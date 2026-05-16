-- Phase 41.e / HI-02 — down for 0021_safe_table_reset_helper.sql.
--
-- Reversible: drop the helper function. Production data is not touched
-- by this migration (it only adds a function), so down is a clean
-- DROP FUNCTION.

DROP FUNCTION IF EXISTS _safe_table_reset(text, boolean);
