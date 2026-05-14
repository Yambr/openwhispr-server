-- Phase 12 / Plan 12-01 — operator-global setup_state singleton + users.role.
-- D-01..D-04: pgEnum + singleton row + v1 backfill to skipped_legacy.
-- D-26 squawk gate: additive only, no NOT NULL on populated table, no concurrent
-- index churn.
--
-- Squawk posture (16-rule gate, see tools/lint-migrations.ts:31-48):
--   * adding-required-field   — NO (users.role is nullable; setup_state.id is on
--                                a brand-new empty table)
--   * ban-drop-*              — NO (pure additive)
--   * renaming-*              — NO
--   * changing-column-type    — NO
--   * constraint-missing-not-valid — NO (CHECK (id=1) is on a brand-new empty table)
--   * prefer-text-field       — NO (we use text, not varchar(N))
--   * disallowed-unique-constraint — NO (no unique constraints)
--   * require-concurrent-index-creation — NO (no indexes)
--
-- The fresh-install branch INSERTs `status='pending'`; the v1-upgrade branch
-- (any pre-existing `users` row) INSERTs `status='skipped_legacy'`. Plan 12-03
-- gates the wizard claim on `status='pending'` via atomic UPDATE-WHERE.

CREATE TYPE setup_state_status AS ENUM ('pending', 'completed', 'skipped_legacy');
--> statement-breakpoint
CREATE TABLE "setup_state" (
  "id"           smallint                  PRIMARY KEY  CHECK (id = 1),
  "status"       setup_state_status        NOT NULL     DEFAULT 'pending',
  "completed_at" timestamptz,
  "created_at"   timestamptz               NOT NULL     DEFAULT now()
);
--> statement-breakpoint
-- D-04 v1 backfill: presence of any prior user → skipped_legacy; else pending.
INSERT INTO "setup_state" (id, status, completed_at)
SELECT 1,
       CASE WHEN EXISTS (SELECT 1 FROM "users") THEN 'skipped_legacy'::setup_state_status
            ELSE 'pending'::setup_state_status
       END,
       CASE WHEN EXISTS (SELECT 1 FROM "users") THEN now() ELSE NULL END;
--> statement-breakpoint
-- ADMIN-03: additive role column. Nullable text (no CHECK constraint v1 —
-- role enumeration is a Phase 13+ growth surface; Better Auth's additionalFields
-- handles type narrowing at the application layer with input:false to block
-- public-sign-up role escalation, see apps/api/src/auth.ts).
ALTER TABLE "users" ADD COLUMN "role" text;
