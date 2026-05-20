// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 2 — DELETE /api/notes/delete (WIRE-22).
//
// Wire shape (matches ~/openwhispr/src/services/NotesService.ts.deleteNote):
//   Request:  { id: string } (body)
//   Success:  204 (no body; Phase 56-02 / R8 — flipped from 200 {ok:true}.
//             HTTP spec: 204 carries no body, so the {ok:true} envelope
//             is removed.)
//   404:      note not found
//
// D-23 — soft delete. Sets deleted_at = NOW(); the row stays in the
// table so future migrations / audit queries can see tombstones. The
// keyset partial index drops the row from `notes_keyset_idx` at the
// same instant (WHERE deleted_at IS NULL clause), so list/search
// continue to skip it without further filtering work.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, NotFoundError } from "../../errors.js";

const DeleteBodySchema = z.object({
  id: z.string().uuid(),
});

export interface NotesDeleteDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildNotesDeleteRoutes = (deps: NotesDeleteDeps) =>
  async function notesDeleteRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "DELETE",
      url: "/api/notes/delete",
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

        const updated = await withTenant(deps.db, tenantId, async (tx) => {
          // deleted_at = NOW() — soft delete per D-23.
          const result = (await tx.execute(sql`
            UPDATE "notes"
               SET "deleted_at" = NOW()
             WHERE "id" = ${body.id}::uuid
               AND "user_id" = ${userId}::uuid
               AND "deleted_at" IS NULL
             RETURNING "id"
          `)) as { rows?: { id: string }[] };
          return result.rows?.[0];
        });

        if (!updated) {
          throw new NotFoundError("NOTE_NOT_FOUND", "note not found");
        }
        // 204 No Content per R8 — explicit empty send() so Fastify
        // emits a zero-length body (no JSON envelope).
        return reply.code(204).send();
      },
    });
  };

export default buildNotesDeleteRoutes;
