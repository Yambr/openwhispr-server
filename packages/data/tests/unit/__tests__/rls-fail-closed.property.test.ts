// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 32 / Plan 32-02 — RLS fail-closed property test.
//
// 16 tenant-scoped tables × 4 ops (SELECT, INSERT, UPDATE, DELETE) × 2
// contexts (with-tenant, without-tenant) = 128 cells.
//
// Real Postgres testcontainer (DISCIPLINE Rule 4 + 5). Boots ONCE via the
// shared bootMigratedPostgres() helper; per-cell assertions run as
// openwhispr_app (no BYPASSRLS) against the booted database.
//
// Expected matrix after migration 0018:
//
//   op      with-context (tenant A)        without-context (GUC unset)
//   ------  -----------------------------  ----------------------------
//   SELECT  returns tenant A's row(s)      returns 0 rows (silent deny)
//   INSERT  succeeds                        raises 42501 (raise)
//   UPDATE  rowCount === 1                  rowCount === 0 (silent deny)
//   DELETE  rowCount === 1                  rowCount === 0 (silent deny)

import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../../src/__tests__/helpers.js";

let boot: BootResult | undefined;
let appPool: Pool | undefined;
let ownerPool: Pool | undefined;

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

interface SeedRow {
  // Existing row created at setup for this (table, tenant) pair. UPDATE/
  // DELETE/SELECT cells target this row's id (or composite key).
  id: string | { tenantId: string; date: string };
}

// Map<tenant -> Map<table -> SeedRow>>
const seeds: Map<string, Map<string, SeedRow>> = new Map();

interface SeedCtx {
  userIdA: string;
  userIdB: string;
  convIdA: string;
  convIdB: string;
}

/**
 * Build an INSERT statement for `table` under `tenantId` with a generated
 * primary key. Returns the SQL fragment + params; callers prepend a SET
 * GUC line (with-context) or omit it (without-context) before executing.
 */
