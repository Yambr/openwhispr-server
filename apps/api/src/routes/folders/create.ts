// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 06 / Task 1 — POST /api/folders/create (WIRE-23).
//
// Wire shape (matches ~/openwhispr/src/services/FoldersService.ts):
//   Request:  FolderInput (validated by FolderInputSchema)
//   Success:  200 CloudFolder
//
// D-24 — same client_folder_id on retry returns the existing row (200,
//        NOT 409). Pattern 1 — createOrReturnExisting() from
//        apps/api/src/lib/client-id-upsert.ts.
//
// All DB activity under withTenant(deps.db, tenantId, ...) so FORCE-RLS
// is in force (tenant_id GUC bound for the transaction).
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { FolderInputSchema } from "@openwhispr/wire-schemas";
import type { FastifyInstance } from "fastify";
import { AuthError } from "../../errors.js";
import { createOrReturnExisting } from "../../lib/client-id-upsert.js";
import { type CloudFolderRow, rowToCloudFolder } from "./shape.js";

export interface FoldersCreateDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildFoldersCreateRoutes = (deps: FoldersCreateDeps) =>
  async function foldersCreateRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/folders/create",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const body = FolderInputSchema.parse(req.body);
        const tenantId = req.tenant;
        const userId = req.user.id;

        const row = await withTenant(deps.db, tenantId, async (tx) => {
          const insertValues: Record<string, unknown> = {
            tenant_id: tenantId,
            user_id: userId,
            client_folder_id: body.client_folder_id ?? null,
            name: body.name,
            is_default: body.is_default ?? false,
            sort_order: body.sort_order ?? 0,
          };
          const { row } = await createOrReturnExisting<CloudFolderRow>(tx, {
            table: "folders",
            clientIdColumn: "client_folder_id",
            tenantId,
            userId,
            clientIdValue: body.client_folder_id ?? null,
            insertValues,
          });
          return row;
        });

        return reply.code(200).send(rowToCloudFolder(row));
      },
    });
  };

export default buildFoldersCreateRoutes;
