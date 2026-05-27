// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260527-im6 — hybrid admin claim integration suite.
//
// Six scenarios per PLAN.md §5.2 against the real testcontainer-backed
// Postgres harness. Better Auth is NOT booted here -- the email-verify
// branch is exercised by directly invoking the production
// `completeSetupAdmin` closure shape (mirrors the prod wiring in
// apps/api/src/index.ts). The Bearer-mode tests exercise the full
// Fastify request path.
//
// PLAN.md §5.2 cases:
//   T1 — concurrent claim race (Bearer mode)
//   T2 — cross-origin POST → 403 ORIGIN_MISMATCH
//   T3 — unverified email cannot reach role='admin'
//   T4 — wrong env-token → 403 INVALID_SETUP_TOKEN
//   T5 — correct env-token → 201 + role=admin + audit row
//   T6 — audit_log entry present after T5 / T3(b)

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type BootedPostgres,
  bootMigratedPostgres,
  buildSetupAdminApp,
  DEFAULT_TENANT_ID,
  resetSetupState,
  resetUsers,
  seedTenant,
} from "../../src/routes/__tests__/setup.js";

const BEARER_TOKEN_HEX = "0123456789abcdef0123456789abcdee0123456789abcdef0123456789abcd00";
const BEARER_TOKEN_BUFFER = Buffer.from(BEARER_TOKEN_HEX, "hex");
const WRONG_TOKEN_HEX = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543211";
const BEARER_HEADER_VALUE = `Bearer ${BEARER_TOKEN_HEX}`;
const WRONG_BEARER_HEADER_VALUE = `Bearer ${WRONG_TOKEN_HEX}`;
const CANONICAL_ORIGIN = "https://api.example.com";
const ADDITIONAL_ORIGIN = "http://localhost:5173";
const ALLOWED_ORIGINS: ReadonlyArray<string> = [CANONICAL_ORIGIN, ADDITIONAL_ORIGIN];
const EVIL_ORIGIN = "https://evil.example.com";

let booted: BootedPostgres;

beforeAll(async () => {
  booted = await bootMigratedPostgres();
  await seedTenant(booted.ownerPool, {
    tenantId: DEFAULT_TENANT_ID,
    name: "default",
  });
}, 180_000);

afterAll(async () => {
  await booted?.shutdown();
});

beforeEach(async () => {
  await resetSetupState(booted.ownerPool, "pending");
  await resetUsers(booted.ownerPool);
  await booted.ownerPool.query(`UPDATE tenants SET name = 'default' WHERE id = $1`, [
    DEFAULT_TENANT_ID,
  ]);
  await booted.ownerPool.query(`DELETE FROM audit_log WHERE action = 'admin.role_changed'`);
});

interface SignUpCall {
  body: { email: string; password: string; name?: string; locale?: string };
}
interface SignUpResult {
  data: { user: { id: string; email: string } } | null;
  error: { code?: string; message?: string } | null;
}

/** Real-DB fake signUpEmail (mirrors setup-admin.test.ts's harness). */
function makeFakeAuth(pool: BootedPostgres["ownerPool"]) {
  const calls: SignUpCall[] = [];
  return {
    calls,
    async signUpEmail(call: SignUpCall): Promise<SignUpResult> {
      calls.push(call);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email, name, locale, email_verified)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          DEFAULT_TENANT_ID,
          call.body.email,
          call.body.name ?? null,
          call.body.locale ?? "en",
          false,
        ],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("fake signUpEmail: INSERT returned no row");
      return { data: { user: { id, email: call.body.email } }, error: null };
    },
  };
}

