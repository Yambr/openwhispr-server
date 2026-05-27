// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260527-im6 — Hybrid admin-claim boot validation +
// timing-safe token comparator + Origin allowlist accessor.
//
// Closes audit findings (.planning/debug/admin-onboarding-security-audit-2026-05-27.md):
//   * HIGH  Dim 5 — email-verify bypass on role flip
//   * MEDIUM Dim 8 — CSRF on pre-claim window
//   * MEDIUM Dim 9 — Origin/Referer allowlist absent
//   * LOW   O1     — audit-log emission gap
//
// Architecture (D1+D2+D4):
//   1. parseSetupClaimToken(env) -> Buffer | undefined
//        Enforces /^[0-9a-f]{64}$/ shape + a bad-pattern reject list
//        (D4) + an exact-string allowlist of documented example values.
//        A3 -- the bad-pattern regexes are lowercase-only (no /i flag)
//        because the upstream shape gate guarantees lowercase input.
//   2. safeTokenCompare(presented, expected) -> boolean
//        Wraps crypto.timingSafeEqual; pre-validates length so the
//        ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH throw is unreachable.
//   3. validateSetupClaimBoot({db, env, onFail}) -> Promise<...>
//        Reads setup_state.status; refuses boot (exit 78 EX_CONFIG)
//        when status='pending' AND no claim path is configured.
//        Returns the parsed token Buffer so the route layer consumes
//        it via deps without re-parsing (A1 single-parse property).
//   4. getAllowedOrigins({ingressBaseUrl, env}) -> AllowedOriginsAccessor
//        Parses INGRESS_BASE_URL + ADDITIONAL_ALLOWED_ORIGINS into a
//        strict-equality allowlist. Each entry is origin-only (no
//        path/query/hash); boot-validated.
//
// LOCKER-01: this module lives under `config/` (the env-reading allowlist).
// Reading env vars here is compliant; the route layer consumes the
// returned values via deps without touching `process.env`.

import { timingSafeEqual } from "node:crypto";
import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import { sql } from "drizzle-orm";

const EX_CONFIG = 78;

/**
 * Canonical lowercase-hex64 shape gate for OPENWHISPR_SETUP_CLAIM_TOKEN.
 * 64 chars * 4 bits/char = 256 bits of entropy when sourced from
 * `openssl rand -hex 32`. Lowercase-only by convention (single canonical
 * shape across the project, mirrors BETTER_AUTH_SECRET operator UX).
 */
export const OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT = /^[0-9a-f]{64}$/;

/**
 * Boot-time configuration error for the setup-claim path. Surfaces via
 * `onFail()` (= process.exit(78) in production, throws in tests) so the
 * operator sees the exact violation on stderr.
 *
 * Constructor-side body truncation per LOCKER-05 is unnecessary here
 * because no credential-shaped value reaches the message string.
 */
export class SetupClaimConfigError extends Error {
  override name = "SetupClaimConfigError";
  constructor(message: string) {
    super(message);
  }
}

// D4 — bad-pattern allowlist. A3 -- the upstream shape gate
// (OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT, lowercase hex64) guarantees
// `raw` is already lowercase ASCII by the time these run, so the `/i`
// flag is unreachable dead code. Drop it from every regex below -- the
// lowercase shape gate is the single source of truth for case.
const BAD_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^([0-9a-f])\1{63}$/, // single-char repeat (all zeros, all a's, etc.) -- no /i flag
  /^(deadbeef){8}$/, // canonical test/marker hex -- no /i flag
  /^(0123456789abcdef){4}$/, // ascending-hex repeat -- no /i flag
];

/**
 * Exact-string allowlist of docs-example values that operators must NOT
 * paste verbatim. Currently empty in v1 because docs/operations.md uses
 * the literal `<your-generated-hex64>` placeholder (no concrete value
 * worth rejecting). If a future docs revision bakes a concrete example
 * value into the runbook, add the exact lowercase-hex64 string here so
 * the boot validator refuses to start with that value.
 */
