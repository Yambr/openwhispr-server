// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-03 / Task 1 — POST /api/setup/admin handler tests.
//
// CLAUDE.md constitutional rule: "no mocks of internal logic — DB-touching
// code uses real Postgres + PgBouncer + Valkey via testcontainers." The
// process boundary is the libpq driver below drizzle; drizzle's tx/execute
// IS internal logic and MUST NOT be faked.
//
// Reuses the shared harness in ./setup.ts (D-12.02-EX1 close-out from
// Plan 12-02), which boots PG + pg_partman + migrations 0000..0017
// (which adds setup_state singleton + users.role column).
//
// AuthLike injection: the handler under test takes a small `signUpEmail`
// callable in its deps (mirroring the AuthLike pattern in
// `middleware/dual-auth.ts`). Real Better Auth is NOT booted in these
// route-level tests — it is a third-party HTTP/library boundary that
// CLAUDE.md explicitly permits stubbing at the process edge. The
// integration of the real Better Auth instance against the real
// `auth.api.signUpEmail` already has full e2e coverage in Phase 02 (the
// universal /api/auth/* handler tests). This file exercises the
// idempotency contract + workspace persistence + rollback paths the
// route owns — everything BELOW the signUpEmail call.
//
// Coverage matrix (Plan 12-03 Task 1, 7 sub-tests):
//   1. Winner branch (fresh state): 201 + setup_state flips to completed
//      + users.role='admin' + tenants.name persisted to workspace.
//   2. Race-loser: 200 + alreadyCompleted:true; tenants.name unchanged.
//   3. Better-Auth-error rollback: 400 + setup_state rolled back to
//      'pending'; tenants.name UNCHANGED; retry succeeds.
//   4. Rate-limit: 6th POST within 60s -> 429.
//   5. Role-escalation guard: body { role:'admin' } extra field is
//      IGNORED — the handler writes role server-side via raw SQL.
//   6. Timezone deferred: 201 succeeds even with timezone in body;
//      information_schema confirms users.timezone column does NOT exist.
//   7. tenant_rename failure path: db.update(tenants) throws -> 201 with
//      warnings:['tenant_rename_failed']; setup_state stays 'completed';
//      admin user IS created (no rollback of admin per T-12.03-05).

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BootedPostgres,
  bootMigratedPostgres,
  buildSetupAdminApp,
  DEFAULT_TENANT_ID,
  resetSetupState,
  resetUsers,
  seedTenant,
} from "../../../../src/routes/__tests__/setup.js";

let booted: BootedPostgres;

beforeAll(async () => {
  booted = await bootMigratedPostgres();
  // Seed the default tenant row (the singleton 0000... UUID). Migrations
  // do NOT pre-seed tenants — apps/api's existing flows insert via
  // `withTenant` / `resolveDefaultTenantId`. For the setup-admin contract
  // (workspace rename), the row MUST exist before the handler attempts
  // the UPDATE.
  await seedTenant(booted.ownerPool, {
    tenantId: DEFAULT_TENANT_ID,
    name: "default",
  });
}, 180_000);

afterAll(async () => {
  await booted?.shutdown();
});

beforeEach(async () => {
  // Reset each test back to: setup_state='pending', no users, tenants.name='default'.
  await resetSetupState(booted.ownerPool, "pending");
  await resetUsers(booted.ownerPool);
  await booted.ownerPool.query(`UPDATE tenants SET name = 'default' WHERE id = $1`, [
    DEFAULT_TENANT_ID,
  ]);
});

interface SignUpResult {
  data: { user: { id: string; email: string } } | null;
  error: { code?: string; message?: string } | null;
}

interface SignUpCall {
  body: {
    email: string;
    password: string;
    name?: string;
    locale?: string;
  };
}

/**
 * Construct a fake AuthLike that records signUpEmail invocations and
 * actually INSERTs the user row via the pool — so that the role-flip
 * UPDATE the handler does next has a row to update. Tests can override
 * the result (e.g. force `result.error` for the rollback path).
 */
