// SPDX-License-Identifier: FSL-1.1-ALv2
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
import { type BootResult, bootMigratedPostgres } from "../../../src/__tests__/helpers.js";

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

  // Phase 33 / Plan 33-05 — migration 0020 drops the 8 plaintext
  // credential columns. `sessions.token` and `sessions.previous_token`
  // are now envelope-encrypted at rest; the canonical lookup surface
  // is the SHA-256 fingerprint sidecar (`token_fp` NOT NULL +
  // `previous_token_fp` nullable). Migrate the column-existence
  // assertions accordingly.
  it.each([
    "token_fp",
    "previous_token_fp",
    "previous_token_expires_at",
    "ip_address",
    "user_agent",
  ])("sessions has post-0020 column %s", async (col) => {
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

  it("sessions has a partial index on previous_token_fp (post-0019/0020)", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname='public' AND tablename='sessions'
           AND indexname='sessions_previous_token_fp_idx'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.indexdef).toMatch(/WHERE/i);
    } finally {
      await pool.end();
    }
  });
});

// Phase 33 / Plan 33-04 — the `lookup_session_by_previous_token(text)`
// SECURITY DEFINER function created in migration 0001 (and re-signed in
// 0005 with a text parameter) was DROPPED by migration 0019b. The
// AUTH-04 5-minute overlap contract now resolves via the Node-side
// helper `packages/data/src/sessions/lookup-by-previous-token.ts` which
// SHA-256-hashes the plaintext bearer and probes the partial-unique
// index `sessions_previous_token_fp_idx`. The obsolete describe block
// that asserted the SQL function's existence + EXECUTE grants is
// removed here; the post-drop assertion lives in
// `packages/data/migrations/__tests__/0019b-drop-lookup-fn.test.ts`,
// and the helper's behavior is exercised by
// `packages/data/tests/unit/__tests__/lookup-by-previous-token.test.ts`.
