// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 2 — POST /api/notes/create (WIRE-22).
//
// Wire shape (matches ~/openwhispr/src/services/NotesService.ts):
//   Request:  NoteInput (validated by NoteInputSchema)
//   Success:  200 CloudNote
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
import { type CloudNoteRow, rowToCloudNote } from "./shape.js";

export interface NotesCreateDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildNotesCreateRoutes = (deps: NotesCreateDeps) =>
  async function notesCreateRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/notes/create",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const body = NoteInputSchema.parse(req.body);
        const tenantId = req.tenant;
        const userId = req.user.id;

        const row = await withTenant(deps.db, tenantId, async (tx) => {
          const insertValues: Record<string, unknown> = {
            tenant_id: tenantId,
            user_id: userId,
            client_note_id: body.client_note_id ?? null,
            folder_id: body.folder_id ?? null,
            title: body.title ?? null,
            content: body.content ?? "",
            note_type: body.note_type ?? "personal",
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

        return reply.code(200).send(rowToCloudNote(row));
      },
    });
  };

export default buildNotesCreateRoutes;
