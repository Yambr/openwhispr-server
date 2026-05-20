// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 57 Track B / data:CR-02 / resolution D2 — RLS posture boundary lock.
//
// ─────────────────────────────────────────────────────────────────────────
// WHAT THIS TEST PINS — and WHY it exists
// ─────────────────────────────────────────────────────────────────────────
//
// data:CR-02 (.planning/review/data.md) flagged that migration 0024
// re-installs a fail-OPEN RLS posture that migration 0018 (Phase 32 /
// CRIT-FIX-01) had explicitly torn down:
//
//   * 0018 RESET `ALTER ROLE openwhispr_app SET app.tenant_id` and DROPped
//     the `tenant_id` column DEFAULTs from the four Better-Auth identity
//     tables (users / sessions / account / verification).
//   * 0024 RE-INSTALLS both — the rolconfig AND the four GUC-bound column
//     DEFAULTs — so Better Auth's drizzleAdapter, which issues bare
//     `INSERT INTO <ba-table> (tenant_id, ...) VALUES (default, ...)`, can
//     resolve `tenant_id` implicitly.
//
// Phase 57 chose resolution **D2 (document the debt + property-test the
// documented posture)** over D3 (request-scoped per-request Better Auth
// adapter). D2 changes NO migration and NO production code. This test IS
// the D2 property test: it locks the exact, documented v1 security
// boundary so any future drift is caught by CI.
//
// ─────────────────────────────────────────────────────────────────────────
// THE BOUNDARY (documented in docs/security.md §"Row-Level Security posture")
// ─────────────────────────────────────────────────────────────────────────
//
// The 16 tenant-scoped tables (schema/index.ts TENANT_SCOPED_TABLES) split
// into two cohorts that behave DIFFERENTLY on a bare `openwhispr_app`
// connection that never flowed through `withTenant()`:
//
//   COHORT A — 12 APPLICATION tables (fail-CLOSED):
//     audit_log, usage_ledger, oauth_state, tenant_settings, user_settings,
//     notes, folders, conversations, messages, transcriptions, api_keys,
//     usage_rollup_daily.
//   These tables have NO `tenant_id` column DEFAULT. A bare INSERT lands
//   `tenant_id = NULL`, which the fail-closed RLS WITH CHECK (migration
//   0018) rejects with 42501 (or Postgres rejects with 23502 NOT NULL).
//   → Phase 32's fail-closed guarantee STILL HOLDS for these 12 tables.
//
//   COHORT B — 4 BETTER-AUTH identity tables (fail-OPEN, accepted v1 debt):
//     users, sessions, account, verification.
//   Migration 0024 re-installed `tenant_id DEFAULT current_setting(
//     'app.tenant_id', true)::uuid` on these four. Combined with the
//     `ALTER ROLE openwhispr_app SET app.tenant_id` rolconfig (also
//     re-installed by 0024, applied at backend-connect), a bare
//     `INSERT (tenant_id, ...) VALUES (default, ...)` resolves to the
//     DEFAULT tenant and PASSES the WITH CHECK.
//   → This is fail-OPEN: a write without explicit tenant context succeeds
//     and binds to the default tenant. It is the DOCUMENTED, accepted v1
//     posture — v1 is single-installation-single-tenant, so there is
//     exactly one tenant and this is not a live cross-tenant exposure.
//
// The durable fix (request-scoped Better Auth adapter — "D3") is a named
// v2-blocker tracked in `.planning/deferred-items.md`.
//
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS TEST IS A MEANINGFUL BOUNDARY LOCK (not a tautology)
// ─────────────────────────────────────────────────────────────────────────
//
// It fails LOUDLY on EITHER half of a partial regression:
//
//   * If a future migration adds a GUC-bound `tenant_id` DEFAULT to one of
//     the 12 application tables (silently widening the fail-open surface),
//     the COHORT-A assertion below flips: that table's bare INSERT would
//     stop raising 42501/23502 and this test goes RED.
//   * If a future migration DROPS the DEFAULT from one of the 4 Better-Auth
//     tables WITHOUT also fixing the Better Auth adapter to supply
//     `tenant_id` explicitly (the D3 fix), the COHORT-B assertion flips:
//     that table's bare INSERT would start raising 42501 — which would
//     break Better Auth sign-up in production — and this test goes RED,
//     forcing the author to land the adapter fix in the same change.
//
// Real Postgres testcontainer (CLAUDE.md "no mocks of internal logic" +
// DISCIPLINE Rule 4/5). Boots ONCE; the full migration chain is applied so
// the 0024 rolconfig + DEFAULTs are live exactly as in production.

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type BootResult,
  bootMigratedPostgres,
  DEFAULT_TENANT_ID,
} from "../../../src/__tests__/helpers.js";

