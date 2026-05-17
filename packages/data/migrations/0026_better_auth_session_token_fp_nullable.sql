-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Plan 51-24 — relax sessions.token_fp NOT NULL.
--
-- Plan 51-23 / 51-24 decided to NOT envelope-encrypt Better Auth-owned
-- columns (see ENCRYPTED_COLUMNS_MAP rationale in apps/api/src/auth.ts).
-- Better Auth writes the plaintext session token directly via its
-- drizzleAdapter; the lens does NOT fire, so the SHA-256 fingerprint
-- sidecar (`token_fp`) that the lens used to produce on write is
-- never populated.
--
-- Phase 33 Plan 02 made `token_fp` NOT NULL with a full UNIQUE INDEX
-- to preserve the Plan 02.12 "session token is unique" contract at the
-- fingerprint layer after the plaintext column was dropped. With
-- plaintext columns back (migration 0025) and the lens out of the
-- write path for Better Auth tables, that constraint has nowhere to
-- pull a value from — every sessions INSERT trips
-- `null value in column "token_fp"`.
--
-- Relax to nullable. The UNIQUE INDEX on the column stays as a partial
-- index (uniqueness preserved when fp is set; multiple NULLs allowed
-- per Postgres MVCC). The session-token uniqueness contract is now
-- enforced at the plaintext `token` column itself via the new partial
-- UNIQUE INDEX `sessions_token_unique_partial` added below.

ALTER TABLE "sessions" ALTER COLUMN "token_fp" DROP NOT NULL;
--> statement-breakpoint

-- Preserve the Plan 02.12 unique-session-token contract on the
-- plaintext column.
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_unique_partial"
  ON "sessions" ("token")
  WHERE "token" IS NOT NULL;
