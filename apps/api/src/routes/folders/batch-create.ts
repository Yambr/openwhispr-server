// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 06 / Task 1 — POST /api/folders/batch-create (WIRE-23).
//
// Wire shape (matches ~/openwhispr/src/services/FoldersService.ts.batchCreate):
//   Request:  { folders: FolderInput[] } (length 1..500 per D-30)
//   Success:  201 { created: CloudFolder[] }   (Phase 56-03 / R9 —
//             was 200 pre-56-03; FULL CloudFolder per row,
//             NOT the {client_folder_id, id} minimal pair that
//             notes/batch-create returns — upstream FoldersService is
//             explicit about returning the full shape)
//   400:      batch size exceeds 500
//
// Each folder goes through createOrReturnExisting() — same idempotency
// semantics as /create, applied per element. Sequential within ONE
// withTenant transaction (parallel would deadlock on the partial UNIQUE
// index).
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { FolderInputSchema } from "@openwhispr/wire-schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, ValidationError } from "../../errors.js";
import { createOrReturnExisting } from "../../lib/client-id-upsert.js";
import { type CloudFolderRow, rowToCloudFolder } from "./shape.js";

const MAX_BATCH_SIZE = 500;

// Body schema — accepts both `{ folders: [...] }` (canonical, what the
// desktop sends) AND a bare array `[...]` for resilience.
const BatchCreateBodySchema = z.union([
  z.object({ folders: z.array(FolderInputSchema) }),
  z.array(FolderInputSchema),
]);

export interface FoldersBatchCreateDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildFoldersBatchCreateRoutes = (deps: FoldersBatchCreateDeps) =>
  async function foldersBatchCreateRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/folders/batch-create",
      // D-30 / T-05-04 — tighter rate limit on the batch endpoint.
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const parsed = BatchCreateBodySchema.parse(req.body);
        const foldersInput = Array.isArray(parsed) ? parsed : parsed.folders;

        // D-30 — batch size exceeds 500 → 400 envelope.
        if (foldersInput.length > MAX_BATCH_SIZE) {
          throw new ValidationError(
            "BATCH_TOO_LARGE",
            `batch size exceeds ${MAX_BATCH_SIZE} items`,
          );
        }

        const tenantId = req.tenant;
        const userId = req.user.id;

        const created = await withTenant(deps.db, tenantId, async (tx) => {
          const results: ReturnType<typeof rowToCloudFolder>[] = [];
          for (const input of foldersInput) {
            const insertValues: Record<string, unknown> = {
              tenant_id: tenantId,
              user_id: userId,
              client_folder_id: input.client_folder_id ?? null,
              name: input.name,
              is_default: input.is_default ?? false,
              sort_order: input.sort_order ?? 0,
            };
            const { row } = await createOrReturnExisting<CloudFolderRow>(tx, {
              table: "folders",
              clientIdColumn: "client_folder_id",
              tenantId,
              userId,
              clientIdValue: input.client_folder_id ?? null,
              insertValues,
            });
            results.push(rowToCloudFolder(row));
          }
          return results;
        });

        return reply.code(201).send({ created });
      },
    });
  };

export default buildFoldersBatchCreateRoutes;
