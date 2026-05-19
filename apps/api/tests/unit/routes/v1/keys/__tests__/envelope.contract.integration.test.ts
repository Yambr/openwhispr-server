// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 56-06 — CONTRACT extension for /api/v1/keys/* envelope (D-3).
//
// Asserts the spec-mandated discriminated envelope across every code
// path on every v1/keys route:
//
//   success: { success: true,  data: T }
//   failure: { success: false, error: string, code?: string }
//
// Regression guards:
//   * HTTP status MUST stay truthful — failure envelope NEVER on 200.
//   * Success envelope MUST NOT carry `error` / `code`.
//   * Failure envelope MUST NOT carry `data`.
//   * Revoke idempotency surfaces success envelope (NOT 409).
//   * Plaintext PAK returned exactly once on create; list rows expose
//     only key_prefix.
//   * 401 unauthenticated → failure envelope with code=UNAUTHORIZED.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../../../src/plugins/zod-type-provider.js";
import { buildTestApp } from "../../../../../../src/routes/v1/keys/__tests__/setup.js";
import { buildKeysCreateRoutes } from "../../../../../../src/routes/v1/keys/create.js";
import { buildKeysListRoutes } from "../../../../../../src/routes/v1/keys/list.js";
import { buildKeysRevokeRoutes } from "../../../../../../src/routes/v1/keys/revoke.js";
import { getSharedRoutePool } from "../../../../../support/shared-route-pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
void __dirname; // keep ref so the file isn't flagged for unused-import drift

const TENANT_A = "00000000-0000-0000-0000-000000000000";

let pool: Pool;
let userA: string;
let appA: FastifyInstance;
let appUnauth: FastifyInstance;

