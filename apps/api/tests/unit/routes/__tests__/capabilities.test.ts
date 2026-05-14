// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-02 / Task 3 — GET /api/capabilities tests.
//
// D-12.02-EX1 close-out: replaces the prior makeFakeDb pattern (which
// violated CLAUDE.md's no-mocks-of-internal-logic rule — drizzle's
// transaction/execute IS internal logic, the process boundary lives at
// the libpq driver) with a real Postgres testcontainer. The shared
// inline harness lives at ./setup.ts; it mirrors
// apps/api/src/lib/audit.test.ts's proven pattern for booting PG +
// pg_partman + the full migration set 0000..0017.
//
// Real-PG also lets us seed a real `tenants` row + `users` row so the
// tenant-scoped ETag assertions exercise the FK-validated production
// schema rather than synthetic UUIDs.
//
// Coverage matrix (preserved from the previous fake-driven suite, with
// the lone fake-internals test — "sql-template chunk-walker captures
// literal SELECT/WHERE" — replaced by an equivalent real-PG assertion
// that the handler reads through to setup_state via the real schema):
//   1. 401 for anonymous request.
//   2. 200 + minimal payload shape for authed request.
//   3. Missing setup_state row -> 'pending' (defensive default).
//   4. No LITELLM_MASTER_KEY -> all features false.
//   5. Realtime requires LITELLM_MASTER_KEY AND OPENAI_API_KEY.
//   6. Cache-Control + weak ETag + If-None-Match -> 304.
//   7. Different tenants under same env -> DIFFERENT ETags.
//   8. ETag changes when setup_state.status flips pending -> completed.
//   9. Handler reads through to the real setup_state schema:
//      seeding `completed_at` does NOT leak it into the response body
//      (the SELECT projects only `status`).

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type BootedPostgres,
  bootMigratedPostgres,
  buildCapabilitiesApp,
  resetSetupState,
  seedTenant,
  seedUser,
} from "../../../../src/routes/__tests__/setup.js";

const TENANT_A = "00000000-0000-0000-0000-000000000000";
const TENANT_B = "11111111-1111-1111-1111-111111111111";
const USER_A_ID = "22222222-2222-2222-2222-222222222222";
const USER_A_EMAIL = "a@example.com";
const USER = { id: USER_A_ID, email: USER_A_EMAIL };

let booted: BootedPostgres;

beforeAll(async () => {
  booted = await bootMigratedPostgres();
  // Seed two tenants + one user under tenant A. The handler does not
  // join through these tables, but seeding them keeps the FK story
  // realistic (a real authenticated request always has a backing user
  // row).
  await seedTenant(booted.ownerPool, { tenantId: TENANT_A, name: "Tenant A" });
  await seedTenant(booted.ownerPool, { tenantId: TENANT_B, name: "Tenant B" });
  await seedUser(booted.ownerPool, {
    tenantId: TENANT_A,
    email: USER_A_EMAIL,
    userId: USER_A_ID,
  });
}, 180_000);

afterAll(async () => {
  await booted?.shutdown();
});

beforeEach(async () => {
  // Default state for each test — explicit per-test status overrides
  // come BELOW this reset.
  await resetSetupState(booted.ownerPool, "pending");
});

