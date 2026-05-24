// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 14 / Plan 04 / Task 1 — BYOK boot-time guard.
//
// Source-of-truth:
//   - .planning/phases/14-slim-core-byok-profiles-v2/14-CONTEXT.md decision 2
//   - .planning/phases/14-slim-core-byok-profiles-v2/14-04-PLAN.md
//   - .planning/REQUIREMENTS.md BYOK-02
//
// Surface: `assertBYOKConfig(env?, opts?)` walks the per-overlay BYOK
// matrix from CONTEXT.md decision 2. For each row, if the required env
// is unset (and NODE_ENV gate is satisfied for SMTP), the guard emits a
// single Pino `fatal({event, code, overlay, missing, hint}, msg)` record
// through `pino.final()` (truncation-safe wrapper) and THROWS
// `BYOKGuardError` (Phase 19 / Plan 02; SR-19.3; D-09). On a clean env
// it returns void. The library NO LONGER calls `process.exit(1)`:
// entrypoints (apps/api, apps/worker) catch BYOKGuardError, log with
// their own pino, and exit. This restores process-boundary discipline
// (SERVER-ERRORS Entry 4; PATTERNS surface 5).
//
// First-violation-only: if multiple overlays are misconfigured, the guard
// fires ONCE on the FIRST matrix row in declaration order (storage →
// observability → ingress → pgbouncer → dev-tools) and exits. Operators
// fix one at a time; multi-fatal noise is anti-pattern.
//
// Loud-fail discipline:
//   * Phase 19 / Plan 02 (SR-19.3, D-09): the library THROWS
//     `BYOKGuardError` after logging the fatal record. Entrypoints
//     catch + log + `process.exit(1)`. The exit-code decision lives at
//     the process boundary, not in the library.
//   * Synchronous Pino destination (`pino.destination({ sync: true })`)
//     avoids the truncation pitfall called out in Pino's fatal docs.
//     Pino 9 removed the legacy `pino.final()` wrapper (deprecated since
//     v6); the modern flush-before-exit guarantee is "construct the
//     destination in sync mode" — every `logger.fatal()` write flushes
//     synchronously before the next statement runs, so the subsequent
//     `throw` (and the entrypoint's eventual `process.exit(1)`) cannot
//     truncate the fatal line. CONTEXT.md decision 2 names
//     `pino.final()` by analogy; the operational invariant is identical.
//   * MUST fire BEFORE installGlobalSSRF() and BEFORE the otel-bootstrap
//     side-effect import, so a misconfigured OTLP endpoint doesn't
//     produce cascading dial noise before the guard message reaches
//     stderr.
//
// Coverage discipline (per PROJECT.md constitution): the test surface
// at src/__tests__/byok-guard.test.ts hits every branch including
// happy-path (no fatal, no exit), per-row violation, the =disabled
// sentinel short-circuit, the NODE_ENV gate for SMTP, first-violation
// ordering, redaction of credential-bearing strings, and the
// pino.final() wrap.

import pino, { type Logger } from "pino";
import { redactUrl } from "./redact-url.js";

/**
 * Phase 51 / Plan 51-02 (REVIEW-INDEX CR-10) — re-export `redactUrl` so
 * `apps/api` and `apps/worker` consume the single canonical
 * implementation. The previous dual implementation in
 * `apps/api/src/lib/redact-url.ts` was a `URL.password`-only stub that
 * leaked JWTs, query-value bearer shapes, and hash-fragment tokens.
 */
export { redactUrl } from "./redact-url.js";

/**
 * Phase 51 / Plan 51-16 (REVIEW byok-guard HIGH cluster) — env-value
 * normalization helpers.
 *
 * Pre-fix the guard treated any non-empty env value as "present" via
 * a bare `if (!env.X)` check. Whitespace-only values (a common
 * .env-file accident, or an operator pasting a key with a trailing
 * newline) therefore passed the gate AND broke downstream consumers
 * with a non-canonical error. Same shape for case-sensitive sentinel
 * checks: `=disabled` accepted ONLY the lowercase literal, so
 * `=Disabled` or `=DISABLED` (operator equivalents) silently fell
 * through to "missing".
 */
function normEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const t = value.trim();
  return t.length === 0 ? undefined : t;
}

function isSentinelDisabled(value: string | undefined): boolean {
  return normEnv(value)?.toLowerCase() === "disabled";
}

function normNodeEnv(value: string | undefined): string {
  return (normEnv(value) ?? "").toLowerCase();
}

/**
 * Phase 19 / Plan 02 (SR-19.3, D-09) — error thrown when an overlay's
 * BYOK env contract is unsatisfied. The library logs the structured
 * fatal record (via the boot pino) and THROWS this typed error;
 * process-boundary callers (apps/api + apps/worker entrypoints) catch
 * + log + `process.exit(1)`. Replaces the prior in-library
 * `process.exit(1)` which violated process-boundary discipline
 * (SERVER-ERRORS Entry 4, PATTERNS surface 5).
 */
export class BYOKGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BYOKGuardError";
  }
}

/**
 * Construct a Pino logger backed by a synchronous destination on stderr
 * (fd 2). Synchronous mode is the Pino-9 replacement for the deprecated
 * `pino.final()` wrapper: every `.fatal()` write reaches the OS buffer
 * before the next JS statement runs, so a subsequent `process.exit(1)`
 * never truncates the log line.
 *
 * Extracted as a module-level helper so the test surface can spy on it
 * and assert that the loud-fail path goes through this constructor
 * (verifying the "no direct unsynced logger.fatal" discipline that the
 * legacy `pino.final()` wrapper used to encode).
 */
export function createBootLogger(): Logger {
  return pino({ name: "boot" }, pino.destination({ sync: true, dest: 2 }));
}

export type BYOKOverlay = "storage" | "observability" | "ingress" | "pgbouncer" | "dev-tools";

export type BYOKErrorCode =
  | "BYOK_STORAGE_REQUIRED"
  | "BYOK_OBSERVABILITY_REQUIRED"
  | "BYOK_INGRESS_REQUIRED"
  | "BYOK_DATABASE_REQUIRED"
  | "BYOK_SMTP_REQUIRED";

export interface BYOKFatalRecord {
  readonly event: "byok.required";
  readonly code: BYOKErrorCode;
  readonly overlay: BYOKOverlay;
  readonly missing: readonly string[];
  readonly hint: string;
}

export interface AssertBYOKConfigOpts {
  /**
   * Optional pre-constructed Pino logger. Tests inject a logger wired to
   * an in-memory `Writable` so they can parse the emitted NDJSON record
   * without spawning a child process. Production callers omit this and
   * the guard constructs its own `pino({ name: "boot" })`.
   */
  readonly logger?: Logger;
}

/**
 * Per-row evaluator. Returns the fatal record to emit, or `null` when
 * the row is satisfied. Closes over `env` for read-only access.
 */
type RowEvaluator = (env: NodeJS.ProcessEnv) => BYOKFatalRecord | null;

/**
 * Build a redacted overlay hint. Includes the canonical `docker compose -f
 * docker-compose.yml -f compose/docker-compose.<overlay>.yml up` invocation
 * plus a redacted echo of any credential-bearing env value so operators
 * can verify the misconfigured value without secrets leaking to stderr.
 */
function buildHint(overlay: BYOKOverlay, redactedEcho?: string): string {
  const base = `Set the missing env(s) OR enable the overlay (docker compose -f docker-compose.yml -f compose/docker-compose.${overlay}.yml up).`;
  if (redactedEcho !== undefined && redactedEcho !== "") {
    return `${base} Observed value: ${redactedEcho}`;
  }
  return base;
}

/**
 * Storage row: S3_ENDPOINT (+ partner keys when ENDPOINT is set).
 * No NODE_ENV gate (loud-fail unconditional per CONTEXT.md decision 2).
 */