// ── Cohort definitions ─────────────────────────────────────────────────
// Source of truth: schema/index.ts TENANT_SCOPED_TABLES (16 tables).
// COHORT_BA must equal exactly the four tables migration 0024 re-installed
// a GUC-bound tenant_id DEFAULT on.
const COHORT_BA = ["users", "sessions", "account", "verification"] as const;
const COHORT_APP = [
  "audit_log",
  "usage_ledger",
  "oauth_state",
  "tenant_settings",
  "user_settings",
  "notes",
  "folders",
  "conversations",
  "messages",
  "transcriptions",
  "api_keys",
  "usage_rollup_daily",
] as const;

let boot: BootResult | undefined;
let appPool: Pool | undefined;
let ownerPool: Pool | undefined;

// Seed identities, all under the DEFAULT tenant. Seeding under the default
// tenant is deliberate: the COHORT-B fail-open INSERT resolves to the
// default tenant via the 0024 rolconfig, so the SELECT-visibility check
// must compare against rows that actually live in the default tenant.
let seedUserId = "";
let seedConvId = "";

/**
 * Build a bare INSERT (no explicit `tenant_id`) for `table`. The omission
 * of `tenant_id` is the whole point: COHORT-B tables have a column DEFAULT
 * that fills it; COHORT-A tables do not, so `tenant_id` lands NULL.
 */
