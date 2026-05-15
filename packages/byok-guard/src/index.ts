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
  const endpoint = env.S3_ENDPOINT;
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
  const missing = partnerKeys.filter((k) => !env[k]);
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
  if (otlp === "disabled") return null; // sentinel — otel-bootstrap handles no-op
  if (!otlp) {
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
  if (!env.INGRESS_BASE_URL) {
    return {
      event: "byok.required",
      code: "BYOK_INGRESS_REQUIRED",
      overlay: "ingress",
      missing: ["INGRESS_BASE_URL"],
      hint: buildHint("ingress"),
    };
  }
  return null;
};

/**
 * PgBouncer row: DATABASE_URL. Already required for all profiles; this
 * row is documentation that surfaces a clear loud-fail code rather than
 * a downstream pg "missing config" error.
 */
const pgbouncerRow: RowEvaluator = (env) => {
  if (!env.DATABASE_URL) {
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
  if (env.NODE_ENV !== "production") return null;
  if (!env.SMTP_HOST) {
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
export function assertBYOKConfig(
  env: NodeJS.ProcessEnv = process.env,
  opts?: AssertBYOKConfigOpts,
): void {
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
    throw new BYOKGuardError(msg);
  }
}
