// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 32 / Plan 32-01 — migration 0018: RLS fail-closed posture.
// Plan 51-22 amendment — migration 0024 RESTORED the Better Auth
// single-tenant bridge that 0018 had dropped (`ALTER ROLE
// openwhispr_app SET app.tenant_id` + per-column `SET DEFAULT
// current_setting('app.tenant_id', true)::uuid` on the 4 Better Auth
// tables) to make Better Auth's drizzleAdapter `INSERT ... VALUES
// (default, ...)` SQL-gen pattern work.
//
// What 0018 still owns AFTER the 51-22 amendment:
//
//   1. RLS policy bodies on every TENANT_SCOPED_TABLE remain
//      fail-closed (silent-deny-read + raise-write via the
//      `NULLIF(current_setting(...), '')::uuid` pattern). 0024 did NOT
//      touch policy bodies — the fail-closed posture is intact and
//      defence-in-depth for non-Better-Auth code paths.
//
//   2. The squawk-lint clean status on the 0018 SQL file is unchanged.
//
// What 0024 RESTORED (constitutional reversal of 0018's role-default
// posture, scoped to Better Auth compat — see Plan 51-22 rationale):
//
//   3. `ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-...'`
//      so backend connects land with the default-tenant GUC pre-bound.
//
//   4. Per-column `SET DEFAULT current_setting('app.tenant_id', true)::uuid`
//      on `users`, `sessions`, `account`, `verification` so the
//      drizzleAdapter's `default`-bound INSERTs resolve to the GUC.
//
// Inverted-mutation validation: this test must STILL FAIL if a future
// refactor (a) drops the GUC pre-bind from `openwhispr_app`,
// (b) drops the column DEFAULT from any of the 4 Better Auth tables,
// (c) loosens any RLS policy body off the `NULLIF(...)` fail-closed
// pattern, or (d) re-introduces an unsafe `'::uuid` cast that raises
// rather than NULL-short-circuits on unset GUC.
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

describe("Plan 51-22 amendment: openwhispr_app role HAS the app.tenant_id GUC pre-bound (restored by 0024)", () => {
  it("openwhispr_app rolconfig pins app.tenant_id to the default-tenant UUID", async () => {
    const pool = new Pool({ connectionString: boot!.ownerUri });
    try {
      const { rows } = await pool.query<{ setconfig: string[] | null }>(
        `SELECT s.setconfig
           FROM pg_db_role_setting s
           JOIN pg_roles r ON s.setrole = r.oid
          WHERE r.rolname = 'openwhispr_app'`,
      );
      const bindings = rows.flatMap((r) => r.setconfig ?? []);
      const tenantBindings = bindings.filter((s) => s.startsWith("app.tenant_id="));
      expect(tenantBindings).toHaveLength(1);
      expect(tenantBindings[0]).toBe("app.tenant_id=00000000-0000-0000-0000-000000000000");
    } finally {
      await pool.end();
    }
  });
});

describe("Plan 51-22 amendment: GUC-bound column DEFAULTs RESTORED on the 4 Better Auth tables (by 0024)", () => {
  const BETTER_AUTH_TABLES = ["users", "sessions", "account", "verification"] as const;
  for (const table of BETTER_AUTH_TABLES) {
    it(`${table}.tenant_id has a column DEFAULT that resolves to current_setting('app.tenant_id', true)::uuid`, async () => {
      const pool = new Pool({ connectionString: boot!.ownerUri });
      try {
        const { rows } = await pool.query<{ column_default: string | null }>(
          `SELECT column_default
             FROM information_schema.columns
            WHERE table_name = $1 AND column_name = 'tenant_id'`,
          [table],
        );
        expect(rows).toHaveLength(1);
        // Postgres canonicalizes the expression; assert on the
        // identifiable substring rather than exact byte equality.
        expect(rows[0]!.column_default).toBeTruthy();
        expect(rows[0]!.column_default ?? "").toMatch(/current_setting\(['"]app\.tenant_id['"]/i);
        expect(rows[0]!.column_default ?? "").toMatch(/::uuid/i);
      } finally {
        await pool.end();
      }
    });
  }
});

describe("0018_rls_fail_closed: RLS policy bodies remain fail-closed (silent-deny-read + raise-write)", () => {
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
        // The fail-closed body uses NULLIF(current_setting(...), '')::uuid
        // so an unset GUC short-circuits to NULL (treated as FALSE) rather
        // than raising on a cast of ''::uuid. 0024 did NOT touch policy
        // bodies — this contract is unchanged from 0018.
        expect(qual).toMatch(/NULLIF\(current_setting/i);
        // WITH CHECK mirrors USING for INSERT/UPDATE semantics.
        expect(withCheck).toMatch(/NULLIF\(current_setting/i);
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
