// Phase 05 / Plan 08 / Task 1 — POST /api/transcriptions/create (WIRE-26).
//
// Wire shape (matches ~/openwhispr/src/services/TranscriptionsService.ts):
//   Request:  TranscriptionInput
//   Success:  200 CloudTranscription (14 fields per shape.ts)
//
// D-24 — same client_transcription_id on retry returns the existing row
//        (200, NOT 409). Pattern 1 — createOrReturnExisting().
// D-32 — NO usage_ledger writes. Phase 3 /api/transcribe is the only
//        ledger debit point; this CRUD endpoint is storage-only.
import {
  type ExecutableTx,
  type TransactionalDb,
  withTenant,
} from "@openwhispr/data";
import { TranscriptionInputSchema } from "@openwhispr/wire-schemas";
import type { FastifyInstance } from "fastify";
import { createOrReturnExisting } from "../../lib/client-id-upsert.js";
import { type CloudTranscriptionRow, rowToCloudTranscription } from "./shape.js";

export interface TranscriptionsCreateDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildTranscriptionsCreateRoutes = (
  deps: TranscriptionsCreateDeps,
) =>
  async function transcriptionsCreateRoutes(
    app: FastifyInstance,
  ): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/transcriptions/create",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          return reply.code(401).send({ error: "unauthorized" });
        }
        const body = TranscriptionInputSchema.parse(req.body);
        const tenantId = req.tenant;
        const userId = req.user.id;

        const text = body.text ?? "";
        const wordCount = text.trim().length === 0
          ? 0
          : text.trim().split(/\s+/).length;

        const row = await withTenant(deps.db, tenantId, async (tx) => {
          const insertValues: Record<string, unknown> = {
            tenant_id: tenantId,
            user_id: userId,
            client_transcription_id: body.client_transcription_id ?? null,
            text,
            raw_text: body.raw_text ?? null,
            word_count: wordCount,
            source: "desktop",
            provider: body.provider ?? null,
            model: body.model ?? null,
            language: body.language ?? null,
            audio_duration_ms: body.audio_duration_ms ?? null,
            status: body.status ?? "completed",
          };
          const { row } = await createOrReturnExisting<CloudTranscriptionRow>(
            tx,
            {
              table: "transcriptions",
              clientIdColumn: "client_transcription_id",
              tenantId,
              userId,
              clientIdValue: body.client_transcription_id ?? null,
              insertValues,
            },
          );
          return row;
        });

        return reply.code(200).send(rowToCloudTranscription(row));
      },
    });
  };

export default buildTranscriptionsCreateRoutes;
