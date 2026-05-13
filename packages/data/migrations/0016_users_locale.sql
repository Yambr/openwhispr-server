-- Phase 10 / Plan 10-01c — users.locale column.
--
-- Adds the per-user preferred locale used by the API i18next negotiation
-- chain (cookie → Accept-Language → DB → 'en') and the worker email-template
-- renderer (Plan 10-01b). Constrained to the runtime locale set OpenWhispr
-- supports today: 'en' (default) and 'ru'. Adding a new locale is a future
-- migration that extends the CHECK predicate.
--
-- NOT NULL DEFAULT 'en' backfills every existing row at column add time so
-- no follow-up UPDATE statement is required. Better Auth's additionalFields
-- maps `locale` through on sign-up; older sessions with no locale claim
-- continue to round-trip the column's default through get-session.

ALTER TABLE "users"
  ADD COLUMN "locale" text NOT NULL DEFAULT 'en'
  CHECK (locale IN ('en', 'ru'));
