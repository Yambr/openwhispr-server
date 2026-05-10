// Phase 2 / Plan 03 / Task 3 — `DELETE /api/auth/delete-account`.
//
// Cookie-only per BACKEND_SPEC.md (NON-NEGOTIABLE wire contract — bearer
// MUST NOT authenticate this endpoint; see `middleware/require-cookie-
// only.ts`). Cascading delete of (sessions, audit_log entry, users) in
// a single transaction under `withTenant`. Clears the session cookie
// before responding `{}` at 200.
//
// Audit row uses action=`account_deleted` (matches the audit_log schema
// which only has `action`, no `event`). The user's id and tenant are
// captured even though the user row is about to be deleted — append-
// only audit log preserves the trail (no FK constraint binds it).
//
// Rate limit (D-28): 5/min/IP. Account deletion is a destructive
// operation; aggressive limiting is appropriate.
//
// Cookie clearing: every Better Auth-emitted cookie name is prefixed
// with `openwhispr.` (see auth.ts `cookiePrefix`). When the request is
// over HTTPS (or `useSecureCookies:true`) BA additionally prefixes the
// name with `__Secure-`. We MUST clear BOTH cookies BA emits at sign-in
// AND under BOTH prefix variants so the cascade contract holds in every
// deploy posture:
//
//   1. `openwhispr.session_token` — opaque session id used by BA to
//      look up the session row in DB.
//   2. `openwhispr.session_data`  — Better Auth's secondary cookie
//      cache (auth.ts session.cookieCache enabled, maxAge=5min). Holds
//      the encoded {session, user} payload signed by BA so getSession()
//      returns a valid session WITHOUT a DB hit during the cache TTL.
//
// Phase 02.21 / Residual B — clearing only `openwhispr.session_token`
// (and only without the `__Secure-` prefix that HTTPS deploys actually
// emit) was the root cause of the delete-account cascade contract
// regression: after DELETE, the same cookie jar still authenticated
// against `/api/auth/verification-status` for up to 5 minutes via the
// cookie-cache payload. The cookie-cache cookie was untouched AND the
// HTTPS-cookie name didn't match the bare-prefix clearCookie call, so
// the browser kept sending both intact.
//
// We clear all 4 variants because the runtime cookie name depends on
// both the prefix (`openwhispr`) and the secure-context flag, and the
// prior session row delete + user row delete in the same transaction
// ensures the server is ready to reject any stale cookie copy too —
// belt-and-braces. Better Auth's `signOut` would also do this but
// requires a live session and a Web Request adapter, neither of which
// fit cleanly inside the cascade transaction.
import type { FastifyInstance } from "fastify";
// Side-effect import: augments FastifyReply with `clearCookie`. Plan 04's
// buildApp also `app.register(fastifyCookie)` at runtime; the type
// import here is needed for compile-time augmentation in this file
// regardless of buildApp registration order.
import "@fastify/cookie";
import { DeleteAccountResponse } from "@openwhispr/contract-tests/schemas";
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import { AuthError } from "../errors.js";
import type { AuthLike } from "../middleware/dual-auth.js";
import { buildRequireCookieOnly } from "../middleware/require-cookie-only.js";

export const SESSION_COOKIE_NAME = "openwhispr.session_token";
export const SESSION_DATA_COOKIE_NAME = "openwhispr.session_data";

/**
 * Phase 02.21 / Residual B — every name × prefix variant we must clear so
 * the cascade contract holds whether the request lands on plaintext HTTP
 * (dev / smoke) or HTTPS (compose default + production). The bare names
 * cover the `useSecureCookies:false` path; the `__Secure-` names cover
 * the HTTPS path where Better Auth auto-prefixes.
 */
export const COOKIES_TO_CLEAR_ON_DELETE = [
  SESSION_COOKIE_NAME,
  SESSION_DATA_COOKIE_NAME,
  `__Secure-${SESSION_COOKIE_NAME}`,
  `__Secure-${SESSION_DATA_COOKIE_NAME}`,
] as const;

export interface DeleteAccountDeps {
  db: TransactionalDb<ExecutableTx>;
  auth: AuthLike;
}

export const buildDeleteAccountRoutes = (deps: DeleteAccountDeps) =>
  async function deleteAccountRoutes(app: FastifyInstance): Promise<void> {
    const { db, auth } = deps;
    const requireCookieOnly = buildRequireCookieOnly({ auth });

    app.route({
      method: "DELETE",
      url: "/api/auth/delete-account",
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
      schema: { response: { 200: DeleteAccountResponse } },
      preHandler: requireCookieOnly,
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("session expired");
        }
        const userId = req.user.id;
        const tenantId = req.tenant;
        await withTenant(db, tenantId, async (tx) => {
          // Single transaction — the SET LOCAL app.tenant_id GUC is in
          // effect for all three statements.
          await tx.execute(sql`DELETE FROM sessions WHERE user_id = ${userId}`);
          await tx.execute(
            sql`INSERT INTO audit_log (tenant_id, actor_user_id, action, payload)
                VALUES (${tenantId}, ${userId}, 'account_deleted', ${{ email: req.user?.email ?? null }})`,
          );
          await tx.execute(sql`DELETE FROM users WHERE id = ${userId}`);
        });
        // Phase 02.21 / Residual B — `__Secure-` prefixed cookies REQUIRE
        // the `Secure` attribute on every Set-Cookie operation per RFC 6265bis.
        // Without it, RFC-compliant cookie jars (incl. tough-cookie used by
        // contract tests, AND every browser) silently reject the clear and
        // keep the original cookie alive — exactly the cascade-contract
        // regression this fix targets. Bare-prefix variants get a plain
        // path:"/" clear (HTTP dev posture).
        for (const name of COOKIES_TO_CLEAR_ON_DELETE) {
          const isSecurePrefix = name.startsWith("__Secure-");
          reply.clearCookie(name, { path: "/", secure: isSecurePrefix });
        }
        return {};
      },
    });
  };

export default buildDeleteAccountRoutes;
