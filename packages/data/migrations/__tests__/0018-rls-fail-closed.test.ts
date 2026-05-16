// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 32 / Plan 32-01 — migration 0018: RLS fail-closed posture.
//
// Reverses 0003's role-default GUC + column DEFAULTs and reshapes every
// tenant-scoped table's RLS policy to silent-deny-read + raise-write.
//
// Per CLAUDE.md "no mocks of internal logic": real Postgres testcontainer,
// real DDL, real role grants.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../src/__tests__/helpers.js";
import { TENANT_SCOPED_TABLES } from "../../src/schema/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/data/migrations/__tests__ -> repo root
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

let boot: BootResult | undefined;

beforeAll(async () => {
  boot = await bootMigratedPostgres({ withPgPartman: true });
}, 180_000);

afterAll(async () => {
  if (boot) await boot.stop();
}, 60_000);

describe("0018_rls_fail_closed: role-default GUC cleared", () => {
  it("openwhispr_app role no longer has app.tenant_id pre-bound at backend-connect time", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ setconfig: string[] | null }>(
        `SELECT s.setconfig
           FROM pg_db_role_setting s
           JOIN pg_roles r ON s.setrole = r.oid
          WHERE r.rolname = 'openwhispr_app'`,
      );
      // After 0018, either there is no rolconfig row at all, OR if one
      // remains it must NOT contain the app.tenant_id binding.
      const offending = rows
        .flatMap((r) => r.setconfig ?? [])
        .filter((s) => s.startsWith("app.tenant_id="));
      expect(offending).toEqual([]);
    } finally {
      await pool.end();
    }
  });
});

describe("0018_rls_fail_closed: GUC-bound column DEFAULTs dropped", () => {
  const BETTER_AUTH_TABLES = ["users", "sessions", "account", "verification"] as const;
  for (const table of BETTER_AUTH_TABLES) {
    it(`${table}.tenant_id has NO column DEFAULT`, async () => {
      const pool = new Pool({ connectionString: boot!.ownerUri });
      try {
        const { rows } = await pool.query<{ column_default: string | null }>(
          `SELECT column_default
             FROM information_schema.columns
            WHERE table_name = $1 AND column_name = 'tenant_id'`,
          [table],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.column_default).toBeNull();
      } finally {
        await pool.end();
      }
    });
  }
});

describe("0018_rls_fail_closed: RLS policy bodies now fail-closed (silent-deny-read + raise-write)", () => {
  for (const table of TENANT_SCOPED_TABLES) {
    it(`${table} policy USING + WITH CHECK gate on (GUC IS NOT NULL AND GUC <> '')`, async () => {
      const pool = new Pool({ connectionString: boot!.ownerUri });
      try {
        const { rows } = await pool.query<{ qual: string | null; with_check: string | null }>(
          `SELECT qual, with_check FROM pg_policies WHERE tablename = $1`,
          [table],
        );
        // Each tenant-scoped table has exactly one tenant_isolation policy.
        expect(rows.length).toBeGreaterThanOrEqual(1);
        const qual = rows[0]!.qual ?? "";
        const withCheck = rows[0]!.with_check ?? "";
        // The fail-closed body must include an IS NOT NULL gate on the GUC.
        expect(qual).toMatch(/IS NOT NULL/i);
        // Empty-string guard prevents '::uuid cast errors and ensures
        // a missing GUC reduces target set to 0 rather than raising.
        expect(qual).toContain("<> ''");
        // WITH CHECK mirrors USING for INSERT/UPDATE semantics.
        expect(withCheck).toMatch(/IS NOT NULL/i);
        expect(withCheck).toContain("<> ''");
      } finally {
        await pool.end();
      }
    });
  }
});

describe("0018_rls_fail_closed: squawk lint clean", () => {
  it("squawk lint exits 0 on migration 0018", () => {
    const out = execFileSync(
      "pnpm",
      ["-s", "lint:migrations", "packages/data/migrations/0018_rls_fail_closed.sql"],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    expect(out).toMatch(/0018_rls_fail_closed\.sql/);
  }, 180_000);
});