export const REJECTED_EXAMPLE_TOKENS: ReadonlySet<string> = new Set<string>([
  // Empty in v1 -- docs use `<your-generated-hex64>` placeholder.
]);

/**
 * Parse OPENWHISPR_SETUP_CLAIM_TOKEN into a 32-byte Buffer.
 *
 * Returns `undefined` when the env var is unset or blank-after-trim
 * (env-token mode disabled).
 * Throws `SetupClaimConfigError` on:
 *   * non-conforming shape (length, non-hex, uppercase),
 *   * BAD_TOKEN_PATTERNS match (low-entropy / well-known repeat),
 *   * REJECTED_EXAMPLE_TOKENS exact-match (docs example pasted as-is).
 *
 * Caller responsibilities: the boot validator (`validateSetupClaimBoot`)
 * is the SINGLE production call-site for this function -- A1 single-parse
 * property. Route layers MUST consume the returned Buffer via
 * `SetupAdminDeps.envClaimTokenBuffer` and MUST NOT re-call this parser.
 */
export function parseSetupClaimToken(env: NodeJS.ProcessEnv): Buffer | undefined {
  const raw = env.OPENWHISPR_SETUP_CLAIM_TOKEN?.trim();
  if (!raw) return undefined;
  if (!OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT.test(raw)) {
    throw new SetupClaimConfigError(
      "OPENWHISPR_SETUP_CLAIM_TOKEN does not match the canonical hex64 shape " +
        "(/^[0-9a-f]{64}$/). Generate with: openssl rand -hex 32",
    );
  }
  // From this point onward `raw` is guaranteed lowercase ASCII hex by the
  // shape gate above. The bad-pattern regexes therefore do NOT need the
  // /i flag (A3) -- the lowercase shape gate is the single source of
  // truth for case.
  for (const re of BAD_TOKEN_PATTERNS) {
    if (re.test(raw)) {
      throw new SetupClaimConfigError(
        `OPENWHISPR_SETUP_CLAIM_TOKEN matches a low-entropy / well-known pattern (${re.source}). ` +
          "Generate a fresh token with: openssl rand -hex 32",
      );
    }
  }
  if (REJECTED_EXAMPLE_TOKENS.has(raw)) {
    throw new SetupClaimConfigError(
      "OPENWHISPR_SETUP_CLAIM_TOKEN matches a documented example value verbatim. " +
        "Do NOT use docs example values in production; generate a fresh token with: openssl rand -hex 32",
    );
  }
  return Buffer.from(raw, "hex");
}

/**
 * Constant-time compare of a presented token Buffer against the
 * boot-parsed expected Buffer. Returns false on any of:
 *   * either operand undefined,
 *   * length mismatch (pre-validated to avoid the
 *     ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH throw -- RESEARCH R3.1),
 *   * byte arrays differ.
 * NEVER throws. The handler maps the boolean to 200/403.
 */
export function safeTokenCompare(
  presented: Buffer | undefined,
  expected: Buffer | undefined,
): boolean {
  if (!presented || !expected) return false;
  if (presented.length !== expected.length) return false;
  // crypto.timingSafeEqual contract empirically verified (RESEARCH R3.1):
  // throws on unequal lengths; we pre-validate to avoid the throw.
  return timingSafeEqual(presented, expected);
}

/**
 * Result of `validateSetupClaimBoot`. The route layer consumes
 * `envTokenBuffer` directly (A1 single-parse property).
 */
export interface SetupClaimBootValidation {
  readonly hasEnvToken: boolean;
  /**
   * A1 -- the parsed env-token Buffer (or `undefined` when the env var
   * is unset). Threaded into `SetupAdminDeps.envClaimTokenBuffer`. The
   * route MUST NOT re-call `parseSetupClaimToken`; that would double-
   * parse and double-validate.
   */
  readonly envTokenBuffer?: Buffer;
  readonly hasSmtp: boolean;
  readonly setupStateStatus: "pending" | "completed" | "skipped_legacy";
}

