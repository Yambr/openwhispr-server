-- Phase 51 / Plan 51-14 — down for 0023. Re-creates the function with
-- a hard-fail body so a pre-0023 rollback at least surfaces a clear
-- error rather than the silent 42703 we had before (the function's
-- original 0005 body referenced sessions.token which was dropped in
-- 0020).

CREATE OR REPLACE FUNCTION public.session_lookup_by_token(p_token text)
RETURNS SETOF "session" AS $$
BEGIN
  RAISE EXCEPTION
    'session_lookup_by_token(text) was retired in migration 0023; sessions.token column was dropped in 0020. Update the caller to use the SHA-256-fingerprint helper instead.'
    USING ERRCODE = '0A000'; -- feature_not_supported
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.session_lookup_by_token(text) FROM PUBLIC;
