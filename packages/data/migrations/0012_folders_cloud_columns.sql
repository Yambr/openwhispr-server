-- Phase 5 / Plan 06 — Extend `folders` table with the 2 columns required
-- by the upstream CloudFolder wire shape (~/openwhispr/src/services/FoldersService.ts).
--
-- Plan 01 shipped a minimal `folders` table that carried `parent_folder_id`
-- (self-FK, ON DELETE SET NULL) but NOT `is_default` / `sort_order`.
-- Upstream CloudFolder requires both fields (non-nullable booleans /
-- numbers). To honor CLAUDE.md's byte-for-byte wire-compatibility rule
-- (D-22) this migration adds them as forward-only ADD COLUMN with safe
-- defaults so the existing tenant rows do not break.
--
-- Mirrors the 0011_notes_cloud_columns.sql pattern. Forward-only, idempotent.
--
-- Columns added:
--   is_default   boolean NOT NULL DEFAULT false  -- one-per-user "default folder" flag
--   sort_order   integer NOT NULL DEFAULT 0      -- display ordering hint
--
-- parent_folder_id stays in the DB (FK constraint, ON DELETE SET NULL)
-- but is intentionally OMITTED from the wire shape — upstream CloudFolder
-- does not expose it. Future plans may surface the hierarchy via a
-- dedicated endpoint; v1 keeps wire conformance with the desktop client.

ALTER TABLE "folders"
  ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Re-grant on the new columns so openwhispr_app retains UPDATE
-- capability. Mirrors the 0011 belt-and-braces pattern.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "folders" TO openwhispr_app;
  END IF;
END $$;
