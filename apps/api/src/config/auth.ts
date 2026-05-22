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

import { redactUrl } from "@openwhispr/byok-guard";

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

  // CodeQL #21 (js/clear-text-logging) — AUTH_URL may carry userinfo
  // credentials; redact before it reaches the stderr log sink.
  const safeAuthUrl = redactUrl(authUrl);

  if (!isHttps && !isHttp) {
    onFail(
      `auth-boot: AUTH_URL is required and must start with http:// or https://. ` +
        `Got: ${JSON.stringify(safeAuthUrl)}.`,
    );
  }

  if (isProduction && !isHttps) {
    onFail(
      `auth-boot: NODE_ENV=production with non-HTTPS AUTH_URL (${safeAuthUrl}). ` +
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

// Phase 57 / Track E — api-routes-rest:CR-01 ingress-origin boot guard.
//
// `better-auth-handler.ts:buildRequestUrl` reconstructs the request URL
// Better Auth uses for CSRF / Origin / redirect-uri validation. The
// pre-fix code fell back to the attacker-controlled `req.headers.host`
// header when neither INGRESS_BASE_URL nor AUTH_URL was set — letting a
// forged `Host: evil.example.com` bypass Better Auth's origin checks on
// any deploy that did not set those env vars.
//
// `validateIngressBoot()` closes the hole at the only safe layer: boot.
// It REFUSES to start the process (exit 78 EX_CONFIG, matching
// `validateAuthBoot()` / `validateEncryptionBoot()`) when BOTH
// INGRESS_BASE_URL (preferred) and AUTH_URL are unset. After the gate,
// `buildRequestUrl` reads only the validated env value — `req.headers.host`
// is never an origin source.
//
// LOCKER-01: this module lives under `config/` (the allowlist for
// `process.env.*` reads). INGRESS_BASE_URL / AUTH_URL are not NODE_ENV
// branches; reading them here is compliant.

export interface IngressBootValidation {
  /** The validated canonical origin — INGRESS_BASE_URL preferred, else AUTH_URL. */
  readonly ingressBaseUrl: string;
}

/**
 * Validate the ingress-origin boot config or refuse to start.
 *
 * @param env Environment snapshot. Defaults to `process.env`; injected
 *   in unit tests to avoid mutating the global.
 * @param onFail Side-effect invoked instead of `process.exit(78)` —
 *   tests pass a spy here to assert exit behaviour without killing the
 *   test runner. Production callers omit this; the default invokes
 *   `process.exit(78)`.
 */
export function validateIngressBoot(
  env: NodeJS.ProcessEnv = process.env,
  onFail: (message: string) => never = defaultFail,
): IngressBootValidation {
  const ingress = env.INGRESS_BASE_URL?.trim();
  const authUrl = env.AUTH_URL?.trim();
  const resolved = ingress || authUrl;

  // Phase 53 / Plan 53-37 parity — vitest sets NODE_ENV=test. Existing
  // buildAuth() unit tests construct the Better Auth instance without
  // populating INGRESS_BASE_URL / AUTH_URL; the production-boot guard
  // must not refuse those harnesses. Treat test env as permissive and
  // return a safe default. The dedicated validate-ingress-boot.test.ts
  // suite still exercises the strict accept/refuse matrix by injecting
  // its own env snapshot (NODE_ENV=development), so the gate is covered.
  if (env.NODE_ENV === "test" && !resolved) {
    return { ingressBaseUrl: "http://localhost:4000" };
  }

  if (!resolved) {
    onFail(
      "ingress-boot: INGRESS_BASE_URL (preferred) or AUTH_URL must be set. " +
        "req.headers.host is NEVER a safe origin source — a forged Host header " +
        "would bypass Better Auth's CSRF / Origin / redirect-uri validation. " +
        "Closes api-routes-rest:CR-01 (Phase 57).",
    );
  }

  if (env.NODE_ENV === "production" && !resolved.startsWith("https://")) {
    onFail(
      // CodeQL #21 (js/clear-text-logging) — INGRESS_BASE_URL / AUTH_URL
      // may carry userinfo credentials; redact before the stderr sink.
      `ingress-boot: NODE_ENV=production requires an HTTPS origin. ` +
        `Got: ${JSON.stringify(redactUrl(resolved))}. Set INGRESS_BASE_URL=https://...`,
    );
  }

  return { ingressBaseUrl: resolved };
}

// Phase 59 / Track C — R18: sign-in/email null-Origin relaxation.
//
// A non-browser client (the OpenWhispr desktop harness running undici
// `fetch`) sends NO `Origin` header. Better Auth's `validateOrigin`
// middleware throws `403 MISSING_OR_NULL_ORIGIN` before `trustedOrigins`
// is ever consulted — so a `trustedOrigins` predicate cannot rescue it.
// The supported, path-scoped escape hatch is `advanced.disableOriginCheck`
// as a string-array of path prefixes.
//
// `relaxNullOrigin` is true ONLY under the SAME double-gate the
// seed-tenant test route uses (R1 / R13): `OPENWHISPR_TEST_ROUTES==="true"`
// AND `NODE_ENV!=="production"`. Production NEVER relaxes the Origin /
// CSRF posture — there is no env-var that flips this on in production.
//
// LOCKER-01: this module lives under `config/` (the allowlist for
// `process.env.*` / `NODE_ENV` reads). The boolean is computed here, at
// boot, and consumed by `auth.ts` as a plain derived constant — no
// `NODE_ENV` comparison leaks into the route-handling auth builder.

export interface OriginBootValidation {
  /**
   * True when the runtime may skip Better Auth's Origin check for the
   * test-only sign-in paths. Double-gated; false in production always.
   */
  readonly relaxNullOrigin: boolean;
}

export function validateOriginBoot(env: NodeJS.ProcessEnv = process.env): OriginBootValidation {
  const testRoutes = env.OPENWHISPR_TEST_ROUTES === "true";
  const isProduction = env.NODE_ENV === "production";
  return { relaxNullOrigin: testRoutes && !isProduction };
}
