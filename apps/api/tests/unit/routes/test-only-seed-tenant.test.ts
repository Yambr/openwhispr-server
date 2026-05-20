// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 56 / Plan 56-01 / R1 — POST /api/_test/seed-tenant unit tests.
//
// Spec: /Users/dev/openwhispr/.planning/phases/08-client-server-audit/
//   SERVER-REQUIREMENTS.md §R1 (lines 21-83). The route unblocks 22 of
//   28 Phase 9 client e2e scenarios that need a real authenticated
//   bearer without going through the verification-email round-trip.
//
// Coverage matrix:
//   Test 1 (gate-production):
//     NODE_ENV='production' + OPENWHISPR_TEST_ROUTES='true' → 404.
//     Defense-in-depth: even if an operator mis-sets the env knob in
//     production, the route MUST stay 404. (Existing test-only routes
//     register on EITHER NODE_ENV='test' OR OPENWHISPR_TEST_ROUTES='true'
//     — seed-tenant tightens this with a hard NODE_ENV!=='production'
//     veto, mirroring the spec's gate-1 + R1-specific safety bar.)
//   Test 2 (gate-env-unset):
//     NODE_ENV='test' but OPENWHISPR_TEST_ROUTES unset → 404. The
//     phase 56 D-1 decision pins the explicit env opt-in as the
//     single source of truth for THIS endpoint (the older test-only
//     routes accept NODE_ENV='test' alone for legacy reasons; we do
//     NOT extend that laxness to seed-tenant). [Updated rationale:
//     spec §R1 gate 2 requires explicit OPENWHISPR_TEST_ROUTES opt-in
//     regardless of NODE_ENV.]
//   Test 3 (happy-path):
//     OPENWHISPR_TEST_ROUTES='true' + NODE_ENV='test' → 200 with
//     {token, user{id, email, emailVerified:true, createdAt}} matching
//     SeedTenantResponse.
//   Test 4 (token-usable):
//     Token returned by seed-tenant is accepted as Authorization:
//     Bearer header on /api/_test/health-authed (existing route),
//     which returns 200 {status:"ok", userId} with the same user.id.
//     Drives the contract that the bearer is a real session token, not
//     a synthetic placeholder.
//   Test 5 (db-email-verified):
//     The handler's recorded SQL includes an UPDATE users SET
//     email_verified=true, email_verified_at=now() statement bound
//     to the created user's id.
//   Test 6 (idempotent-reseed):
//     Calling twice with the same email returns 200 both times. The
//     second call returns the existing user.id (no duplicate row) +
//     a fresh session token. This contract matches the way e2e specs
//     re-use a stable email per-worker fixture: the second `seed-tenant`
//     invocation MUST NOT 409 / 500.
//   Test 7 (no-origin-required):
//     POST with no Origin header (and with a random origin) does NOT
//     return the Better Auth `MISSING_OR_NULL_ORIGIN` 403. The whole
//     point of the route is that contract-level e2e fetch() callers
//     don't send a browser Origin header.
//
// All tests use the in-process fake DB / fake auth pattern proven by
// test-only.test.ts and test-only-reset-setup.test.ts. The integration-
// level cross-check (compose stack, real Postgres, real Better Auth) is
// the responsibility of wave-2's CONTRACT-01 extension.

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { AuthError } from "../../../src/errors.js";
import { buildTestOnlyRoutes, type TestOnlyDeps } from "../../../src/routes/test-only.js";

const FAKE_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FAKE_TENANT_ID = "00000000-0000-0000-0000-000000000000";

interface RecordedSql {
  sql: string;
  params: unknown[];
}