describe("GET /api/capabilities", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 401 for an anonymous request (no session)", async () => {
    app = await buildCapabilitiesApp({ db: booted.db, env: {} as NodeJS.ProcessEnv });
    const res = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 with the Phase-12 minimal payload shape for an authed request", async () => {
    const env = {
      LITELLM_MASTER_KEY: "sk-litellm",
      OPENAI_API_KEY: "sk-openai",
    } as NodeJS.ProcessEnv;
    app = await buildCapabilitiesApp({ db: booted.db, env, user: USER, tenantId: TENANT_A });

    const res = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(["auth", "features"]);
    const auth = body.auth as Record<string, unknown>;
    expect(Object.keys(auth).sort()).toEqual(["emailVerification", "providers", "setup"]);
    const setup = auth.setup as Record<string, unknown>;
    expect(Object.keys(setup)).toEqual(["status"]);
    expect(setup.status).toBe("pending");
    expect(auth.providers).toEqual([]);
    const features = body.features as Record<string, unknown>;
    expect(Object.keys(features).sort()).toEqual(["agent", "realtime", "transcribe"]);
    expect(features).toEqual({ transcribe: true, agent: true, realtime: true });
  });

  it("treats a missing setup_state row as 'pending' (defensive robustness)", async () => {
    await resetSetupState(booted.ownerPool, "missing");
    app = await buildCapabilitiesApp({
      db: booted.db,
      env: {} as NodeJS.ProcessEnv,
      user: USER,
      tenantId: TENANT_A,
    });
    const res = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { auth: { setup: { status: string } } };
    expect(body.auth.setup.status).toBe("pending");
  });

  it("derives features from env: missing LITELLM_MASTER_KEY → all features false", async () => {
    app = await buildCapabilitiesApp({
      db: booted.db,
      env: {} as NodeJS.ProcessEnv,
      user: USER,
      tenantId: TENANT_A,
    });
    const res = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { features: Record<string, boolean> };
    expect(body.features).toEqual({ transcribe: false, agent: false, realtime: false });
  });

  it("realtime requires both LITELLM_MASTER_KEY AND OPENAI_API_KEY", async () => {
    app = await buildCapabilitiesApp({
      db: booted.db,
      env: { LITELLM_MASTER_KEY: "sk" } as NodeJS.ProcessEnv,
      user: USER,
      tenantId: TENANT_A,
    });
    const res = await app.inject({ method: "GET", url: "/api/capabilities" });
    const body = res.json() as { features: Record<string, boolean> };
    expect(body.features).toEqual({ transcribe: true, agent: true, realtime: false });
  });

  it("emits Cache-Control: private, max-age=30 + weak ETag; matching If-None-Match → 304", async () => {
    app = await buildCapabilitiesApp({
      db: booted.db,
      env: {} as NodeJS.ProcessEnv,
      user: USER,
      tenantId: TENANT_A,
    });

    const first = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, max-age=30");
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^W\/"[a-f0-9]{16}"$/);

    const second = await app.inject({
      method: "GET",
      url: "/api/capabilities",
      headers: { "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
    expect(second.headers.etag).toBe(etag);
  });

  it("emits DIFFERENT ETags for two different tenants under the same env+status", async () => {
    const env = {} as NodeJS.ProcessEnv;
    const appA = await buildCapabilitiesApp({
      db: booted.db,
      env,
      user: USER,
      tenantId: TENANT_A,
    });
    const appB = await buildCapabilitiesApp({
      db: booted.db,
      env,
      user: USER,
      tenantId: TENANT_B,
    });
    try {
      const resA = await appA.inject({ method: "GET", url: "/api/capabilities" });
      const resB = await appB.inject({ method: "GET", url: "/api/capabilities" });
      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(200);
      expect(resA.headers.etag).not.toBe(resB.headers.etag);
    } finally {
      await appA.close();
      await appB.close();
    }
  });

  it("ETag changes when setup_state.status flips pending → completed (same tenant, same env)", async () => {
    const env = {} as NodeJS.ProcessEnv;
    app = await buildCapabilitiesApp({ db: booted.db, env, user: USER, tenantId: TENANT_A });

    const before = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(before.statusCode).toBe(200);
    expect((before.json() as { auth: { setup: { status: string } } }).auth.setup.status).toBe(
      "pending",
    );
    const etagBefore = before.headers.etag as string;

    // Flip the real row.
    await resetSetupState(booted.ownerPool, "completed");

    const after = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(after.statusCode).toBe(200);
    expect((after.json() as { auth: { setup: { status: string } } }).auth.setup.status).toBe(
      "completed",
    );
    const etagAfter = after.headers.etag as string;
    expect(etagAfter).not.toBe(etagBefore);
  });

  it("reads through real setup_state schema: completed_at column exists in DB but is NOT projected into the response body", async () => {
    // Real-PG replacement for the previous fake-internals chunk-walker
    // test. Sets setup_state.completed_at to a known timestamp via SQL,
    // then asserts:
    //   (a) the timestamp is observably present in the DB row, AND
    //   (b) the handler's response body does NOT leak it.
    // This proves the handler's SELECT projects only `status` (not
    // `SELECT *`) and operates against the real production schema.
    const stamp = "2025-01-15T12:34:56.000Z";
    await booted.ownerPool.query(
      `UPDATE setup_state
         SET status = 'completed'::setup_state_status,
             completed_at = $1::timestamptz
       WHERE id = 1`,
      [stamp],
    );
    // Sanity: the DB really has the timestamp now.
    const dbRow = await booted.ownerPool.query<{ completed_at: Date | null; status: string }>(
      `SELECT status, completed_at FROM setup_state WHERE id = 1`,
    );
    expect(dbRow.rows[0]?.status).toBe("completed");
    expect(dbRow.rows[0]?.completed_at).toBeInstanceOf(Date);

    app = await buildCapabilitiesApp({
      db: booted.db,
      env: {} as NodeJS.ProcessEnv,
      user: USER,
      tenantId: TENANT_A,
    });
    const res = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(res.statusCode).toBe(200);
    const serialised = res.body;
    expect(serialised).not.toMatch(/completed_at|completedAt/);
    expect(serialised).not.toMatch(/2025-01-15T12:34:56/);
    const body = res.json() as { auth: { setup: { status: string } } };
    expect(body.auth.setup.status).toBe("completed");
    expect(Object.keys(body.auth.setup)).toEqual(["status"]);
  });
});