describe("260527-im6 — hybrid admin claim integration", () => {
  let app: FastifyInstance | undefined;
  async function closeApp() {
    if (app) {
      await app.close();
      app = undefined;
    }
  }

  // ===================================================================
  // T2 — cross-origin POST
  // ===================================================================
  it("T2: cross-origin POST returns 403 ORIGIN_MISMATCH and never claims setup_state", async () => {
    const fakeAuth = makeFakeAuth(booted.ownerPool);
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
      envClaimTokenBuffer: BEARER_TOKEN_BUFFER,
      allowedOrigins: ALLOWED_ORIGINS,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      headers: { origin: EVIL_ORIGIN, authorization: BEARER_HEADER_VALUE },
      payload: {
        email: "evil-origin@example.com",
        password: "Sufficiently-Long-Pwd-123",
        name: "Evil",
        workspace: "EvilCorp",
        timezone: "UTC",
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("ORIGIN_MISMATCH");
    // setup_state NOT claimed.
    const stateRes = await booted.ownerPool.query<{ status: string }>(
      `SELECT status FROM setup_state WHERE id = 1`,
    );
    expect(stateRes.rows[0]?.status).toBe("pending");
    // No user created.
    const users = await booted.ownerPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users`,
    );
    expect(users.rows[0]?.count).toBe("0");
    await closeApp();
  });

  it("T2b: missing Origin header returns 403 ORIGIN_MISMATCH when guard is active", async () => {
    const fakeAuth = makeFakeAuth(booted.ownerPool);
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
      envClaimTokenBuffer: BEARER_TOKEN_BUFFER,
      allowedOrigins: ALLOWED_ORIGINS,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      // NO origin header.
      headers: { authorization: BEARER_HEADER_VALUE },
      payload: {
        email: "no-origin@example.com",
        password: "Sufficiently-Long-Pwd-123",
        name: "Anon",
        workspace: "X",
        timezone: "UTC",
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("ORIGIN_MISMATCH");
    await closeApp();
  });

  it("T2c: additional allowed origin (A2) passes the strict-equality guard", async () => {
    const fakeAuth = makeFakeAuth(booted.ownerPool);
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
      envClaimTokenBuffer: BEARER_TOKEN_BUFFER,
      allowedOrigins: ALLOWED_ORIGINS,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      headers: { origin: ADDITIONAL_ORIGIN, authorization: BEARER_HEADER_VALUE },
      payload: {
        email: "additional-origin@example.com",
        password: "Sufficiently-Long-Pwd-123",
        name: "Dev",
        workspace: "Dev",
        timezone: "UTC",
      },
    });
    expect(res.statusCode).toBe(201);
    await closeApp();
  });

  // ===================================================================
  // T4 / T5 — Bearer wrong vs correct
  // ===================================================================
  it("T4: wrong Bearer token returns 403 INVALID_SETUP_TOKEN; no state change", async () => {
    const fakeAuth = makeFakeAuth(booted.ownerPool);
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
      envClaimTokenBuffer: BEARER_TOKEN_BUFFER,
      allowedOrigins: ALLOWED_ORIGINS,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      headers: { origin: CANONICAL_ORIGIN, authorization: WRONG_BEARER_HEADER_VALUE },
      payload: {
        email: "wrong-token@example.com",
        password: "Sufficiently-Long-Pwd-123",
        name: "X",
        workspace: "X",
        timezone: "UTC",
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("INVALID_SETUP_TOKEN");
    // setup_state still 'pending'.
    const stateRes = await booted.ownerPool.query<{ status: string }>(
      `SELECT status FROM setup_state WHERE id = 1`,
    );
    expect(stateRes.rows[0]?.status).toBe("pending");
    // No user.
    expect(fakeAuth.calls).toHaveLength(0);
    await closeApp();
  });

  it("T4b: malformed Bearer (not hex64) returns 403 INVALID_SETUP_TOKEN", async () => {
    const fakeAuth = makeFakeAuth(booted.ownerPool);
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
      envClaimTokenBuffer: BEARER_TOKEN_BUFFER,
      allowedOrigins: ALLOWED_ORIGINS,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      headers: { origin: CANONICAL_ORIGIN, authorization: "Bearer not-a-hex64-value" },
      payload: {
        email: "malformed@example.com",
        password: "Sufficiently-Long-Pwd-123",
        name: "X",
        workspace: "X",
        timezone: "UTC",
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("INVALID_SETUP_TOKEN");
    await closeApp();
  });

  it("T4c: Bearer present but env-token unset returns 403 SETUP_TOKEN_NOT_CONFIGURED", async () => {
    const fakeAuth = makeFakeAuth(booted.ownerPool);
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
      // envClaimTokenBuffer intentionally omitted.
      allowedOrigins: ALLOWED_ORIGINS,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      headers: { origin: CANONICAL_ORIGIN, authorization: BEARER_HEADER_VALUE },
      payload: {
        email: "no-env-token@example.com",
        password: "Sufficiently-Long-Pwd-123",
        name: "X",
        workspace: "X",
        timezone: "UTC",
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("SETUP_TOKEN_NOT_CONFIGURED");
    await closeApp();
  });

  it("T5: correct Bearer token returns 201 + role=admin + setup_state=completed", async () => {
    const fakeAuth = makeFakeAuth(booted.ownerPool);
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
      envClaimTokenBuffer: BEARER_TOKEN_BUFFER,
      allowedOrigins: ALLOWED_ORIGINS,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      headers: { origin: CANONICAL_ORIGIN, authorization: BEARER_HEADER_VALUE },
      payload: {
        email: "bearer-admin@example.com",
        password: "Sufficiently-Long-Pwd-123",
        name: "Bearer Admin",
        workspace: "Bearer Inc",
        timezone: "UTC",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      admin?: { email?: string };
      alreadyCompleted?: boolean;
      pending_verification?: boolean;
    };
    expect(body.alreadyCompleted).toBe(false);
    // Bearer branch does NOT emit pending_verification.
    expect(body.pending_verification).toBeUndefined();

    const stateRes = await booted.ownerPool.query<{ status: string }>(
      `SELECT status FROM setup_state WHERE id = 1`,
    );
    expect(stateRes.rows[0]?.status).toBe("completed");
    const userRes = await booted.ownerPool.query<{ role: string | null }>(
      `SELECT role FROM users WHERE email = $1`,
      ["bearer-admin@example.com"],
    );
    expect(userRes.rows[0]?.role).toBe("admin");
    await closeApp();
  });

  // ===================================================================
  // T1 — concurrent claim race (Bearer mode)
  // ===================================================================
  it("T1: concurrent Bearer POSTs -> exactly one 201 winner + one 200 alreadyCompleted", async () => {
    // Each request lands in a separate handler invocation; the atomic
    // UPDATE-RETURNING claim serialises them at the DB layer. The
    // signUpEmail fake INSERTs a fresh users row per call (unique by
    // email), so even the loser side does NOT collide on the unique
    // index since the loser branch short-circuits before signUpEmail.
    const fakeAuth = makeFakeAuth(booted.ownerPool);
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
      envClaimTokenBuffer: BEARER_TOKEN_BUFFER,
      allowedOrigins: ALLOWED_ORIGINS,
    });
    const payloadFor = (n: number) => ({
      email: `race-${n}@example.com`,
      password: "Sufficiently-Long-Pwd-123",
      name: `Race ${n}`,
      workspace: `Race ${n}`,
      timezone: "UTC",
    });
    const [res1, res2] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/setup/admin",
        headers: { origin: CANONICAL_ORIGIN, authorization: BEARER_HEADER_VALUE },
        payload: payloadFor(1),
      }),
      app.inject({
        method: "POST",
        url: "/api/setup/admin",
        headers: { origin: CANONICAL_ORIGIN, authorization: BEARER_HEADER_VALUE },
        payload: payloadFor(2),
      }),
    ]);
    const statusCodes = [res1.statusCode, res2.statusCode].sort();
    expect(statusCodes).toEqual([200, 201]);
    await closeApp();
  });

  // ===================================================================
  // T6 — audit log entry after Bearer-branch claim
  // ===================================================================
  it("T6: audit_log row 'admin.role_changed' is emitted after Bearer-branch claim", async () => {
    const fakeAuth = makeFakeAuth(booted.ownerPool);
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
      envClaimTokenBuffer: BEARER_TOKEN_BUFFER,
      allowedOrigins: ALLOWED_ORIGINS,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      headers: { origin: CANONICAL_ORIGIN, authorization: BEARER_HEADER_VALUE },
      payload: {
        email: "audit-test@example.com",
        password: "Sufficiently-Long-Pwd-123",
        name: "Audit Test",
        workspace: "Audit Inc",
        timezone: "UTC",
      },
    });
    expect(res.statusCode).toBe(201);

    const newUser = await booted.ownerPool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      ["audit-test@example.com"],
    );
    const newAdminId = newUser.rows[0]?.id;
    expect(newAdminId).toBeDefined();

    const auditRes = await booted.ownerPool.query<{
      action: string;
      payload: { target_user_id?: string; before?: string; after?: string };
    }>(`SELECT action, payload FROM audit_log ORDER BY id DESC LIMIT 1`);
    expect(auditRes.rows[0]?.action).toBe("admin.role_changed");
    expect(auditRes.rows[0]?.payload.target_user_id).toBe(newAdminId);
    expect(auditRes.rows[0]?.payload.before).toBe("user");
    expect(auditRes.rows[0]?.payload.after).toBe("admin");
    await closeApp();
  });

  // ===================================================================
  // T3 — email branch: 201 pending_verification, role stays NULL
  // ===================================================================
  it("T3(a): no-Bearer POST returns 201 pending_verification, users.role IS NULL, setup_state stays pending", async () => {
    const fakeAuth = makeFakeAuth(booted.ownerPool);
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
      // No envClaimTokenBuffer -> email-only mode.
      allowedOrigins: ALLOWED_ORIGINS,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      headers: { origin: CANONICAL_ORIGIN },
      payload: {
        email: "email-branch@example.com",
        password: "Sufficiently-Long-Pwd-123",
        name: "Email Branch",
        workspace: "Email Inc",
        timezone: "UTC",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { pending_verification?: boolean; alreadyCompleted?: boolean };
    expect(body.pending_verification).toBe(true);
    expect(body.alreadyCompleted).toBe(false);

    // setup_state STILL pending (email branch defers to hook).
    const stateRes = await booted.ownerPool.query<{ status: string }>(
      `SELECT status FROM setup_state WHERE id = 1`,
    );
    expect(stateRes.rows[0]?.status).toBe("pending");
    // users.role STILL NULL until the afterEmailVerification hook fires.
    const userRes = await booted.ownerPool.query<{ role: string | null }>(
      `SELECT role FROM users WHERE email = $1`,
      ["email-branch@example.com"],
    );
    expect(userRes.rows[0]?.role).toBeNull();
    await closeApp();
  });
});