function makeRecordingDb() {
  const recorded: RecordedSql[] = [];
  // Fake `users` row table — keyed by id. The `email_verified` flip
  // lands here so test 5 can introspect.
  const users = new Map<string, { id: string; email: string; emailVerified: boolean }>();
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const params: unknown[] = [];
      const parts: string[] = [];
      for (const c of chunks) {
        if (typeof c === "string") {
          // drizzle's queryChunks emits plain strings for bound values
          // (the surrounding StringChunks wrap the raw SQL fragments).
          parts.push("?");
          params.push(c);
        } else if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
            parts.push((v as string[]).join(""));
          } else {
            parts.push("?");
            params.push(v);
          }
        }
      }
      const text = parts.join("");
      recorded.push({ sql: text, params });
      // SELECT set_config('app.tenant_id', $1, true) — withTenant() GUC
      // bind. Acknowledge so the wrapped transaction proceeds (R14).
      if (/set_config\s*\(\s*'app\.tenant_id'/i.test(text)) {
        return { rows: [] };
      }
      // SELECT tenant_id FROM users WHERE id = $1 — R14 tenant resolution
      // for the withTenant() wrap. The fake users table is single-tenant
      // (default tenant) so every known user resolves to FAKE_TENANT_ID.
      if (/SELECT\s+tenant_id\s+FROM\s+users\s+WHERE\s+id/i.test(text)) {
        const id = params[0];
        if (typeof id === "string" && users.has(id)) {
          return { rows: [{ tenant_id: FAKE_TENANT_ID }] };
        }
        return { rows: [] };
      }
      // UPDATE users SET email_verified=true, email_verified_at=now()
      // WHERE id = $1 — mutate the fake row so test 5 + test 4 can see.
      if (/UPDATE\s+users\s+SET[\s\S]*email_verified\s*=\s*true/i.test(text)) {
        const id = params[0];
        if (typeof id === "string") {
          const row = users.get(id);
          if (row) {
            row.emailVerified = true;
          }
        }
        return { rows: [], rowCount: 1 };
      }
      // SELECT id, email, email_verified, created_at FROM users
      // WHERE lower(email) = lower($1) LIMIT 1 — idempotent re-seed lookup.
      if (/SELECT[\s\S]*FROM\s+users\s+WHERE[\s\S]*lower\s*\(\s*email\s*\)/i.test(text)) {
        const email = params[0];
        if (typeof email === "string") {
          for (const row of users.values()) {
            if (row.email.toLowerCase() === email.toLowerCase()) {
              return {
                rows: [
                  {
                    id: row.id,
                    email: row.email,
                    email_verified: row.emailVerified,
                    created_at: "2026-05-19T00:00:00.000Z",
                  },
                ],
              };
            }
          }
        }
        return { rows: [] };
      }
      // INSERT INTO sessions (...) — mint session row. The handler
      // generates the token in app code; we just record + acknowledge.
      if (/INSERT\s+INTO\s+sessions/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    },
  };
  return {
    db: {
      async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
        return cb(tx);
      },
    },
    recorded,
    // Test-only seam: pre-populate the fake users table so test-time
    // signUpEmail returns can sync back to "the row that's in the DB."
    users,
  };
}

interface FakeSignUpResult {
  data: { user: { id: string; email: string } } | null;
  error: { code?: string; message?: string } | null;
}

/**
 * Fake Better Auth handle. `signUpEmail` mints a new user, records it
 * in the shared `users` map so subsequent calls hit the dedupe branch.
 */
function makeFakeAuth(
  users: ReturnType<typeof makeRecordingDb>["users"],
  opts: { signUpFails?: boolean } = {},
) {
  const signUpEmail = vi.fn(
    async (call: { body: { email: string } }): Promise<FakeSignUpResult> => {
      if (opts.signUpFails) {
        return { data: null, error: { code: "FAIL", message: "boom" } };
      }
      // Dedupe by lowercased email so idempotent re-seed (test 6) can
      // see the existing row even when callers vary casing.
      const lower = call.body.email.toLowerCase();
      for (const row of users.values()) {
        if (row.email.toLowerCase() === lower) {
          return { data: { user: { id: row.id, email: row.email } }, error: null };
        }
      }
      const id = FAKE_USER_ID;
      users.set(id, { id, email: call.body.email, emailVerified: false });
      return { data: { user: { id, email: call.body.email } }, error: null };
    },
  );
  return {
    handler: vi.fn(),
    api: {
      getSession: vi.fn(async () => null),
      signUpEmail,
    },
  };
}

