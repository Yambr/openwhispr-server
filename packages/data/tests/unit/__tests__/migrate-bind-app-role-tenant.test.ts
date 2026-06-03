// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260603-rls / upstream blocker #7 — bindAppRoleTenantDefault unit test.
//
// Migrations 0003/0024 hardcode `ALTER ROLE openwhispr_app SET app.tenant_id`
// under an `IF EXISTS (… rolname = 'openwhispr_app')` guard — so on a managed
// Postgres whose single app role is named `svcdb_*` the rolconfig is never
// applied to the role the app connects as. The GUC stays unset → the Better
// Auth tables' `tenant_id` column DEFAULT (`current_setting('app.tenant_id',
// true)::uuid`) resolves to NULL → the pre-auth `verification` INSERT violates
// FORCE RLS → 500 on sign-in. `bindAppRoleTenantDefault` re-applies the
// rolconfig to the operator-named `DATABASE_APP_ROLE`, mirroring the #2 sibling
// `grantAppRoleMembership`. Pure-unit: stub pg.Pool.query and assert the emitted
// SQL + the guard branches (unset / default / role-absent / unsafe-ident).

import { describe, expect, it, vi } from "vitest";
import { bindAppRoleTenantDefault } from "../../../src/migrate.js";

interface QueryCall {
  text: string;
  params?: unknown[];
}

function makeStubPool(rolePresent: boolean) {
  const calls: QueryCall[] = [];
  const pool = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      // The existence probe SELECTs a `present` boolean; the ALTER ROLE
      // statement contains no `present` token and falls through to `rows: []`.
      if (/pg_roles/.test(text)) {
        return { rows: [{ present: rolePresent }] };
      }
      return { rows: [] };
    }),
  };
  return { pool, calls };
}

describe("bindAppRoleTenantDefault (quick 260603-rls, upstream #7)", () => {
  it("no-ops when DATABASE_APP_ROLE is unset", async () => {
    const { pool, calls } = makeStubPool(true);
    await bindAppRoleTenantDefault(pool as never, {}, () => {});
    expect(calls).toHaveLength(0);
  });

  it("no-ops when DATABASE_APP_ROLE equals the canonical openwhispr_app", async () => {
    const { pool, calls } = makeStubPool(true);
    await bindAppRoleTenantDefault(
      pool as never,
      { DATABASE_APP_ROLE: "openwhispr_app" },
      () => {},
    );
    expect(calls).toHaveLength(0);
  });

  it("ALTERs the role to bind app.tenant_id when a custom role is set and exists", async () => {
    const { pool, calls } = makeStubPool(true);
    await bindAppRoleTenantDefault(pool as never, { DATABASE_APP_ROLE: "svcdb_owhspr" }, () => {});
    // First call probes existence; second is the rolconfig ALTER.
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toMatch(/pg_roles/);
    expect(calls[0]?.params).toEqual(["svcdb_owhspr"]);
    // pgIdent validates the [A-Za-z_][A-Za-z0-9_]* shape and returns the bare
    // identifier (no quoting) — safe because anything outside that charset is
    // rejected (see the unsafe-name case below). The nil-UUID is the
    // constitutional default-tenant literal (LOCKER-03 allowlisted), matching
    // both migrations + MIGRATE_SESSION_OPTIONS.
    expect(calls[1]?.text).toBe(
      "ALTER ROLE svcdb_owhspr SET app.tenant_id TO '00000000-0000-0000-0000-000000000000'",
    );
  });

  it("skips the ALTER when the role does not exist", async () => {
    const { pool, calls } = makeStubPool(false);
    await bindAppRoleTenantDefault(pool as never, { DATABASE_APP_ROLE: "svcdb_owhspr" }, () => {});
    // Probe ran, but NO ALTER followed.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toMatch(/pg_roles/);
  });

  it("rejects an unsafe role name (pgIdent) before issuing any query", async () => {
    const { pool } = makeStubPool(true);
    await expect(
      bindAppRoleTenantDefault(
        pool as never,
        { DATABASE_APP_ROLE: 'svcdb"; ALTER ROLE postgres SUPERUSER; --' },
        () => {},
      ),
    ).rejects.toThrow(/pgIdent/);
  });
});
