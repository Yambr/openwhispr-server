-- packages/data/migrations/init/00-roles.sql.tpl
--
-- Template, NOT run directly. The companion shell wrapper `00-roles.sh`
-- envsubst-expands ${POSTGRES_OWNER_PASSWORD} / ${POSTGRES_APP_PASSWORD}
-- before piping the result into psql. Mounted into the postgres
-- container at /docker-entrypoint-initdb.d/ via docker-compose.yml.
--
-- Runs ONCE on first volume init (the entrypoint sentinel-skips on
-- subsequent boots when /var/lib/postgresql/data already has a cluster).
-- Both passwords originate from .env (Plan 01-02 bootstrap.sh) and never
-- appear in source.
--
-- Two-role model (D-15):
--   * openwhispr_owner has BYPASSRLS — DDL only via DATABASE_URL_OWNER
--   * openwhispr_app   has NO BYPASSRLS — RLS-subject API/test traffic
-- The defensive DO-block at the bottom RAISEs an exception if anything
-- ever leaves _app inheriting BYPASSRLS (catches typos / regressions).

CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS PASSWORD '${POSTGRES_OWNER_PASSWORD}';
CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${POSTGRES_APP_PASSWORD}';

ALTER DATABASE openwhispr OWNER TO openwhispr_owner;
ALTER SCHEMA public OWNER TO openwhispr_owner;

DO $$
BEGIN
	IF (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
		RAISE EXCEPTION 'openwhispr_app must NOT have BYPASSRLS';
	END IF;
END $$;
