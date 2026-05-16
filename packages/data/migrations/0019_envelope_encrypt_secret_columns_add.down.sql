-- !!! Phase 33 / Plan 33-01 ROLLBACK SCRIPT !!!
-- Reverses migration 0019_envelope_encrypt_secret_columns_add.sql.
-- NOT in the drizzle journal — mirrors 0018_rls_fail_closed.down.sql
-- precedent. Run by hand as openwhispr_owner during a same-day rollback
-- BEFORE Plan 33-03 (backfill) populates the sidecars or 33-05 drops
-- plaintext columns. After 33-03 runs and ciphertext exists on disk,
-- this rollback is data-lossy in the cryptographic sense (it drops the
-- DEK/ciphertext quadruples) — operator must accept that.

-- Drop the two new fingerprint indexes first (index drop is cheap; column
-- drop below cascades anyway, but explicit drop is louder in psql output).
DROP INDEX IF EXISTS "sessions_token_fp_unique";
DROP INDEX IF EXISTS "sessions_previous_token_fp_idx";

-- account: drop 24 bytea sidecars
ALTER TABLE "account"
  DROP COLUMN IF EXISTS "access_token_dek_wrapped",
  DROP COLUMN IF EXISTS "access_token_dek_iv",
  DROP COLUMN IF EXISTS "access_token_dek_auth_tag",
  DROP COLUMN IF EXISTS "access_token_value_iv",
  DROP COLUMN IF EXISTS "access_token_value_auth_tag",
  DROP COLUMN IF EXISTS "access_token_value_ciphertext",
  DROP COLUMN IF EXISTS "refresh_token_dek_wrapped",
  DROP COLUMN IF EXISTS "refresh_token_dek_iv",
  DROP COLUMN IF EXISTS "refresh_token_dek_auth_tag",
  DROP COLUMN IF EXISTS "refresh_token_value_iv",
  DROP COLUMN IF EXISTS "refresh_token_value_auth_tag",
  DROP COLUMN IF EXISTS "refresh_token_value_ciphertext",
  DROP COLUMN IF EXISTS "id_token_dek_wrapped",
  DROP COLUMN IF EXISTS "id_token_dek_iv",
  DROP COLUMN IF EXISTS "id_token_dek_auth_tag",
  DROP COLUMN IF EXISTS "id_token_value_iv",
  DROP COLUMN IF EXISTS "id_token_value_auth_tag",
  DROP COLUMN IF EXISTS "id_token_value_ciphertext",
  DROP COLUMN IF EXISTS "password_dek_wrapped",
  DROP COLUMN IF EXISTS "password_dek_iv",
  DROP COLUMN IF EXISTS "password_dek_auth_tag",
  DROP COLUMN IF EXISTS "password_value_iv",
  DROP COLUMN IF EXISTS "password_value_auth_tag",
  DROP COLUMN IF EXISTS "password_value_ciphertext";

-- verification: drop 6 bytea sidecars
ALTER TABLE "verification"
  DROP COLUMN IF EXISTS "value_dek_wrapped",
  DROP COLUMN IF EXISTS "value_dek_iv",
  DROP COLUMN IF EXISTS "value_dek_auth_tag",
  DROP COLUMN IF EXISTS "value_value_iv",
  DROP COLUMN IF EXISTS "value_value_auth_tag",
  DROP COLUMN IF EXISTS "value_value_ciphertext";

-- sessions: drop 12 bytea sidecars + 2 fingerprint cols
ALTER TABLE "sessions"
  DROP COLUMN IF EXISTS "token_dek_wrapped",
  DROP COLUMN IF EXISTS "token_dek_iv",
  DROP COLUMN IF EXISTS "token_dek_auth_tag",
  DROP COLUMN IF EXISTS "token_value_iv",
  DROP COLUMN IF EXISTS "token_value_auth_tag",
  DROP COLUMN IF EXISTS "token_value_ciphertext",
  DROP COLUMN IF EXISTS "previous_token_dek_wrapped",
  DROP COLUMN IF EXISTS "previous_token_dek_iv",
  DROP COLUMN IF EXISTS "previous_token_dek_auth_tag",
  DROP COLUMN IF EXISTS "previous_token_value_iv",
  DROP COLUMN IF EXISTS "previous_token_value_auth_tag",
  DROP COLUMN IF EXISTS "previous_token_value_ciphertext",
  DROP COLUMN IF EXISTS "token_fp",
  DROP COLUMN IF EXISTS "previous_token_fp";

-- oauth_state: drop 6 bytea sidecars
ALTER TABLE "oauth_state"
  DROP COLUMN IF EXISTS "code_verifier_dek_wrapped",
  DROP COLUMN IF EXISTS "code_verifier_dek_iv",
  DROP COLUMN IF EXISTS "code_verifier_dek_auth_tag",
  DROP COLUMN IF EXISTS "code_verifier_value_iv",
  DROP COLUMN IF EXISTS "code_verifier_value_auth_tag",
  DROP COLUMN IF EXISTS "code_verifier_value_ciphertext";
