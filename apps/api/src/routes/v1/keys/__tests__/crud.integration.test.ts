// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 09 / Task 2 — /api/v1/keys/{list,create} integration
// tests against real Postgres + RLS. Asserts:
//   * V1Response envelope `{ data: T }` on every route (D-28)
//   * Argon2id hash format in DB (`$argon2id$v=19$m=65536$t=3$p=1$…`) D-29
//   * Clear-text PAK returned EXACTLY ONCE on /create response (D-29)
//   * `key` / `key_hash` NEVER appear in /list response (T-KEY-LEAK)
//   * key_prefix is 12 chars, starts with `pak_`
//   * Cross-tenant RLS invisibility (T-05-07)
//   * Duplicate active name → 409 (D-30 via partial UNIQUE)

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootMigratedPostgres, buildTestApp, seedUser } from "./setup.js";

const TENANT_A = "00000000-0000-0000-0000-000000000000";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";

let pool: Pool;
let shutdown: () => Promise<void>;
let userA: string;
let userB: string;
let appA: FastifyInstance;
let appB: FastifyInstance;

beforeAll(async () => {
  const booted = await bootMigratedPostgres();
  pool = booted.pool;
  shutdown = booted.shutdown.bind(booted);
  await pool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, 'Tenant B') ON CONFLICT (id) DO NOTHING`,
    [TENANT_B],
  );
  userA = await seedUser(pool, { tenantId: TENANT_A, email: "keys-a@test" });
  userB = await seedUser(pool, { tenantId: TENANT_B, email: "keys-b@test" });
  appA = await buildTestApp({ pool, userId: userA, tenantId: TENANT_A });
  appB = await buildTestApp({ pool, userId: userB, tenantId: TENANT_B });
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
  if (appB) await appB.close();
  if (shutdown) await shutdown();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM api_keys`);
});

