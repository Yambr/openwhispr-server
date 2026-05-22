-- SPDX-License-Identifier: FSL-1.1-ALv2
-- AUDIT-SEC-01 (HACK-C2) — restore the AUTH-04 5-minute previous-token
-- overlap window.
--
-- Defect: `apps/api/src/lib/token-rotation.ts` `tryPreviousToken()`
-- resolved the rotated bearer with a BARE
--   `SELECT user_id, tenant_id FROM sessions WHERE previous_token_fp = ...`
-- issued through the RLS-subject `openwhispr_app` pool (`makeAppDb()`).
-- The dual-auth hook (`apps/api/src/index.ts`) calls that adapter BEFORE
-- `req.tenant` is resolved — `app.tenant_id` is unset. `sessions` carries
-- FORCE ROW LEVEL SECURITY with the fail-closed policy
--   `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`
-- (migration 0018). With no GUC the predicate is `tenant_id = NULL` →
-- NULL → the policy matches ZERO rows, so the overlap window never
-- admitted a single request — it was dead code.
--
-- The original design (migration 0005) resolved this exact tenant-unknown
-- lookup through a SECURITY DEFINER function; migration 0019b retired it
-- when the storage shape moved to a plaintext column, and the Node-side
-- helper that replaced it silently inherited the RLS-subject-pool bug.
--
-- Fix: reinstate the SECURITY DEFINER lookup, keyed on the SHA-256
-- fingerprint sidecar `previous_token_fp` (bytea) that is the post-Phase-33
-- storage shape. The function:
--   1. Runs with definer (table-owner) rights, so it bypasses the
--      `sessions` RLS policy WITHOUT the caller knowing the tenant —
--      which is exactly the value being resolved.
--   2. Returns ONLY (user_id, tenant_id, email) — no row data, no token
--      material — so a caller probing arbitrary fingerprints learns
--      nothing beyond "this fingerprint maps to <opaque ids>".
--   3. Filters by `previous_token_expires_at > now()` so an expired
--      overlap window does not match — the 5-minute window stays bounded.
--   4. SET search_path = public, pg_temp — defense in depth against
--      search_path injection (PG SECURITY DEFINER hardening best practice).
--   5. REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO openwhispr_app — the
--      app role can EXECUTE the function but cannot SELECT `sessions`
--      directly. This is the SAFEST shape and keeps the standard app
--      pool — no BYPASSRLS connection is threaded into request paths.
--
-- The `email` column is returned alongside so the dual-auth hook can
-- surface the matched user's email (WR-05) without a follow-up SELECT
-- against the RLS-fail-closed `users` table on the same tenant-less pool.
--
-- Hard Rule 1 honored: this is a NEW forward migration, not an edit to
-- 0005 / 0019b. Down migration drops the function (idempotent).

CREATE OR REPLACE FUNCTION public.lookup_session_by_previous_token_fp(p_fp bytea)
  RETURNS TABLE (user_id uuid, tenant_id uuid, email text)
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public, pg_temp
AS $$
  SELECT s.user_id, s.tenant_id, u.email
  FROM sessions s
  JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
  WHERE s.previous_token_fp = p_fp
    AND s.previous_token_expires_at IS NOT NULL
    AND s.previous_token_expires_at > now()
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lookup_session_by_previous_token_fp(bytea) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    GRANT EXECUTE ON FUNCTION public.lookup_session_by_previous_token_fp(bytea) TO openwhispr_app;
  END IF;
END $$;
