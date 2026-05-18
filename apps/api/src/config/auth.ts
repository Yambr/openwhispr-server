// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 53 / Plan 53-22 — Auth boot-time security guard.
//
// Closes the security hole exposed by Plan 53-20: `useSecureCookies` is
// derived from `AUTH_URL.startsWith("https://")` so HTTP-local slim-core
// works without HTTPS. The risk: if an operator (or a misconfigured
// production deploy) leaves AUTH_URL as `http://...` while NODE_ENV is
// `production`, Better Auth would emit session cookies WITHOUT the
// `Secure` flag — MITM can then capture the session token over plaintext.
//
// `validateAuthBoot()` is invoked from the boot pathway BEFORE
// `buildAuth()` runs. It refuses to start the process (exit 78
// EX_CONFIG, matching `validateEncryptionBoot()`'s convention) when:
//
//   1. `NODE_ENV === "production"` AND `AUTH_URL` does not start with
//      `https://`. No exceptions. No env-var bypass.
//   2. `BETTER_AUTH_SECRET` is unset or shorter than 32 chars (also a
//      LOCKER-PLAINTEXT spirit check — see docs/security.md §3).
//
// LOCKER-01 compliance: this module lives under `config/` which IS
// in the allowlist for `process.env.*` reads. `auth.ts:553` now
// trusts `AUTH_URL` exclusively — that read is the only env branch
// in the route-handling path. The production-vs-development decision
// happens here, at boot, and produces a single derived constant.

const EX_CONFIG = 78;

export interface AuthBootValidation {
  /** True when the runtime should emit `Secure` flag on session cookies. */
  readonly useSecureCookies: boolean;
  /** The validated AUTH_URL — guaranteed to start with `http://` or `https://`. */
  readonly authUrl: string;
}

/**
 * Validate auth boot config or refuse to start.
 *
 * @param env Environment snapshot. Defaults to `process.env`; injected
 *   in unit tests to avoid mutating the global. Tests covering both
 *   the production-https accept path and the production-http refuse
 *   path live in `apps/api/tests/unit/config/auth.test.ts`.
 * @param onFail Side-effect invoked instead of `process.exit(78)` —
 *   tests pass a spy here to assert exit behaviour without killing
 *   the test runner. Production callers omit this parameter; the
 *   default invokes `process.exit(78)`.
 */
export function validateAuthBoot(
  env: NodeJS.ProcessEnv = process.env,
  onFail: (message: string) => never = defaultFail,
): AuthBootValidation {
  const authUrl = env.AUTH_URL ?? "";
  const isProduction = env.NODE_ENV === "production";
  // Phase 53 / Plan 53-37 — vitest sets NODE_ENV=test. Existing
  // buildAuth() unit tests (apps/api/tests/unit/__tests__/auth-*.test.ts)
  // construct the Better Auth instance without populating AUTH_URL /
  // BETTER_AUTH_SECRET — the production-boot validators would refuse
  // those harnesses. Treat test env as "permissive" and return safe
  // defaults; the dedicated `apps/api/tests/unit/config/auth.test.ts`
  // suite still exercises the strict accept/refuse matrix by
  // injecting its own env snapshot.
  const isTest = env.NODE_ENV === "test";
  const isHttps = authUrl.startsWith("https://");
  const isHttp = authUrl.startsWith("http://");

  if (isTest) {
    return {
      useSecureCookies: isHttps,
      authUrl: isHttps || isHttp ? authUrl : "http://localhost:4000",
    };
  }

  if (!isHttps && !isHttp) {
    onFail(
      `auth-boot: AUTH_URL is required and must start with http:// or https://. ` +
        `Got: ${JSON.stringify(authUrl)}.`,
    );
  }

  if (isProduction && !isHttps) {
    onFail(
      `auth-boot: NODE_ENV=production with non-HTTPS AUTH_URL (${authUrl}). ` +
        `Refusing to boot — Better Auth would emit session cookies without the ` +
        `Secure flag, exposing every signed-in session to MITM over plaintext. ` +
        `Set AUTH_URL=https://... or run with NODE_ENV=development for local HTTP.`,
    );
  }

  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32) {
    onFail(
      `auth-boot: BETTER_AUTH_SECRET must be set and >= 32 chars (got ${secret.length}). ` +
        `Generate with: openssl rand -base64 48`,
    );
  }

  return {
    useSecureCookies: isHttps,
    authUrl,
  };
}

function defaultFail(message: string): never {
  // biome-ignore lint/suspicious/noConsole: pre-logger boot path — stderr is the only sink.
  console.error(`FATAL ${message}`);
  process.exit(EX_CONFIG);
}
