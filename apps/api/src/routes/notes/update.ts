// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 2 — PATCH /api/notes/update (WIRE-22).
//
// Wire shape (matches ~/openwhispr/src/services/NotesService.ts.update):
//   Request:  { id: string, ...Partial<NoteInput> }
//   Success:  200 CloudNote
//   404:      note not found / cross-tenant (RLS invisible == 404)
//
// Cross-tenant attempts return 404, not 403 (D-22 / Pitfall: never
// confirm row existence across tenants). RLS makes other tenants'
// rows invisible; an UPDATE with 0 affected rows is indistinguishable
// from "row never existed" — and that's the contract we want.
//
// updated_at is bumped server-side regardless of input. The desktop's
// PATCH may carry `updated_at` from its own clock but the server is
// the source of truth on this field.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { SPACE_SCOPE_INPUT_FIELDS } from "@openwhispr/wire-schemas";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, NotFoundError } from "../../errors.js";
import { assertSpaceWritable } from "../../lib/space-scope.js";
import { type CloudNoteRow, rowToCloudNote } from "./shape.js";

// Allowed mutable columns. STRICT allowlist — defends against
// untrusted-column injection even though the schema is Zod-validated.
const MUTABLE_COLS = [
  "title",
  "content",
  "note_type",
  "enhanced_content",
  "enhancement_prompt",
  "source_file",
  "audio_duration_seconds",
  "folder_id",
  "transcript",
  "enhanced_at_content_hash",
  "participants",
  "calendar_event_id",
  "diarization_enabled",
  "expected_speaker_count",
  // Moving a note between spaces is an ordinary update as far as the client is
  // concerned; the ACCESS check for the target space happens below, before the
  // statement runs.
  "space_id",
] as const;
type MutableCol = (typeof MUTABLE_COLS)[number];

const UpdateBodySchema = z.object({
  // Space scope. These update bodies are NOT `.strict()`, so an unknown key
  // passed silently before it was declared here — a `space_id` was accepted and
  // then ignored, which is worse than a refusal. Now the pair is declared, the
  // column is mutable, and reaching an unauthorized space is a 403 from
  // assertSpaceWritable rather than a quiet no-op.
  ...SPACE_SCOPE_INPUT_FIELDS,
  id: z.string().uuid(),
  title: z.string().nullable().optional(),
  content: z.string().optional(),
  note_type: z.enum(["personal", "meeting", "upload"]).optional(),
  enhanced_content: z.string().nullable().optional(),
  enhancement_prompt: z.string().nullable().optional(),
  source_file: z.string().nullable().optional(),
  audio_duration_seconds: z.number().nullable().optional(),
  folder_id: z.string().nullable().optional(),
  transcript: z.string().nullable().optional(),
  enhanced_at_content_hash: z.string().nullable().optional(),
  participants: z.string().nullable().optional(),
  calendar_event_id: z.string().nullable().optional(),
  diarization_enabled: z.number().nullable().optional(),
  expected_speaker_count: z.number().nullable().optional(),
  // Tolerate but ignore client-supplied timestamps; server owns updated_at.
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  client_note_id: z.string().optional(),
});

const FIELD_MAP: Record<string, MutableCol> = {
  title: "title",
  content: "content",
  note_type: "note_type",
  enhanced_content: "enhanced_content",
  enhancement_prompt: "enhancement_prompt",
  source_file: "source_file",
  audio_duration_seconds: "audio_duration_seconds",
  folder_id: "folder_id",
  transcript: "transcript",
  enhanced_at_content_hash: "enhanced_at_content_hash",
  participants: "participants",
  calendar_event_id: "calendar_event_id",
  diarization_enabled: "diarization_enabled",
  expected_speaker_count: "expected_speaker_count",
  space_id: "space_id",
};

export interface NotesUpdateDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildNotesUpdateRoutes = (deps: NotesUpdateDeps) =>
  async function notesUpdateRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "PATCH",
      url: "/api/notes/update",
      // LOCKER-04 inv-14 — declarative schema wires the SAME Zod schema
      // the handler .parse()s inline (stock ZodCompiler not attached).
      schema: { body: UpdateBodySchema },
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
            // sql.identifier-style: quote literal column name (statically
            // sourced from FIELD_MAP, never user input).
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
          // A move INTO a space needs access to the destination. Without this
          // the column was simply ignored — the row stayed where it was, the
          // response said 200, and the client marked it synced into a space it
          // had never reached.
          if (body.space_id) await assertSpaceWritable(tx, userId, body.space_id);

          const result = (await tx.execute(sql`
            UPDATE "notes"
               SET ${setClause}
             WHERE "id" = ${body.id}::uuid
               AND "user_id" = ${userId}::uuid
               AND "deleted_at" IS NULL
             RETURNING *
          `)) as { rows?: CloudNoteRow[] };
          return result.rows?.[0];
        });

        if (!row) {
          // 0 rows affected — either not found, cross-tenant (RLS
          // invisible), cross-user, or soft-deleted. Surface as 404.
          throw new NotFoundError("NOTE_NOT_FOUND", "note not found");
        }
        return reply.code(200).send(rowToCloudNote(row));
      },
    });
  };

export default buildNotesUpdateRoutes;
