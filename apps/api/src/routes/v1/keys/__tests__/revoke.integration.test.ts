// Phase 05 / Plan 09 / Task 3 — POST /api/v1/keys/:id/revoke
// integration tests against real Postgres + RLS. Asserts:
//   * Response shape `{ data: ApiKey }` with revoked_at populated (D-28)
//   * Idempotency — repeat revoke preserves original revoked_at
//   * Subsequent /list still includes the revoked row with revoked_at
//   * Cross-tenant attempt → 404 (RLS, NEVER 403)
//   * verifyKey(clearText, key_hash) still TRUE after revoke
//     (T-REVOKE-LATENCY documented — Phase 6 enforces revoked_at IS NULL)

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { verifyKey } from "../../../../lib/argon2-keys.js";
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
  userA = await seedUser(pool, { tenantId: TENANT_A, email: "revoke-a@test" });
  userB = await seedUser(pool, { tenantId: TENANT_B, email: "revoke-b@test" });
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

async function createKey(name: string): Promise<{ id: string; key: string }> {
  const res = await appA.inject({
    method: "POST",
    url: "/api/v1/keys/create",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ name }),
  });
  const body = (res.json() as { data: { id: string; key: string } }).data;
  return body;
}

describe("integration — POST /api/v1/keys/:id/revoke (real Postgres + RLS)", () => {
  it("revoke — happy path returns { data: ApiKey } with revoked_at populated (D-28)", async () => {
    const { id } = await createKey("revoke-target");
    const res = await appA.inject({
      method: "POST",
      url: `/api/v1/keys/${id}/revoke`,
    });
    expect(res.statusCode).toBe(200);
    const envelope = res.json() as {
      data: { id: string; revoked_at: string | null };
    };
    expect(envelope).toHaveProperty("data");
    expect(envelope.data.id).toBe(id);
    expect(envelope.data.revoked_at).not.toBeNull();
    // No clear-text or hash leakage on revoke response.
    expect(envelope.data).not.toHaveProperty("key");
    expect(envelope.data).not.toHaveProperty("key_hash");
  });

  it("revoke — idempotent: repeat revoke preserves the original timestamp", async () => {
    const { id } = await createKey("idem-revoke");
    const r1 = await appA.inject({
      method: "POST",
      url: `/api/v1/keys/${id}/revoke`,
    });
    expect(r1.statusCode).toBe(200);
    const firstAt = (
      r1.json() as { data: { revoked_at: string } }
    ).data.revoked_at;

    // Brief delay; if COALESCE were missing the second revoke would
    // overwrite revoked_at with a later NOW().
    await new Promise((r) => setTimeout(r, 50));

    const r2 = await appA.inject({
      method: "POST",
      url: `/api/v1/keys/${id}/revoke`,
    });
    expect(r2.statusCode).toBe(200);
    const secondAt = (
      r2.json() as { data: { revoked_at: string } }
    ).data.revoked_at;
    expect(secondAt).toBe(firstAt);
  });

  it("revoke — subsequent /list still includes the row with revoked_at", async () => {
    const { id } = await createKey("listed-after-revoke");
    await appA.inject({
      method: "POST",
      url: `/api/v1/keys/${id}/revoke`,
    });
    const list = await appA.inject({ method: "GET", url: "/api/v1/keys/list" });
    expect(list.statusCode).toBe(200);
    const body = (
      list.json() as {
        data: { keys: Array<{ id: string; revoked_at: string | null }> };
      }
    ).data;
    const found = body.keys.find((k) => k.id === id);
    expect(found).toBeDefined();
    expect(found?.revoked_at).not.toBeNull();
  });

  it("revoke — cross-tenant attempt → 404 (RLS, NEVER 403)", async () => {
    const { id } = await createKey("a-only");
    const bRevoke = await appB.inject({
      method: "POST",
      url: `/api/v1/keys/${id}/revoke`,
    });
    expect(bRevoke.statusCode).toBe(404);
    // Defensive — make sure A's row is NOT revoked after B's attempt.
    const { rows } = await pool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM api_keys WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.revoked_at).toBeNull();
  });

  it("revoke — unknown id → 404", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/11111111-2222-3333-4444-555555555555/revoke",
    });
    expect(res.statusCode).toBe(404);
  });

  it("revoke — invalid uuid → 400", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/not-a-uuid/revoke",
    });
    expect(res.statusCode).toBe(400);
  });

  it("T-REVOKE-LATENCY — verifyKey() still TRUE after revoke (Phase 6 will gate on revoked_at)", async () => {
    const { id, key } = await createKey("verify-after-revoke");
    await appA.inject({
      method: "POST",
      url: `/api/v1/keys/${id}/revoke`,
    });
    const { rows } = await pool.query<{ key_hash: string }>(
      `SELECT key_hash FROM api_keys WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.key_hash).toBeDefined();
    // The Argon2id hash is UNCHANGED by revoke (audit invariant).
    // Phase 6 bearer middleware MUST check revoked_at IS NULL BEFORE
    // dispatching to verifyKey() — documented in this Plan's SUMMARY.
    expect(await verifyKey(key, rows[0]!.key_hash)).toBe(true);
  });
});