const storageRow: RowEvaluator = (env) => {
  const endpoint = normEnv(env.S3_ENDPOINT);
  if (!endpoint) {
    return {
      event: "byok.required",
      code: "BYOK_STORAGE_REQUIRED",
      overlay: "storage",
      missing: ["S3_ENDPOINT"],
      hint: buildHint("storage"),
    };
  }
  // ENDPOINT set — partner keys must also be set, or the operator has
  // configured S3 partially and the upload path would crash at runtime.
  const partnerKeys = ["S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"] as const;
  const missing = partnerKeys.filter((k) => !normEnv(env[k]));
  if (missing.length > 0) {
    return {
      event: "byok.required",
      code: "BYOK_STORAGE_REQUIRED",
      overlay: "storage",
      missing,
      hint: buildHint("storage", redactUrl(endpoint)),
    };
  }
  return null;
};

/**
 * Observability row: OTEL_EXPORTER_OTLP_ENDPOINT, with the `=disabled`
 * sentinel short-circuit per CONTEXT.md decision 5.
 */
const observabilityRow: RowEvaluator = (env) => {
  const otlp = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  // Phase 51 / Plan 51-16 — case-insensitive + whitespace-tolerant
  // sentinel. Pre-fix `=Disabled` / `= DISABLED ` fell through to
  // "missing".
  if (isSentinelDisabled(otlp)) return null;
  if (!normEnv(otlp)) {
    return {
      event: "byok.required",
      code: "BYOK_OBSERVABILITY_REQUIRED",
      overlay: "observability",
      missing: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
      hint: buildHint("observability"),
    };
  }
  return null;
};

/** Ingress row: INGRESS_BASE_URL. No NODE_ENV gate. */
const ingressRow: RowEvaluator = (env) => {
  // Phase 51 / Plan 51-16 — whitespace-tolerant + cascade for TLS.
  // When INGRESS_BASE_URL is `https://…` and INGRESS_TLS_CERT_PATH is
  // unset, refuse to boot — the operator paired TLS scheme with no
  // cert path, and Traefik will fail to load the ingress chain at
  // runtime with a far less actionable error.
  const base = normEnv(env.INGRESS_BASE_URL);
  if (!base) {
    return {
      event: "byok.required",
      code: "BYOK_INGRESS_REQUIRED",
      overlay: "ingress",
      missing: ["INGRESS_BASE_URL"],
      hint: buildHint("ingress"),
    };
  }
  if (base.startsWith("https://")) {
    const certPath = normEnv(env.INGRESS_TLS_CERT_PATH);
    if (!certPath) {
      return {
        event: "byok.required",
        code: "BYOK_INGRESS_REQUIRED",
        overlay: "ingress",
        missing: ["INGRESS_TLS_CERT_PATH"],
        hint: buildHint("ingress", redactUrl(base)),
      };
    }
  }
  return null;
};

/**
 * PgBouncer row: DATABASE_URL. Already required for all profiles; this
 * row is documentation that surfaces a clear loud-fail code rather than
 * a downstream pg "missing config" error.
 */
const pgbouncerRow: RowEvaluator = (env) => {
  if (!normEnv(env.DATABASE_URL)) {
    return {
      event: "byok.required",
      code: "BYOK_DATABASE_REQUIRED",
      overlay: "pgbouncer",
      missing: ["DATABASE_URL"],
      hint: buildHint("pgbouncer"),
    };
  }
  return null;
};

/**
 * Dev-tools row: SMTP_HOST, NODE_ENV=production only.
 * Matches the createEmailSender precedent at
 * packages/email/src/EmailSender.ts:74-91.
 */
const devToolsRow: RowEvaluator = (env) => {
  // Phase 51 / Plan 51-16 — case-insensitive NODE_ENV compare so
  // `Production` (capital-P, a common CI / Helm-chart typo) doesn't
  // bypass the gate.
  if (normNodeEnv(env.NODE_ENV) !== "production") return null;
  if (!normEnv(env.SMTP_HOST)) {
    return {
      event: "byok.required",
      code: "BYOK_SMTP_REQUIRED",
      overlay: "dev-tools",
      missing: ["SMTP_HOST"],
      hint: buildHint("dev-tools"),
    };
  }
  return null;
};

