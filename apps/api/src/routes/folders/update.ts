// Phase 05 / Plan 06 / Task 1 — PATCH /api/folders/update (WIRE-23).
//
// Wire shape (matches ~/openwhispr/src/services/FoldersService.ts.update):
//   Request:  { id: string, ...Partial<FolderInput> }
//   Success:  200 CloudFolder
//   404:      folder not found / cross-tenant (RLS invisible == 404)
//
// Cross-tenant attempts return 404, not 403 — RLS makes other tenants'
// rows invisible; an UPDATE with 0 affected rows is indistinguishable
// from "row never existed".
//
// updated_at is bumped server-side regardless of input.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError } from "../../errors.js";
import { type CloudFolderRow, rowToCloudFolder } from "./shape.js";

// Static allowlist of mutable columns (defense-in-depth).
const MUTABLE_COLS = ["name", "is_default", "sort_order"] as const;
type MutableCol = (typeof MUTABLE_COLS)[number];

const UpdateBodySchema = z.object({
  id: z.string().uuid(),
  name: z.string().optional(),
  is_default: z.boolean().optional(),
  sort_order: z.number().optional(),
  // Tolerate but ignore client-supplied timestamps; server owns updated_at.
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  client_folder_id: z.string().optional(),
});

const FIELD_MAP: Record<string, MutableCol> = {
  name: "name",
  is_default: "is_default",
  sort_order: "sort_order",
};

export interface FoldersUpdateDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildFoldersUpdateRoutes = (deps: FoldersUpdateDeps) =>
  async function foldersUpdateRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "PATCH",
      url: "/api/folders/update",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const body = UpdateBodySchema.parse(req.body);
        const tenantId = req.tenant;
        const userId = req.user.id;

        // Build the SET clause from provided fields only.
        const setFragments = [];
        for (const [key, col] of Object.entries(FIELD_MAP)) {
          if (Object.hasOwn(body, key)) {
            const v = (body as Record<string, unknown>)[key];
            setFragments.push(sql`${sql.raw(`"${col}"`)} = ${v as unknown}`);
          }
        }
        // Always bump updated_at server-side.
        setFragments.push(sql`"updated_at" = NOW()`);

        const setClause = setFragments.reduce<ReturnType<typeof sql>>(
          (acc, frag, i) => (i === 0 ? frag : sql`${acc}, ${frag}`),
          sql``,
        );

        const row = await withTenant(deps.db, tenantId, async (tx) => {
          const result = (await tx.execute(sql`
            UPDATE "folders"
               SET ${setClause}
             WHERE "id" = ${body.id}::uuid
               AND "user_id" = ${userId}::uuid
               AND "deleted_at" IS NULL
             RETURNING *
          `)) as { rows?: CloudFolderRow[] };
          return result.rows?.[0];
        });

        if (!row) {
          return reply.code(404).send({ error: "folder not found" });
        }
        return reply.code(200).send(rowToCloudFolder(row));
      },
    });
  };

export default buildFoldersUpdateRoutes;
