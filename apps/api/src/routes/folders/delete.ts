// Phase 05 / Plan 06 / Task 1 — DELETE /api/folders/delete (WIRE-23).
//
// Wire shape (matches ~/openwhispr/src/services/FoldersService.ts.deleteFolder):
//   Request:  { id: string } (body)
//   Success:  200 { ok: true }
//   404:      folder not found
//
// D-23 — soft delete. Sets deleted_at = NOW(); the row stays in the
// table. The `notes.folder_id` FK is ON DELETE SET NULL but soft-delete
// does NOT trigger that — children stay attached, will be re-parented if
// the folder is restored. This matches upstream desktop semantics.
import {
  type ExecutableTx,
  type TransactionalDb,
  withTenant,
} from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const DeleteBodySchema = z.object({
  id: z.string().uuid(),
});

export interface FoldersDeleteDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildFoldersDeleteRoutes = (deps: FoldersDeleteDeps) =>
  async function foldersDeleteRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "DELETE",
      url: "/api/folders/delete",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          return reply.code(401).send({ error: "unauthorized" });
        }
        const body = DeleteBodySchema.parse(req.body);
        const tenantId = req.tenant;
        const userId = req.user.id;

        const updated = await withTenant(deps.db, tenantId, async (tx) => {
          // deleted_at = NOW() — soft delete per D-23.
          const result = (await tx.execute(sql`
            UPDATE "folders"
               SET "deleted_at" = NOW()
             WHERE "id" = ${body.id}::uuid
               AND "user_id" = ${userId}::uuid
               AND "deleted_at" IS NULL
             RETURNING "id"
          `)) as { rows?: { id: string }[] };
          return result.rows?.[0];
        });

        if (!updated) {
          return reply.code(404).send({ error: "folder not found" });
        }
        return reply.code(200).send({ ok: true });
      },
    });
  };

export default buildFoldersDeleteRoutes;
