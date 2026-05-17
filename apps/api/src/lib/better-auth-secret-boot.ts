// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-03 — boot-time validator for BETTER_AUTH_SECRET.
//
// Pre-publication review (REVIEW-INDEX CR-1) found that
// `apps/api/src/auth.ts:325` passes `process.env.BETTER_AUTH_SECRET`
// straight to `betterAuth({...})` with no validation. Better Auth 1.6.9
// does NOT validate `secret` at construction; missing or short values
// silently sign session tokens with `undefined`, yielding forgeable
// cookies the moment the first user signs in.
//
// Wired into bootstrap alongside `validateEncryptionBoot()` so a single
// loud-fail surface owns every "the secret env is malformed" exit. Uses
// the same BSD EX_CONFIG (78) exit code so operators can disambiguate
// "config error" vs "runtime crash" in systemd/k8s.
//
// Thresholds:
//  * MUST be present.
//  * MUST decode (best-effort base64url) OR measure raw to >= 32 bytes.
//    Better Auth uses the secret as an HMAC key; 32 bytes is the AES-256
//    floor and matches the MASTER_KEK contract for operator consistency.
//
// The validator is intentionally narrow — we don't try to estimate
// entropy or reject known-weak strings. Length-floor + presence are
// sufficient defense-in-depth for the constitutional gate.

/** BSD sysexits(3) EX_CONFIG. Mirrors `MasterKekMissingError.EXIT_CODE`. */
export const EX_CONFIG = 78;

export class BetterAuthSecretMissingError extends Error {
  static readonly EXIT_CODE = EX_CONFIG;
  readonly EXIT_CODE = BetterAuthSecretMissingError.EXIT_CODE;
  constructor() {
    super(
      "BETTER_AUTH_SECRET env var not set. Generate a 32-byte secret " +
        "(e.g. `openssl rand 32 | base64 | tr '+/' '-_' | tr -d '='`) " +
        "and set BETTER_AUTH_SECRET to its base64url encoding.",
    );
    this.name = "BetterAuthSecretMissingError";
  }
}

export class BetterAuthSecretTooShortError extends Error {
  static readonly EXIT_CODE = EX_CONFIG;
  readonly EXIT_CODE = BetterAuthSecretTooShortError.EXIT_CODE;
  constructor(measuredBytes: number) {
    super(
      `BETTER_AUTH_SECRET must be at least 32 bytes (HMAC-key floor); got ${measuredBytes} bytes after the larger of (base64url decode, raw UTF-8 length).`,
    );
    this.name = "BetterAuthSecretTooShortError";
  }
}

function failConfig(err: Error): never {
  process.stderr.write(`[better-auth-secret-boot] FATAL ${err.name}: ${err.message}\n`);
  // We `as never`-cast through `process.exit` because tests stub it to
  // throw a synthetic exit-marker error; the production path simply
  // terminates the process before any caller can observe a return value.
  return process.exit(BetterAuthSecretMissingError.EXIT_CODE) as never;
}

/**
 * Assert BETTER_AUTH_SECRET is present + >= 32 bytes. Calls
 * `process.exit(78)` via `failConfig` on any violation.
 *
 * @param env - process env (defaults to `process.env`). Pure-function
 *   parameterisation simplifies tests (`captureExit` pattern in the
 *   sibling test).
 */
export function validateBetterAuthSecretBoot(env: NodeJS.ProcessEnv = process.env): void {
  const raw = env.BETTER_AUTH_SECRET;
  if (!raw) {
    failConfig(new BetterAuthSecretMissingError());
  }
  // Best-effort base64url decode. Buffer.from(*, "base64url") is total
  // (silently drops out-of-alphabet bytes), so we ALSO check raw UTF-8
  // length and use whichever is larger — operators paste secrets in
  // many encodings; we want to accept any encoding that has >= 32 real
  // bytes of entropy.
  const value = raw as string;
  const decodedBytes = Buffer.from(value, "base64url").length;
  const rawBytes = Buffer.byteLength(value, "utf8");
  const measured = Math.max(decodedBytes, rawBytes);
  if (measured < 32) {
    failConfig(new BetterAuthSecretTooShortError(measured));
  }
}
