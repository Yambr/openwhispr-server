// Phase 05 / Plan 08 / Task 1 — POST /api/transcriptions/batch-create
// (WIRE-26).
//
// Wire shape (matches
// ~/openwhispr/src/services/TranscriptionsService.ts.batchCreate):
//   Request:  { transcriptions: TranscriptionInput[] } (length 1..500)
//   Success:  200 { created: CloudTranscription[] }
//   400:      batch size exceeds 500 (D-30)
//
// Each row goes through createOrReturnExisting() — same idempotency
// semantics as /create, applied per element. Sequential within ONE
// withTenant transaction (parallel would deadlock on the partial UNIQUE
// index). D-32 — NO usage_ledger writes (storage-only).
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { TranscriptionInputSchema } from "@openwhispr/wire-schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError } from "../../errors.js";
import { createOrReturnExisting } from "../../lib/client-id-upsert.js";
import { type CloudTranscriptionRow, rowToCloudTranscription } from "./shape.js";

const MAX_BATCH_SIZE = 500;

// Accepts both `{ transcriptions: [...] }` (canonical, what the desktop
// sends) AND a bare array `[...]` for resilience — mirrors folders/notes.
const BatchCreateBodySchema = z.union([
  z.object({ transcriptions: z.array(TranscriptionInputSchema) }),
  z.array(TranscriptionInputSchema),
]);

export interface TranscriptionsBatchCreateDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildTranscriptionsBatchCreateRoutes = (deps: TranscriptionsBatchCreateDeps) =>
  async function transcriptionsBatchCreateRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/transcriptions/batch-create",
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const parsed = BatchCreateBodySchema.parse(req.body);
        const items = Array.isArray(parsed) ? parsed : parsed.transcriptions;

        // D-30 — batch size > 500 → 400 envelope BEFORE any DB work.
        if (items.length > MAX_BATCH_SIZE) {
          return reply.code(400).send({ error: `batch size exceeds ${MAX_BATCH_SIZE} items` });
        }

        const tenantId = req.tenant;
        const userId = req.user.id;

        const created = await withTenant(deps.db, tenantId, async (tx) => {
          const results: ReturnType<typeof rowToCloudTranscription>[] = [];
          for (const input of items) {
            const text = input.text ?? "";
            const wordCount = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
            const insertValues: Record<string, unknown> = {
              tenant_id: tenantId,
              user_id: userId,
              client_transcription_id: input.client_transcription_id ?? null,
              text,
              raw_text: input.raw_text ?? null,
              word_count: wordCount,
              source: "desktop",
              provider: input.provider ?? null,
              model: input.model ?? null,
              language: input.language ?? null,
              audio_duration_ms: input.audio_duration_ms ?? null,
              status: input.status ?? "completed",
            };
            const { row } = await createOrReturnExisting<CloudTranscriptionRow>(tx, {
              table: "transcriptions",
              clientIdColumn: "client_transcription_id",
              tenantId,
              userId,
              clientIdValue: input.client_transcription_id ?? null,
              insertValues,
            });
            results.push(rowToCloudTranscription(row));
          }
          return results;
        });

        return reply.code(200).send({ created });
      },
    });
  };

export default buildTranscriptionsBatchCreateRoutes;