function buildInsert(
  table: string,
  tenantId: string,
  ctx: SeedCtx,
): { sql: string; params: unknown[] } {
  const userId = tenantId === TENANT_A ? ctx.userIdA : ctx.userIdB;
  const convId = tenantId === TENANT_A ? ctx.convIdA : ctx.convIdB;
  const nonce = randomUUID();
  switch (table) {
    case "users":
      return {
        sql: `INSERT INTO users (id, tenant_id, email) VALUES ($1::uuid, $2::uuid, $3) RETURNING id`,
        params: [randomUUID(), tenantId, `user-${nonce}@test.local`],
      };
    case "sessions":
      // Plan 33-05 — plaintext `token` column dropped by migration 0020.
      // Seed only the SHA-256 fingerprint (`token_fp`, NOT NULL); the
      // plaintext bearer is never persisted post-0020.
      return {
        sql: `INSERT INTO sessions (id, tenant_id, user_id, token_fp, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now() + interval '1 hour') RETURNING id`,
        params: [
          randomUUID(),
          tenantId,
          userId,
          createHash("sha256").update(`tok-${nonce}`, "utf8").digest(),
        ],
      };
    case "audit_log":
      return {
        sql: `INSERT INTO audit_log (id, tenant_id, action) VALUES ($1::uuid, $2::uuid, 'auth.signin') RETURNING id`,
        params: [randomUUID(), tenantId],
      };
    case "usage_ledger":
      return {
        sql: `INSERT INTO usage_ledger (id, tenant_id, user_id, request_id, kind, units) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'transcribe', 1) RETURNING id`,
        params: [randomUUID(), tenantId, userId, `req-${nonce}`],
      };
    case "account":
      return {
        sql: `INSERT INTO account (id, tenant_id, user_id, provider_id, account_id) VALUES ($1::uuid, $2::uuid, $3::uuid, 'google', $4) RETURNING id`,
        params: [randomUUID(), tenantId, userId, `acct-${nonce}`],
      };
    case "verification":
      // Plan 33-05 — plaintext `value` column dropped by migration 0020;
      // every encryption sidecar is nullable. The RLS property test only
      // needs a row that passes the tenant_id WITH CHECK, so we omit
      // the ciphertext sidecars entirely.
      return {
        sql: `INSERT INTO verification (id, tenant_id, identifier, expires_at) VALUES ($1::uuid, $2::uuid, $3, now() + interval '1 hour') RETURNING id`,
        params: [randomUUID(), tenantId, `ident-${nonce}`],
      };
    case "oauth_state":
      // Plan 33-05 — plaintext `code_verifier` column dropped by 0020;
      // every encryption sidecar is nullable. Seed without the verifier
      // payload — RLS isolation is column-agnostic.
      return {
        sql: `INSERT INTO oauth_state (id, tenant_id, provider, callback_url, scheme, expires_at) VALUES ($1::uuid, $2::uuid, 'google', 'https://x', 'pkce', now() + interval '1 hour') RETURNING id`,
        params: [randomUUID(), tenantId],
      };
    case "tenant_settings":
      // PK is tenant_id (singleton). The seed pass for (tenant_settings, A)
      // already inserted tenantId. INSERT-cell tests use a FRESH tenant_id
      // to avoid PK conflict — but RLS WITH CHECK runs on the row's
      // tenant_id column, so an INSERT with a foreign tenant_id under
      // GUC=TENANT_A would FAIL the policy. Use the bound tenantId here.
      // PK conflict is avoided by upstream: this INSERT runs in a per-cell
      // transaction that's rolled back automatically because the only
      // assertions made are `rowCount`. But tenant_settings PK=tenant_id
      // means we'd get 23505. Workaround: use ON CONFLICT DO NOTHING + DELETE.
      // Simpler: generate a fresh tenant first (BYPASSRLS via owner), then
      // INSERT into tenant_settings for it with GUC=that-tenant. But the
      // INSERT cell expects GUC=TENANT_A. Resolution: pre-delete any
      // existing tenant_settings for tenantId in a separate prelude before
      // the INSERT case. Implemented in beforeEach pattern below.
      return {
        sql: `INSERT INTO tenant_settings (tenant_id) VALUES ($1::uuid) ON CONFLICT (tenant_id) DO UPDATE SET stt_config = EXCLUDED.stt_config RETURNING tenant_id AS id`,
        params: [tenantId],
      };
    case "user_settings":
      // PK is user_id. Same singleton issue as tenant_settings. Use upsert.
      return {
        sql: `INSERT INTO user_settings (user_id, tenant_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT (user_id) DO UPDATE SET stt_overrides = EXCLUDED.stt_overrides RETURNING user_id AS id`,
        params: [userId, tenantId],
      };
    case "notes":
      return {
        sql: `INSERT INTO notes (id, tenant_id, user_id, title) VALUES ($1::uuid, $2::uuid, $3::uuid, $4) RETURNING id`,
        params: [randomUUID(), tenantId, userId, `note-${nonce}`],
      };
    case "folders":
      return {
        sql: `INSERT INTO folders (id, tenant_id, user_id, name) VALUES ($1::uuid, $2::uuid, $3::uuid, $4) RETURNING id`,
        params: [randomUUID(), tenantId, userId, `folder-${nonce}`],
      };
    case "conversations":
      return {
        sql: `INSERT INTO conversations (id, tenant_id, user_id) VALUES ($1::uuid, $2::uuid, $3::uuid) RETURNING id`,
        params: [randomUUID(), tenantId, userId],
      };
    case "messages":
      return {
        sql: `INSERT INTO messages (id, tenant_id, conversation_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'user') RETURNING id`,
        params: [randomUUID(), tenantId, convId, userId],
      };
    case "transcriptions":
      return {
        sql: `INSERT INTO transcriptions (id, tenant_id, user_id) VALUES ($1::uuid, $2::uuid, $3::uuid) RETURNING id`,
        params: [randomUUID(), tenantId, userId],
      };
    case "api_keys":
      return {
        sql: `INSERT INTO api_keys (id, tenant_id, user_id, name, key_prefix, key_hash) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6) RETURNING id`,
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
        sql: `INSERT INTO usage_rollup_daily (tenant_id, date) VALUES ($1::uuid, $2::date) ON CONFLICT (tenant_id, date) DO UPDATE SET total_units = EXCLUDED.total_units RETURNING tenant_id AS id`,
        params: [
          tenantId,
          `2026-${String(Math.floor(Math.random() * 11) + 2).padStart(2, "0")}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, "0")}`,
        ],
      };
    default:
      throw new Error(`buildInsert: unknown table ${table}`);
  }
}

/** Build a WHERE clause identifying a seeded row by primary key. */
function buildWhere(table: string, seed: SeedRow): { sql: string; params: unknown[] } {
  if (typeof seed.id === "string") {
    if (table === "user_settings") {
      return { sql: `WHERE user_id = $1::uuid`, params: [seed.id] };
    }
    if (table === "tenant_settings") {
      return { sql: `WHERE tenant_id = $1::uuid`, params: [seed.id] };
    }
    return { sql: `WHERE id = $1::uuid`, params: [seed.id] };
  }
  return {
    sql: `WHERE tenant_id = $1::uuid AND date = $2::date`,
    params: [seed.id.tenantId, seed.id.date],
  };
}

