-- Phase 5 / Plan 05 — Extend `notes` table with the 11 columns required
-- by the upstream CloudNote wire shape (~/openwhispr/src/services/NotesService.ts).
--
-- Plan 01 shipped the wire-schemas Zod definitions for CloudNote (all 19
-- fields) and a minimal `notes` table (12 columns). To honor CLAUDE.md's
-- byte-for-byte wire-compatibility rule (D-22) we MUST persist every
-- field the desktop's NoteInput accepts and CloudNote returns. This
-- migration is a forward-only ADD COLUMN sequence — every new column is
-- nullable or has a NOT NULL DEFAULT, so it is safe to apply to a live
-- table with existing rows.
--
-- Why a separate migration rather than amending 0007:
--   * 0007 has already been applied in production environments (Plan 01
--     ships the journal entry). Drizzle's migration system is forward-only
--     — modifying a past migration corrupts the meta state.
--   * Splitting also makes the wire-shape extension auditable as a
--     distinct Plan-5-Plan-5 change rather than blurring Plan 01's RLS
--     floor.
--
-- Columns added (all from upstream CloudNote):
--   note_type                  text  NOT NULL DEFAULT 'personal'  -- enum-equivalent: personal|meeting|upload
--   enhanced_content           text  NULL                          -- LLM-rewritten content
--   enhancement_prompt         text  NULL                          -- prompt template id used for enhancement
--   source_file                text  NULL                          -- original audio file basename (if recorded)
--   audio_duration_seconds     real  NULL                          -- recording length in seconds
--   participants               text  NULL                          -- free-text speaker names
--   calendar_event_id          text  NULL                          -- ical id for meeting notes
--   diarization_enabled        integer NULL                        -- 0 | 1 (sqlite-style bool from upstream)
--   expected_speaker_count     integer NULL                        -- speaker count hint for pyannote
--   transcript                 text  NULL                          -- raw STT output (pre-enhancement)
--   enhanced_at_content_hash   text  NULL                          -- hash of content at enhancement time
--
-- D-26 / Pitfall #1: the tsvector content_search GENERATED column does
-- NOT reference the new columns. We do NOT extend it to include
-- enhanced_content / transcript — those fields can be enormous (whole
-- meeting transcripts), and a tsvector that includes them would explode
-- in size and slow down every INSERT. If/when search needs to span
-- transcript text, the schema will be revisited; for v1, search remains
-- title+content only per D-26.

ALTER TABLE "notes"
  ADD COLUMN IF NOT EXISTS "note_type" text NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS "enhanced_content" text,
  ADD COLUMN IF NOT EXISTS "enhancement_prompt" text,
  ADD COLUMN IF NOT EXISTS "source_file" text,
  ADD COLUMN IF NOT EXISTS "audio_duration_seconds" real,
  ADD COLUMN IF NOT EXISTS "participants" text,
  ADD COLUMN IF NOT EXISTS "calendar_event_id" text,
  ADD COLUMN IF NOT EXISTS "diarization_enabled" integer,
  ADD COLUMN IF NOT EXISTS "expected_speaker_count" integer,
  ADD COLUMN IF NOT EXISTS "transcript" text,
  ADD COLUMN IF NOT EXISTS "enhanced_at_content_hash" text;
--> statement-breakpoint

-- Re-grant on the new columns so openwhispr_app retains UPDATE
-- capability (Postgres column-level privileges are inherited by
-- table-level GRANT when the column did not exist at grant time, but
-- being explicit here keeps the migration self-contained for fresh
-- installs that bypass 0007's grant block).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "notes" TO openwhispr_app;
  END IF;
END $$;
