// SPDX-License-Identifier: FSL-1.1-ALv2
// Cascade semantic (Phase 56-03 / R9): hard-delete the folder row;
// contained notes detach to folder_id = NULL via the FK ON DELETE SET
// NULL declared on notes.folder_id. Notes are first-class survivors —
// the folder is purely organizational.
//
// Phase 05 / Plan 06 / Task 1 — DELETE /api/folders/delete (WIRE-23).
//
// Wire shape (matches ~/openwhispr/src/services/FoldersService.ts.deleteFolder):
//   Request:  { id: string } (body)
//   Success:  204 No Content (Phase 56-03 / R9 — was 200 {ok:true})
//   404:      folder not found (no row matched user_id + id)
//
// Phase 56-03 supersedes D-23's soft-delete decision for folders: the
// upstream client wire (FoldersService.deleteFolder) expects 204, and
// the organizational nature of folders means there is no value in
// preserving a soft-deleted folder shell once its notes have detached.
// Notes themselves retain their own independent soft-delete lifecycle.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, NotFoundError } from "../../errors.js";

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
      // LOCKER-04 inv-14 — declarative schema wires the SAME Zod schema
      // the handler .parse()s inline (stock ZodCompiler not attached).
      schema: { body: DeleteBodySchema },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const body = DeleteBodySchema.parse(req.body);
        const tenantId = req.tenant;
        const userId = req.user.id;

        const deleted = await withTenant(deps.db, tenantId, async (tx) => {
          // Hard delete — contained notes detach to folder_id = NULL via
          // FK ON DELETE SET NULL (notes.folder_id, schema/notes.ts:26).
          const result = (await tx.execute(sql`
            DELETE FROM "folders"
             WHERE "id" = ${body.id}::uuid
               AND "user_id" = ${userId}::uuid
             RETURNING "id"
          `)) as { rows?: { id: string }[] };
          return result.rows?.[0];
        });

        if (!deleted) {
          throw new NotFoundError("FOLDER_NOT_FOUND", "folder not found");
        }
        return reply.code(204).send();
      },
    });
  };

export default buildFoldersDeleteRoutes;
