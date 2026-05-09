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
// with `openwhispr.` (see auth.ts `cookiePrefix`). We clear the canonical
// session token cookie here; Better Auth's `signOut` would do more
// (revoke session row, clear all cookies) but we've just deleted the
// session row in the same transaction so there is nothing left to
// revoke. `clearCookie` on the session token alone is sufficient and
// matches what BACKEND_SPEC.md describes.
import type { FastifyInstance } from "fastify";
// Side-effect import: augments FastifyReply with `clearCookie`. Plan 04's
// buildApp also `app.register(fastifyCookie)` at runtime; the type
// import here is needed for compile-time augmentation in this file
// regardless of buildApp registration order.
import "@fastify/cookie";
import { sql } from "drizzle-orm";
import { DeleteAccountResponse } from "@openwhispr/contract-tests/schemas";
import { withTenant, type TransactionalDb, type ExecutableTx } from "@openwhispr/data";
import type { AuthLike } from "../middleware/dual-auth.js";
import { buildRequireCookieOnly } from "../middleware/require-cookie-only.js";
import { AuthError } from "../errors.js";

export const SESSION_COOKIE_NAME = "openwhispr.session_token";

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
        reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
        return {};
      },
    });
  };

export default buildDeleteAccountRoutes;
