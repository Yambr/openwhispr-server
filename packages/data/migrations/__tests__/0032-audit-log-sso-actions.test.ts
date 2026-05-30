// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-02 / Task 1 — migration 0032 forward + rollback.
//
// D-69-2 (Option A): extend the locked 18-action audit taxonomy to 21 by
// adding the three SSO just-in-time provisioning actions
//   - sso.jit.user.created
//   - sso.jit.role.updated
//   - sso.jit.rejected
// to AUDIT_LOG_ACTIONS + the Postgres `audit_log_action_check` CHECK.
//
// `audit_log` is a monthly RANGE-partitioned parent (migration 0014). The
// CHECK swap MUST cascade to all partition children, so migration 0032 does
// `ALTER TABLE audit_log DROP CONSTRAINT ...; ALTER TABLE audit_log ADD
// CONSTRAINT ... CHECK (...)` WITHOUT `ONLY` (using `ONLY` would error once
// partitions exist). The down-migration reverts to the 18-action posture.
//
// Per CLAUDE.md "no mocks": real Postgres 17 + pg_partman testcontainer,
// real DDL, real INSERTs through the partitioned parent. No pg-mem, no stubs.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../src/__tests__/helpers.js";

const PARTMAN_IMAGE = "ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1";
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "..");
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

// The three new actions added in D-69-2.
const NEW_SSO_ACTIONS = [
  "sso.jit.user.created",
  "sso.jit.role.updated",
  "sso.jit.rejected",
] as const;

// The 18 actions that must STILL be admitted after the migration (D-A6).
const LEGACY_18_ACTIONS = [
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
] as const;

function readMigrationFile(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

let booted: BootResult | undefined;

beforeAll(async () => {
  // bootMigratedPostgres applies ALL journaled migrations through 0032
  // (the new entry is registered in meta/_journal.json by this plan).
  booted = await bootMigratedPostgres({
    image: PARTMAN_IMAGE,
    withPgPartman: true,
  });
}, 180_000);

afterAll(async () => {
  if (booted) await booted.stop();
}, 60_000);

describe("0032_audit_log_sso_actions: forward migration", () => {
  it("the CHECK admits each of the 3 new sso.jit.* actions", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      for (const action of NEW_SSO_ACTIONS) {
        await expect(
          pool.query(
            `INSERT INTO audit_log (tenant_id, action, payload)
               VALUES ($1::uuid, $2, '{}'::jsonb)`,
            [DEFAULT_TENANT_ID, action],
          ),
        ).resolves.toBeDefined();
      }
    } finally {
      await pool.end();
    }
  });

  it("still admits all 18 legacy D-A6 actions", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      for (const action of LEGACY_18_ACTIONS) {
        await expect(
          pool.query(
            `INSERT INTO audit_log (tenant_id, action, payload)
               VALUES ($1::uuid, $2, '{}'::jsonb)`,
            [DEFAULT_TENANT_ID, action],
          ),
        ).resolves.toBeDefined();
      }
    } finally {
      await pool.end();
    }
  });

  it("still REJECTS an action outside the 21-set (CHECK enforced)", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      await expect(
        pool.query(
          `INSERT INTO audit_log (tenant_id, action, payload)
             VALUES ($1::uuid, 'sso.jit.bogus', '{}'::jsonb)`,
          [DEFAULT_TENANT_ID],
        ),
      ).rejects.toThrow(/audit_log_action_check|violates check constraint/i);
    } finally {
      await pool.end();
    }
  });

  it("the CHECK definition enumerates exactly the 18 legacy + 3 new = 21 actions", async () => {
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
      for (const action of [...LEGACY_18_ACTIONS, ...NEW_SSO_ACTIONS]) {
        expect(def, `CHECK must list ${action}`).toContain(action);
      }
      // Count the quoted action literals in the IN-list — must be exactly 21.
      const literalCount = (def.match(/'[a-z]+\.[a-z._]+'/g) ?? []).length;
      expect(literalCount).toBe(21);
    } finally {
      await pool.end();
    }
  });

  it("the new CHECK cascaded to a monthly partition child (no ONLY)", async () => {
    // pg_partman premakes child partitions. Insert a row that PostgreSQL
    // routes into a real monthly child and assert the child enforces the
    // new action set too — proving DROP/ADD WITHOUT ONLY cascaded.
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      // A new sso.jit.* row routed by created_at=now() lands in the current
      // monthly child partition; it must be ADMITTED (cascade worked).
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO audit_log (tenant_id, action, payload, created_at)
           VALUES ($1::uuid, 'sso.jit.user.created', '{}'::jsonb, now())
           RETURNING id`,
        [DEFAULT_TENANT_ID],
      );
      expect(inserted.rows).toHaveLength(1);

      // Every child partition that inherits audit_log must carry a
      // constraint admitting the new action (declarative partitioning
      // copies the parent CHECK to children when added without ONLY).
      const { rows: children } = await pool.query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_inherits i
           JOIN pg_class c ON c.oid = i.inhrelid
           JOIN pg_class p ON p.oid = i.inhparent
          WHERE p.relname = 'audit_log'`,
      );
      expect(children.length).toBeGreaterThan(0);
      for (const child of children) {
        const { rows: defs } = await pool.query<{ src: string }>(
          `SELECT pg_get_constraintdef(con.oid) AS src
             FROM pg_constraint con
             JOIN pg_class c ON c.oid = con.conrelid
            WHERE c.relname = $1
              AND con.contype = 'c'
              AND pg_get_constraintdef(con.oid) ILIKE '%sso.jit.user.created%'`,
          [child.relname],
        );
        expect(
          defs.length,
          `child ${child.relname} must inherit a CHECK admitting sso.jit.user.created`,
        ).toBeGreaterThanOrEqual(1);
      }
    } finally {
      await pool.end();
    }
  });
});

