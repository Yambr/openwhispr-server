// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 2 — POST /api/notes/create (WIRE-22).
//
// Wire shape (matches ~/openwhispr/src/services/NotesService.ts):
//   Request:  NoteInput (validated by NoteInputSchema)
//   Success:  201 CloudNote (Phase 56-02 / R8 — flipped from 200; resource
//             creation route returns Created. Idempotent retry per D-24
//             still returns 201 with the existing row — the wire contract
//             does not model the new-vs-existed distinction.)
//
// D-24 — same client_note_id on retry returns the existing row (200, NOT
//        409). The desktop client retries on network blips with the same
//        client_note_id; landing duplicates would corrupt the local
//        sync state.
//
// Pattern 1: createOrReturnExisting() from apps/api/src/lib/client-id-upsert.ts.
// All DB activity under withTenant(deps.db, tenantId, ...) so FORCE-RLS
// is in force (tenant_id GUC bound for the transaction).
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { NoteInputSchema } from "@openwhispr/wire-schemas";
import type { FastifyInstance } from "fastify";
import { AuthError } from "../../errors.js";
import { createOrReturnExisting } from "../../lib/client-id-upsert.js";
import { assertSpaceWritable } from "../../lib/space-scope.js";
import { type CloudNoteRow, normalizeNoteType, rowToCloudNote } from "./shape.js";

export interface NotesCreateDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildNotesCreateRoutes = (deps: NotesCreateDeps) =>
  async function notesCreateRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/notes/create",
      // LOCKER-04 inv-14 — declarative schema wires the SAME Zod schema
      // the handler .parse()s inline (stock ZodCompiler not attached).
      schema: { body: NoteInputSchema },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const body = NoteInputSchema.parse(req.body);
        const tenantId = req.tenant;
        const userId = req.user.id;

        const row = await withTenant(deps.db, tenantId, async (tx) => {
          // Naming a space you cannot reach is an access attempt, not a bad
          // payload — 403, and nothing is written under any scope.
          if (body.space_id) await assertSpaceWritable(tx, userId, body.space_id);

          const insertValues: Record<string, unknown> = {
            tenant_id: tenantId,
            user_id: userId,
            space_id: body.space_id ?? null,
            client_note_id: body.client_note_id ?? null,
            folder_id: body.folder_id ?? null,
            title: body.title ?? null,
            content: body.content ?? "",
            // R37 — normalize a client free-text note_type to a
            // canonical NoteType (see notes/shape.ts normalizeNoteType).
            note_type: normalizeNoteType(body.note_type),
            enhanced_content: body.enhanced_content ?? null,
            enhancement_prompt: body.enhancement_prompt ?? null,
            source_file: body.source_file ?? null,
            audio_duration_seconds: body.audio_duration_seconds ?? null,
            participants: body.participants ?? null,
            calendar_event_id: body.calendar_event_id ?? null,
            diarization_enabled: body.diarization_enabled ?? null,
            expected_speaker_count: body.expected_speaker_count ?? null,
            transcript: body.transcript ?? null,
            enhanced_at_content_hash: body.enhanced_at_content_hash ?? null,
          };
          const { row } = await createOrReturnExisting<CloudNoteRow>(tx, {
            table: "notes",
            clientIdColumn: "client_note_id",
            tenantId,
            userId,
            clientIdValue: body.client_note_id ?? null,
            insertValues,
          });
          return row;
        });

        return reply.code(201).send(rowToCloudNote(row));
      },
    });
  };

export default buildNotesCreateRoutes;
