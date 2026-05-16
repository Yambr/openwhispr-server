// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 01 / Task 2 — RED tests for migration 0002_oauth_state.sql.
//
// Asserts that the oauth_state table exists with FORCE RLS + tenant
// isolation policy and the canonical columns + indexes. Schema-only.
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

describe("0002_oauth_state migration", () => {
  it("oauth_state table exists with the expected columns", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='oauth_state'`,
      );
      const cols = rows.map((r) => r.column_name);
      expect(cols).toContain("id");
      expect(cols).toContain("tenant_id");
      expect(cols).toContain("provider");
      expect(cols).toContain("callback_url");
      expect(cols).toContain("scheme");
      expect(cols).toContain("expires_at");
      expect(cols).toContain("consumed_at");
      // Phase 33 / Plan 33-05 — migration 0020 dropped plaintext
      // oauth_state.code_verifier; the PKCE verifier is now stored as
      // a 6-bytea envelope-encrypted sidecar tuple (LOCKER-08).
      for (const suffix of [
        "_dek_wrapped",
        "_dek_iv",
        "_dek_auth_tag",
        "_value_iv",
        "_value_auth_tag",
        "_value_ciphertext",
      ]) {
        expect(cols).toContain(`code_verifier${suffix}`);
      }
      expect(cols).not.toContain("code_verifier");
    } finally {
      await pool.end();
    }
  });

  it("oauth_state has FORCE ROW LEVEL SECURITY", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
         WHERE relname = 'oauth_state'`,
      );
      expect(rows[0]?.relrowsecurity).toBe(true);
      expect(rows[0]?.relforcerowsecurity).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it("oauth_state has a tenant_isolation policy referencing app.tenant_id", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{
        policyname: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `SELECT policyname, qual, with_check FROM pg_policies
         WHERE schemaname='public' AND tablename='oauth_state'`,
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

  it("has a partial index on expires_at filtered by consumed_at IS NULL", async () => {
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname='public' AND tablename='oauth_state'`,
      );
      const hasPartial = rows.some(
        (r) => /expires_at/.test(r.indexdef) && /consumed_at\s+IS\s+NULL/i.test(r.indexdef),
      );
      expect(hasPartial).toBe(true);
    } finally {
      await pool.end();
    }
  });
});
