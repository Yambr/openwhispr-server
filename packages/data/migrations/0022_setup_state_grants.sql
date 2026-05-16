-- Phase 41.f-hotfix-followup — migration 0017 created the `setup_state`
-- singleton (Phase 12 / D-01..04 / ADMIN-03) but forgot to GRANT
-- SELECT/UPDATE to the `openwhispr_app` runtime role. The first-boot
-- onboarding wizard is served by `apps/api/src/routes/setup-state.ts`
-- (public GET) and `setup-admin.ts` (POST claim), both of which connect
-- as `openwhispr_app` — every request returned `permission denied for
-- table setup_state` rendered as a 500 internal-server-error to the
-- browser, blocking the wizard from rendering on a fresh install.
--
-- Hard Rule 1 (`.planning/CLAUDE.md`): never retroactively edit applied
-- migrations. 0017 stays as-shipped; this forward migration backfills the
-- missing grants. Pure additive — no DDL, no data touched.
--
-- Squawk posture (16-rule gate, see tools/lint-migrations.ts:31-48):
--   * adding-required-field            — NO (no DDL)
--   * ban-drop-*                       — NO (pure GRANT)
--   * renaming-*                       — NO
--   * changing-column-type             — NO
--   * constraint-missing-not-valid     — NO
--   * prefer-text-field                — NO
--   * disallowed-unique-constraint     — NO
--   * require-concurrent-index-creation— NO

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "setup_state" TO openwhispr_app;
  END IF;
END $$;
