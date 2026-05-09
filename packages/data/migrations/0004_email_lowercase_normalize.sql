-- Phase 02.7 / Plan 05 / D-03 Layer B — case-insensitive email uniqueness.
-- Hand-authored (drizzle-kit cannot emit functional indexes for our schema DSL).
--
-- Migration ordering rationale (per CONTEXT D-03 Specific Ideas note):
--   1. Verify no case-collision dupes EXIST in current data — fail loud.
--      We refuse to auto-deduplicate; collision resolution is a human
--      decision (which row wins? which audit trail to keep?). Auto-dedup
--      would be a silent data-loss event (T-02.7-14, Tampering).
--   2. Backfill UPDATE — lowercase every email row (idempotent; no-op
--      WHERE clause for already-lowercase rows).
--   3. Drop the old case-sensitive composite unique index.
--   4. Create the new functional unique index on (tenant_id, lower(email)).
--      The functional form makes WHERE lower(email) = lower($1) an index
--      lookup rather than a sequential scan (T-02.7-16, DoS mitigation).
--
-- All four statements run inside drizzle-orm/migrator's enclosing transaction
-- (per drizzle-kit convention); partial application is impossible — either
-- every step lands or none does.

-- Step 1: dupe precondition check.
DO $$
DECLARE
  collisions integer;
BEGIN
  SELECT count(*) INTO collisions FROM (
    SELECT tenant_id, lower(email) AS lemail, count(*) AS n
    FROM "users"
    GROUP BY tenant_id, lower(email)
    HAVING count(*) > 1
  ) t;
  IF collisions > 0 THEN
    RAISE EXCEPTION
      'migration 0004: found % case-collision email dupes in users table; refusing to auto-deduplicate. Resolve manually (DELETE the duplicate rows or merge audit trails) before re-running.', collisions;
  END IF;
END $$;
--> statement-breakpoint

-- Step 2: backfill — idempotent, only touches rows that need it.
UPDATE "users" SET "email" = lower("email") WHERE "email" <> lower("email");
--> statement-breakpoint

-- Step 3: drop the old case-sensitive composite unique.
DROP INDEX IF EXISTS "users_tenant_email_unique";
--> statement-breakpoint

-- Step 4: new functional unique on (tenant_id, lower(email)).
CREATE UNIQUE INDEX "users_tenant_email_lower_unique"
  ON "users" (tenant_id, lower(email));
