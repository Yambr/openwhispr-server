-- Phase 41.f-hotfix-followup — rollback companion for 0022.
-- Re-creates the pre-0022 state where openwhispr_app has no grants on
-- setup_state (i.e. the bug 0022 fixes). Operators should not run this
-- in production — it re-introduces the 500 on /api/setup-state.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    REVOKE SELECT, INSERT, UPDATE ON "setup_state" FROM openwhispr_app;
  END IF;
END $$;