interface BuildAppOpts {
  fakeAuth: ReturnType<typeof makeFakeAuth>;
  fakeDb: ReturnType<typeof makeRecordingDb>["db"];
  // For test 4 — register a stand-in dual-auth hook on
  // /api/_test/health-authed that resolves the bearer to a user row by
  // consulting the fake auth.api.sessionFromToken seam below.
  sessionsByToken?: Map<string, { id: string; email: string; tenantId: string }>;
}

function buildLocalApp(opts: BuildAppOpts): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  if (opts.sessionsByToken) {
    const lookup = opts.sessionsByToken;
    app.addHook("onRequest", async (req) => {
      // Mirror dual-auth: extract Bearer, resolve via session lookup,
      // stamp req.user/req.tenant. seed-tenant route MUST opt out (it
      // creates the session in the first place) — gate by URL.
      if (req.url === "/api/_test/seed-tenant") return;
      const auth = req.headers["authorization"];
      const value = Array.isArray(auth) ? auth[0] : auth;
      if (!value) {
        throw new AuthError("unauthorized");
      }
      const m = /^Bearer\s+(.+)$/i.exec(value);
      const token = m?.[1]?.trim();
      if (!token) {
        throw new AuthError("unauthorized");
      }
      const user = lookup.get(token);
      if (!user) {
        throw new AuthError("unauthorized");
      }
      (req as unknown as { user: typeof user }).user = user;
      (req as unknown as { tenant: string }).tenant = user.tenantId;
    });
  }
  const deps: TestOnlyDeps = {
    auth: opts.fakeAuth as unknown as TestOnlyDeps["auth"],
    db: opts.fakeDb as unknown as TestOnlyDeps["db"],
    signUpEmail: opts.fakeAuth.api.signUpEmail as unknown as TestOnlyDeps["signUpEmail"],
    sessions: opts.sessionsByToken,
  };
  app.register(buildTestOnlyRoutes(deps));
  return app;
}

