-- Phase 33 / Plan 33-04 — rescue script (NOT in the drizzle journal,
-- mirrors 0018 / 0019 patterns). Recreates the
-- `lookup_session_by_previous_token(text)` SECURITY DEFINER function
-- exactly as migration 0005 left it. Only useful in the dev rollback
-- window before Plan 33-05 drops the plaintext `previous_token` column;
-- after that the function would always return 0 rows.

CREATE OR REPLACE FUNCTION lookup_session_by_previous_token(p_token text)
  RETURNS TABLE (user_id uuid, tenant_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public, pg_temp
AS $$
  SELECT s.user_id, s.tenant_id
  FROM sessions s
  WHERE s.previous_token = p_token
    AND s.previous_token_expires_at IS NOT NULL
    AND s.previous_token_expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION lookup_session_by_previous_token(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    GRANT EXECUTE ON FUNCTION lookup_session_by_previous_token(text) TO openwhispr_app;
  END IF;
END $$;