beforeAll(async () => {
  pool = await getSharedRoutePool();
  const ra = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [TENANT_A, "envelope-a@test"],
  );
  userA = ra.rows[0]!.id;
  appA = await buildTestApp({ pool, userId: userA, tenantId: TENANT_A });

  // Unauth fixture: routes wired WITHOUT the onRequest hook that injects
  // req.user / req.tenant — the defensive 401 path runs.
  const db = drizzle(pool);
  appUnauth = Fastify({ logger: false });
  registerErrorHandler(appUnauth);
  await appUnauth.register(zodTypeProvider);
  const dbAny = db as unknown as Parameters<typeof buildKeysListRoutes>[0]["db"];
  await appUnauth.register(buildKeysListRoutes({ db: dbAny }));
  await appUnauth.register(buildKeysCreateRoutes({ db: dbAny }));
  await appUnauth.register(buildKeysRevokeRoutes({ db: dbAny }));
  await appUnauth.ready();
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
  if (appUnauth) await appUnauth.close();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM api_keys`);
});

type SuccessEnvelope<T> = { success: true; data: T };
type FailureEnvelope = { success: false; error: string; code?: string };

function assertSuccess<T>(body: unknown): asserts body is SuccessEnvelope<T> {
  expect(body).toMatchObject({ success: true });
  expect(body).toHaveProperty("data");
  expect(body).not.toHaveProperty("error");
  expect(body).not.toHaveProperty("code");
}

function assertFailure(body: unknown): asserts body is FailureEnvelope {
  expect(body).toMatchObject({ success: false });
  expect(typeof (body as FailureEnvelope).error).toBe("string");
  expect((body as FailureEnvelope).error.length).toBeGreaterThan(0);
  expect(body).not.toHaveProperty("data");
}

describe("CONTRACT — /api/v1/keys envelope (Phase 56-06 D-3)", () => {
  it("list — success envelope on 200", async () => {
    const r = await appA.inject({ method: "GET", url: "/api/v1/keys/list" });
    expect(r.statusCode).toBe(200);
    assertSuccess<{ keys: unknown[] }>(r.json());
  });

  it("create — success envelope on 200 + plaintext key returned ONCE", async () => {
    const c = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "envelope-once" }),
    });
    expect(c.statusCode).toBe(200);
    const body = c.json();
    assertSuccess<{ id: string; key: string; key_prefix: string }>(body);
    expect(body.data.key.startsWith("pak_")).toBe(true);
    expect(body.data.key_prefix.length).toBe(12);

    // List MUST NOT include `key` for the same row (T-KEY-LEAK).
    const l = await appA.inject({ method: "GET", url: "/api/v1/keys/list" });
    expect(l.statusCode).toBe(200);
    const lbody = l.json() as {
      success: true;
      data: { keys: Array<Record<string, unknown>> };
    };
    assertSuccess<{ keys: unknown[] }>(lbody);
    for (const row of lbody.data.keys) {
      expect(row).not.toHaveProperty("key");
      expect(row).toHaveProperty("key_prefix");
    }
  });

  it("create — failure envelope on 409 duplicate name (status TRUTHFUL, NOT 200)", async () => {
    const a = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "dup-envelope" }),
    });
    expect(a.statusCode).toBe(200);
    const b = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "dup-envelope" }),
    });
    // Regression: prior implementations could mask failure as 200 + error
    // field. The new envelope MUST emit the truthful HTTP status.
    expect(b.statusCode).toBe(409);
    expect(b.statusCode).not.toBe(200);
    const body = b.json();
    assertFailure(body);
    expect(body.code).toBe("API_KEY_NAME_TAKEN");
  });

  it("revoke — success envelope on 200 + idempotent (NOT 409 on second call)", async () => {
    const c = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "idem-envelope" }),
    });
    const { id } = (c.json() as { success: true; data: { id: string } }).data;

    const r1 = await appA.inject({ method: "POST", url: `/api/v1/keys/${id}/revoke` });
    expect(r1.statusCode).toBe(200);
    assertSuccess<{ id: string; revoked_at: string }>(r1.json());

    const r2 = await appA.inject({ method: "POST", url: `/api/v1/keys/${id}/revoke` });
    expect(r2.statusCode).toBe(200);
    expect(r2.statusCode).not.toBe(409);
    assertSuccess<{ id: string; revoked_at: string }>(r2.json());
  });

  it("revoke — failure envelope on 404 unknown id (status TRUTHFUL, NOT 200)", async () => {
    const r = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/22222222-2222-4222-8222-222222222222/revoke",
    });
    expect(r.statusCode).toBe(404);
    expect(r.statusCode).not.toBe(200);
    const body = r.json();
    assertFailure(body);
    expect(body.code).toBe("API_KEY_NOT_FOUND");
  });

  it("revoke — failure envelope on 400 invalid UUID (status TRUTHFUL, NOT 200)", async () => {
    const r = await appA.inject({
      method: "POST",
      url: "/api/v1/keys/not-a-uuid/revoke",
    });
    expect(r.statusCode).toBe(400);
    expect(r.statusCode).not.toBe(200);
    const body = r.json();
    assertFailure(body);
    expect(body.code).toBe("INVALID_ID");
  });

  it("unauthenticated — list/create/revoke return 401 + failure envelope with code=UNAUTHORIZED", async () => {
    const l = await appUnauth.inject({ method: "GET", url: "/api/v1/keys/list" });
    expect(l.statusCode).toBe(401);
    expect(l.statusCode).not.toBe(200);
    const lbody = l.json();
    assertFailure(lbody);
    expect(lbody.code).toBe("UNAUTHORIZED");

    const c = await appUnauth.inject({
      method: "POST",
      url: "/api/v1/keys/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "x" }),
    });
    expect(c.statusCode).toBe(401);
    const cbody = c.json();
    assertFailure(cbody);
    expect(cbody.code).toBe("UNAUTHORIZED");

    const r = await appUnauth.inject({
      method: "POST",
      url: "/api/v1/keys/11111111-1111-4111-8111-111111111111/revoke",
    });
    expect(r.statusCode).toBe(401);
    const rbody = r.json();
    assertFailure(rbody);
    expect(rbody.code).toBe("UNAUTHORIZED");
  });
});