describe("/api/_test/seed-tenant (Phase 56 / R1)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Test 1 (gate-production): NODE_ENV='production' + OPENWHISPR_TEST_ROUTES='true' → 404", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db, users } = makeRecordingDb();
    const fakeAuth = makeFakeAuth(users);
    const app = buildLocalApp({ fakeAuth, fakeDb: db });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload: {
        email: "e2e@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
        verified: true,
      },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("Test 2 (gate-env-unset): NODE_ENV='test' but OPENWHISPR_TEST_ROUTES unset → 404", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "");
    const { db, users } = makeRecordingDb();
    const fakeAuth = makeFakeAuth(users);
    const app = buildLocalApp({ fakeAuth, fakeDb: db });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload: {
        email: "e2e@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
        verified: true,
      },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("Test 3 (happy-path): 200 + SeedTenantResponse shape", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db, users } = makeRecordingDb();
    const fakeAuth = makeFakeAuth(users);
    const app = buildLocalApp({ fakeAuth, fakeDb: db });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload: {
        email: "e2e@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
        verified: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(typeof body.token).toBe("string");
    expect((body.token as string).length).toBeGreaterThan(0);
    expect(body.user).toMatchObject({
      id: FAKE_USER_ID,
      email: "e2e@test.local",
      emailVerified: true,
    });
    expect(typeof (body.user as { createdAt: unknown }).createdAt).toBe("string");
    // Better Auth was asked to mint the user with the right body fields.
    expect(fakeAuth.api.signUpEmail).toHaveBeenCalledWith({
      body: expect.objectContaining({
        email: "e2e@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
      }),
    });
    await app.close();
  });

  it("Test 4 (token-usable): bearer is accepted on /api/_test/health-authed", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db, users } = makeRecordingDb();
    const fakeAuth = makeFakeAuth(users);
    // Shared sessions map — seed-tenant inserts into this; the dual-auth
    // stub on /api/_test/health-authed reads from it. Models the
    // real-world contract that Better Auth's bearer plugin lands the
    // session.token + (session→user) join in the same DB Better Auth
    // queries on subsequent requests.
    const sessions = new Map<string, { id: string; email: string; tenantId: string }>();
    const app = buildLocalApp({ fakeAuth, fakeDb: db, sessionsByToken: sessions });
    await app.ready();
    const seedRes = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload: {
        email: "e2e@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
        verified: true,
      },
    });
    expect(seedRes.statusCode).toBe(200);
    const token = (seedRes.json() as { token: string }).token;
    const userId = (seedRes.json() as { user: { id: string } }).user.id;
    // Wire the minted token into the dual-auth stub's lookup so the
    // subsequent health-authed call resolves to a user row.
    sessions.set(token, { id: userId, email: "e2e@test.local", tenantId: FAKE_TENANT_ID });
    const healthRes = await app.inject({
      method: "GET",
      url: "/api/_test/health-authed",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json()).toEqual({ status: "ok", userId });
    await app.close();
  });

  it("Test 5 (db-email-verified): handler issues UPDATE users SET email_verified=true", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db, users, recorded } = makeRecordingDb();
    const fakeAuth = makeFakeAuth(users);
    const app = buildLocalApp({ fakeAuth, fakeDb: db });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload: {
        email: "e2e@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
        verified: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const verify = recorded.find(
      (q) =>
        /UPDATE\s+users\s+SET[\s\S]*email_verified\s*=\s*true/i.test(q.sql) &&
        /email_verified_at\s*=\s*now\s*\(\s*\)/i.test(q.sql),
    );
    expect(
      verify,
      "expected UPDATE users SET email_verified=true, email_verified_at=now()",
    ).toBeTruthy();
    // The fake users row is now flipped — confirms the SQL is bound to
    // the real user id (not a dangling no-op).
    expect(users.get(FAKE_USER_ID)?.emailVerified).toBe(true);
    await app.close();
  });

  it("Test 6 (idempotent-reseed): second call returns same user id + a fresh token", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db, users } = makeRecordingDb();
    const fakeAuth = makeFakeAuth(users);
    const app = buildLocalApp({ fakeAuth, fakeDb: db });
    await app.ready();
    const payload = {
      email: "e2e@test.local",
      password: "hunter22hunter22",
      name: "E2E Tenant",
      verified: true,
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(second.statusCode).toBe(200);
    const firstBody = first.json() as { token: string; user: { id: string } };
    const secondBody = second.json() as { token: string; user: { id: string } };
    // Same user id (no duplicate row).
    expect(secondBody.user.id).toBe(firstBody.user.id);
    // Fresh session token on each call (e2e specs re-seed per-worker
    // and need a token that isn't tied to a prior run's session row).
    expect(secondBody.token).not.toBe(firstBody.token);
    await app.close();
  });

  it("Test 7 (no-origin-required): POST without Origin header is NOT 403 MISSING_OR_NULL_ORIGIN", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db, users } = makeRecordingDb();
    const fakeAuth = makeFakeAuth(users);
    const app = buildLocalApp({ fakeAuth, fakeDb: db });
    await app.ready();
    // (a) no Origin header
    const a = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload: {
        email: "e2e@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
        verified: true,
      },
    });
    expect(a.statusCode).toBe(200);
    // (b) hostile Origin header — still not gated. The point of the
    // route is that NO Better-Auth-style trustedOrigins check fires.
    const b = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
      },
      payload: {
        email: "e2e+2@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
        verified: true,
      },
    });
    expect(b.statusCode).toBe(200);
    await app.close();
  });

  // ── Negative cases (Zod boundary coverage for the route surface) ────

  it("Test 8 (validation): rejects malformed body with 400", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db, users } = makeRecordingDb();
    const fakeAuth = makeFakeAuth(users);
    const app = buildLocalApp({ fakeAuth, fakeDb: db });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload: { email: "not-an-email", password: "pw", name: "n", verified: true },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("Test 10a (signup-failure-but-user-exists, string created_at): idempotent recovery → 200", async () => {
    // Pins lines 427-431 — the string branch of `typeof created_at`.
    // Mirrors Better Auth's USER_ALREADY_EXISTS surface in production
    // where the email-unique index hard-bounces a second sign-up; the
    // route still owes the caller the existing row + a fresh session
    // token (seed-tenant is idempotent).
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db, users } = makeRecordingDb();
    users.set(FAKE_USER_ID, {
      id: FAKE_USER_ID,
      email: "e2e@test.local",
      emailVerified: false,
    });
    const fakeAuth = makeFakeAuth(users, { signUpFails: true });
    const app = buildLocalApp({ fakeAuth, fakeDb: db });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload: {
        email: "e2e@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
        verified: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: { id: string; createdAt: string } };
    expect(body.user.id).toBe(FAKE_USER_ID);
    expect(body.user.createdAt).toBe("2026-05-19T00:00:00.000Z");
    await app.close();
  });

  it("Test 10b (signup-failure-but-user-exists, Date created_at): exercises toISOString() branch", async () => {
    // Pins line 432 — the Date branch of `typeof created_at`. The
    // production path via the real DB driver may return either a string
    // or a Date depending on the pg driver typecast config; both paths
    // must funnel into a wire-correct ISO string in the response.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db, users } = makeRecordingDb();
    users.set(FAKE_USER_ID, {
      id: FAKE_USER_ID,
      email: "e2e@test.local",
      emailVerified: false,
    });
    // Wrap the recording DB so the lookup row's `created_at` comes back
    // as a Date instead of a string.
    const wrappedDb = {
      async transaction<T>(
        cb: (t: { execute: (q: unknown) => Promise<unknown> }) => Promise<T>,
      ): Promise<T> {
        return db.transaction(async (tx) => {
          return cb({
            async execute(query: unknown): Promise<unknown> {
              const out = (await tx.execute(query)) as { rows?: unknown[] };
              if (Array.isArray(out.rows) && out.rows[0] && typeof out.rows[0] === "object") {
                const row = out.rows[0] as { created_at?: unknown };
                if (typeof row.created_at === "string") {
                  row.created_at = new Date(row.created_at);
                }
              }
              return out;
            },
          });
        });
      },
    };
    const fakeAuth = makeFakeAuth(users, { signUpFails: true });
    const app = buildLocalApp({ fakeAuth, fakeDb: wrappedDb });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload: {
        email: "e2e@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
        verified: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: { id: string; createdAt: string } };
    expect(body.user.id).toBe(FAKE_USER_ID);
    expect(body.user.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await app.close();
  });

  it("Test 10c (signup-failure with null error object): exercises the ?? 'SIGNUP_FAILED' fallback", async () => {
    // Pins lines 423-424 — `signUp.error?.message ?? "signUpEmail failed"`
    // + `signUp.error?.code ?? "SIGNUP_FAILED"`. Better Auth's
    // signUpEmail can in theory resolve `{data: null, error: null}` at
    // the type boundary; the route's defensive ??-fallback fires the
    // canonical SIGNUP_FAILED envelope so callers see a stable code.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db, users } = makeRecordingDb();
    const signUpEmail = vi.fn(
      async (): Promise<FakeSignUpResult> => ({
        data: null,
        error: null,
      }),
    );
    const fakeAuth = {
      handler: vi.fn(),
      api: { getSession: vi.fn(async () => null), signUpEmail },
    };
    const app = buildLocalApp({ fakeAuth, fakeDb: db });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload: {
        email: "fresh@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
        verified: true,
      },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string; code: string };
    expect(body.code).toBe("SIGNUP_FAILED");
    expect(body.error).toBe("signUpEmail failed");
    // Reference the unused `users` map so biome/ts don't whine about
    // the destructured-but-unused binding.
    expect(users.size).toBe(0);
    await app.close();
  });

  it("Test 11 (R14 idempotent-reseed-throwing-path): re-seed a known email through a THROWING signUpEmail → 200, never 500", async () => {
    // Phase 59 / Track A / R14. The production `auth.api.signUpEmail`
    // does NOT return `{data:null,error}` on a duplicate email — it
    // THROWS a Better Auth `APIError` (verified against
    // better-auth@1.6.9: `api/routes/sign-up.mjs:205` →
    // `APIError.from("UNPROCESSABLE_ENTITY",
    // BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL)`, whose
    // `.body.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"`).
    //
    // The pre-R14 handler had NO try/catch around signUpEmail, so the
    // thrown APIError escaped to the global error handler → generic
    // 500. The earlier fakes only ever RETURN an error, so this path
    // was never exercised. This fake THROWS an APIError-shaped object
    // matching production. RED: second seed 500s. GREEN: 200 idempotent.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db, users } = makeRecordingDb();
    // signUpEmail: first call mints the user; second call THROWS an
    // APIError-shaped duplicate-email error exactly as Better Auth does.
    const signUpEmail = vi.fn(async (call: { body: { email: string } }) => {
      const lower = call.body.email.toLowerCase();
      for (const row of users.values()) {
        if (row.email.toLowerCase() === lower) {
          // Better Auth APIError shape on a duplicate email.
          const err = Object.assign(new Error("User already exists. Use another email."), {
            name: "APIError",
            status: "UNPROCESSABLE_ENTITY",
            statusCode: 422,
            body: {
              message: "User already exists. Use another email.",
              code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
            },
          });
          throw err;
        }
      }
      const id = FAKE_USER_ID;
      users.set(id, { id, email: call.body.email, emailVerified: false });
      return { data: { user: { id, email: call.body.email } }, error: null };
    });
    const fakeAuth = {
      handler: vi.fn(),
      api: { getSession: vi.fn(async () => null), signUpEmail },
    };
    const app = buildLocalApp({ fakeAuth, fakeDb: db });
    await app.ready();
    const payload = {
      email: "r14@test.local",
      password: "hunter22hunter22",
      name: "E2E Tenant",
      verified: true,
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { token: string; user: { id: string } };
    // Second call — production path THROWS USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL.
    const second = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { token: string; user: { id: string } };
    // Same user id (idempotent — no duplicate row).
    expect(secondBody.user.id).toBe(firstBody.user.id);
    // Fresh session token on the re-seed.
    expect(secondBody.token).not.toBe(firstBody.token);
    await app.close();
  });

  it("Test 12 (R14 non-duplicate throw re-thrown): a non-duplicate APIError still 500s", async () => {
    // Phase 59 / Track A / R14 — regression guard. The catch must only
    // swallow the duplicate-email code; a genuine signUpEmail failure
    // (any other thrown APIError) MUST still surface as a 500, not be
    // masked into a misleading 200.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db, users } = makeRecordingDb();
    const signUpEmail = vi.fn(async () => {
      const err = Object.assign(new Error("Password too short"), {
        name: "APIError",
        status: "BAD_REQUEST",
        statusCode: 400,
        body: { message: "Password too short", code: "PASSWORD_TOO_SHORT" },
      });
      throw err;
    });
    const fakeAuth = {
      handler: vi.fn(),
      api: { getSession: vi.fn(async () => null), signUpEmail },
    };
    const app = buildLocalApp({ fakeAuth, fakeDb: db });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload: {
        email: "r14-nondupe@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
        verified: true,
      },
    });
    expect(res.statusCode).toBe(500);
    expect(users.size).toBe(0);
    await app.close();
  });

  it("Test 9 (signup-failure): 500 envelope when Better Auth signUpEmail returns an error", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db, users } = makeRecordingDb();
    const fakeAuth = makeFakeAuth(users, { signUpFails: true });
    const app = buildLocalApp({ fakeAuth, fakeDb: db });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload: {
        email: "e2e@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
        verified: true,
      },
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});
