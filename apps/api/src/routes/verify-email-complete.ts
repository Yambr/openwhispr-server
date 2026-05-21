// SPDX-License-Identifier: FSL-1.1-ALv2
// R22 — `GET /api/auth/verify-email-complete`.
//
// THE BUG: after a real sign-up → verify-email flow the Electron client
// lands in the app with NO session. Under Better Auth 1.6.9
// `requireEmailVerification: true`, `POST /sign-up/email` issues no
// session; `GET /verify-email` (plain sign-up token) only creates one if
// `emailVerification.autoSignInAfterVerification` is set (vendored proof:
// `email-verification.mjs:268-287`). R22 sets that flag in `auth.ts` —
// but even then Better Auth's `setSessionCookie` lands the cookie in the
// BROWSER's jar (the user opened the link), never in the Electron
// client. The client's only token-intake channel is its auth-bridge
// loopback listener (see `config/desktop-bridge.ts` for the address).
//
// THE FIX (Option C): deliver the session through that EXISTING bridge.
// `auth.ts`'s `sendVerificationEmail` hook rewrites the verification
// link's `callbackURL` query param to point at THIS route. Better Auth's
// `verify-email` handler, on success, (a) creates a session + sets the
// session cookie on the response, then (b) `302`-redirects to the
// `callbackURL` (vendored proof: `email-verification.mjs:288`
// `if (ctx.query.callbackURL) throw ctx.redirect(ctx.query.callbackURL)`).
// The browser follows the 302 to THIS route carrying the just-set
// session cookie. This route reads that session, extracts the raw
// session token, and 302-redirects to the desktop bridge with
// `?bearer_token=<token>`.
//
// PRECEDENT: `apps/api/src/routes/auth-callback.ts` already proves Better
// Auth 1.6.9 has NO per-request redirect-rewrite hook, so the OAuth flow
// ships a SEPARATE route that mints the bearer and 302-redirects to the
// client channel. R22 mirrors that pattern, rate-limit, error-envelope,
// and redirect-building approach.
//
// `config.auth = false` — this route opts OUT of the global
// `dualAuthHook`. Better Auth's own session cookie (set by the
// verify-email handler one redirect-hop earlier) IS the proof of
// verification; the route resolves the session itself via
// `auth.api.getSession`. This mirrors the R21 `verification-status.ts`
// `auth: false` precedent. `auth: false` does NOT relax LOCKER-04 — the
// `rateLimit` block below is still mandatory.
//
// Rate limit: 60/min/IP, mirroring `auth-callback.ts`. The route is
// unauthenticated so @fastify/rate-limit's keyGenerator degrades to
// `ip:<req.ip>` — the correct abuse axis for an unauthenticated
// callback. A real verify-email click hits this exactly once.
//
// SECURITY — the redirect target is the SERVER-FIXED
// `DESKTOP_BRIDGE_CALLBACK_URL` literal (`config/desktop-bridge.ts`); it
// is NEVER derived from an attacker-controlled query parameter, so there
// is no open-redirect surface. The bearer handed to the bridge is the
// raw Better Auth session token — it resolves through the SAME dual-auth
// path as `sign-in/email` (the R20 fingerprint lens). No second session
// kind is invented.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildDesktopBridgeRedirect } from "../config/desktop-bridge.js";
import { AuthError } from "../errors.js";
import { VERIFY_EMAIL_COMPLETE_PATH } from "../lib/verification-callback-url.js";
import { type AuthLike, fastifyHeadersToWebHeaders } from "../middleware/dual-auth.js";

/**
 * The route reuses the canonical `AuthLike` / `SessionResult` structural
 * types from `middleware/dual-auth.ts` rather than declaring a parallel
 * shape. R22 widened `SessionResult.session` with the optional raw
 * `token` — the opaque bearer this route hands to the desktop
 * auth-bridge — so the production `buildAuth()` instance and every
 * existing test fake satisfy this dependency without a cast.
 */
export interface VerifyEmailCompleteDeps {
  auth: AuthLike;
}

/**
 * Querystring schema. The route is normally reached by a query-less 302
 * from Better Auth's `verify-email` handler, but that handler's
 * error-redirect path appends `?error=<code>` when verification itself
 * failed (`email-verification.mjs:151-155`). `error` is therefore
 * accepted as an OPTIONAL passthrough param so a failed-verification
 * 302 does not 400 at the schema layer — the handler still emits a
 * clean 4xx envelope below because no session cookie exists in that
 * case. `.strict()` rejects any other unexpected query parameter.
 * LOCKER-04 requires every non-health route to declare `schema:`.
 */
const VerifyEmailCompleteQuery = z.object({ error: z.string().max(256).optional() }).strict();

export const buildVerifyEmailCompleteRoutes = (deps: VerifyEmailCompleteDeps) =>
  async function verifyEmailCompleteRoutes(app: FastifyInstance): Promise<void> {
    const { auth } = deps;
    app.route({
      method: "GET",
      url: VERIFY_EMAIL_COMPLETE_PATH,
      config: {
        // R22: opt out of the global dualAuthHook. Better Auth's session
        // cookie (set by the verify-email handler one redirect-hop ago)
        // is the proof of verification; this route resolves it itself
        // via auth.api.getSession. Without `auth: false` the app-wide
        // `onRequest` dualAuthHook would 401 the request BEFORE the
        // handler runs, because the dual-auth hook treats a cookie-only
        // request without a matching bearer the same as unauthenticated
        // only when the cookie fails — but more importantly this route
        // must own its own clean 4xx envelope when the cookie is absent.
        // Mirrors the R21 verification-status.ts precedent. `auth: false`
        // does NOT waive the rateLimit block below (LOCKER-04).
        auth: false,
        // Mirrors auth-callback.ts — 60/min/IP. Unauthenticated route, so
        // @fastify/rate-limit's keyGenerator degrades to `ip:<req.ip>`.
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
      schema: {
        querystring: VerifyEmailCompleteQuery,
      },
      handler: async (req, reply) => {
        // Resolve the Better Auth session from the request cookies. The
        // browser that clicked the verification link carries the session
        // cookie Better Auth's verify-email handler just set (it ran one
        // 302 hop earlier). Convert Fastify's header record to a
        // Web-standard Headers instance (the shape getSession expects),
        // reusing the canonical converter from dual-auth.ts.
        const headers = fastifyHeadersToWebHeaders(req.headers);
        const session = await auth.api.getSession({ headers });

        // Fail CLEANLY (4xx with the canonical {error:...} envelope) if
        // the session cookie is somehow absent — e.g. a cookie-jar /
        // redirect quirk, a direct hit on this URL without first
        // verifying, or an expired cookie. NEVER 500, NEVER hang. The
        // AuthError is mapped to 401 by the centralized error handler
        // (the single envelope-emission point).
        const token = session?.session?.token;
        if (!session || !token) {
          throw new AuthError(
            "VERIFY_EMAIL_COMPLETE_NO_SESSION",
            "no verified session on verify-email-complete request",
          );
        }

        // The raw Better Auth session token is the bearer the Electron
        // client replays through its auth-bridge. It resolves through the
        // SAME dual-auth path as a `sign-in/email` token (the R20
        // fingerprint lens) — no second session kind. The redirect target
        // is the SERVER-FIXED desktop-bridge literal; no open-redirect.
        const target = buildDesktopBridgeRedirect(token);
        return reply.redirect(target, 302);
      },
    });
  };

export default buildVerifyEmailCompleteRoutes;