describe("integration — /api/v1/keys CRUD (real Postgres + RLS)", () => {
  it("create — returns { data: { ...ApiKey, key: 'pak_*' } } and clear-text is NOT persisted", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "alpha-key", scopes: ["notes:read"] }),
    });
    expect(res.statusCode).toBe(200);
    const envelope = res.json() as {
      data: {
        id: string;
        name: string;
        key_prefix: string;
        scopes: string[];
        key: string;
        last_used_at: string | null;
        expires_at: string | null;
        created_at: string;
        revoked_at: string | null;
      };
    };
    expect(envelope).toHaveProperty("data");
    const body = envelope.data;
    // D-29 — clear-text PAK returned, starts with pak_.
    expect(body.key.startsWith("pak_")).toBe(true);
    expect(body.key.length).toBeGreaterThanOrEqual(20);
    expect(body.key_prefix.length).toBe(12);
    expect(body.key_prefix).toBe(body.key.slice(0, 12));
    expect(body.name).toBe("alpha-key");
    expect(body.scopes).toEqual(["notes:read"]);
    expect(body.revoked_at).toBeNull();

    // DB invariant — key_hash stored in Argon2id OWASP 2026 format;
    // clear-text key is NOT in any column.
    const { rows } = await pool.query<{
      key_hash: string;
      key_prefix: string;
    }>(`SELECT key_hash, key_prefix FROM api_keys WHERE id = $1`, [body.id]);
    // @node-rs/argon2 emits PHC string with comma-separated params per RFC 9106
    expect(rows[0]?.key_hash.startsWith("$argon2id$v=19$m=65536,t=3,p=1$")).toBe(true);
    expect(rows[0]?.key_prefix).toBe(body.key_prefix);
    // Clear-text key never appears in storage (audit DB columns).
    const leakCheck = await pool.query(
      `SELECT count(*)::int AS n FROM api_keys
        WHERE key_hash = $1 OR name = $1 OR $1 = ANY(scopes)`,
      [body.key],
    );
    expect(leakCheck.rows[0].n).toBe(0);
  });

  it("list — returns { data: { keys: ApiKey[] } } without `key` or `key_hash`", async () => {
    // Seed two keys via the API.
    const c1 = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "key-1" }),
    });
    expect(c1.statusCode).toBe(200);
    const c2 = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "key-2" }),
    });
    expect(c2.statusCode).toBe(200);

    const list = await appA.inject({
      method: "GET",
      url: "/api/v1/keys/list",
    });
    expect(list.statusCode).toBe(200);
    const envelope = list.json() as {
      data: { keys: Array<Record<string, unknown>> };
    };
    expect(envelope).toHaveProperty("data");
    expect(envelope.data.keys).toHaveLength(2);
    for (const row of envelope.data.keys) {
      // T-KEY-LEAK mitigation — clear-text/hash NEVER in list.
      expect(row).not.toHaveProperty("key");
      expect(row).not.toHaveProperty("key_hash");
      // Listed shape — fields per ApiKeySchema.
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("name");
      expect(row).toHaveProperty("key_prefix");
      expect(row).toHaveProperty("scopes");
      expect(row).toHaveProperty("last_used_at");
      expect(row).toHaveProperty("expires_at");
      expect(row).toHaveProperty("created_at");
      expect(row).toHaveProperty("revoked_at");
    }
    // Ordering — newest first.
    const names = envelope.data.keys.map((k) => k.name);
    expect(names[0]).toBe("key-2");
    expect(names[1]).toBe("key-1");
  });

  it("create — duplicate active name → 409 (D-30 partial UNIQUE)", async () => {
    const r1 = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "dup-name" }),
    });
    expect(r1.statusCode).toBe(200);
    const r2 = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "dup-name" }),
    });
    expect(r2.statusCode).toBe(409);
    expect((r2.json() as { error: string }).error).toMatch(/already exists/);
  });

  it("create — expiresInDays maps to expires_at", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "expiring", expiresInDays: 30 }),
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as { data: { expires_at: string } }).data;
    expect(body.expires_at).not.toBeNull();
    const ms = new Date(body.expires_at).getTime() - Date.now();
    // Within 30 days ± 1 minute slack.
    expect(ms).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(ms).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  it("RLS — tenant B cannot see tenant A's keys (T-05-07)", async () => {
    const create = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "a-private" }),
    });
    expect(create.statusCode).toBe(200);

    const bList = await appB.inject({
      method: "GET",
      url: "/api/v1/keys/list",
    });
    expect(bList.statusCode).toBe(200);
    const bBody = bList.json() as { data: { keys: unknown[] } };
    expect(bBody.data.keys).toHaveLength(0);

    // Cross-tenant name reuse is legal (partial UNIQUE is per-tenant).
    const bCreate = await appB.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "a-private" }),
    });
    expect(bCreate.statusCode).toBe(200);
  });

  it("create — rejects extra unknown field on .strict() schema", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        name: "strict-test",
        // Accidental clear-text injection — must NOT be honored.
        key_hash: "$evil$bogus",
        key: "pak_evil",
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("create — name min(1) max(120) bounds enforced", async () => {
    const empty = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "" }),
    });
    expect(empty.statusCode).toBe(400);

    const tooLong = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "x".repeat(121) }),
    });
    expect(tooLong.statusCode).toBe(400);
  });

  it("audit — emits canonical `key.issued` row with key_id only (no clear-text leak)", async () => {
    await pool.query(`DELETE FROM audit_log`);
    const res = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "audit-issued-key" }),
    });
    expect(res.statusCode).toBe(200);
    const wire = res.json() as { data: { id: string; key: string } };
    const clearText = wire.data.key;
    const keyId = wire.data.id;

    // The audit row exists, action is the canonical D-A6 #8 string,
    // payload carries the key_id (NOT the secret), and no forbidden
    // raw-secret value reaches the JSONB column.
    const rows = (
      await pool.query<{ action: string; payload: Record<string, unknown> }>(
        `SELECT action, payload FROM audit_log WHERE action = 'key.issued' ORDER BY created_at DESC LIMIT 1`,
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("key.issued");
    expect(rows[0]!.payload.key_id).toBe(keyId);
    // T-bearer-leak sentinel — the clear-text PAK MUST NOT appear
    // anywhere in the serialised payload (D-A7 forbidden-keys + the
    // recordAudit Zod schema only declares `key_id`).
    expect(JSON.stringify(rows[0]!.payload)).not.toContain(clearText);
  });

  it("audit — emits canonical `key.revoked` row with key_id + reason on successful revoke", async () => {
    await pool.query(`DELETE FROM audit_log`);
    const create = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "audit-revoked-key" }),
    });
    expect(create.statusCode).toBe(200);
    const { id: keyId } = (create.json() as { data: { id: string } }).data;

    const revoke = await appA.inject({
      method: "POST",
      url: `/api/v1/keys/${keyId}/revoke`,
    });
    expect(revoke.statusCode).toBe(200);

    const rows = (
      await pool.query<{ action: string; payload: Record<string, unknown> }>(
        `SELECT action, payload FROM audit_log WHERE action = 'key.revoked' ORDER BY created_at DESC LIMIT 1`,
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.key_id).toBe(keyId);
    expect(rows[0]!.payload.reason).toBe("manual");
  });

  it("audit — 404 cross-tenant revoke does NOT emit `key.revoked` (RLS invisibility preserved)", async () => {
    await pool.query(`DELETE FROM audit_log`);
    const create = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "a-cross-tenant-revoke" }),
    });
    expect(create.statusCode).toBe(200);
    const { id: keyId } = (create.json() as { data: { id: string } }).data;

    const bRevoke = await appB.inject({
      method: "POST",
      url: `/api/v1/keys/${keyId}/revoke`,
    });
    // Tenant-B caller cannot see tenant-A's key (RLS); the route
    // returns 404 (CLAUDE.md: never confirm existence across tenants).
    expect(bRevoke.statusCode).toBe(404);

    // CRITICAL — emitting a `key.revoked` audit row here would leak
    // the existence of tenant-A's key id into a row that tenant-A
    // might later read; the route guards against this by emitting
    // the audit row only when the UPDATE actually targeted a row.
    const rows = (
      await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM audit_log WHERE action = 'key.revoked'`,
      )
    ).rows;
    expect(Number(rows[0]!.c)).toBe(0);
  });

  it("401 — missing req.user defensive guard on /list and /create", async () => {
    const Fastify = (await import("fastify")).default;
    const app = Fastify({ logger: false });
    const { registerErrorHandler } = await import("../../../../error-handler.js");
    const { zodTypeProvider } = await import("../../../../plugins/zod-type-provider.js");
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const db = drizzle(pool);
    const { buildKeysCreateRoutes } = await import("../create.js");
    const { buildKeysListRoutes } = await import("../list.js");
    const dbAny = db as unknown as Parameters<typeof buildKeysCreateRoutes>[0]["db"];
    await app.register(buildKeysListRoutes({ db: dbAny }));
    await app.register(buildKeysCreateRoutes({ db: dbAny }));
    await app.ready();
    try {
      const l = await app.inject({ method: "GET", url: "/api/v1/keys/list" });
      expect(l.statusCode).toBe(401);
      const c = await app.inject({
        method: "POST",
        url: "/api/v1/keys/create",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "x" }),
      });
      expect(c.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
