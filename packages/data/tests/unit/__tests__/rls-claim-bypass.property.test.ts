// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260602-j9z / blocker #2 — claim-driven RLS bypass property test.
//
// Security proof for migration 0033_rls_claim_driven_bypass.sql: a SINGLE
// NOBYPASSRLS Postgres role can perform privileged cross-tenant work via the
// transaction-scoped `app.bypass='on'` GUC claim, WITHOUT weakening tenant
// isolation. bootMigratedPostgres() creates openwhispr_app WITHOUT BYPASSRLS
// (helpers.ts) — every assertion below runs through that NOBYPASSRLS appPool,
// so it proves the CLAIM (not a role attribute) grants access.
//
// 16 tenant-scoped tables × 3 contexts:
//   (a) bypass:    app.bypass='on'  → cross-tenant SELECT sees BOTH tenants,
//                  foreign-tenant INSERT succeeds (system path works w/o BYPASSRLS).
//   (b) isolation: app.tenant_id=A only (no bypass) → tenant-B row invisible
//                  (SELECT 0) AND tenant-B INSERT refused (42501). The OR arm
//                  does NOT leak.
//   (c) failclosed: NEITHER GUC → SELECT 0 / INSERT 42501 (0018 posture intact).

import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../../src/__tests__/helpers.js";

let boot: BootResult | undefined;
let appPool: Pool | undefined;
let ownerPool: Pool | undefined;

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

interface Ids {
  userA: string;
  userB: string;
  convA: string;
  convB: string;
}
let ids: Ids;