function makeFakeAuth(opts: {
  ownerPool: BootedPostgres["ownerPool"];
  overrideResult?: (call: SignUpCall) => Promise<SignUpResult>;
}): {
  signUpEmail: (call: SignUpCall) => Promise<SignUpResult>;
  calls: SignUpCall[];
} {
  const calls: SignUpCall[] = [];
  return {
    calls,
    async signUpEmail(call: SignUpCall): Promise<SignUpResult> {
      calls.push(call);
      if (opts.overrideResult) return opts.overrideResult(call);
      // Real Better Auth would INSERT via its Drizzle adapter. Emulate
      // that side-effect against the real DB so the handler's role-flip
      // UPDATE has a real users row to mutate.
      const { rows } = await opts.ownerPool.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email, name, locale)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [DEFAULT_TENANT_ID, call.body.email, call.body.name ?? null, call.body.locale ?? "en"],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("fake signUpEmail: INSERT returned no row");
      return { data: { user: { id, email: call.body.email } }, error: null };
    },
  };
}

describe("POST /api/setup/admin — idempotent claim + workspace + rollback contract", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("(1) winner branch: 201 + setup_state=completed + role=admin + tenants.name persisted", async () => {
    const fakeAuth = makeFakeAuth({ ownerPool: booted.ownerPool });
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      payload: {
        email: "admin@acme.test",
        password: "CorrectHorseBattery9",
        name: "Alice Admin",
        workspace: "Acme Inc",
        timezone: "Europe/Berlin",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body).toEqual({
      admin: { email: "admin@acme.test" },
      alreadyCompleted: false,
    });
    // No warnings key on the happy path.
    expect("warnings" in body).toBe(false);

    // setup_state flipped.
    const stateRes = await booted.ownerPool.query<{ status: string }>(
      `SELECT status FROM setup_state WHERE id = 1`,
    );
    expect(stateRes.rows[0]?.status).toBe("completed");

    // role flipped via raw SQL post-claim.
    const roleRes = await booted.ownerPool.query<{ role: string | null }>(
      `SELECT role FROM users WHERE email = $1`,
      ["admin@acme.test"],
    );
    expect(roleRes.rows[0]?.role).toBe("admin");

    // tenants.name persisted (RESEARCH Q1).
    const tenantRes = await booted.ownerPool.query<{ name: string }>(
      `SELECT name FROM tenants WHERE id = $1`,
      [DEFAULT_TENANT_ID],
    );
    expect(tenantRes.rows[0]?.name).toBe("Acme Inc");
  });

  it("(2) race-loser: pre-completed state -> 200 alreadyCompleted:true, tenants.name unchanged", async () => {
    // Pre-flip + pre-seed an existing admin.
    await resetSetupState(booted.ownerPool, "completed");
    await booted.ownerPool.query(
      `INSERT INTO users (tenant_id, email, name, role) VALUES ($1, $2, $3, $4)`,
      [DEFAULT_TENANT_ID, "existing-admin@acme.test", "Existing", "admin"],
    );

    const fakeAuth = makeFakeAuth({ ownerPool: booted.ownerPool });
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      payload: {
        email: "second@acme.test",
        password: "CorrectHorseBattery9",
        name: "Bob",
        workspace: "Should-Not-Persist",
        timezone: "UTC",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      admin: { email: "existing-admin@acme.test" },
      alreadyCompleted: true,
    });
    // signUpEmail MUST NOT have been called on the loser branch.
    expect(fakeAuth.calls).toHaveLength(0);
    // tenants.name UNCHANGED.
    const tenantRes = await booted.ownerPool.query<{ name: string }>(
      `SELECT name FROM tenants WHERE id = $1`,
      [DEFAULT_TENANT_ID],
    );
    expect(tenantRes.rows[0]?.name).toBe("default");
  });

  it("(3) better-auth error: 400 + setup_state rolled back to pending; tenants unchanged; retry succeeds", async () => {
    const fakeAuth = makeFakeAuth({
      ownerPool: booted.ownerPool,
      overrideResult: async () => ({
        data: null,
        error: { code: "PASSWORD_TOO_WEAK", message: "boom" },
      }),
    });
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      payload: {
        email: "admin@acme.test",
        password: "weakerthanthis",
        name: "Alice",
        workspace: "Acme Inc",
        timezone: "UTC",
      },
    });
    expect(res.statusCode).toBe(400);
    const errBody = res.json() as { error: { code: string } };
    expect(errBody.error.code).toBe("ADMIN_CREATE_FAILED");

    // Rolled back.
    const stateRes = await booted.ownerPool.query<{ status: string }>(
      `SELECT status FROM setup_state WHERE id = 1`,
    );
    expect(stateRes.rows[0]?.status).toBe("pending");
    // tenants.name UNCHANGED.
    const tenantRes = await booted.ownerPool.query<{ name: string }>(
      `SELECT name FROM tenants WHERE id = $1`,
      [DEFAULT_TENANT_ID],
    );
    expect(tenantRes.rows[0]?.name).toBe("default");

    // Retry with a working auth → 201.
    await app.close();
    const happyAuth = makeFakeAuth({ ownerPool: booted.ownerPool });
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: happyAuth.signUpEmail,
    });
    const retry = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      payload: {
        email: "admin@acme.test",
        password: "CorrectHorseBattery9",
        name: "Alice",
        workspace: "Acme Inc",
        timezone: "UTC",
      },
    });
    expect(retry.statusCode).toBe(201);
  });

  it("(4) rate-limit: 6th POST within 60s from one IP returns 429", async () => {
    const fakeAuth = makeFakeAuth({
      ownerPool: booted.ownerPool,
      // Always-error so no DB state mutates between attempts (we only
      // care that the limiter counts each invocation).
      overrideResult: async () => ({
        data: null,
        error: { code: "X", message: "blocked" },
      }),
    });
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
      withRateLimit: true,
    });

    const payload = {
      email: "ratelimit@acme.test",
      password: "Aaaaa1bbbbb2cc",
      name: "X",
      workspace: "X",
      timezone: "UTC",
    };
    const ip = "203.0.113.42";
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/api/setup/admin",
        headers: { "x-forwarded-for": ip },
        payload,
      });
      expect(r.statusCode).not.toBe(429);
    }
    const sixth = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      headers: { "x-forwarded-for": ip },
      payload,
    });
    expect(sixth.statusCode).toBe(429);
  });

  it("(5) role-escalation guard: body {role:'admin'} extra field is ignored; role is set server-side", async () => {
    const fakeAuth = makeFakeAuth({ ownerPool: booted.ownerPool });
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      payload: {
        email: "escalation@acme.test",
        password: "CorrectHorseBattery9",
        name: "Mallory",
        workspace: "Acme",
        timezone: "UTC",
        role: "admin", // hostile extra field — handler must NOT echo into the body it passes to signUpEmail
      },
    });
    expect(res.statusCode).toBe(201);

    // The fake captured exactly one signUpEmail call; its body MUST NOT
    // carry the `role` field — the handler must whitelist before forwarding.
    expect(fakeAuth.calls).toHaveLength(1);
    const firstCall = fakeAuth.calls[0];
    if (!firstCall) throw new Error("expected fakeAuth.calls[0] to be defined");
    const passedBody = firstCall.body as unknown as Record<string, unknown>;
    expect(passedBody.role).toBeUndefined();
    // Resulting role IS 'admin' — but only because the handler set it
    // post-claim via direct SQL, not because of the request body.
    const roleRes = await booted.ownerPool.query<{ role: string | null }>(
      `SELECT role FROM users WHERE email = $1`,
      ["escalation@acme.test"],
    );
    expect(roleRes.rows[0]?.role).toBe("admin");
  });

  it("(6) timezone deferred: timezone in body is accepted; users.timezone column DOES NOT exist", async () => {
    const fakeAuth = makeFakeAuth({ ownerPool: booted.ownerPool });
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      payload: {
        email: "tz@acme.test",
        password: "CorrectHorseBattery9",
        name: "Tessa",
        workspace: "Acme",
        timezone: "America/New_York",
      },
    });
    expect(res.statusCode).toBe(201);

    // Regression net: if a future migration adds users.timezone this
    // assertion goes RED, prompting the handler to persist it and the
    // deferred note in CONTEXT.md to be revisited.
    const colRes = await booted.ownerPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'timezone'`,
    );
    expect(colRes.rows).toHaveLength(0);
  });

  it("(extra) invalid body shape -> 400 INVALID_BODY (Zod safeParse rejection branch)", async () => {
    const fakeAuth = makeFakeAuth({ ownerPool: booted.ownerPool });
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      // Missing required `workspace` + bad email → safeParse fails.
      payload: { email: "x", password: "tooshort", name: "" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
    expect(fakeAuth.calls).toHaveLength(0);
  });

  it("(extra) Accept-Language: ru,en propagates locale='ru' into signUpEmail call (pickLocale branch)", async () => {
    const fakeAuth = makeFakeAuth({ ownerPool: booted.ownerPool });
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      headers: { "accept-language": "ru-RU,ru;q=0.9,en;q=0.5" },
      payload: {
        email: "ru-admin@acme.test",
        password: "CorrectHorseBattery9",
        name: "Ruslan",
        workspace: "Acme RU",
        timezone: "Europe/Moscow",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(fakeAuth.calls).toHaveLength(1);
    expect(fakeAuth.calls[0]?.body.locale).toBe("ru");
  });

  it("(extra) Accept-Language: en-US,en propagates locale='en' (pickLocale default branch)", async () => {
    const fakeAuth = makeFakeAuth({ ownerPool: booted.ownerPool });
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      headers: { "accept-language": "en-US,en;q=0.9" },
      payload: {
        email: "en-admin@acme.test",
        password: "CorrectHorseBattery9",
        name: "Eve",
        workspace: "Acme EN",
        timezone: "UTC",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(fakeAuth.calls[0]?.body.locale).toBe("en");
  });

  it("(7) tenant_rename failure path: db.update(tenants) throws -> 201 with warnings; admin still created", async () => {
    // Inject a `renameTenant` callable into the route deps and provide
    // an always-throwing version (T-12.03-05 sub-test 7). Mirrors the
    // AuthLike DI pattern already established for signUpEmail and
    // keeps the test free of timing tricks.
    const renameTenant = vi
      .fn<(name: string) => Promise<void>>()
      .mockRejectedValue(new Error("simulated tenants UPDATE failure"));
    const fakeAuth = makeFakeAuth({ ownerPool: booted.ownerPool });
    app = await buildSetupAdminApp({
      db: booted.db,
      ownerPool: booted.ownerPool,
      signUpEmail: fakeAuth.signUpEmail,
      renameTenant,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      payload: {
        email: "warn@acme.test",
        password: "CorrectHorseBattery9",
        name: "Wendy",
        workspace: "Acme Inc",
        timezone: "UTC",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body).toEqual({
      admin: { email: "warn@acme.test" },
      alreadyCompleted: false,
      warnings: ["tenant_rename_failed"],
    });
    expect(renameTenant).toHaveBeenCalledTimes(1);

    // setup_state stays 'completed' (NO rollback — admin already exists).
    const stateRes = await booted.ownerPool.query<{ status: string }>(
      `SELECT status FROM setup_state WHERE id = 1`,
    );
    expect(stateRes.rows[0]?.status).toBe("completed");
    // Admin user IS created.
    const userRes = await booted.ownerPool.query<{ role: string | null }>(
      `SELECT role FROM users WHERE email = $1`,
      ["warn@acme.test"],
    );
    expect(userRes.rows[0]?.role).toBe("admin");
  });
});
