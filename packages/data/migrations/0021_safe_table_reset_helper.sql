-- Phase 41.e / HI-02 — `_safe_table_reset(table_name, allow_truncate)`.
--
-- Source: .planning/review/data.md HI-02 fix recommendation. 0005's
-- unconditional `TRUNCATE TABLE "sessions"` is now a documented breaking-
-- migration boundary; future reset-style migrations MUST call this helper
-- so a non-empty target table is either: (a) refused with EXCEPTION, or
-- (b) DELETE-applied with an explicit `allow_truncate=true` override and
-- visible NOTICE in the migration log.
--
-- 0005 itself is NOT retroactively rewritten — project CLAUDE.md Hard
-- Rule 1 prohibits editing already-applied migrations to satisfy a
-- review finding. See 41-e-DECISIONS.md §D-2 for rationale.
--
-- Hardening:
--   * SECURITY DEFINER + SET search_path = public, pg_temp (PG SECDEF
--     best practice; mirrors session_lookup_by_token in 0005).
--   * REVOKE ALL FROM PUBLIC, GRANT EXECUTE TO openwhispr_owner only.
--     The app role MUST NOT call this — it is migration-time tooling.
--   * `format('%I', ...)` quotes the identifier; non-existent tables
--     raise the standard `undefined_table` SQLSTATE 42P01.

CREATE OR REPLACE FUNCTION _safe_table_reset(p_table_name text, p_allow_truncate boolean)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_row_count bigint;
BEGIN
  -- Identifier-safe count of rows in the target table. `format('%I', ...)`
  -- quotes the identifier per Postgres rules; an injection attempt
  -- ('foo; DROP TABLE x') would produce a quoted identifier that fails the
  -- name lookup with `undefined_table` rather than executing.
  EXECUTE format('SELECT count(*) FROM %I', p_table_name) INTO v_row_count;

  IF v_row_count = 0 THEN
    -- Empty table: no-op. Logged for migration-log audit.
    RAISE NOTICE '_safe_table_reset(%): table is empty — no-op', p_table_name;
    RETURN;
  END IF;

  IF NOT p_allow_truncate THEN
    -- Fail-closed: non-empty table without explicit override is refused.
    RAISE EXCEPTION
      '_safe_table_reset: refusing to reset non-empty table % (allow_truncate=false). Pass allow_truncate=true to override (DELETE, not TRUNCATE).',
      p_table_name;
  END IF;

  -- Allowed: DELETE (NOT TRUNCATE). DELETE writes WAL rows that are
  -- visible to logical replication and audit-log triggers; TRUNCATE
  -- bypasses both. Operator opted in via allow_truncate=true.
  EXECUTE format('DELETE FROM %I', p_table_name);
  RAISE NOTICE '_safe_table_reset(%): deleted % row(s) (allow_truncate=true)', p_table_name, v_row_count;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION _safe_table_reset(text, boolean) FROM PUBLIC;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_owner') THEN
    GRANT EXECUTE ON FUNCTION _safe_table_reset(text, boolean) TO openwhispr_owner;
  END IF;
END $$;
