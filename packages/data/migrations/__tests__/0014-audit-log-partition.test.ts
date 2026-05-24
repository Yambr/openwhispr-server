// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 / Plan 02 / Task 2 — migration 0014 forward + rollback.
//
// Boots a Postgres 17.5 container WITH pg_partman 5.2.4 (custom image
// built by compose/postgres/Dockerfile), runs migrations through 0014,
// asserts the partitioned shape, then exercises the .down.sql to assert
// rollback preserves rows and restores the flat-table shape. Per
// CLAUDE.md "no mocks": real Postgres, real pg_partman, no stubs.
//
// NOTE on numbering: the plan references "0011_audit_log_partition" but
// migrations 0011-0013 are already occupied (notes/folders/transcriptions
// cloud columns). We use the next sequential number 0014 to preserve
// linear migration order (Phase 1 D-* migration discipline).

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../src/__tests__/helpers.js";

const PARTMAN_IMAGE = "ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1";
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "..");

function readMigrationFile(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

let booted: BootResult | undefined;

beforeAll(async () => {
  booted = await bootMigratedPostgres({
    image: PARTMAN_IMAGE,
    withPgPartman: true,
  });
}, 180_000);

afterAll(async () => {
  if (booted) await booted.stop();
}, 60_000);

describe("0014_audit_log_partition: forward migration", () => {
  it("audit_log is RANGE-partitioned on created_at", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      const { rows } = await pool.query<{ partstrat: string; partkey: string }>(
        `SELECT pt.partstrat::text AS partstrat,
                pg_get_partkeydef(c.oid)::text AS partkey
           FROM pg_class c
           JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
          WHERE c.relname = 'audit_log'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.partstrat).toBe("r"); // RANGE
      expect(rows[0]!.partkey.toLowerCase()).toContain("created_at");
    } finally {
      await pool.end();
    }
  });

  it("enumerates all 18 D-A6 actions in the CHECK constraint", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      const { rows } = await pool.query<{ src: string }>(
        `SELECT pg_get_constraintdef(con.oid) AS src
           FROM pg_constraint con
           JOIN pg_class c ON c.oid = con.conrelid
          WHERE c.relname = 'audit_log'
            AND con.conname = 'audit_log_action_check'`,
      );
      expect(rows).toHaveLength(1);
      const def = rows[0]!.src;
      const expected = [
        "auth.signin",
        "auth.signin_failed",
        "auth.signout",
        "auth.password_change",
        "auth.oauth_link",
        "account.delete",
        "account.delete_requested",
        "key.issued",
        "key.revoked",
        "settings.tenant_changed",
        "settings.user_changed",
        "admin.tenant_created",
        "admin.tenant_suspended",
        "admin.user_impersonated",
        "admin.role_changed",
        "security.cross_tenant_attempt",
        "security.rate_limit_exceeded",
        "security.ssrf_blocked",
      ];
      for (const action of expected) {
        expect(def).toContain(action);
      }
    } finally {
      await pool.end();
    }
  });

  it("RLS is enabled+forced on the partitioned parent and a policy exists", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      const { rows: flagsRows } = await pool.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relrowsecurity, relforcerowsecurity
           FROM pg_class WHERE relname = 'audit_log'`,
      );
      expect(flagsRows).toHaveLength(1);
      expect(flagsRows[0]!.relrowsecurity).toBe(true);
      expect(flagsRows[0]!.relforcerowsecurity).toBe(true);
      const { rows: policyRows } = await pool.query<{ qual: string }>(
        `SELECT qual FROM pg_policies
          WHERE tablename = 'audit_log'
            AND policyname = 'audit_log_tenant_isolation'`,
      );
      expect(policyRows).toHaveLength(1);
      expect(policyRows[0]!.qual).toContain("app.tenant_id");
    } finally {
      await pool.end();
    }
  });

  it("partman registered with monthly RANGE and 13-month retention", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      const { rows } = await pool.query<{
        partition_interval: string;
        premake: number;
        retention: string | null;
        retention_keep_table: boolean;
      }>(
        `SELECT partition_interval::text AS partition_interval,
                premake,
                retention,
                retention_keep_table
           FROM partman.part_config
          WHERE parent_table = 'public.audit_log'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.partition_interval).toContain("1 mon");
      expect(rows[0]!.premake).toBeGreaterThanOrEqual(4);
      expect(rows[0]!.retention).toContain("13 mon");
      expect(rows[0]!.retention_keep_table).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it("premake child partitions exist for the next 4+ months", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      const { rows } = await pool.query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_inherits i
           JOIN pg_class c ON c.oid = i.inhrelid
           JOIN pg_class p ON p.oid = i.inhparent
          WHERE p.relname = 'audit_log'
          ORDER BY c.relname`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(5);
      // pg_partman 5.x children are `audit_log_pYYYY_pMM` plus a
      // `audit_log_default` catch-all when infinite_time_partitions=true.
      for (const r of rows) {
        expect(r.relname).toMatch(/^audit_log_(p\d{8}|default)$/);
      }
      // At least one true monthly partition exists.
      expect(rows.filter((r) => /^audit_log_p\d{8}$/.test(r.relname)).length).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  });
});

describe("0014_audit_log_partition: rollback (.down.sql)", () => {
  it("down migration restores a flat audit_log, preserving rows", async () => {
    // Use a fresh container so the rollback test is hermetic — it does
    // not share state with the forward-only suite above.
    const local = await bootMigratedPostgres({
      image: PARTMAN_IMAGE,
      withPgPartman: true,
    });
    try {
      const owner = new Pool({ connectionString: local.ownerUri });
      // Insert a row via owner (BYPASSRLS) into the partitioned parent.
      const insRow = await owner.query<{ id: string }>(
        `INSERT INTO audit_log (tenant_id, action, payload)
           VALUES ($1::uuid, 'auth.signin', '{"k":"v"}'::jsonb)
           RETURNING id`,
        ["00000000-0000-0000-0000-000000000000"],
      );
      const seedId = insRow.rows[0]!.id;

      // Apply the down migration.
      const downSql = readMigrationFile("0014_audit_log_partition.down.sql");
      // The down file uses dollar-quoted blocks and `partman.undo_partition_proc`
      // which is a PROCEDURE -> use CALL. We pipe the full file content as one
      // multi-statement query; node-postgres supports this when no parameters
      // are needed.
      await owner.query(downSql);

      // Assert: audit_log is back to a flat (non-partitioned) table.
      const { rows: pt } = await owner.query(
        `SELECT 1 FROM pg_partitioned_table pt
           JOIN pg_class c ON c.oid = pt.partrelid
          WHERE c.relname = 'audit_log'`,
      );
      expect(pt).toHaveLength(0);

      // Assert: the seeded row is still there.
      const { rows: seedSurvived } = await owner.query<{ id: string }>(
        `SELECT id FROM audit_log WHERE id = $1::uuid`,
        [seedId],
      );
      expect(seedSurvived).toHaveLength(1);

      await owner.end();
    } finally {
      await local.stop();
    }
  }, 180_000);
});
