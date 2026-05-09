// Phase 2 / Plan 01 / Task 2 — tests for migration 0001_better_auth.sql.
//
// Phase 02.12 superseded the bytea storage half of this migration with
// 0005_session_token_plain.sql (Better-Auth-native plain `token` text).
// The Phase 2 columns + function this file originally pinned (
// `previous_token_hash`, `lookup_session_by_previous_token(bytea)`) are
// dropped in 0005 and replaced with plain-text equivalents +
// `text` parameter signatures. The post-migration assertions below
// reflect the FINAL on-disk state (after 0005 lands); the
// session-token-plain-roundtrip integration test in tests/integration/
// pins the 0005-specific contract independently.
//
// What this file still asserts on the freshly-migrated Postgres 17
// container (chain through 0005):
//   1. `account` and `verification` tables exist with FORCE RLS + tenant
//      isolation policy (unchanged by 0005).
//   2. `users` gained name / email_verified / email_verified_at / image
//      / password_hash columns (unchanged by 0005).
//   3. `sessions` carries the post-0005 plain-text `token` / `previous_token`
//      columns plus `previous_token_expires_at` / `ip_address` / `user_agent`
//      (the bytea hash columns originally added by 0001 are gone).
//   4. `lookup_session_by_previous_token(text)` SECURITY DEFINER function
//      exists, executes only when the overlap window is open, and is
//      grantable to openwhispr_app while REVOKEd from PUBLIC.
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "./helpers.js";

let booted: BootResult;

beforeAll(async () => {
  booted = await bootMigratedPostgres();
}, 120_000);

afterAll(async () => {
  if (booted) await booted.stop();
}, 60_000);