/**
 * Matrix in declaration order — drives first-violation-only behavior.
 * Operators see ONE clear failure per boot attempt; fix-and-retry is
 * a tight loop.
 */
const BYOK_MATRIX: readonly RowEvaluator[] = [
  storageRow,
  observabilityRow,
  ingressRow,
  pgbouncerRow,
  devToolsRow,
];

/**
 * Walk the BYOK matrix and refuse to start when an overlay's BYOK env
 * contract is unsatisfied. Pure over `env` (default arg is `process.env`).
 *
 * @param env  - environment to inspect (defaults to `process.env`)
 * @param opts - optional logger injection point for tests
 */
/**
 * Detect the `OPENWHISPR_DEPLOYMENT_MODE=k8s` kill-switch.
 *
 * Downstream k8s consumers (Yambr et al.) bring observability, storage,
 * and ingress via Kubernetes-native primitives (ServiceMonitor,
 * envFromSecret, HTTPRoute, etc.) — not docker compose overlays. The
 * compose-era `storage` / `observability` / `ingress` rows in the BYOK
 * matrix loud-fail in that environment even though every real
 * application secret (MASTER_KEK, BETTER_AUTH_SECRET, DATABASE_URL,
 * LITELLM_*, S3_*) is correctly provided via Kubernetes Secrets.
 *
 * When this env var is set to `k8s` (case-insensitive, whitespace-
 * tolerant), `assertBYOKConfig` short-circuits ALL matrix rows and
 * returns void. The `pgbouncer` (DATABASE_URL) and `dev-tools` (SMTP)
 * rows are bypassed alongside the compose-era trio because operators
 * provide them via the same external-Secret mechanism — the in-app
 * code paths that actually consume DATABASE_URL / SMTP_HOST still
 * fail loudly at first use, so we don't lose the safety net, only
 * the compose-overlay framing.
 *
 * Default (unset, or any non-`k8s` value): compose-mode behavior is
 * preserved — full BYOK matrix evaluated.
 */
function isK8sDeploymentMode(env: NodeJS.ProcessEnv): boolean {
  return normEnv(env.OPENWHISPR_DEPLOYMENT_MODE)?.toLowerCase() === "k8s";
}

export function assertBYOKConfig(
  env: NodeJS.ProcessEnv = process.env,
  opts?: AssertBYOKConfigOpts,
): void {
  if (isK8sDeploymentMode(env)) {
    // Operator-visibility log: one structured info record so the
    // bypass is auditable in Loki / kubectl logs without surprising
    // operators who grep for guard activity.
    const logger = opts?.logger ?? createBootLogger();
    logger.info(
      { event: "byok.bypassed", mode: "k8s" },
      "byok-guard bypassed: OPENWHISPR_DEPLOYMENT_MODE=k8s",
    );
    return;
  }
  for (const row of BYOK_MATRIX) {
    const record = row(env);
    if (record === null) continue;
    // Lazily construct the logger so happy-path boots allocate nothing.
    // Synchronous destination is the Pino-9 flush-before-exit guarantee.
    const logger = opts?.logger ?? createBootLogger();
    const msg = "BYOK env missing for disabled overlay; refusing to start";
    logger.fatal(record, msg);
    // Phase 19 / Plan 02 (SR-19.3, D-09): throw instead of process.exit.
    // Entrypoints (apps/api, apps/worker) catch BYOKGuardError, log via
    // their own logger, and call process.exit(1). Library is now pure;
    // exit-code decision lives at the process boundary.
    //
    // Phase 51 / Plan 51-16 — thread the missing-key list into the
    // error message so tests + log readers can disambiguate WHICH
    // env failed without parsing the structured log. The original
    // pino.fatal record is still the canonical machine-readable
    // surface; this string is a human convenience.
    const detail = `${msg} (overlay=${record.overlay}, missing=${record.missing.join(",")})`;
    throw new BYOKGuardError(detail);
  }
}
