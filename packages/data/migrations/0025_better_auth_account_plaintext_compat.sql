-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Plan 51-23 — restore the 7 Better-Auth-introspection compat columns.
--
-- Background: Phase 33-03 dropped `account.password / access_token /
-- refresh_token / id_token`, `verification.value`, `sessions.token /
-- previous_token` as part of the envelope-encryption-at-rest migration
-- (CRIT-FIX-02). The TS schema declarations were stripped too, leaving
-- the encryption lens (packages/data/src/encryption/lens.ts) as the
-- sole path that routes writes into the 6 bytea sidecars per credential.
--
-- The drop turned out to be premature: Better Auth's drizzleAdapter
-- introspects the schema at adapter-construction time and refuses to
-- boot when a model-canonical field is missing
-- (`BetterAuthError: The field "password" does not exist in the
-- "account" Drizzle schema`), AND its INSERT-SQL generator lists every
-- column drizzle declares and binds `DEFAULT` for any value not
-- supplied. With the columns gone from both schema and DB, every Better
-- Auth sign-up fails. With the columns restored only on the TS side,
-- sign-up advances one step and trips `column "<col>" of relation
-- "<table>" does not exist` in Postgres.
--
-- Fix: ADD the 7 columns back as **nullable, no-DEFAULT sentinels**.
-- Plaintext NEVER lands at rest at runtime — the lens
-- (`encryptInto()`) DELETES the plaintext key from the row payload
-- BEFORE Drizzle builds the SQL, so the column is never written. The
-- columns exist purely as a Drizzle-SQL-gen ⇄ Better-Auth-introspection
-- compatibility shim.
--
-- This is a constitutional amendment to DISCIPLINE Rule 15 — see the
-- updated `tools/lint-no-plaintext-secret-columns.ts` (Plan 51-23) and
-- `.planning/deferred-items.md` Plan 51-19 §amendment for the locked
-- review criteria.

ALTER TABLE "account"      ADD COLUMN IF NOT EXISTS "password"      text;
--> statement-breakpoint
ALTER TABLE "account"      ADD COLUMN IF NOT EXISTS "access_token"  text;
--> statement-breakpoint
ALTER TABLE "account"      ADD COLUMN IF NOT EXISTS "refresh_token" text;
--> statement-breakpoint
ALTER TABLE "account"      ADD COLUMN IF NOT EXISTS "id_token"      text;
--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN IF NOT EXISTS "value"          text;
--> statement-breakpoint
ALTER TABLE "sessions"     ADD COLUMN IF NOT EXISTS "token"          text;
--> statement-breakpoint
ALTER TABLE "sessions"     ADD COLUMN IF NOT EXISTS "previous_token" text;
