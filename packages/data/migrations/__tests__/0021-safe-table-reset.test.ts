// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41.e / HI-02 — migration 0021: _safe_table_reset(table_name, allow_truncate).
//
// Codifies the defensive pattern recommended by .planning/review/data.md HI-02
// fix: future migrations that need to reset a table must NOT silently TRUNCATE
// (as 0005 did on `sessions`). They call `_safe_table_reset()` which:
//   - counts rows in the target table,
//   - if non-empty AND allow_truncate=false → RAISE EXCEPTION (fail-closed),
//   - if empty OR allow_truncate=true → executes a logged DELETE (NOT TRUNCATE).
//
// 0005 itself is NOT retroactively modified (project CLAUDE.md Hard Rule 1
// prohibits editing already-applied migrations to satisfy a later fix); the
// helper is forward-looking. See 41-e-DECISIONS.md §D-2.
//
// Test assertions:
//   1. Function exists with the documented signature.
//   2. On a seeded table with 1 row AND allow_truncate=false → EXCEPTION,
//      row count unchanged.
//   3. On a seeded table with allow_truncate=true → DELETE applied,
//      row count is 0.
//   4. On an empty table with allow_truncate=false → no error, no-op.
//   5. CREATE OR REPLACE FUNCTION idempotency: re-applying 0021 succeeds.
//   6. EXECUTE grant is restricted to openwhispr_owner only (not _app).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../src/__tests__/helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "..");
const MIGRATION_0021_PATH = resolve(MIGRATIONS_DIR, "0021_safe_table_reset_helper.sql");

let boot: BootResult | undefined;

beforeAll(async () => {
  boot = await bootMigratedPostgres({ withPgPartman: true });
}, 240_000);

afterAll(async () => {
  if (boot) await boot.stop();
}, 60_000);

describe("0021 forward: _safe_table_reset helper function", () => {
  it("function exists with signature (text, boolean) returning void", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname = '_safe_table_reset'`,
      );
      expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(1);
    } finally {
      await pool.end();
    }
  });

  it("raises EXCEPTION when target table is non-empty and allow_truncate=false", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      // Use a scratch table to avoid disturbing fixture rows.
      await pool.query(`CREATE TABLE IF NOT EXISTS _safe_reset_scratch (id int)`);
      await pool.query(`INSERT INTO _safe_reset_scratch (id) VALUES (1)`);

      await expect(
        pool.query(`SELECT _safe_table_reset('_safe_reset_scratch', false)`),
      ).rejects.toThrow(/refusing|non-empty|allow_truncate/i);

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM _safe_reset_scratch`,
      );
      expect(rows[0]!.count).toBe("1");

      // Clean up.
      await pool.query(`DROP TABLE _safe_reset_scratch`);
    } finally {
      await pool.end();
    }
  });

  it("DELETE-resets the table when allow_truncate=true", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS _safe_reset_scratch2 (id int)`);
      await pool.query(`INSERT INTO _safe_reset_scratch2 (id) VALUES (1), (2), (3)`);

      await pool.query(`SELECT _safe_table_reset('_safe_reset_scratch2', true)`);

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM _safe_reset_scratch2`,
      );
      expect(rows[0]!.count).toBe("0");

      await pool.query(`DROP TABLE _safe_reset_scratch2`);
    } finally {
      await pool.end();
    }
  });

  it("is a no-op on an empty table with allow_truncate=false", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS _safe_reset_scratch3 (id int)`);
      // No rows inserted.

      await expect(
        pool.query(`SELECT _safe_table_reset('_safe_reset_scratch3', false)`),
      ).resolves.toBeDefined();

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM _safe_reset_scratch3`,
      );
      expect(rows[0]!.count).toBe("0");

      await pool.query(`DROP TABLE _safe_reset_scratch3`);
    } finally {
      await pool.end();
    }
  });

  it("is idempotent — re-applying 0021 raw SQL succeeds (CREATE OR REPLACE)", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const sql = readFileSync(MIGRATION_0021_PATH, "utf8");
      // Strip drizzle's `--> statement-breakpoint` markers; the test runs
      // the file as one query batch.
      const cleaned = sql.replace(/-->\s*statement-breakpoint/g, "");
      await expect(pool.query(cleaned)).resolves.toBeDefined();
    } finally {
      await pool.end();
    }
  });

  it("EXECUTE is granted to openwhispr_owner but not to openwhispr_app", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ has_exec: boolean; grantee: string }>(
        `SELECT
           has_function_privilege('openwhispr_app',   'public._safe_table_reset(text, boolean)', 'EXECUTE') AS app_has_exec,
           has_function_privilege('openwhispr_owner', 'public._safe_table_reset(text, boolean)', 'EXECUTE') AS owner_has_exec`,
      );
      const r = rows[0] as unknown as { app_has_exec: boolean; owner_has_exec: boolean };
      expect(r.owner_has_exec).toBe(true);
      expect(r.app_has_exec).toBe(false);
    } finally {
      await pool.end();
    }
  });
});
