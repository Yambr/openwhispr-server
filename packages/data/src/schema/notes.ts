// SPDX-License-Identifier: Apache-2.0
// Phase 5 / Plan 01 — Tenant-scoped notes. RLS in 0007_notes_folders.sql.
// content_search is a tsvector GENERATED ALWAYS AS (... ) STORED column,
// indexed with GIN. Partial UNIQUE on (tenant_id, user_id, client_note_id)
// per D-24. Keyset pagination via partial index (created_at DESC, id DESC)
// WHERE deleted_at IS NULL per D-25.
//
// Phase 5 / Plan 05 — extended with the 11 columns required by the
// upstream CloudNote wire shape (~/openwhispr/src/services/NotesService.ts).
// Migration 0011 adds the columns to the live table; this Drizzle schema
// mirrors the new shape so the typed query layer recognises the columns.
import { integer, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { folders } from "./folders.js";
import { tsvector } from "./_helpers.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
  clientNoteId: text("client_note_id"),
  title: text("title"),
  content: text("content").notNull().default(""),
  // Plan 05 / 0011 — upstream CloudNote columns.
  noteType: text("note_type").notNull().default("personal"),
  enhancedContent: text("enhanced_content"),
  enhancementPrompt: text("enhancement_prompt"),
  sourceFile: text("source_file"),
  audioDurationSeconds: real("audio_duration_seconds"),
  participants: text("participants"),
  calendarEventId: text("calendar_event_id"),
  diarizationEnabled: integer("diarization_enabled"),
  expectedSpeakerCount: integer("expected_speaker_count"),
  transcript: text("transcript"),
  enhancedAtContentHash: text("enhanced_at_content_hash"),
  // Materialized GENERATED column over (title, content). Hand-augmented in
  // migration 0007; drizzle-kit cannot emit GENERATED expressions natively.
  contentSearch: tsvector("content_search").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
