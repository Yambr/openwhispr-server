// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-02 / Task 1 — shared OIDC provider discovery.
//
// Two exports, ONE env-reading source of truth (D-08, T-12.02-04
// zero-drift mitigation):
//
//   1. `readOidcProvidersForRegistration(env)` — full-config shape
//      Better Auth's `genericOAuth` plugin consumes (with clientSecret
//      and discoveryUrl). Called from apps/api/src/auth.ts.
//
//   2. `listConfiguredOidcProviders(env)` — public-safe shape returned
//      by `GET /api/auth/providers`. ONLY `{id, name, enabled}` — never
//      a secret, never an issuer URL (RESEARCH §15(c) info-leak gate,
//      T-12.02-01 mitigation).
//
// Both helpers walk the same env permutation: OIDC (issuer+id+secret),
// Google (id+secret), GitHub (id+secret). A future drift between the
// two — e.g. a renamed env var, a new provider — is caught by the
// contract test in routes/__tests__/auth-providers.test.ts (Task 4).
//
// Ordering is stable: [google, github, oidc] when all three are
// configured. The order matches the UI sign-in screen's preferred
// rendering ("Continue with Google" / "Continue with GitHub" /
// "Continue with SSO") and is asserted by the contract test.

/** Public shape returned by `GET /api/auth/providers`. NEVER carries secrets. */
export interface ConfiguredProvider {
  readonly id: "google" | "github" | "oidc";
  readonly name: string;
  readonly enabled: true;
}

/** Better Auth `genericOAuth` config entry — includes clientSecret + discoveryUrl. */
export interface OidcProviderRegistration {
  readonly providerId: string;
  readonly discoveryUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

const DEFAULT_ENV: NodeJS.ProcessEnv = process.env;

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function googleConfigured(env: NodeJS.ProcessEnv): boolean {
  return present(env.GOOGLE_CLIENT_ID) && present(env.GOOGLE_CLIENT_SECRET);
}

function githubConfigured(env: NodeJS.ProcessEnv): boolean {
  return present(env.GITHUB_CLIENT_ID) && present(env.GITHUB_CLIENT_SECRET);
}

function oidcConfigured(env: NodeJS.ProcessEnv): boolean {
  return (
    present(env.OIDC_ISSUER_URL) && present(env.OIDC_CLIENT_ID) && present(env.OIDC_CLIENT_SECRET)
  );
}

/**
 * Return the public list of configured OIDC providers — safe to ship
 * to unauthenticated clients. Order: google, github, oidc.
 *
 * Defaults to `process.env`. Tests pass an explicit env stub to
 * avoid mutating the global.
 */
export function listConfiguredOidcProviders(
  env: NodeJS.ProcessEnv = DEFAULT_ENV,
): readonly ConfiguredProvider[] {
  const out: ConfiguredProvider[] = [];
  if (googleConfigured(env)) {
    out.push({ id: "google", name: "Google", enabled: true });
  }
  if (githubConfigured(env)) {
    out.push({ id: "github", name: "GitHub", enabled: true });
  }
  if (oidcConfigured(env)) {
    out.push({ id: "oidc", name: "OIDC", enabled: true });
  }
  return out;
}

/**
 * Return the Better Auth `genericOAuth` config entries. Only the OIDC
 * branch is shipped here today — Google / GitHub use the dedicated
 * Better Auth provider plugins (not yet wired in apps/api/src/auth.ts
 * but advertised by the public listing for forward-compat with the
 * UI's sign-in screen and the wizard's provider summary).
 *
 * This split is intentional: the public list MAY include providers
 * that Better Auth registers via per-provider plugins instead of
 * genericOAuth. The contract test only asserts ID set equality on
 * permutations within OIDC; Google/GitHub registration lives outside
 * this helper because `betterAuth({...providers})` uses a different
 * config shape for them.
 */
export function readOidcProvidersForRegistration(
  env: NodeJS.ProcessEnv = DEFAULT_ENV,
): readonly OidcProviderRegistration[] {
  if (!oidcConfigured(env)) return [];
  const issuer = env.OIDC_ISSUER_URL!;
  return [
    {
      providerId: "oidc",
      discoveryUrl: `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
      clientId: env.OIDC_CLIENT_ID!,
      clientSecret: env.OIDC_CLIENT_SECRET!,
    },
  ];
}
