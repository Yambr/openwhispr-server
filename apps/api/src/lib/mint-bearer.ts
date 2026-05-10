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

interface OidcTokenResponse {
  access_token: string;
  id_token?: string;
}

interface OidcUserinfo {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

interface OidcDiscoveryDoc {
  token_endpoint?: string;
  userinfo_endpoint?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`mint bearer: ${name} is not configured`);
  }
  return value;
}

// Phase 02.16 — process-lifetime cache for the OIDC discovery doc.
// OIDC issuers consider discovery stable; the spec (OIDC Discovery 1.0
// §4) explicitly permits clients to cache the document. A process-
// lifetime cache is sufficient for our scale and avoids paying the
// roundtrip on every callback. Reset on process restart (operator
// rolls the api pod after rotating the IdP).
//
// Keyed by issuer URL (post-trim) to support — in theory — multiple
// IdPs in one process. The map stays bounded by the small set of
// configured issuers.
const discoveryCache = new Map<string, OidcDiscoveryDoc>();

/**
 * Fetch (and cache) the OIDC issuer's discovery doc. Per RFC 8414 /
 * OpenID Connect Discovery 1.0 §4, the metadata document lives at
 * `${issuer}/.well-known/openid-configuration` and contains the
 * `token_endpoint` + `userinfo_endpoint` URLs the relying party uses
 * for code exchange and profile retrieval. Operators set ONE env var
 * (OIDC_ISSUER_URL) and we resolve the rest — matches Better Auth
 * genericOAuth's lazy-discovery contract (auth.ts:89–90).
 *
 * T-02.7-07 — error messages include the HTTP status only, NEVER the
 * response body (discovery doc may be served from a misconfigured
 * proxy that leaks PII or attacker-controlled values).
 */
async function discoverOidc(issuerUrl: string): Promise<OidcDiscoveryDoc> {
  const issuer = issuerUrl.replace(/\/+$/, "");
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;
  const url = `${issuer}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`mint bearer: discovery ${res.status} (issuer=${issuer})`);
  }
  const doc = (await res.json()) as OidcDiscoveryDoc;
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
      const doc = await discoverOidc(issuerUrl);
      const discoveredToken = explicitTokenUrl ?? doc.token_endpoint;
      const discoveredUserinfo = explicitUserinfoUrl ?? doc.userinfo_endpoint;
      if (!discoveredToken) {
        throw new Error(`mint bearer: discovery doc missing token_endpoint (issuer=${issuerUrl})`);
      }
      if (!discoveredUserinfo) {
        throw new Error(
          `mint bearer: discovery doc missing userinfo_endpoint (issuer=${issuerUrl})`,
        );
      }
      tokenEndpoint = discoveredToken;
      userinfoEndpoint = discoveredUserinfo;
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
    const tokens = (await tokenRes.json()) as OidcTokenResponse;

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