/** Build an INSERT for `table` under `tenantId` with a fresh PK. */
function buildInsert(table: string, tenantId: string): { sql: string; params: unknown[] } {
  const userId = tenantId === TENANT_A ? ids.userA : ids.userB;
  const convId = tenantId === TENANT_A ? ids.convA : ids.convB;
  const nonce = randomUUID();
  switch (table) {
    case "users":
      return {
        sql: `INSERT INTO users (id, tenant_id, email) VALUES ($1::uuid,$2::uuid,$3) RETURNING id`,
        params: [randomUUID(), tenantId, `u-${nonce}@t.local`],
      };
    case "sessions":
      return {
        sql: `INSERT INTO sessions (id, tenant_id, user_id, token_fp, expires_at) VALUES ($1::uuid,$2::uuid,$3::uuid,$4, now() + interval '1 hour') RETURNING id`,
        params: [
          randomUUID(),
          tenantId,
          userId,
          createHash("sha256").update(`tok-${nonce}`).digest(),
        ],
      };
    case "audit_log":
      return {
        sql: `INSERT INTO audit_log (id, tenant_id, action) VALUES ($1::uuid,$2::uuid,'auth.signin') RETURNING id`,
        params: [randomUUID(), tenantId],
      };
    case "usage_ledger":
      return {
        sql: `INSERT INTO usage_ledger (id, tenant_id, user_id, request_id, kind, units) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'transcribe',1) RETURNING id`,
        params: [randomUUID(), tenantId, userId, `req-${nonce}`],
      };
    case "account":
      return {
        sql: `INSERT INTO account (id, tenant_id, user_id, provider_id, account_id) VALUES ($1::uuid,$2::uuid,$3::uuid,'google',$4) RETURNING id`,
        params: [randomUUID(), tenantId, userId, `acct-${nonce}`],
      };
    case "verification":
      return {
        sql: `INSERT INTO verification (id, tenant_id, identifier, expires_at) VALUES ($1::uuid,$2::uuid,$3, now() + interval '1 hour') RETURNING id`,
        params: [randomUUID(), tenantId, `ident-${nonce}`],
      };
    case "oauth_state":
      return {
        sql: `INSERT INTO oauth_state (id, tenant_id, provider, callback_url, scheme, expires_at) VALUES ($1::uuid,$2::uuid,'google','https://x','pkce', now() + interval '1 hour') RETURNING id`,
        params: [randomUUID(), tenantId],
      };
    case "tenant_settings":
      return {
        sql: `INSERT INTO tenant_settings (tenant_id) VALUES ($1::uuid) ON CONFLICT (tenant_id) DO UPDATE SET stt_config = EXCLUDED.stt_config RETURNING tenant_id AS id`,
        params: [tenantId],
      };
    case "user_settings":
      return {
        sql: `INSERT INTO user_settings (user_id, tenant_id) VALUES ($1::uuid,$2::uuid) ON CONFLICT (user_id) DO UPDATE SET stt_overrides = EXCLUDED.stt_overrides RETURNING user_id AS id`,
        params: [userId, tenantId],
      };
    case "notes":
      return {
        sql: `INSERT INTO notes (id, tenant_id, user_id, title) VALUES ($1::uuid,$2::uuid,$3::uuid,$4) RETURNING id`,
        params: [randomUUID(), tenantId, userId, `note-${nonce}`],
      };
    case "folders":
      return {
        sql: `INSERT INTO folders (id, tenant_id, user_id, name) VALUES ($1::uuid,$2::uuid,$3::uuid,$4) RETURNING id`,
        params: [randomUUID(), tenantId, userId, `folder-${nonce}`],
      };
    case "conversations":
      return {
        sql: `INSERT INTO conversations (id, tenant_id, user_id) VALUES ($1::uuid,$2::uuid,$3::uuid) RETURNING id`,
        params: [randomUUID(), tenantId, userId],
      };
    case "messages":
      return {
        sql: `INSERT INTO messages (id, tenant_id, conversation_id, user_id, role) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'user') RETURNING id`,
        params: [randomUUID(), tenantId, convId, userId],
      };
    case "transcriptions":
      return {
        sql: `INSERT INTO transcriptions (id, tenant_id, user_id) VALUES ($1::uuid,$2::uuid,$3::uuid) RETURNING id`,
        params: [randomUUID(), tenantId, userId],
      };
    case "api_keys":
      return {
        sql: `INSERT INTO api_keys (id, tenant_id, user_id, name, key_prefix, key_hash) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6) RETURNING id`,
        params: [
          randomUUID(),
          tenantId,
          userId,
          `key-${nonce}`,
          `pfx-${nonce.slice(0, 8)}`,
          `hash-${nonce}`,
        ],
      };
    case "usage_rollup_daily":
      return {
        sql: `INSERT INTO usage_rollup_daily (tenant_id, date) VALUES ($1::uuid,$2::date) ON CONFLICT (tenant_id, date) DO UPDATE SET total_units = EXCLUDED.total_units RETURNING tenant_id AS id`,
        params: [
          tenantId,
          `2027-${String(Math.floor(Math.random() * 11) + 1).padStart(2, "0")}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, "0")}`,
        ],
      };
    default:
      throw new Error(`buildInsert: unknown table ${table}`);
  }
}