describe("0032_audit_log_sso_actions: rollback (.down.sql)", () => {
  it("down migration reverts the CHECK to the 18-action set (rejects sso.jit.*)", async () => {
    // Hermetic fresh container so rollback state does not bleed into the
    // forward-only suite above.
    const local = await bootMigratedPostgres({
      image: PARTMAN_IMAGE,
      withPgPartman: true,
    });
    try {
      const owner = new Pool({ connectionString: local.ownerUri });

      // Sanity: forward migration admits sso.jit.* before rollback.
      const seeded = await owner.query<{ id: string }>(
        `INSERT INTO audit_log (tenant_id, action, payload)
           VALUES ($1::uuid, 'sso.jit.user.created', '{}'::jsonb)
           RETURNING id`,
        [DEFAULT_TENANT_ID],
      );
      expect(seeded.rows).toHaveLength(1);

      // A validating ADD CONSTRAINT (the down's re-ADD of the 18-action
      // CHECK) refuses to apply while rows using the new actions still
      // exist — same as any constraint-tightening rollback. Operators
      // purge / migrate the new-action rows first; emulate that here so
      // the revert can prove the restored 18-action posture cleanly.
      await owner.query(`DELETE FROM audit_log WHERE id = $1::uuid`, [seeded.rows[0]!.id]);

      // Apply the down migration (multi-statement; no params).
      const downSql = readMigrationFile("0032_audit_log_sso_actions.down.sql");
      await owner.query(downSql);

      // The CHECK now lists only the 18 legacy actions.
      const { rows } = await owner.query<{ src: string }>(
        `SELECT pg_get_constraintdef(con.oid) AS src
           FROM pg_constraint con
           JOIN pg_class c ON c.oid = con.conrelid
          WHERE c.relname = 'audit_log'
            AND con.conname = 'audit_log_action_check'`,
      );
      expect(rows).toHaveLength(1);
      const literalCount = (rows[0]!.src.match(/'[a-z]+\.[a-z._]+'/g) ?? []).length;
      expect(literalCount).toBe(18);
      for (const action of NEW_SSO_ACTIONS) {
        expect(rows[0]!.src).not.toContain(action);
      }

      // Inserting a sso.jit.* action is now REJECTED.
      await expect(
        owner.query(
          `INSERT INTO audit_log (tenant_id, action, payload)
             VALUES ($1::uuid, 'sso.jit.role.updated', '{}'::jsonb)`,
          [DEFAULT_TENANT_ID],
        ),
      ).rejects.toThrow(/audit_log_action_check|violates check constraint/i);

      // The 18 legacy actions still insert fine post-rollback.
      await expect(
        owner.query(
          `INSERT INTO audit_log (tenant_id, action, payload)
             VALUES ($1::uuid, 'auth.signin', '{}'::jsonb)`,
          [DEFAULT_TENANT_ID],
        ),
      ).resolves.toBeDefined();

      await owner.end();
    } finally {
      await local.stop();
    }
  }, 180_000);
});