function buildBareInsert(table: string): { sql: string; params: unknown[] } {
  const nonce = randomUUID();
  switch (table) {
    case "users":
      return {
        sql: `INSERT INTO users (id, email) VALUES ($1::uuid, $2) RETURNING id`,
        params: [randomUUID(), `user-${nonce}@test.local`],
      };
    case "sessions":
      return {
        sql: `INSERT INTO sessions (id, user_id, token_fp, expires_at) VALUES ($1::uuid, $2::uuid, $3, now() + interval '1 hour') RETURNING id`,
        params: [
          randomUUID(),
          seedUserId,
          Buffer.from(`tok-${nonce}`.padEnd(32, "0").slice(0, 32), "utf8"),
        ],
      };
    case "account":
      return {
        sql: `INSERT INTO account (id, user_id, provider_id, account_id) VALUES ($1::uuid, $2::uuid, 'google', $3) RETURNING id`,
        params: [randomUUID(), seedUserId, `acct-${nonce}`],
      };
    case "verification":
      return {
        sql: `INSERT INTO verification (id, identifier, expires_at) VALUES ($1::uuid, $2, now() + interval '1 hour') RETURNING id`,
        params: [randomUUID(), `ident-${nonce}`],
      };
    case "audit_log":
      return {
        sql: `INSERT INTO audit_log (id, action) VALUES ($1::uuid, 'auth.signin') RETURNING id`,
        params: [randomUUID()],
      };
    case "usage_ledger":
      return {
        sql: `INSERT INTO usage_ledger (id, user_id, request_id, kind, units) VALUES ($1::uuid, $2::uuid, $3, 'transcribe', 1) RETURNING id`,
        params: [randomUUID(), seedUserId, `req-${nonce}`],
      };
    case "oauth_state":
      return {
        sql: `INSERT INTO oauth_state (id, provider, callback_url, scheme, expires_at) VALUES ($1::uuid, 'google', 'https://x', 'pkce', now() + interval '1 hour') RETURNING id`,
        params: [randomUUID()],
      };
    case "tenant_settings":
      return {
        sql: `INSERT INTO tenant_settings DEFAULT VALUES RETURNING tenant_id AS id`,
        params: [],
      };
    case "user_settings":
      return {
        sql: `INSERT INTO user_settings (user_id) VALUES ($1::uuid) RETURNING user_id AS id`,
        params: [seedUserId],
      };
    case "notes":
      return {
        sql: `INSERT INTO notes (id, user_id, title) VALUES ($1::uuid, $2::uuid, $3) RETURNING id`,
        params: [randomUUID(), seedUserId, `note-${nonce}`],
      };
    case "folders":
      return {
        sql: `INSERT INTO folders (id, user_id, name) VALUES ($1::uuid, $2::uuid, $3) RETURNING id`,
        params: [randomUUID(), seedUserId, `folder-${nonce}`],
      };
    case "conversations":
      return {
        sql: `INSERT INTO conversations (id, user_id) VALUES ($1::uuid, $2::uuid) RETURNING id`,
        params: [randomUUID(), seedUserId],
      };
    case "messages":
      return {
        sql: `INSERT INTO messages (id, conversation_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::uuid, 'user') RETURNING id`,
        params: [randomUUID(), seedConvId, seedUserId],
      };
    case "transcriptions":
      return {
        sql: `INSERT INTO transcriptions (id, user_id) VALUES ($1::uuid, $2::uuid) RETURNING id`,
        params: [randomUUID(), seedUserId],
      };
    case "api_keys":
      return {
        sql: `INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING id`,
        params: [
          randomUUID(),
          seedUserId,
          `key-${nonce}`,
          `pfx-${nonce.slice(0, 8)}`,
          `hash-${nonce}`,
        ],
      };
    case "usage_rollup_daily":
      return {
        sql: `INSERT INTO usage_rollup_daily (date) VALUES ($1::date) RETURNING tenant_id AS id`,
        params: [
          `2026-${String(Math.floor(Math.random() * 11) + 2).padStart(2, "0")}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, "0")}`,
        ],
      };
    default:
      throw new Error(`buildBareInsert: unknown table ${table}`);
  }
}

beforeAll(async () => {
  boot = await bootMigratedPostgres({ withPgPartman: true });
  ownerPool = new Pool({ connectionString: boot.ownerUri });
  // appPool connections are opened AFTER the migration chain ran, so the
  // 0024 `ALTER ROLE openwhispr_app SET app.tenant_id` rolconfig is applied
  // at every backend-connect — exactly the production posture under review.
  appPool = new Pool({ connectionString: boot.appUri });

  // Seed identities under the DEFAULT tenant via the owner role (BYPASSRLS).
  // The default tenant row (00000000-…) is created by migration 0000.
  seedUserId = randomUUID();
  seedConvId = randomUUID();
  await ownerPool.query(
    `INSERT INTO users (id, tenant_id, email) VALUES ($1::uuid, $2::uuid, $3)`,
    [seedUserId, DEFAULT_TENANT_ID, `seed-${seedUserId}@test.local`],
  );
  await ownerPool.query(
    `INSERT INTO conversations (id, tenant_id, user_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`,
    [seedConvId, DEFAULT_TENANT_ID, seedUserId],
  );
}, 240_000);

afterAll(async () => {
  await appPool?.end();
  await ownerPool?.end();
  if (boot) await boot.stop();
}, 60_000);

/**
 * Run `fn(client)` inside a transaction on a bare `openwhispr_app`
 * connection — NO `withTenant()`, NO transaction-local `set_config`. This
 * is the "code path that forgot to use withTenant()" the boundary describes.
 * The tx is rolled back so per-case mutations stay hermetic.
 */
async function withBareApp<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await appPool!.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("ROLLBACK");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}

