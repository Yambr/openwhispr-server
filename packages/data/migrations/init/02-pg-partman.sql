-- Phase 6 / Plan 02 — provision pg_partman extension on first DB init.
--
-- Runs ONCE on a freshly initialized Postgres data volume (the
-- /docker-entrypoint-initdb.d contract). Idempotent guards make
-- re-running harmless if an operator manually re-applies.
--
-- Why a dedicated `partman` schema (not `public`):
--   pg_partman's recommended posture isolates its 30+ functions and
--   the `part_config` registration table from application objects.
--   Migrations reference partman procedures as `partman.create_parent(...)`.
--
-- Why GRANT USAGE to openwhispr_owner (BYPASSRLS):
--   The migration runner connects as openwhispr_owner and must be able
--   to call `partman.create_parent` + UPDATE `partman.part_config`.
--   openwhispr_app NEVER needs access to the partman schema — it only
--   reads/writes the application-level partitioned parent (audit_log).

CREATE SCHEMA IF NOT EXISTS partman;

CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_owner') THEN
        GRANT USAGE ON SCHEMA partman TO openwhispr_owner;
        GRANT ALL ON ALL TABLES IN SCHEMA partman TO openwhispr_owner;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO openwhispr_owner;
        GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO openwhispr_owner;
    END IF;
END
$$;
