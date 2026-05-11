// Phase 05 / Plan 09 / Task 3 — POST /api/v1/keys/:id/revoke (WIRE-27).
//
// Wire shape (matches ~/openwhispr/src/services/ApiKeysService.ts.revoke):
//   Request:  POST /api/v1/keys/:id/revoke (no body)
//   Success:  200 { data: ApiKey } — V1Response envelope (D-28) with
//             revoked_at populated.
//   404:      Cross-tenant attempt OR unknown id (RLS hides; appears
//             not-found). Mirrors notes/folders "RLS-invisible == 404"
//             contract — NEVER 403 (CLAUDE.md: don't confirm existence
//             across tenants).
//
// Idempotent — revoking an already-revoked key returns 200 with the
// existing revoked_at unchanged (`COALESCE(revoked_at, NOW())`).
//
// Soft-revoke (D-29): the row REMAINS in the table; subsequent /list
// includes it with revoked_at populated. We never DELETE — audit trail
// (who minted what, when) is mandatory for enterprise compliance.
//
// T-REVOKE-LATENCY (accepted): after revoke, verifyKey(clearText, key_hash)
// still returns true because the Argon2id hash is unchanged. Phase 6
// bearer auth will gate on `revoked_at IS NULL` before the verify step;
// until then the endpoint surfaces lifecycle correctly but does NOT
// invalidate live bearer auth (which doesn't exist yet).
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditCtxFromRequest, recordAudit } from "../../../lib/audit.js";
import { type ApiKeyRow, rowToApiKey } from "./list.js";

export interface KeysRevokeDeps {
  db: TransactionalDb<ExecutableTx>;
}

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

export const buildKeysRevokeRoutes = (deps: KeysRevokeDeps) =>
  async function keysRevokeRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/v1/keys/:id/revoke",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          return reply.code(401).send({ error: "unauthorized" });
        }
        const tenantId = req.tenant;
        const userId = req.user.id;

        let params: z.infer<typeof ParamsSchema>;
        try {
          params = ParamsSchema.parse(req.params);
        } catch {
          return reply.code(400).send({ error: "invalid id" });
        }

        const row = await withTenant(deps.db, tenantId, async (tx) => {
          // COALESCE keeps idempotency — repeat revokes preserve the
          // original revoked_at timestamp. RLS gates row visibility,
          // so a tenant-B caller targeting a tenant-A id sees 0 rows.
          const result = (await tx.execute(sql`
            UPDATE "api_keys"
               SET "revoked_at" = COALESCE("revoked_at", NOW())
             WHERE "id" = ${params.id}::uuid
               AND "user_id" = ${userId}::uuid
            RETURNING "id", "name", "key_prefix", "scopes",
                      "last_used_at", "expires_at", "created_at", "revoked_at"
          `)) as { rows?: ApiKeyRow[] };
          const updated = result.rows?.[0];
          // Phase 6 / Plan 05 / Task 2 — emit canonical D-A6 #9
          // `key.revoked` ONLY when the UPDATE actually targeted a
          // visible row owned by this user. Cross-tenant attempts and
          // unknown ids surface as 404 below; emitting an audit row
          // for those would create a tenant-A-visible record of a
          // tenant-B key id, which violates the RLS invisibility
          // contract (Plan 05 D-31 mirror). Audit emission inside the
          // same tx so the row exists iff the revoke commits.
          if (updated) {
            await recordAudit(tx, auditCtxFromRequest(req, tenantId, userId), "key.revoked", {
              key_id: updated.id,
              reason: "manual",
            });
          }
          return updated;
        });

        if (!row) {
          return reply.code(404).send({ error: "api key not found" });
        }
        // V1Response envelope per D-28: { data: ApiKey }.
        return reply.code(200).send({ data: rowToApiKey(row) });
      },
    });
  };

export default buildKeysRevokeRoutes;