beforeAll(async () => {
  boot = await bootMigratedPostgres({ withPgPartman: true });
  ownerPool = new Pool({ connectionString: boot.ownerUri });
  appPool = new Pool({ connectionString: boot.appUri });

  // Seed both tenants as the owner role (BYPASSRLS).
  await ownerPool.query(
    `INSERT INTO tenants (id, name) VALUES ($1::uuid, 'A'), ($2::uuid, 'B') ON CONFLICT DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // Seed one user per tenant.
  const userA = randomUUID();
  const userB = randomUUID();
  await ownerPool.query(
    `INSERT INTO users (id, tenant_id, email) VALUES ($1::uuid, $2::uuid, 'a@x'), ($3::uuid, $4::uuid, 'b@x')`,
    [userA, TENANT_A, userB, TENANT_B],
  );

  // Seed one conversation per tenant.
  const convA = randomUUID();
  const convB = randomUUID();
  await ownerPool.query(
    `INSERT INTO conversations (id, tenant_id, user_id) VALUES ($1::uuid, $2::uuid, $3::uuid), ($4::uuid, $5::uuid, $6::uuid)`,
    [convA, TENANT_A, userA, convB, TENANT_B, userB],
  );

  seeds.set(TENANT_A, new Map());
  seeds.set(TENANT_B, new Map());
  seeds.get(TENANT_A)!.set("users", { id: userA });
  seeds.get(TENANT_B)!.set("users", { id: userB });
  seeds.get(TENANT_A)!.set("conversations", { id: convA });
  seeds.get(TENANT_B)!.set("conversations", { id: convB });

  const ctx: SeedCtx = { userIdA: userA, userIdB: userB, convIdA: convA, convIdB: convB };

  const tablesToSeed = [
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
    "messages",
    "transcriptions",
    "api_keys",
    "usage_rollup_daily",
  ];

  for (const tenantId of [TENANT_A, TENANT_B]) {
    for (const table of tablesToSeed) {
      const ins = buildInsert(table, tenantId, ctx);
      try {
        const { rows } = await ownerPool.query<{ id: string }>(ins.sql, ins.params);
        if (table === "usage_rollup_daily") {
          seeds.get(tenantId)!.set(table, {
            id: { tenantId, date: ins.params[1] as string },
          });
        } else if (table === "tenant_settings") {
          seeds.get(tenantId)!.set(table, { id: tenantId });
        } else if (table === "user_settings") {
          const userIdForTenant = tenantId === TENANT_A ? userA : userB;
          seeds.get(tenantId)!.set(table, { id: userIdForTenant });
        } else {
          seeds.get(tenantId)!.set(table, { id: rows[0]!.id });
        }
      } catch (err) {
        throw new Error(`seed ${table} for tenant ${tenantId} failed: ${(err as Error).message}`);
      }
    }
  }
}, 240_000);

afterAll(async () => {
  await appPool?.end();
  await ownerPool?.end();
  if (boot) await boot.stop();
}, 60_000);

/**
 * Helper: run `fn(client)` with optional tenant GUC binding inside a tx.
 * The tx is rolled back at the end so per-cell mutations don't leak
 * across iterations of the property suite.
 */
async function withCtx<T>(
  tenantId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool!.connect();
  try {
    await client.query("BEGIN");
    if (tenantId) {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    }
    const result = await fn(client);
    // Roll back to keep the seed state intact for subsequent tests; for
    // SELECT cells this is a no-op; for INSERT/UPDATE/DELETE cells this
    // ensures the test is hermetic per-case.
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

const TENANT_SCOPED_TABLES_ORDER = [
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

describe.each(TENANT_SCOPED_TABLES_ORDER)("RLS fail-closed: %s", (table) => {
  function makeCtx(): SeedCtx {
    return {
      userIdA: seeds.get(TENANT_A)!.get("users")!.id as string,
      userIdB: seeds.get(TENANT_B)!.get("users")!.id as string,
      convIdA: seeds.get(TENANT_A)!.get("conversations")!.id as string,
      convIdB: seeds.get(TENANT_B)!.get("conversations")!.id as string,
    };
  }

  it("SELECT with-context returns tenant A's row, not tenant B's", async () => {
    const seedA = seeds.get(TENANT_A)!.get(table)!;
    const whereA = buildWhere(table, seedA);
    const resA = await withCtx(TENANT_A, (c) =>
      c.query(`SELECT 1 FROM ${table} ${whereA.sql}`, whereA.params),
    );
    expect(resA.rowCount).toBe(1);

    const seedB = seeds.get(TENANT_B)!.get(table)!;
    const whereB = buildWhere(table, seedB);
    const resB = await withCtx(TENANT_A, (c) =>
      c.query(`SELECT 1 FROM ${table} ${whereB.sql}`, whereB.params),
    );
    expect(resB.rowCount).toBe(0);
  });

  it("SELECT without-context returns 0 rows (silent deny)", async () => {
    const seedA = seeds.get(TENANT_A)!.get(table)!;
    const where = buildWhere(table, seedA);
    const res = await withCtx(null, (c) =>
      c.query(`SELECT 1 FROM ${table} ${where.sql}`, where.params),
    );
    expect(res.rowCount).toBe(0);
  });

  it("INSERT with-context succeeds", async () => {
    const ins = buildInsert(table, TENANT_A, makeCtx());
    const res = await withCtx(TENANT_A, (c) => c.query(ins.sql, ins.params));
    expect(res.rowCount).toBe(1);
  });

  it("INSERT without-context raises 42501", async () => {
    const ins = buildInsert(table, TENANT_A, makeCtx());
    await expect(withCtx(null, (c) => c.query(ins.sql, ins.params))).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("UPDATE with-context affects 1 row", async () => {
    const seedA = seeds.get(TENANT_A)!.get(table)!;
    const where = buildWhere(table, seedA);
    const res = await withCtx(TENANT_A, (c) =>
      c.query(`UPDATE ${table} SET tenant_id = tenant_id ${where.sql}`, where.params),
    );
    expect(res.rowCount).toBe(1);
  });

  it("UPDATE without-context affects 0 rows (silent deny)", async () => {
    const seedA = seeds.get(TENANT_A)!.get(table)!;
    const where = buildWhere(table, seedA);
    const res = await withCtx(null, (c) =>
      c.query(`UPDATE ${table} SET tenant_id = tenant_id ${where.sql}`, where.params),
    );
    expect(res.rowCount).toBe(0);
  });

  it("DELETE with-context affects 1 row", async () => {
    // Seed a fresh throwaway row so we don't violate FKs that point at the
    // shared seed row (e.g. users.id referenced by usage_ledger). For
    // singleton-keyed tables (tenant_settings PK=tenant_id, user_settings
    // PK=user_id) the upsert in buildInsert returns the same key; the
    // DELETE then removes it. The outer tx is rolled back regardless, so
    // even singleton-keyed mutations don't pollute the shared seed map.
    const ins = buildInsert(table, TENANT_A, makeCtx());
    let pkParams: unknown[];
    let pkSql: string;
    if (table === "usage_rollup_daily") {
      pkSql = `WHERE tenant_id = $1::uuid AND date = $2::date`;
      pkParams = [TENANT_A, ins.params[1]];
    } else if (table === "tenant_settings") {
      pkSql = `WHERE tenant_id = $1::uuid`;
      pkParams = [TENANT_A];
    } else if (table === "user_settings") {
      pkSql = `WHERE user_id = $1::uuid`;
      pkParams = [makeCtx().userIdA];
    } else {
      pkSql = `WHERE id = $1::uuid`;
      // Insert + delete in the same tx via the freshly-inserted id
      pkParams = []; // populated inside withCtx
    }
    const res = await withCtx(TENANT_A, async (c) => {
      let target: unknown[];
      if (pkParams.length === 0) {
        const inserted = await c.query<{ id: string }>(ins.sql, ins.params);
        target = [inserted.rows[0]!.id];
      } else {
        // singleton/composite — INSERT (upsert) ensures the row exists
        await c.query(ins.sql, ins.params);
        target = pkParams;
      }
      return c.query(`DELETE FROM ${table} ${pkSql}`, target);
    });
    expect(res.rowCount).toBe(1);
  });

  it("DELETE without-context affects 0 rows (silent deny)", async () => {
    const seedA = seeds.get(TENANT_A)!.get(table)!;
    const where = buildWhere(table, seedA);
    const res = await withCtx(null, (c) =>
      c.query(`DELETE FROM ${table} ${where.sql}`, where.params),
    );
    expect(res.rowCount).toBe(0);
  });
});