export interface SetupClaimBootInput {
  readonly db: TransactionalDb<ExecutableTx>;
  readonly env?: NodeJS.ProcessEnv;
  readonly onFail?: (message: string) => never;
}

/**
 * Async boot validator. Mirrors `validateAuthBoot`'s `(env, onFail)`
 * injection shape (RESEARCH R4.1) but is async because it reads
 * `setup_state.status` from the DB.
 *
 * Gate logic:
 *   * status='pending' AND no env-token AND no SMTP_HOST -> refuse boot.
 *   * Any other combination passes (status='completed' / 'skipped_legacy'
 *     short-circuits since the wizard is past the claim window).
 *
 * `env.NODE_ENV === 'test'` returns a permissive result without
 * exiting -- mirrors `validateAuthBoot`'s test-permissive default
 * (RESEARCH R4.1 #6). The dedicated setup-claim.test.ts suite still
 * exercises the strict matrix by passing onFail spies.
 */
export async function validateSetupClaimBoot(
  input: SetupClaimBootInput,
): Promise<SetupClaimBootValidation> {
  const env = input.env ?? process.env;
  const onFail: (message: string) => never = input.onFail ?? defaultFail;

  const isTest = env.NODE_ENV === "test";

  // Parse the env-token (may throw SetupClaimConfigError on shape /
  // entropy / example-match failure). A1 -- this is the SINGLE canonical
  // call site; the route does NOT re-parse.
  let envBuffer: Buffer | undefined;
  try {
    envBuffer = parseSetupClaimToken(env);
  } catch (err) {
    if (err instanceof SetupClaimConfigError) {
      onFail(`setup-claim-boot: ${err.message}`);
    }
    throw err;
  }
  const hasEnvToken = envBuffer !== undefined;
  const hasSmtp = Boolean(env.SMTP_HOST?.trim());

  // Read setup_state.status from the singleton row. Defensive default
  // (matches setup-state.ts:43-58 defensive read).
  let status: "pending" | "completed" | "skipped_legacy" = "pending";
  try {
    await input.db.transaction(async (tx: ExecutableTx) => {
      // Defensive optional chain on `result` itself: under contention /
      // empty-result-set races, `tx.execute()` can resolve with
      // `undefined` rather than a `{rows:[]}` envelope (observed in
      // entrypoint-db-shape unit test against the fake-Drizzle harness;
      // and mirrors the empirically reproducible production failure
      // mode where the driver returns void for SELECT on a transient
      // empty cursor). The previous `result.rows?.[0]` access crashed
      // with `TypeError: Cannot read properties of undefined (reading
      // 'rows')` -- defensive read keeps the existing "default pending"
      // posture intact while restoring crash-resistance.
      const result = (await tx.execute(sql`SELECT status FROM setup_state WHERE id = 1`)) as
        | { rows?: Array<{ status?: "pending" | "completed" | "skipped_legacy" }> }
        | undefined;
      const row = result?.rows?.[0];
      if (row?.status) status = row.status;
    });
  } catch (err) {
    // DB query failure at boot is NOT a no-op -- propagate so the
    // operator sees it. Same posture as validateBetterAuthSecretBoot.
    throw err;
  }

  // Gate: refuse boot iff status='pending' AND no claim path configured.
  if (status === "pending" && !hasEnvToken && !hasSmtp) {
    if (isTest) {
      // Tests injecting their own env+db can still hit the strict path
      // by passing onFail; permissive default applies only when the
      // test harness omits both.
      return { hasEnvToken, hasSmtp, setupStateStatus: status };
    }
    onFail(
      "setup-claim-boot: setup_state.status='pending' but no admin claim path is configured. " +
        "Set OPENWHISPR_SETUP_CLAIM_TOKEN (env-token mode; generate with `openssl rand -hex 32`) " +
        "OR set SMTP_HOST + the SMTP_FROM/SMTP_AUTH transport vars (email-verified mode). " +
        "See docs/operations.md section 'Admin Claim Modes'.",
    );
  }

  // A1 -- return the parsed Buffer so the route can call
  // safeTokenCompare(presented, validation.envTokenBuffer) without ever
  // invoking parseSetupClaimToken again.
  return {
    hasEnvToken,
    ...(envBuffer ? { envTokenBuffer: envBuffer } : {}),
    hasSmtp,
    setupStateStatus: status,
  };
}