const TABLES = [
  "users",
  "sessions",
  "audit_log",
  "usage_ledger",
  "account",
  "verification",
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

/**
 * Run `fn` on the NOBYPASSRLS appPool inside a tx with the requested GUCs.
 * Rolled back so per-case mutations stay hermetic.
 */
async function withGucs<T>(
  gucs: { tenantId?: string; bypass?: boolean },
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool!.connect();
  try {
    await client.query("BEGIN");
    if (gucs.bypass) {
      await client.query("SELECT set_config('app.bypass', 'on', true)");
    }
    if (gucs.tenantId) {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [gucs.tenantId]);
    }
    const r = await fn(client);
    await client.query("ROLLBACK");
    return r;
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

beforeAll(async () => {
  boot = await bootMigratedPostgres({ withPgPartman: true });
  ownerPool = new Pool({ connectionString: boot.ownerUri });
  appPool = new Pool({ connectionString: boot.appUri });

  await ownerPool.query(
    `INSERT INTO tenants (id, name) VALUES ($1::uuid,'A'),($2::uuid,'B') ON CONFLICT DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  const userA = randomUUID();
  const userB = randomUUID();
  await ownerPool.query(
    `INSERT INTO users (id, tenant_id, email) VALUES ($1::uuid,$2::uuid,'a@x'),($3::uuid,$4::uuid,'b@x')`,
    [userA, TENANT_A, userB, TENANT_B],
  );
  const convA = randomUUID();
  const convB = randomUUID();
  await ownerPool.query(
    `INSERT INTO conversations (id, tenant_id, user_id) VALUES ($1::uuid,$2::uuid,$3::uuid),($4::uuid,$5::uuid,$6::uuid)`,
    [convA, TENANT_A, userA, convB, TENANT_B, userB],
  );
  ids = { userA, userB, convA, convB };
}, 240_000);

afterAll(async () => {
  await appPool?.end();
  await ownerPool?.end();
  if (boot) await boot.stop();
}, 60_000);

describe("RLS verifies appPool is NOBYPASSRLS (the claim, not a role attribute)", () => {
  it("openwhispr_app has rolbypassrls = false", async () => {
    const { rows } = await appPool!.query<{ rolbypassrls: boolean; me: string }>(
      `SELECT rolbypassrls, current_user AS me FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows[0]?.rolbypassrls).toBe(false);
  });
});

describe.each(TABLES)("claim-driven bypass: %s", (table) => {
  // (a) bypass works — cross-tenant write succeeds on a NOBYPASSRLS role.
  it("INSERT of a FOREIGN-tenant row SUCCEEDS under app.bypass='on'", async () => {
    // Under tenant-A context BUT with bypass on, write a tenant-B row.
    const ins = buildInsert(table, TENANT_B);
    const res = await withGucs({ bypass: true, tenantId: TENANT_A }, (c) =>
      c.query(ins.sql, ins.params),
    );
    expect(res.rowCount).toBe(1);
  });

  it("SELECT under app.bypass='on' sees BOTH tenants' rows (cross-tenant read)", async () => {
    // Seed one row per tenant via the owner (BYPASSRLS) so both exist.
    const insA = buildInsert(table, TENANT_A);
    const insB = buildInsert(table, TENANT_B);
    await ownerPool!.query(insA.sql, insA.params);
    await ownerPool!.query(insB.sql, insB.params);
    const res = await withGucs({ bypass: true }, (c) =>
      c.query(
        `SELECT DISTINCT tenant_id::text AS t FROM ${table} WHERE tenant_id IN ($1::uuid,$2::uuid)`,
        [TENANT_A, TENANT_B],
      ),
    );
    const seen = new Set((res.rows as Array<{ t: string }>).map((r) => r.t));
    expect(seen.has(TENANT_A)).toBe(true);
    expect(seen.has(TENANT_B)).toBe(true);
  });

  // (b) isolation preserved — the OR arm does NOT leak without bypass.
  it("WITHOUT bypass, foreign-tenant INSERT is REFUSED (42501)", async () => {
    const ins = buildInsert(table, TENANT_B);
    await expect(
      withGucs({ tenantId: TENANT_A }, (c) => c.query(ins.sql, ins.params)),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("WITHOUT bypass, tenant-A context cannot SEE tenant-B rows", async () => {
    const insB = buildInsert(table, TENANT_B);
    await ownerPool!.query(insB.sql, insB.params);
    const res = await withGucs({ tenantId: TENANT_A }, (c) =>
      c.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1::uuid`, [TENANT_B]),
    );
    expect(res.rowCount).toBe(0);
  });

  // (c) fail-closed preserved — neither GUC set (0018 posture).
  it("with NEITHER GUC, SELECT returns 0 rows and INSERT raises 42501", async () => {
    const selRes = await withGucs({}, (c) =>
      c.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1::uuid`, [TENANT_A]),
    );
    expect(selRes.rowCount).toBe(0);
    const ins = buildInsert(table, TENANT_A);
    await expect(withGucs({}, (c) => c.query(ins.sql, ins.params))).rejects.toMatchObject({
      code: "42501",
    });
  });
});
