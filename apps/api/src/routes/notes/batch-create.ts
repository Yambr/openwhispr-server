// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 2 — POST /api/notes/batch-create (WIRE-22).
//
// Wire shape (matches ~/openwhispr/src/services/NotesService.ts.batchCreate):
//   Request:  { notes: NoteInput[] }   (length 1..500 per D-30)
//   Success:  201 { created: { client_note_id: string, id: string }[] }
//             (Phase 56-02 / R8 — flipped from 200; resource-creation
//             route returns Created.)
//   400:      batch size exceeds 500
//
// Deviation from plan <behavior>: plan says "Array<CloudNote> in input
// order". Upstream NotesService.batchCreate() expects the
// `{ created: [{client_note_id, id}, ...] }` shape (lightweight
// confirmation rather than full CloudNote per row) — we honor the
// upstream contract byte-for-byte (CLAUDE.md hard rule) and only
// surface the minimal client-binding pair the desktop needs to
// update its local state. Full-row reads route through /api/notes/list.
//
// Each note in the array goes through createOrReturnExisting() — same
// idempotency semantics as /create, applied per element. Rows without
// a client_note_id are returned with `client_note_id: null` in the
// response (the desktop ignores those entries).
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { NoteInputSchema } from "@openwhispr/wire-schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, ValidationError } from "../../errors.js";
import { createOrReturnExisting } from "../../lib/client-id-upsert.js";
import { type CloudNoteRow, normalizeNoteType } from "./shape.js";

const MAX_BATCH_SIZE = 500;

// Body schema — accepts both `{ notes: [...] }` (canonical) AND a bare
// array `[...]` (legacy/forward compat with the plan's <behavior> block).
// The desktop ships the canonical wrapper today; we accept both for
// resilience.
const BatchCreateBodySchema = z.union([
  z.object({ notes: z.array(NoteInputSchema) }),
  z.array(NoteInputSchema),
]);

export interface NotesBatchCreateDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildNotesBatchCreateRoutes = (deps: NotesBatchCreateDeps) =>
  async function notesBatchCreateRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/notes/batch-create",
      // LOCKER-04 inv-14 — declarative schema wires the SAME Zod schema
      // the handler .parse()s inline (stock ZodCompiler not attached).
      schema: { body: BatchCreateBodySchema },
      // D-30 / T-05-04 — tighter rate limit on the batch endpoint to
      // mitigate flood-via-amplification. 5 requests/min/user is enough
      // for legitimate bulk sync after a long offline window (5 × 500 =
      // 2500 notes/min ceiling).
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const parsed = BatchCreateBodySchema.parse(req.body);
        const notesInput = Array.isArray(parsed) ? parsed : parsed.notes;

        // D-30 — batch size exceeds 500 → 400 envelope.
        if (notesInput.length > MAX_BATCH_SIZE) {
          throw new ValidationError(
            "BATCH_TOO_LARGE",
            `batch size exceeds ${MAX_BATCH_SIZE} items`,
          );
        }

        const tenantId = req.tenant;
        const userId = req.user.id;

        const created = await withTenant(deps.db, tenantId, async (tx) => {
          const results: { client_note_id: string; id: string }[] = [];
          // Sequential within ONE transaction. Parallel would race on the
          // ON CONFLICT path because concurrent INSERTs into the same
          // (tenant_id, user_id, client_note_id) tuple inside a single tx
          // can deadlock on the partial UNIQUE index.
          for (const input of notesInput) {
            const insertValues: Record<string, unknown> = {
              tenant_id: tenantId,
              user_id: userId,
              client_note_id: input.client_note_id ?? null,
              folder_id: input.folder_id ?? null,
              title: input.title ?? null,
              content: input.content ?? "",
              // R37 — normalize a client free-text note_type to a
              // canonical NoteType so the stored row + strict CloudNote
              // response always carry a valid enum value.
              note_type: normalizeNoteType(input.note_type),
              enhanced_content: input.enhanced_content ?? null,
              enhancement_prompt: input.enhancement_prompt ?? null,
              source_file: input.source_file ?? null,
              audio_duration_seconds: input.audio_duration_seconds ?? null,
              participants: input.participants ?? null,
              calendar_event_id: input.calendar_event_id ?? null,
              diarization_enabled: input.diarization_enabled ?? null,
              expected_speaker_count: input.expected_speaker_count ?? null,
              transcript: input.transcript ?? null,
              enhanced_at_content_hash: input.enhanced_at_content_hash ?? null,
            };
            const { row } = await createOrReturnExisting<CloudNoteRow>(tx, {
              table: "notes",
              clientIdColumn: "client_note_id",
              tenantId,
              userId,
              clientIdValue: input.client_note_id ?? null,
              insertValues,
            });
            if (row.client_note_id) {
              results.push({ client_note_id: row.client_note_id, id: row.id });
            }
          }
          return results;
        });

        return reply.code(201).send({ created });
      },
    });
  };

export default buildNotesBatchCreateRoutes;
