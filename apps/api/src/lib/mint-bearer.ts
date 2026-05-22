// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 02.7 / Plan 02.7-02 / D-01 — production `MintBearer` adapter.
//
// Closes AUTH-A1 (deferred from Phase 02 Plan 05). Replaces the previous
// auth.handler('/api/auth/oauth2/callback/...') delegation, which could
// never work: Better Auth's callbackOAuth route reads PKCE state from its
// own internal `verification` table (parseState in
// node_modules/better-auth/dist/api/routes/callback.mjs:58), but our
// desktop-signin route writes state to our own `oauth_state` table —
// every delegation attempt 400'd with state_not_found.
//
// New design (per RESEARCH §D-01 "Recommended (plain fetch)"):
//   1. POST OIDC_TOKEN_URL (form-urlencoded) with code + code_verifier
//      + redirect_uri + client credentials → access_token (+ optional
//      id_token).
//   2. GET OIDC_USERINFO_URL with Bearer access_token → {sub, email, …}.
//   3. await auth.$context → ctx.internalAdapter.findUserByEmail(
//      email.toLowerCase()) — explicit lowercase even though the installed
//      Better Auth lowercases on read; D-03 alignment requires the
//      explicit guard so any future behavior change does not regress us.
//   4. If user exists → reuse user.id; else internalAdapter.createOAuthUser
//      with explicit lowercased email (createOAuthUser does NOT lowercase
//      automatically — verified in internal-adapter.mjs:39 vs createUser:62).
//   5. internalAdapter.createSession(userId, false) → session.token is the
//      raw 32-char string. The bearer plugin self-signs on receive when
//      the token has no `.` (verified plugins/bearer/index.mjs:32-37 with
//      requireSignature unset), so returning it raw is correct.
//
// Threat boundaries (T-02.7-07): error messages include only status code
// + provider name, NEVER the IdP response body — IdP body may contain
// PII or attacker-controlled values.
import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import { LRUCache } from "lru-cache";
import { z } from "zod";
import type { MintBearer, MintBearerArgs } from "../routes/auth-callback.js";

/**
 * Minimal Better Auth surface this adapter consumes. Narrowing to a
 * structural type (rather than importing Better Auth's exported `Auth`)
 * keeps the test fakes ergonomic and avoids leaking the full plugin
 * configuration into mint-bearer's call signature.
 */
export interface AuthContextLike {
  internalAdapter: {
    findUserByEmail: (
      email: string,
      options?: unknown,
    ) => Promise<{ user: { id: string }; accounts?: unknown[] } | null>;
    createOAuthUser: (
      user: {
        email: string;
        name: string;
        emailVerified: boolean;
        image?: string | null;
      },
      account: {
        providerId: string;
        accountId: string;
        accessToken?: string;
        idToken?: string | null;
        scope?: string;
      },
    ) => Promise<{ user: { id: string }; account: unknown }>;
    createSession: (
      userId: string,
      dontRememberMe?: boolean,
    ) => Promise<{ token: string; userId: string }>;
  };
}

export interface AuthLike {
  $context: Promise<AuthContextLike>;
}

export interface BuildMintBearerOpts {
  auth: AuthLike;
  /** Reserved for future use; tenant binding is automatic via role-level GUC. */
  db?: TransactionalDb<ExecutableTx>;
  log?: {
    info?: (msg: unknown) => void;
    warn?: (msg: unknown) => void;
  };
}

// HI-04 (REVIEW api-core HIGH / Phase 62) — the OIDC token response is
// zod-validated before use. `await res.json() as OidcTokenResponse` was
// an unchecked cast: a hijacked token endpoint could plant a malformed
// body and the unchecked `access_token` would flow into the userinfo
// Bearer header. The schema fails loud instead.
const OidcTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().optional(),
});
type OidcTokenResponse = z.infer<typeof OidcTokenResponseSchema>;

interface OidcUserinfo {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

// HI-04 — the OIDC discovery doc is zod-validated before caching.
// `token_endpoint` / `userinfo_endpoint` MUST be absolute https:// URLs;
// the scheme + same-origin checks below additionally pin them to the
// issuer's origin so a poisoned discovery response cannot redirect the
// `client_secret` exchange to an attacker endpoint.
const OidcDiscoveryDocSchema = z.object({
  token_endpoint: z.string().url(),
  userinfo_endpoint: z.string().url(),
});
type OidcDiscoveryDoc = z.infer<typeof OidcDiscoveryDocSchema>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`mint bearer: ${name} is not configured`);
  }
  return value;
}