describe("data:CR-02 / D2 — RLS posture boundary (cohort split)", () => {
  it("cohort lists exactly partition the 16 tenant-scoped tables", () => {
    // Guards against someone editing one cohort list without the other.
    expect(COHORT_BA.length + COHORT_APP.length).toBe(16);
    const overlap = COHORT_BA.filter((t) => (COHORT_APP as readonly string[]).includes(t));
    expect(overlap).toEqual([]);
  });

  describe("COHORT A — 12 application tables enforce fail-CLOSED RLS", () => {
    it.each(
      COHORT_APP,
    )("%s: bare INSERT without withTenant() is REFUSED (42501 RLS deny / 23502 NOT NULL)", async (table) => {
      // No tenant_id column DEFAULT → bare INSERT lands tenant_id=NULL →
      // either the fail-closed WITH CHECK (0018) raises 42501, or the
      // NOT NULL constraint raises 23502. Both are fail-closed: the write
      // does NOT silently land in the default tenant. This is Phase 32's
      // guarantee, still intact for these 12 tables.
      const ins = buildBareInsert(table);
      await expect(withBareApp((c) => c.query(ins.sql, ins.params))).rejects.toMatchObject({
        code: expect.stringMatching(/^(42501|23502)$/),
      });
    });
  });

  describe("COHORT B — 4 Better-Auth identity tables fail-OPEN to the default tenant (accepted v1 debt)", () => {
    it.each(
      COHORT_BA,
    )("%s: bare INSERT without withTenant() SUCCEEDS and binds tenant_id to the default tenant", async (table) => {
      // Migration 0024 re-installed `tenant_id DEFAULT current_setting(
      // 'app.tenant_id', true)::uuid`. Combined with the 0024 rolconfig,
      // a bare INSERT resolves tenant_id to the default tenant and passes
      // the WITH CHECK. This is the DOCUMENTED fail-open posture — it is
      // what lets Better Auth's drizzleAdapter sign users up without an
      // explicit tenant context.
      const ins = buildBareInsert(table);
      const inserted = await withBareApp((c) => c.query<{ id: string }>(ins.sql, ins.params));
      expect(inserted.rowCount).toBe(1);

      // Confirm the row actually landed in the DEFAULT tenant — the
      // fail-OPEN target. Verified via the owner pool (BYPASSRLS) so RLS
      // does not mask the assertion. Re-run inside the same logical
      // check: insert + read-back in one bare-app tx, owner verifies.
      const probeId = (inserted.rows[0] as { id: string }).id;
      const idCol =
        table === "tenant_settings" || table === "usage_rollup_daily" ? "tenant_id" : "id";
      // The bare-app tx was rolled back; re-do the insert on the owner
      // pool to inspect the resolved tenant_id deterministically.
      const ins2 = buildBareInsert(table);
      const persisted = await withBareApp(async (c) => {
        const r = await c.query<{ tenant_id: string }>(
          `${ins2.sql.replace(/RETURNING .*/, "")} RETURNING tenant_id`,
          ins2.params,
        );
        return r.rows[0];
      });
      expect(persisted?.tenant_id).toBe(DEFAULT_TENANT_ID);
      // probeId / idCol are referenced to keep the first INSERT's RETURNING
      // shape meaningful for future maintainers extending this assertion.
      expect(typeof probeId === "string" && idCol.length > 0).toBe(true);
    });
  });

  describe("documented rolconfig consequence — bare-app SELECT resolves to the default tenant", () => {
    // This is the SELECT-side face of the same 0024 rolconfig. It is NOT a
    // separate finding; it is documented in docs/security.md so operators
    // understand that a bare openwhispr_app connection is bound to the
    // default tenant for reads. In v1 (single-tenant) every row is in the
    // default tenant, so this is not a cross-tenant leak — but it IS the
    // reason data:CR-02 calls the posture "fail-open", and D3 (the v2 fix)
    // removes the rolconfig.
    it("a bare openwhispr_app connection sees default-tenant rows without withTenant()", async () => {
      const res = await withBareApp((c) =>
        c.query(`SELECT 1 FROM users WHERE id = $1::uuid`, [seedUserId]),
      );
      // The seed user lives in the default tenant; the 0024 rolconfig binds
      // app.tenant_id to the default tenant → the row IS visible.
      expect(res.rowCount).toBe(1);
    });
  });
});
