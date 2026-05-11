-- Phase 05 / Plan 08 — extend transcriptions with CloudTranscription
-- columns missed by Plan 01 (0009_transcriptions.sql).
--
-- Upstream ~/openwhispr/src/services/TranscriptionsService.ts.CloudTranscription
-- requires: raw_text, word_count, source, status (in addition to the
-- columns already in 0009). Forward-only ALTER TABLE with safe defaults.
--
-- Rationale (Rule 2 — critical missing functionality): byte-for-byte
-- wire conformance (D-22) requires every CloudTranscription field to
-- be persistable. Mirrors Plan 05's 0011 (notes) and Plan 06's 0012
-- (folders) pattern.

ALTER TABLE "transcriptions"
	ADD COLUMN IF NOT EXISTS "raw_text" text,
	ADD COLUMN IF NOT EXISTS "word_count" integer NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'desktop',
	ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'completed';
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "transcriptions" TO openwhispr_app;
	END IF;
END $$;