/**
 * Strict-equality allowed-origin accessor.
 *
 * Built from `INGRESS_BASE_URL` (canonical) + the optional
 * comma-separated `ADDITIONAL_ALLOWED_ORIGINS` env var (zero or more
 * additional entries). Each entry is checked by `===` at request time;
 * there is NO wildcard, NO suffix-match, NO `startsWith`.
 *
 * Boot-validated -- malformed entries throw `SetupClaimConfigError`
 * which is converted to exit 78 via `onFail` in the boot validator.
 */
export interface AllowedOriginsAccessor {
  /** Canonical origin parsed from `INGRESS_BASE_URL` (always present). */
  readonly canonical: string;
  /** Additional strict-equality allowed origins from `ADDITIONAL_ALLOWED_ORIGINS`. */
  readonly additional: ReadonlyArray<string>;
  /** Flat union for preHandler `Set.has()` checks. */
  readonly all: ReadonlyArray<string>;
}

export interface GetAllowedOriginsInput {
  readonly ingressBaseUrl: string;
  readonly env?: NodeJS.ProcessEnv;
}

export function getAllowedOrigins(input: GetAllowedOriginsInput): AllowedOriginsAccessor {
  const env = input.env ?? process.env;
  let canonical: string;
  try {
    canonical = new URL(input.ingressBaseUrl).origin;
  } catch {
    throw new SetupClaimConfigError(
      `INGRESS_BASE_URL "${input.ingressBaseUrl}" is not a valid URL; ` +
        "cannot derive canonical allowed origin.",
    );
  }
  const rawAdditional = env.ADDITIONAL_ALLOWED_ORIGINS?.trim();
  const additional: string[] = [];
  if (rawAdditional) {
    for (const piece of rawAdditional.split(",")) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        throw new SetupClaimConfigError(
          `ADDITIONAL_ALLOWED_ORIGINS entry "${trimmed}" is not a valid URL. ` +
            "Each entry must be a full scheme://host[:port] origin (no path, no query, no hash).",
        );
      }
      if (parsed.pathname !== "/" && parsed.pathname !== "") {
        throw new SetupClaimConfigError(
          `ADDITIONAL_ALLOWED_ORIGINS entry "${trimmed}" contains a path; ` +
            "each entry must be origin-only (scheme://host[:port]).",
        );
      }
      if (parsed.search || parsed.hash) {
        throw new SetupClaimConfigError(
          `ADDITIONAL_ALLOWED_ORIGINS entry "${trimmed}" contains query or hash; ` +
            "each entry must be origin-only (scheme://host[:port]).",
        );
      }
      if (!parsed.origin || parsed.origin === "null") {
        throw new SetupClaimConfigError(
          `ADDITIONAL_ALLOWED_ORIGINS entry "${trimmed}" did not resolve to a non-null URL.origin.`,
        );
      }
      additional.push(parsed.origin);
    }
  }
  const all: ReadonlyArray<string> = [canonical, ...additional];
  return { canonical, additional, all };
}

function defaultFail(message: string): never {
  // biome-ignore lint/suspicious/noConsole: pre-logger boot path -- stderr is the only sink.
  console.error(`FATAL ${message}`);
  process.exit(EX_CONFIG);
}