// HI-04 — bounded, TTL'd cache for the OIDC discovery doc.
//
// OIDC Discovery 1.0 §4 explicitly permits caching the metadata
// document. The original implementation used a bare process-lifetime
// `Map` with NO TTL and NO size bound: a poisoned discovery response
// (token-endpoint swap) was cached for the entire process life, and a
// rotated/refreshed IdP could not recover without a pod roll.
//
// `lru-cache` (the same library `dep-check.ts` uses) provides the
// bounded-size + TTL semantics natively: `max` evicts the
// least-recently-used issuer on overflow; `ttl` (60 min) lets a
// refreshed IdP recover on the next callback — an expired entry is a
// transparent miss (`get` returns `undefined`), triggering a re-fetch.
const MAX_CACHE_ENTRIES = 16;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

const discoveryCache = new LRUCache<string, OidcDiscoveryDoc>({
  max: MAX_CACHE_ENTRIES,
  ttl: DISCOVERY_TTL_MS,
  // `Date.now()` is the TTL clock. `lru-cache` defaults to
  // `performance.now()` when `performance` is present; at a 60-minute
  // TTL granularity a wall-clock-vs-monotonic distinction is immaterial,
  // and `Date.now()` keeps the TTL deterministically controllable under
  // test fake timers.
  perf: { now: () => Date.now() },
  // `ttlResolution: 0` disables `lru-cache`'s 1-second `now()` memoization
  // (which it normally refreshes via an internal `setTimeout`). At a
  // 60-minute TTL the per-read clock call is negligible, and disabling
  // the memoization makes expiry depend solely on the injected `perf`
  // clock — no reliance on a background timer firing.
  ttlResolution: 0,
});

/**
 * HI-04 — assert an OIDC endpoint URL is an https:// URL whose origin
 * matches the issuer's origin (or an explicit operator-configured
 * allowlist origin). A non-affiliated origin on `token_endpoint` /
 * `userinfo_endpoint` is the exact attacker primitive HI-04 describes
 * (redirect the `client_secret` exchange). Default-deny: an operator
 * with a legitimate split-domain IdP sets `OIDC_DISCOVERY_ALLOWED_ORIGINS`
 * (csv of `https://...` origins).
 */
function assertEndpointAffiliated(label: string, endpoint: string, issuerOrigin: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`mint bearer: discovery ${label} is not a valid URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`mint bearer: discovery ${label} must be https`);
  }
  if (url.origin === issuerOrigin) return;
  const allowed = (process.env.OIDC_DISCOVERY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (allowed.includes(url.origin)) return;
  throw new Error(`mint bearer: discovery ${label} origin not affiliated with issuer`);
}

/**
 * Fetch (and cache) the OIDC issuer's discovery doc. Per RFC 8414 /
 * OpenID Connect Discovery 1.0 §4, the metadata document lives at
 * `${issuer}/.well-known/openid-configuration` and contains the
 * `token_endpoint` + `userinfo_endpoint` URLs the relying party uses
 * for code exchange and profile retrieval. Operators set ONE env var
 * (OIDC_ISSUER_URL) and we resolve the rest — matches Better Auth
 * genericOAuth's lazy-discovery contract (auth.ts:89–90).
 *
 * HI-04 — the fetched document is zod-validated AND each endpoint is
 * checked for https + issuer-origin affiliation BEFORE caching; an
 * expired cache entry is treated as a miss and re-fetched.
 *
 * T-02.7-07 — error messages include the HTTP status only, NEVER the
 * response body (discovery doc may be served from a misconfigured
 * proxy that leaks PII or attacker-controlled values).
 */
async function discoverOidc(issuerUrl: string): Promise<OidcDiscoveryDoc> {
  const issuer = issuerUrl.replace(/\/+$/, "");
  // An expired entry is a transparent miss — `get` returns `undefined`
  // once the TTL elapses, so no manual expiry/delete bookkeeping.
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;

  const url = `${issuer}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`mint bearer: discovery ${res.status} (issuer=${issuer})`);
  }
  const parsed = OidcDiscoveryDocSchema.safeParse(await res.json());
  if (!parsed.success) {
    // HI-04 — never cache an unvalidated doc; fail loud (no body leak).
    throw new Error(`mint bearer: discovery doc failed schema validation (issuer=${issuer})`);
  }
  const doc = parsed.data;

  let issuerOrigin: string;
  try {
    issuerOrigin = new URL(issuer).origin;
  } catch {
    throw new Error(`mint bearer: OIDC_ISSUER_URL is not a valid URL`);
  }
  assertEndpointAffiliated("token_endpoint", doc.token_endpoint, issuerOrigin);
  assertEndpointAffiliated("userinfo_endpoint", doc.userinfo_endpoint, issuerOrigin);

  // HI-04 — cache only after zod-validation + origin-affiliation pass;
  // `lru-cache` bounds the size (LRU eviction) and applies the TTL.
  discoveryCache.set(issuer, doc);
  return doc;
}

