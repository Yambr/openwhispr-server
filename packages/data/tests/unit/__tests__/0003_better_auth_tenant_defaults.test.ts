// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 02.5 / Plan 01 — RED tests for migration 0003_better_auth_tenant_defaults.sql.
//
// Source-of-record: upcoming Plan 02 commit (new migration file
// packages/data/migrations/0003_better_auth_tenant_defaults.sql).
//
// The migration (Plan 02) does three things:
//   1. Sets `ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-0000-0000-0000-000000000000'`
//      so every connection from that role lands with the default-tenant GUC pre-bound.
//   2. Adds column DEFAULT current_setting('app.tenant_id', true)::uuid
//      on users.tenant_id / sessions.tenant_id / account.tenant_id / verification.tenant_id.
//   3. (Idempotent) confirms the default tenant row 00000000-...-000 exists
//      (already seeded by 0000_initial.sql; ON CONFLICT DO NOTHING).
//
// Together this makes Better Auth's bare INSERTs (which never supply tenant_id)
// resolve to the default tenant transparently, satisfying RLS without app code.
//
// GUC name is `app.tenant_id` (canonical across 0000/0001/0002 RLS policies);
// the CONTEXT.md mention of `app.current_tenant` is a typo. Locked decision
// intent (role default + column DEFAULT) preserved at full strength.
//
// Reverts: removing the ALTER ROLE statement OR removing the column DEFAULTs
// from migration 0003 MUST turn the corresponding tests red — captured in
// SUMMARY reverse-patch evidence (Plan 05).
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type BootResult,
  bootMigratedPostgres,
  DEFAULT_TENANT_ID,
} from "../../../src/__tests__/helpers.js";

let booted: BootResult;
let appPool: Pool;

beforeAll(async () => {
  booted = await bootMigratedPostgres();
  appPool = new Pool({ connectionString: booted.appUri, max: 2 });
}, 180_000);

afterAll(async () => {
  if (appPool) await appPool.end();
  if (booted) await booted.stop();
}, 60_000);

describe("migration 0003_better_auth_tenant_defaults", () => {
  it("ALTER ROLE openwhispr_app sets app.tenant_id=00000000-... default-tenant UUID", async () => {
    const ownerPool = new Pool({ connectionString: booted.ownerUri, max: 1 });
    try {
      const r = await ownerPool.query<{ rolconfig: string[] | null }>(
        `SELECT rolconfig FROM pg_roles WHERE rolname = 'openwhispr_app'`,
      );
      expect(r.rows[0]?.rolconfig ?? []).toEqual(
        expect.arrayContaining([`app.tenant_id=${DEFAULT_TENANT_ID}`]),
      );
    } finally {
      await ownerPool.end();
    }
  });

  it("INSERT INTO users without tenant_id picks up default-tenant via column DEFAULT", async () => {
    const r = await appPool.query<{ tenant_id: string }>(
      `INSERT INTO "users" ("email") VALUES ('alice-d03@test')
         RETURNING "tenant_id"`,
    );
    expect(r.rows[0]?.tenant_id).toBe(DEFAULT_TENANT_ID);
  });

  it("INSERT INTO sessions without tenant_id picks up default-tenant", async () => {
    const u = await appPool.query<{ id: string }>(
      `INSERT INTO "users" ("email") VALUES ('bob-d03@test') RETURNING "id"`,
    );
    // Phase 02.12 — bytea token_hash dropped; sessions.token is plain text.
    const r = await appPool.query<{ tenant_id: string }>(
      `INSERT INTO "sessions" ("user_id", "token", "expires_at")
         VALUES ($1, 'd03-test-bearer', now() + interval '1 hour')
         RETURNING "tenant_id"`,
      [u.rows[0].id],
    );
    expect(r.rows[0]?.tenant_id).toBe(DEFAULT_TENANT_ID);
  });

  it("INSERT INTO account without tenant_id picks up default-tenant", async () => {
    const u = await appPool.query<{ id: string }>(
      `INSERT INTO "users" ("email") VALUES ('carol-d03@test') RETURNING "id"`,
    );
    const r = await appPool.query<{ tenant_id: string }>(
      `INSERT INTO "account" ("user_id", "provider_id", "account_id")
         VALUES ($1, 'credential', 'carol-d03@test')
         RETURNING "tenant_id"`,
      [u.rows[0].id],
    );
    expect(r.rows[0]?.tenant_id).toBe(DEFAULT_TENANT_ID);
  });

  it("INSERT INTO verification without tenant_id picks up default-tenant", async () => {
    const r = await appPool.query<{ tenant_id: string }>(
      `INSERT INTO "verification" ("identifier", "value", "expires_at")
         VALUES ('alice-d03@test', 'tok-xyz', now() + interval '1 hour')
         RETURNING "tenant_id"`,
    );
    expect(r.rows[0]?.tenant_id).toBe(DEFAULT_TENANT_ID);
  });
});
