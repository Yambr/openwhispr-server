// Phase 2 / Plan 08 / Task 1 — production `MintBearer` adapter.
//
// Closes 02-VERIFICATION.md Gap 1.
//
// Given an OAuth code+state arriving at `/api/auth/desktop-callback/:provider`,
// this adapter forwards the exchange to Better Auth's universal
// `auth.handler(Request)` entrypoint at the genericOAuth callback path
// (`/api/auth/oauth2/callback/${providerId}` — see
// node_modules/better-auth/dist/plugins/generic-oauth/routes.mjs:116) and
// extracts the freshly-minted opaque bearer.
//
// Bearer extraction strategy (per 02-08-PLAN Task 1 action step 2):
//   PRIMARY: response.headers.get("set-auth-token")
//     — emitted by the bearer plugin's `after` hook on any auth-mutating
//       response that carries a `set-cookie` session token (see
//       node_modules/better-auth/dist/plugins/bearer/index.mjs:71-72).
//   FALLBACK: JSON.parse(await response.text()).token
//     — covers Better Auth response variants that surface the token in
//       the JSON body (e.g. sign-in/email).
//
// Failure cases throw `Error("mint bearer failed: <reason>")`; the
// centralized setErrorHandler then emits a 500 envelope.
//
// PKCE: Better Auth itself owns the code_verifier round-trip during the
// IdP redirect. The `codeVerifier` arg here is informational only (for
// trace logs); we do NOT re-implement PKCE.
import type { TransactionalDb, ExecutableTx } from "@openwhispr/data";
import type { MintBearer, MintBearerArgs } from "../routes/auth-callback.js";

/** Minimal Better Auth surface this adapter consumes. */
export interface AuthHandlerLike {
  handler: (request: Request) => Promise<Response>;
}

export interface BuildMintBearerOpts {
  auth: AuthHandlerLike;
  /**
   * Optional db handle (reserved for future plans that need to upsert the
   * tenant binding alongside the token mint). Currently unused — the
   * Better Auth handler owns the user/session row creation.
   */
  db?: TransactionalDb<ExecutableTx>;
  log?: {
    info?: (msg: unknown) => void;
    warn?: (msg: unknown) => void;
  };
}

/**
 * Build the production `MintBearer` adapter bound to a Better Auth
 * instance. The returned function exchanges an OAuth code at the
 * genericOAuth callback URL and returns the resulting opaque bearer.
 */
export function buildMintBearer(opts: BuildMintBearerOpts): MintBearer {
  const { auth } = opts;
  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";

  return async function mintBearer(args: MintBearerArgs): Promise<string> {
    const url = new URL(
      `/api/auth/oauth2/callback/${encodeURIComponent(args.provider)}`,
      baseUrl,
    );
    url.searchParams.set("code", args.code);
    url.searchParams.set("state", args.stateId);

    const request = new Request(url.toString(), { method: "GET" });
    const response = await auth.handler(request);

    if (response.status >= 400) {
      throw new Error(`mint bearer failed: ${response.status}`);
    }

    // PRIMARY — bearer plugin's `set-auth-token` header.
    const headerToken = response.headers.get("set-auth-token");
    if (headerToken && headerToken.length > 0) {
      return headerToken;
    }

    // FALLBACK — JSON body `{token: "..."}`.
    try {
      const text = await response.text();
      if (text.length > 0) {
        const parsed = JSON.parse(text) as { token?: unknown };
        if (typeof parsed.token === "string" && parsed.token.length > 0) {
          return parsed.token;
        }
      }
    } catch {
      // Non-JSON or unreadable body — falls through to the throw below.
    }

    throw new Error(
      `mint bearer failed: response had no set-auth-token header and no body token (status ${response.status})`,
    );
  };
}
