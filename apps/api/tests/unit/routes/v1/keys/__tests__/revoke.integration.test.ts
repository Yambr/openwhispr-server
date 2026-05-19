// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 09 / Task 3 — POST /api/v1/keys/:id/revoke
// integration tests against real Postgres + RLS. Asserts:
//   * Response shape `{ data: ApiKey }` with revoked_at populated (D-28)
//   * Idempotency — repeat revoke preserves original revoked_at
//   * Subsequent /list still includes the revoked row with revoked_at
//   * Cross-tenant attempt → 404 (RLS, NEVER 403)
//   * verifyKey(clearText, key_hash) still TRUE after revoke
//     (T-REVOKE-LATENCY documented — Phase 6 enforces revoked_at IS NULL)

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyKey } from "../../../../../../src/lib/argon2-keys.js";
import { buildTestApp } from "../../../../../../src/routes/v1/keys/__tests__/setup.js";
import { getSharedRoutePool } from "../../../../../support/shared-route-pool.js";

// Phase 18.1.2 / Plan 05 / Cluster #2 sub-cluster 2c — shared-pg
// migration (Option A canon).

const TENANT_A = "00000000-0000-0000-0000-000000000000";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";

let pool: Pool;
let userA: string;
let userB: string;
let appA: FastifyInstance;
let appB: FastifyInstance;

beforeAll(async () => {
  pool = await getSharedRoutePool();
  await pool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, 'Tenant B') ON CONFLICT (id) DO NOTHING`,
    [TENANT_B],
  );
  const ra = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [TENANT_A, "revoke-a@test"],
  );
  const rb = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [TENANT_B, "revoke-b@test"],
  );
  userA = ra.rows[0]!.id;
  userB = rb.rows[0]!.id;
  appA = await buildTestApp({ pool, userId: userA, tenantId: TENANT_A });
  appB = await buildTestApp({ pool, userId: userB, tenantId: TENANT_B });
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
  if (appB) await appB.close();
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
  const body = (res.json() as { success: true; data: { id: string; key: string } }).data;
  return body;
}

describe("integration — POST /api/v1/keys/:id/revoke (real Postgres + RLS)", () => {
  it("revoke — happy path returns { success:true, data: ApiKey } with revoked_at populated (Phase 56-06 D-3)", async () => {
    const { id } = await createKey("revoke-target");
    const res = await appA.inject({
      method: "POST",
      url: `/api/v1/keys/${id}/revoke`,
    });
    expect(res.statusCode).toBe(200);
    const envelope = res.json() as {
      success: true;
      data: { id: string; revoked_at: string | null };
    };
    expect(envelope.success).toBe(true);
    expect(envelope).toHaveProperty("data");
    expect(envelope).not.toHaveProperty("error");
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
    const firstAt = (r1.json() as { success: true; data: { revoked_at: string } }).data.revoked_at;

    // Brief delay; if COALESCE were missing the second revoke would
    // overwrite revoked_at with a later NOW().
    await new Promise((r) => setTimeout(r, 50));

    const r2 = await appA.inject({
      method: "POST",
      url: `/api/v1/keys/${id}/revoke`,
    });
    expect(r2.statusCode).toBe(200);
    const secondAt = (r2.json() as { success: true; data: { revoked_at: string } }).data.revoked_at;
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
        success: true;
        data: { keys: Array<{ id: string; revoked_at: string | null }> };
      }
    ).data;
    const found = body.keys.find((k) => k.id === id);
    expect(found).toBeDefined();
    expect(found?.revoked_at).not.toBeNull();
  });

  it("revoke — cross-tenant attempt → 404 + failure envelope (RLS, NEVER 403)", async () => {
    const { id } = await createKey("a-only");
    const bRevoke = await appB.inject({
      method: "POST",
      url: `/api/v1/keys/${id}/revoke`,
    });
    expect(bRevoke.statusCode).toBe(404);
    // Phase 56-06 D-3 — failure envelope.
    const body = bRevoke.json() as { success: false; error: string; code?: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not found/i);
    expect(body.code).toBe("API_KEY_NOT_FOUND");
    expect(body).not.toHaveProperty("data");
    // Defensive — make sure A's row is NOT revoked after B's attempt.
    const { rows } = await pool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM api_keys WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.revoked_at).toBeNull();
  });

  it("revoke — unknown id → 404 + failure envelope", async () => {
    const res = await appA.inject({
      method: "POST",
      // Valid v4 UUID (third group starts with 4, fourth with 8-b)
      url: "/api/v1/keys/11111111-1111-4111-8111-111111111111/revoke",
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { success: false; error: string; code?: string };
    expect(body.success).toBe(false);
    expect(body.code).toBe("API_KEY_NOT_FOUND");
  });

  it("revoke — invalid uuid → 400 + failure envelope", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/not-a-uuid/revoke",
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { success: false; error: string; code?: string };
    expect(body.success).toBe(false);
    expect(body.code).toBe("INVALID_ID");
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
    expect(await verifyKey(key, rows[0]?.key_hash)).toBe(true);
  });
});