describe("0001_better_auth migration — Better Auth tables", () => {
  it("account table exists with tenant_id column", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='account'
         ORDER BY column_name`,
      );
      const cols = rows.map((r) => r.column_name);
      expect(cols).toContain("tenant_id");
      expect(cols).toContain("user_id");
      expect(cols).toContain("provider_id");
      expect(cols).toContain("account_id");
      expect(cols).toContain("password");
      expect(cols).toContain("access_token");
      expect(cols).toContain("refresh_token");
      expect(cols).toContain("id_token");
    } finally {
      await pool.end();
    }
  });

  it("verification table exists with tenant_id column", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='verification'
         ORDER BY column_name`,
      );
      const cols = rows.map((r) => r.column_name);
      expect(cols).toContain("tenant_id");
      expect(cols).toContain("identifier");
      expect(cols).toContain("value");
      expect(cols).toContain("expires_at");
    } finally {
      await pool.end();
    }
  });

  it.each(["account", "verification"])("%s table has FORCE ROW LEVEL SECURITY", async (tbl) => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
           WHERE relname = $1`,
        [tbl],
      );
      expect(rows[0]?.relrowsecurity).toBe(true);
      expect(rows[0]?.relforcerowsecurity).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it.each([
    "account",
    "verification",
  ])("%s table has a tenant_isolation policy referencing app.tenant_id", async (tbl) => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{
        policyname: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `SELECT policyname, qual, with_check FROM pg_policies
           WHERE schemaname='public' AND tablename=$1`,
        [tbl],
      );
      expect(rows.length).toBeGreaterThan(0);
      const hasTenantRef = rows.some(
        (r) =>
          (r.qual ?? "").includes("app.tenant_id") &&
          (r.with_check ?? "").includes("app.tenant_id"),
      );
      expect(hasTenantRef).toBe(true);
    } finally {
      await pool.end();
    }
  });
});

describe("0001_better_auth migration — users / sessions extensions", () => {
  it.each([
    "name",
    "email_verified",
    "email_verified_at",
    "image",
    "password_hash",
  ])("users gained column %s", async (col) => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
           WHERE table_schema='public' AND table_name='users' AND column_name=$1`,
        [col],
      );
      expect(rows).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });

  // Phase 02.12 — post-0005 plain-text columns. The bytea hash columns
  // originally added by 0001 are dropped in 0005.
  it.each([
    "token",
    "previous_token",
    "previous_token_expires_at",
    "ip_address",
    "user_agent",
  ])("sessions has post-0005 column %s", async (col) => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema='public' AND table_name='sessions' AND column_name=$1`,
        [col],
      );
      expect(rows).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });

  it("sessions has a partial index on previous_token (post-0005)", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname='public' AND tablename='sessions'
           AND indexname='sessions_previous_token_idx'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.indexdef).toMatch(/WHERE/i);
    } finally {
      await pool.end();
    }
  });
});

describe("0001_better_auth migration — lookup_session_by_previous_token function", () => {
  it("function exists with SECURITY DEFINER", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ prosecdef: boolean; provolatile: string }>(
        `SELECT prosecdef, provolatile FROM pg_proc
         WHERE proname = 'lookup_session_by_previous_token'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.prosecdef).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it("PUBLIC is REVOKEd; openwhispr_app has EXECUTE (post-0005 text signature)", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      // Phase 02.12 — function signature is now (text), not (bytea).
      const { rows: appRow } = await pool.query<{ has: boolean }>(
        `SELECT has_function_privilege(
           'openwhispr_app',
           'lookup_session_by_previous_token(text)',
           'EXECUTE'
         ) AS has`,
      );
      expect(appRow[0]?.has).toBe(true);

      const { rows: pubRow } = await pool.query<{ has: boolean }>(
        `SELECT has_function_privilege(
           'public',
           'lookup_session_by_previous_token(text)',
           'EXECUTE'
         ) AS has`,
      );
      expect(pubRow[0]?.has).toBe(false);
    } finally {
      await pool.end();
    }
  });

  it("returns 0 rows when previous_token_expires_at <= now() (plain-text)", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const tenantId = "00000000-0000-0000-0000-000000000000";
      await pool.query(
        `INSERT INTO users (id, tenant_id, email)
         VALUES (gen_random_uuid(), $1, 'expired@local')
         ON CONFLICT DO NOTHING`,
        [tenantId],
      );
      const { rows: userRow } = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE email = 'expired@local'`,
      );
      const userId = userRow[0]?.id;
      const bearer = "expired-bearer-AAA";
      await pool.query(
        `INSERT INTO sessions (id, tenant_id, user_id, token, expires_at,
                               previous_token, previous_token_expires_at)
         VALUES (gen_random_uuid(), $1, $2, $3, now() + interval '30 days',
                 $4, now() - interval '1 minute')`,
        [tenantId, userId, "current-bearer-AAA", bearer],
      );
      const { rows } = await pool.query(
        `SELECT user_id, tenant_id FROM lookup_session_by_previous_token($1)`,
        [bearer],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });

  it("returns 1 row when previous_token_expires_at > now() (plain-text)", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const tenantId = "00000000-0000-0000-0000-000000000000";
      await pool.query(
        `INSERT INTO users (id, tenant_id, email)
         VALUES (gen_random_uuid(), $1, 'fresh@local')
         ON CONFLICT DO NOTHING`,
        [tenantId],
      );
      const { rows: userRow } = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE email = 'fresh@local'`,
      );
      const userId = userRow[0]?.id;
      const bearer = "fresh-bearer-BBB";
      await pool.query(
        `INSERT INTO sessions (id, tenant_id, user_id, token, expires_at,
                               previous_token, previous_token_expires_at)
         VALUES (gen_random_uuid(), $1, $2, $3, now() + interval '30 days',
                 $4, now() + interval '5 minutes')`,
        [tenantId, userId, "current-bearer-BBB", bearer],
      );
      const { rows } = await pool.query<{ user_id: string; tenant_id: string }>(
        `SELECT user_id, tenant_id FROM lookup_session_by_previous_token($1)`,
        [bearer],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.user_id).toBe(userId);
      expect(rows[0]?.tenant_id).toBe(tenantId);
    } finally {
      await pool.end();
    }
  });
});
