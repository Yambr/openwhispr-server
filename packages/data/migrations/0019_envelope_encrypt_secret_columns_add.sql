-- Phase 33 / Plan 33-01 / CRIT-FIX-02 — additive bytea sidecars for envelope encryption.
-- Hand-authored (drizzle-kit cannot emit per-column-family bytea sidecars
-- without a schema declaration; the schema declarations land in 33-05
-- alongside the plaintext drop — research §15 pitfall #1).
--
-- This migration is ADDITIVE-ONLY: it adds 48 nullable bytea sidecar
-- columns (6 per credential × 8 credentials, matching the EncryptedRow
-- shape declared in packages/data/src/encryption/envelope.ts:37-44) and
-- 2 nullable bytea SHA-256 fingerprint sidecars on `sessions`
-- (`token_fp` + `previous_token_fp`). Plaintext columns and their
-- existing indexes (notably `sessions_token_unique`) remain untouched.
--
-- The 6-sidecar shape per credential:
--   - <col>_dek_wrapped:      AES-256-GCM(KEK, DEK)
--   - <col>_dek_iv:           12-byte IV used to wrap the DEK
--   - <col>_dek_auth_tag:     16-byte GCM tag over dek_wrapped
--   - <col>_value_iv:         12-byte IV used to encrypt plaintext
--   - <col>_value_auth_tag:   16-byte GCM tag over value_ciphertext
--   - <col>_value_ciphertext: AES-256-GCM(DEK, plaintext)
--
-- Fingerprint sidecars are HMAC-shaped SHA-256(32 bytes) over the plaintext
-- token — used to preserve O(log N) `lookupByToken` once Plan 33-05 drops
-- the plaintext `sessions.token` / `previous_token` columns. The NOT-NULL
-- flip on `sessions.token_fp` is deferred to migration 0020 (Plan 33-05).
-- The partial-unique-index pattern (WHERE col IS NOT NULL) is the
-- canonical Postgres shape for nullable-transition uniqueness.
--
-- Order of follow-on migrations:
--   - 0019 (this file)   — additive bytea sidecars + fingerprints + indexes
--   - Plan 33-03 backfill — Node-side migrator populates sidecars from plaintext
--   - 0020 (Plan 33-05)  — drop plaintext columns, NOT-NULL flip on token_fp,
--                          drop `sessions_token_unique` (token_fp_unique takes over)
--
-- Forward-only. Companion 0019_envelope_encrypt_secret_columns_add.down.sql
-- is a rescue script (NOT in the drizzle journal — mirrors 0018's pattern).

-- account: 4 credential columns × 6 sidecars = 24 bytea cols
ALTER TABLE "account"
  ADD COLUMN "access_token_dek_wrapped"      bytea,
  ADD COLUMN "access_token_dek_iv"           bytea,
  ADD COLUMN "access_token_dek_auth_tag"     bytea,
  ADD COLUMN "access_token_value_iv"         bytea,
  ADD COLUMN "access_token_value_auth_tag"   bytea,
  ADD COLUMN "access_token_value_ciphertext" bytea,
  ADD COLUMN "refresh_token_dek_wrapped"      bytea,
  ADD COLUMN "refresh_token_dek_iv"           bytea,
  ADD COLUMN "refresh_token_dek_auth_tag"     bytea,
  ADD COLUMN "refresh_token_value_iv"         bytea,
  ADD COLUMN "refresh_token_value_auth_tag"   bytea,
  ADD COLUMN "refresh_token_value_ciphertext" bytea,
  ADD COLUMN "id_token_dek_wrapped"      bytea,
  ADD COLUMN "id_token_dek_iv"           bytea,
  ADD COLUMN "id_token_dek_auth_tag"     bytea,
  ADD COLUMN "id_token_value_iv"         bytea,
  ADD COLUMN "id_token_value_auth_tag"   bytea,
  ADD COLUMN "id_token_value_ciphertext" bytea,
  ADD COLUMN "password_dek_wrapped"      bytea,
  ADD COLUMN "password_dek_iv"           bytea,
  ADD COLUMN "password_dek_auth_tag"     bytea,
  ADD COLUMN "password_value_iv"         bytea,
  ADD COLUMN "password_value_auth_tag"   bytea,
  ADD COLUMN "password_value_ciphertext" bytea;
--> statement-breakpoint

-- verification: 1 credential column × 6 sidecars = 6 bytea cols
ALTER TABLE "verification"
  ADD COLUMN "value_dek_wrapped"      bytea,
  ADD COLUMN "value_dek_iv"           bytea,
  ADD COLUMN "value_dek_auth_tag"     bytea,
  ADD COLUMN "value_value_iv"         bytea,
  ADD COLUMN "value_value_auth_tag"   bytea,
  ADD COLUMN "value_value_ciphertext" bytea;
--> statement-breakpoint

-- sessions: 2 credential columns × 6 sidecars = 12 bytea cols + 2 fingerprint cols
ALTER TABLE "sessions"
  ADD COLUMN "token_dek_wrapped"      bytea,
  ADD COLUMN "token_dek_iv"           bytea,
  ADD COLUMN "token_dek_auth_tag"     bytea,
  ADD COLUMN "token_value_iv"         bytea,
  ADD COLUMN "token_value_auth_tag"   bytea,
  ADD COLUMN "token_value_ciphertext" bytea,
  ADD COLUMN "previous_token_dek_wrapped"      bytea,
  ADD COLUMN "previous_token_dek_iv"           bytea,
  ADD COLUMN "previous_token_dek_auth_tag"     bytea,
  ADD COLUMN "previous_token_value_iv"         bytea,
  ADD COLUMN "previous_token_value_auth_tag"   bytea,
  ADD COLUMN "previous_token_value_ciphertext" bytea,
  ADD COLUMN "token_fp"          bytea,
  ADD COLUMN "previous_token_fp" bytea;
--> statement-breakpoint

-- oauth_state: 1 credential column × 6 sidecars = 6 bytea cols
ALTER TABLE "oauth_state"
  ADD COLUMN "code_verifier_dek_wrapped"      bytea,
  ADD COLUMN "code_verifier_dek_iv"           bytea,
  ADD COLUMN "code_verifier_dek_auth_tag"     bytea,
  ADD COLUMN "code_verifier_value_iv"         bytea,
  ADD COLUMN "code_verifier_value_auth_tag"   bytea,
  ADD COLUMN "code_verifier_value_ciphertext" bytea;
--> statement-breakpoint

-- Partial UNIQUE index on sessions.token_fp (nullable-transition shape).
-- Plan 33-05's migration 0020 flips token_fp to NOT NULL and replaces
-- this partial-unique with a plain UNIQUE INDEX; until then, NULL rows
-- (un-backfilled) coexist without violating uniqueness.
CREATE UNIQUE INDEX "sessions_token_fp_unique" ON "sessions" ("token_fp")
  WHERE "token_fp" IS NOT NULL;
--> statement-breakpoint

-- Partial INDEX (non-unique) on sessions.previous_token_fp. Mirrors the
-- semantics of the existing `sessions_previous_token_idx` (Plan 02.12 /
-- migration 0005) — many NULLs, occasional non-NULL during the AUTH-04
-- 5-minute rotation overlap window.
CREATE INDEX "sessions_previous_token_fp_idx" ON "sessions" ("previous_token_fp")
  WHERE "previous_token_fp" IS NOT NULL;
