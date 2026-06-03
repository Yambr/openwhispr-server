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

import { readJitConfig } from "./oidc-jit-config.js";

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
  /**
   * OAuth scopes requested at the IdP authorize step. MUST be a mutable
   * `string[]` (not `readonly`): the `{...provider}` spread in apps/api/src/
   * auth.ts feeds this verbatim into Better Auth's `genericOAuth` config, whose
   * type is `scopes?: string[]` — a `readonly string[]` value fails TS2345 and
   * LOCKER-02 forbids casting it away. Always non-empty and `openid`-first.
   */
  readonly scopes: string[];
}

const DEFAULT_ENV: NodeJS.ProcessEnv = process.env;

/** Base scopes when OIDC_SCOPES is unset. `openid` is mandatory for OIDC. */
const DEFAULT_OIDC_SCOPES: readonly string[] = ["openid", "email", "profile"];

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

/** Default display label for the generic OIDC button when no override is set. */
const DEFAULT_OIDC_PROVIDER_NAME = "OIDC";

/**
 * Operator-configurable display label for the single generic OIDC button.
 *
 * The provider `id` stays the FROZEN `"oidc"` round-trip contract with the
 * desktop client (it POSTs back to `/api/desktop-signin/oidc`); only the
 * human-facing `name` is overridable, so an operator wiring Keycloak /
 * Authentik / Okta / any IdP can render "Continue with <Company SSO>"
 * instead of the generic "OIDC". Unset / blank → `"OIDC"` (backward compat).
 * Surrounding whitespace is trimmed.
 */
function oidcProviderName(env: NodeJS.ProcessEnv): string {
  const raw = env.OIDC_PROVIDER_NAME;
  if (typeof raw !== "string") return DEFAULT_OIDC_PROVIDER_NAME;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_OIDC_PROVIDER_NAME;
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
    out.push({ id: "oidc", name: oidcProviderName(env), enabled: true });
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
/**
 * Resolve the OAuth scopes the web genericOAuth flow requests at the IdP.
 *
 * Brings the web path into parity with the desktop server flow
 * (routes/desktop-signin.ts, which sets `openid email profile` + the group
 * scope when JIT is enabled). Better Auth's `genericOAuth` only emits the
 * `scope=` authorize param when this array is non-empty, and the IdP (e.g.
 * Dex) returns no `id_token` without `openid` — so `openid` is mandatory.
 *
 * Resolution:
 *  - Base: `OIDC_SCOPES` (CSV) when it yields ≥1 non-empty token, else the
 *    default `["openid","email","profile"]`. The override REPLACES the default.
 *  - `openid` is force-prepended if absent (OIDC is nonfunctional without it),
 *    even on an `OIDC_SCOPES` override.
 *  - JIT-group parity: when JIT is enabled (`OIDC_TENANT_CLAIM` set), append the
 *    group claim. We reuse `readJitConfig(env).groupClaim` — the SAME value the
 *    desktop flow derives from `OIDC_GROUP_CLAIM || "groups"` — instead of
 *    re-reading the env vars, keeping a single source of truth (D-08 zero-drift).
 *  - Deduped, preserving first occurrence, with `openid` at index 0.
 *
 * NOTE: `readJitConfig` inherits the boot loud-fail (`validateJitBoot` →
 * `process.exit(78)` on malformed OIDC_*_MAPPING JSON). Callers in tests that
 * flip JIT on must not pass malformed mapping JSON through here.
 *
 * Module-private (not exported): the only consumer is
 * `readOidcProvidersForRegistration` below, and the unit tests exercise every
 * branch through that public seam (the object Better Auth actually receives) —
 * so it needs no standalone export (avoids a LOCKER-04 dead-export).
 */
function resolveOidcScopes(env: NodeJS.ProcessEnv = DEFAULT_ENV): string[] {
  const raw = env.OIDC_SCOPES;
  const overridden =
    typeof raw === "string"
      ? raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
  const base = overridden.length > 0 ? overridden : [...DEFAULT_OIDC_SCOPES];

  // openid is mandatory — prepend when the override dropped it.
  const withOpenid = base.includes("openid") ? base : ["openid", ...base];

  // JIT-group parity with the desktop flow: append the resolved group claim.
  const jit = readJitConfig(env);
  const withGroup = jit ? [...withOpenid, jit.groupClaim] : withOpenid;

  // Dedupe, openid first (the includes() guard above guarantees its presence).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const scope of withGroup) {
    if (!seen.has(scope)) {
      seen.add(scope);
      out.push(scope);
    }
  }
  return out;
}

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
      scopes: resolveOidcScopes(env),
    },
  ];
}
