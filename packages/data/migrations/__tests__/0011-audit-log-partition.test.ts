// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-02 per 06-VALIDATION.md.
//
// Production migration (not yet created): packages/data/migrations/0014_audit_log_partition.sql
// (Phase 6's migration number is post-Phase-5's 0013_transcriptions_cloud_columns.sql; the
// "0011-" prefix in this test file is the PLAN-LEVEL ordering anchor that 06-VALIDATION.md
// uses, NOT the SQL file number. The GREEN migration will be 0014_*.sql.)
//
// Behaviors locked by D-A2 + D-A3 + D-A4:
//   Forward:
//     - pg_partman extension installed
//     - audit_log converted from flat to relkind='p' (partitioned parent)
//     - 4 premake partitions exist (current month + 3 forward)
//     - CHECK constraint enforces 18 actions (D-A6)
//     - RLS policy migrated to parent + inherited by children
//   Rollback:
//     - audit_log back to flat table
//     - data preserved across the round-trip
//
// TODO: integration test in Plan 06-02 uses a real PostgreSqlContainer
// against the canonical migration runner (packages/data/src/migrate.ts).
//
// NOTE: this test file imports nothing at top level so it compiles even
// before the production migration script exists. All references are in
// comments + string literals for grep traceability ('partman', '0014').
import { describe, it } from "vitest";

const NOT_YET =
  "not yet implemented — Plan 06-02 implements migration 0014_audit_log_partition.sql (D-A2)";

describe("migration 0014_audit_log_partition forward (D-A2)", () => {
  it("installs the pg_partman extension (CREATE EXTENSION IF NOT EXISTS pg_partman)", () => {
    throw new Error(NOT_YET);
  });

  it("converts audit_log to a partitioned parent (relkind='p') RANGE-partitioned on created_at", () => {
    throw new Error(NOT_YET);
  });

  it("creates 4 premake monthly partitions (current month + 3 ahead)", () => {
    throw new Error(NOT_YET);
  });

  it("adds CHECK constraint enforcing the 18 D-A6 action values", () => {
    throw new Error(NOT_YET);
  });

  it("preserves existing audit_log rows during the conversion (copy into the parent)", () => {
    throw new Error(NOT_YET);
  });

  it("re-enables RLS + FORCE on the partitioned parent", () => {
    throw new Error(NOT_YET);
  });

  it("re-applies the tenant-scoped policy on the partitioned parent", () => {
    throw new Error(NOT_YET);
  });
});

describe("migration 0014_audit_log_partition rollback (D-A2)", () => {
  it("drops the pg_partman partman.part_config row for audit_log", () => {
    throw new Error(NOT_YET);
  });

  it("returns audit_log to a flat (relkind='r') table", () => {
    throw new Error(NOT_YET);
  });

  it("preserves all rows across the round-trip (forward -> rollback)", () => {
    throw new Error(NOT_YET);
  });

  it("re-enables original RLS on the flat table", () => {
    throw new Error(NOT_YET);
  });
});