/** Test-only: clear the discovery cache between vitest runs. */
export function __resetOidcDiscoveryCacheForTests(): void {
  discoveryCache.clear();
}

/**
 * Build the production `MintBearer` adapter bound to a Better Auth
 * instance. The returned function performs a real OIDC code exchange,
 * upserts the user via Better Auth's internalAdapter, mints a session,
 * and returns the raw opaque bearer.
 */
export function buildMintBearer(opts: BuildMintBearerOpts): MintBearer {
  const { auth } = opts;

  return async function mintBearer(args: MintBearerArgs): Promise<string> {
    // Fail-fast env validation BEFORE any network call so misconfigured
    // operators see a clear error rather than a confusing 502 from the IdP.
    //
    // Phase 02.16 — token_endpoint / userinfo_endpoint may now come from
    // the OIDC discovery doc when the explicit env overrides are unset.
    // Real-world operators set ONE env var (OIDC_ISSUER_URL) and rely on
    // RFC 8414 / OpenID Connect Discovery 1.0; the explicit env vars
    // remain available for non-conforming IdPs that don't publish a
    // discovery doc at the standard path.
    const clientId = requireEnv("OIDC_CLIENT_ID");
    const clientSecret = requireEnv("OIDC_CLIENT_SECRET");
    const authUrl = requireEnv("AUTH_URL");
    const explicitTokenUrl = process.env.OIDC_TOKEN_URL;
    const explicitUserinfoUrl = process.env.OIDC_USERINFO_URL;
    let tokenEndpoint: string;
    let userinfoEndpoint: string;
    if (explicitTokenUrl && explicitUserinfoUrl) {
      tokenEndpoint = explicitTokenUrl;
      userinfoEndpoint = explicitUserinfoUrl;
    } else {
      const issuerUrl = requireEnv("OIDC_ISSUER_URL");
      // HI-04 — `discoverOidc` zod-validates the doc and asserts both
      // endpoints are https + issuer-origin-affiliated before returning;
      // `token_endpoint` / `userinfo_endpoint` are therefore guaranteed
      // present, well-formed, and trusted at this point.
      const doc = await discoverOidc(issuerUrl);
      tokenEndpoint = explicitTokenUrl ?? doc.token_endpoint;
      userinfoEndpoint = explicitUserinfoUrl ?? doc.userinfo_endpoint;
    }

    const redirectUri = `${authUrl.replace(/\/+$/, "")}/api/auth/desktop-callback/${args.provider}`;

    // Step 1 — token exchange.
    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: args.codeVerifier,
      }),
    });
    if (!tokenRes.ok) {
      // T-02.7-07 — DO NOT include response body in the error message.
      throw new Error(`mint bearer: token exchange ${tokenRes.status} (provider=${args.provider})`);
    }
    // HI-04 — zod-validate the token response; an unchecked cast let a
    // malformed/poisoned body's `access_token` flow into the userinfo
    // Bearer header. Fail loud instead (no body leak in the message).
    const tokenParsed = OidcTokenResponseSchema.safeParse(await tokenRes.json());
    if (!tokenParsed.success) {
      throw new Error(
        `mint bearer: token response failed schema validation (provider=${args.provider})`,
      );
    }
    const tokens: OidcTokenResponse = tokenParsed.data;

    // Step 2 — userinfo.
    const uiRes = await fetch(userinfoEndpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!uiRes.ok) {
      throw new Error(`mint bearer: userinfo ${uiRes.status} (provider=${args.provider})`);
    }
    const profile = (await uiRes.json()) as OidcUserinfo;

    // Step 3 — explicit lowercase BEFORE adapter calls (D-03 alignment).
    // Better Auth's findUserByEmail also lowercases internally
    // (internal-adapter.mjs:448) but createOAuthUser does NOT (line 39 —
    // it spreads `...user` only). Lowercasing ourselves at one chokepoint
    // keeps both paths case-consistent and survives any future Better
    // Auth refactor.
    const email = profile.email.toLowerCase();

    const ctx = await auth.$context;
    const ia = ctx.internalAdapter;

    let userId: string;
    const existing = await ia.findUserByEmail(email);
    if (existing) {
      userId = existing.user.id;
    } else {
      const created = await ia.createOAuthUser(
        {
          email,
          name: profile.name ?? profile.email,
          emailVerified: true,
          image: profile.picture ?? null,
        },
        {
          providerId: args.provider,
          accountId: profile.sub,
          accessToken: tokens.access_token,
          idToken: tokens.id_token ?? null,
          scope: "openid email profile",
        },
      );
      userId = created.user.id;
    }

    // Step 5 — mint session. dontRememberMe=false → full sessionExpiration.
    const session = await ia.createSession(userId, false);
    return session.token;
  };
}
