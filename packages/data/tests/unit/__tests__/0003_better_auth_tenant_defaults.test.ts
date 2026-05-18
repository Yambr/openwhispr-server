// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-05 — net-effect replacement test for the historical
// 0003 + 0018 + 0020 migration trio.
//
// Plan 51-22/23 amendment — migrations 0024/0025 RESTORED a subset of
// what 0018 + 0020 had dropped, scoped narrowly to make Better Auth's
// drizzleAdapter introspection + `INSERT ... VALUES (default, ...)`
// SQL-gen pattern work:
//
//   0024 restored:
//     • `ALTER ROLE openwhispr_app SET app.tenant_id` (rolconfig bind)
//     • per-column `SET DEFAULT current_setting('app.tenant_id', true)::uuid`
//       on users / sessions / account / verification
//
//   0025 restored as nullable, no-DEFAULT compat sentinels:
//     • account.{password, access_token, refresh_token, id_token}
//     • verification.value
//     • sessions.{token, previous_token}
//     (7 columns total — the 8th, oauth_state.code_verifier, STAYS DROPPED)
//
// What this 3-case suite now asserts (the FINAL post-amendment shape):
//
//   1. openwhispr_app rolconfig DOES carry `app.tenant_id=00000000-...`
//      (Plan 51-22 / migration 0024).
//
//   2. Each of the 4 Better Auth tables HAS a column DEFAULT on
//      tenant_id that resolves to `current_setting('app.tenant_id',
//      true)::uuid` (Plan 51-22 / migration 0024).
//
//   3. EXACTLY 7 plaintext credential columns survive across the 4
//      target tables (Plan 51-23 LENS_INTROSPECTION_COMPAT allowlist
//      members). `oauth_state.code_verifier` is the lone plaintext
//      target that REMAINS dropped (not in allowlist).
//
// Inverted-mutation validation: this test must STILL FAIL if a future
// refactor (a) drops the rolconfig binding, (b) drops any of the 4
// column DEFAULTs, (c) re-introduces `oauth_state.code_verifier`, or
// (d) drops any of the 7 LENS_INTROSPECTION_COMPAT plaintext columns.

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../../src/__tests__/helpers.js";

let booted: BootResult;

beforeAll(async () => {
  booted = await bootMigratedPostgres();
}, 180_000);

afterAll(async () => {
  if (booted) await booted.stop();
}, 60_000);

describe("Plan 51-22/23 net effect — Better Auth-compatible single-tenant bridge", () => {
  it("openwhispr_app role rolconfig pins app.tenant_id to the default-tenant UUID (Plan 51-22 / migration 0024)", async () => {
    const ownerPool = new Pool({ connectionString: booted.ownerUri, max: 1 });
    try {
      const r = await ownerPool.query<{ rolconfig: string[] | null }>(
        `SELECT rolconfig FROM pg_roles WHERE rolname = 'openwhispr_app'`,
      );
      const cfg = r.rows[0]?.rolconfig ?? [];
      const bindings = cfg.filter((entry) => entry.startsWith("app.tenant_id="));
      expect(bindings).toHaveLength(1);
      expect(bindings[0]).toBe("app.tenant_id=00000000-0000-0000-0000-000000000000");
    } finally {
      await ownerPool.end();
    }
  });

  it("Better Auth tables HAVE a column DEFAULT resolving to current_setting('app.tenant_id', true)::uuid (Plan 51-22 / migration 0024)", async () => {
    const ownerPool = new Pool({ connectionString: booted.ownerUri, max: 1 });
    try {
      const r = await ownerPool.query<{ table_name: string; column_default: string | null }>(
        `SELECT table_name, column_default
           FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name IN ('users','sessions','account','verification')
            AND column_name = 'tenant_id'`,
      );
      expect(r.rows).toHaveLength(4);
      for (const row of r.rows) {
        expect(row.column_default, `${row.table_name}.tenant_id default`).toBeTruthy();
        expect(row.column_default ?? "").toMatch(/current_setting\(['"]app\.tenant_id['"]/i);
        expect(row.column_default ?? "").toMatch(/::uuid/i);
      }
    } finally {
      await ownerPool.end();
    }
  });

  it("EXACTLY the 7 LENS_INTROSPECTION_COMPAT plaintext columns survive; oauth_state.code_verifier remains dropped (Plan 51-23 / migration 0025)", async () => {
    const ownerPool = new Pool({ connectionString: booted.ownerUri, max: 1 });
    try {
      const r = await ownerPool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM information_schema.columns
          WHERE table_schema='public'
            AND (
              (table_name='account' AND column_name IN ('access_token','refresh_token','id_token','password'))
              OR (table_name='verification' AND column_name='value')
              OR (table_name='sessions' AND column_name IN ('token','previous_token'))
              OR (table_name='oauth_state' AND column_name='code_verifier')
            )`,
      );
      // 7 LENS_INTROSPECTION_COMPAT columns coexist with their sidecars;
      // oauth_state.code_verifier (the 8th) stays dropped — total 7.
      expect(r.rows[0]!.count).toBe("7");

      // Defence-in-depth: assert oauth_state.code_verifier is the
      // specific drop (not some other combination of 7).
      const dropped = await ownerPool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name='oauth_state' AND column_name='code_verifier'`,
      );
      expect(dropped.rows[0]!.count).toBe("0");
    } finally {
      await ownerPool.end();
    }
  });
});
