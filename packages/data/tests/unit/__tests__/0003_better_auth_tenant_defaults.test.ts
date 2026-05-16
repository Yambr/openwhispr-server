// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-05 — net-effect replacement test for the historical
// 0003 + 0018 + 0020 migration trio.
//
// The original 5 cases in this file (1 rolconfig assertion + 4 INSERT-
// default-tenant assertions) were written under the Phase 02.5
// FAIL-OPEN posture: they verified that migration 0003 bound
// `app.tenant_id` to the placeholder default tenant at the role level
// AND added GUC-bound column DEFAULTs on `users` / `sessions` /
// `account` / `verification`. Phase 32 (migration 0018) EXPLICITLY
// reverses both: rolconfig is RESET; column DEFAULTs are DROPPED; RLS
// policy bodies rewritten to NULLIF form for fail-closed semantics
// (Phase 32 32-SUMMARY.md). Phase 33 (migration 0020) further drops the
// 8 plaintext credential columns those tests' INSERTs depended on
// (account.password / sessions.token are now bytea-only) — the test
// INSERTs would now fail with 42703 "column does not exist" before
// reaching the GUC-default assertion they were trying to verify.
//
// Deleted per Phase 32 32-DEFERRED.md Category A (the 5-case set
// explicitly named as obsolete + further-broken under Phase 33's
// bytea schema) and Plan 33-05 Task 8.
//
// Net-effect replacement: a 3-introspection check confirming the
// Phase 32 + 33 invariants that the historical tests were
// inverse-asserting. Owning phase: Phase 33 (closing) / Plan 33-05.

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

describe("Phase 32 + 33 net effect — fail-closed RLS + envelope encryption", () => {
  it("openwhispr_app role has NO rolconfig binding for app.tenant_id (Phase 32 / migration 0018)", async () => {
    const ownerPool = new Pool({ connectionString: booted.ownerUri, max: 1 });
    try {
      const r = await ownerPool.query<{ rolconfig: string[] | null }>(
        `SELECT rolconfig FROM pg_roles WHERE rolname = 'openwhispr_app'`,
      );
      const cfg = r.rows[0]?.rolconfig ?? [];
      expect(cfg.some((entry) => entry.startsWith("app.tenant_id="))).toBe(false);
    } finally {
      await ownerPool.end();
    }
  });

  it("Better Auth tables have NO column DEFAULT on tenant_id (Phase 32 / migration 0018)", async () => {
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
        expect(row.column_default).toBeNull();
      }
    } finally {
      await ownerPool.end();
    }
  });

  it("credential columns are bytea-only — plaintext access_token / password / token / value / code_verifier are gone (Phase 33 / migration 0020)", async () => {
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
      // All 8 plaintext columns dropped — count must be 0.
      expect(r.rows[0]!.count).toBe("0");
    } finally {
      await ownerPool.end();
    }
  });
});
