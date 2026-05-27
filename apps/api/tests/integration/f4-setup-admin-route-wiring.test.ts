// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260524-u00 / Task F4 — setup-admin route wiring regression guard.
//
// THE BUG (F1, live prod 2026-05-24 on openwhispr.yambr.com chart 1.0.6):
// POST /api/setup/admin returned 404 because the chart never projected
// DATABASE_URL_OWNER into the api Deployment. apps/api/src/index.ts:1066
// reads it to construct `probeOwnerPool`; routes/index.ts:511 silently
// skips `buildSetupAdminRoutes` registration when probeOwnerPool is
// undefined; first-run admin onboarding wizard at /setup is unrecoverable
// without kubectl exec corrective SQL.
//
// THE GUARD: this integration test exercises the FULL chain on the real
// Fastify surface with a real Postgres testcontainer, real Better Auth,
// real route registry — exactly the production buildApp() path. Two
// scenarios:
//
//   (1) POSITIVE: buildApp({ setupAdmin: { ownerPool, signUpEmail } })
//       POST /api/setup/admin with valid payload → 201, users.role='admin'
//       persisted, setup_state flipped to 'completed'.
//
//   (2) NEGATIVE: buildApp({}) — no setupAdmin opt → POST /api/setup/admin
//       returns 404. This pins the F1 failure mode: future api refactors
//       that quietly remove the `if (probeOwnerPool && auth)` gate at
//       index.ts:1105 would silently re-register the route without owner
//       pool wiring (worse than 404 — could write with the wrong role).
//
// Both scenarios share the same Postgres container; the second buildApp
// is constructed without setupAdmin and immediately torn down.
//
// Per CLAUDE.md "no internal mocks": Postgres is real (testcontainers),
// Better Auth is real (production buildAuth), email is stubbed at the
// process boundary (verification not exercised in this test). No app
// logic is mocked.

import { dirname as pathDirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppDb, schema } from "@openwhispr/data";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAuth } from "../../src/auth.js";
import { buildApp } from "../../src/index.js";

const __dirname = pathDirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "data",
  "migrations",
);

let container: StartedPostgreSqlContainer;
let ownerPool: Pool;
let appPool: Pool;
// Better Auth's exported AuthInstance type is narrow; this test drives the
// raw api surface so a bare `any` for the auth handle matches the existing
// integration-test convention (r22, better-auth-envelope-at-rest).
// biome-ignore lint/suspicious/noExplicitAny: integration-test convention
let auth: any;
let appDb: AppDb;
// Process-boundary stub for the SMTP transport — verification email is
// not exercised here, but Better Auth's signUpEmail tries to call the
// email hook when verification is enabled. Capture & swallow.
const emailStub = {
  async send(_: { to: string; subject: string; text: string; html?: string }) {
    return { delivered: true };
  },
};

beforeAll(async () => {
  process.env.MASTER_KEK = process.env.MASTER_KEK ?? Buffer.alloc(32).toString("base64url");
  process.env.BETTER_AUTH_SECRET ??=
    "0000000000000000000000000000000000000000000000000000000000000000";
  // Setup-admin test runs WITH email verification ENABLED (production
  // posture) so the test surface matches what k8s deployments hit. The
  // setup-admin route does NOT trigger verification on its first user;
  // the role flip + tenant rename happen synchronously.
  process.env.OPENWHISPR_DISABLE_EMAIL_VERIFICATION = "0";
  process.env.OPENWHISPR_KEY_PROVIDER = process.env.OPENWHISPR_KEY_PROVIDER ?? "env";

  container = await new PostgreSqlContainer(
    "ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1",
  )
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  await superPool.query("CREATE SCHEMA IF NOT EXISTS partman");
  await superPool.query("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD 'owner-pw'`,
  );
  await superPool.query(`CREATE ROLE openwhispr_app WITH LOGIN PASSWORD 'app-pw'`);
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);

  ownerPool = new Pool({
    connectionString: `postgres://openwhispr_owner:owner-pw@${host}:${port}/openwhispr`,
  });
  await migrate(drizzle(ownerPool), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });

  appPool = new Pool({
    connectionString: `postgres://openwhispr_app:app-pw@${host}:${port}/openwhispr`,
  });
  appDb = drizzle(appPool, { schema });
  auth = buildAuth({ db: appDb, email: emailStub as never });
}, 240_000);

afterAll(async () => {
  await appPool?.end();
  await ownerPool?.end();
  await container?.stop();
}, 60_000);

// Quick-task 260527-im6 — Bearer-mode test token. The role-flip is now
// synchronous ONLY in the Bearer-token branch; the email branch defers
// it to the afterEmailVerification hook. The F4 POSITIVE assertion
// (role='admin' immediately after POST) requires Bearer mode.
const F4_BEARER_HEX = "0123456789abcdef0123456789abcdee0123456789abcdef0123456789abcd00";
const F4_BEARER_BUFFER = Buffer.from(F4_BEARER_HEX, "hex");
const F4_BEARER_HEADER = `Bearer ${F4_BEARER_HEX}`;

describe("F4: POST /api/setup/admin route wiring (regression guard for F1)", () => {
  it("POSITIVE: buildApp WITH setupAdmin opt → POST /api/setup/admin returns 201 + role='admin'", async () => {
    // Mirror what apps/api/src/index.ts:1106-1141 builds in production
    // when DATABASE_URL_OWNER is set. The adapter converts Better Auth's
    // throw-on-error contract into the {data,error} envelope shape the
    // route handler expects (compensating-rollback support).
    const signUpEmailAdapter = async (call: {
      body: { email: string; password: string; name: string };
    }) => {
      try {
        const result = await auth.api.signUpEmail({ body: call.body });
        const u = (result as { user?: { id?: string; email?: string } }).user;
        if (!u?.id || !u.email) {
          return {
            data: null,
            error: { code: "SIGN_UP_NO_USER", message: "sign-up returned no user" },
          };
        }
        return { data: { user: { id: u.id, email: u.email } }, error: null };
      } catch (err) {
        const e = err as { body?: { code?: string; message?: string }; message?: string };
        return {
          data: null,
          error: {
            ...(e.body?.code ? { code: e.body.code } : {}),
            message: e.body?.message ?? e.message ?? "admin sign-up failed",
          },
        };
      }
    };

    const app: FastifyInstance = await buildApp({
      db: appDb as never,
      auth: auth as never,
      setupAdmin: {
        ownerPool,
        signUpEmail: signUpEmailAdapter,
        // Quick-task 260527-im6 / A1 — supply the pre-parsed env-token
        // Buffer so the request below (which sends a matching Bearer)
        // hits the synchronous Bearer branch the F4 assertions rely on.
        envClaimTokenBuffer: F4_BEARER_BUFFER,
      },
    });
    try {
      await app.ready();

      const email = `f4-pos-${Date.now()}@example.test`;
      const res = await app.inject({
        method: "POST",
        url: "/api/setup/admin",
        headers: { authorization: F4_BEARER_HEADER },
        payload: {
          email,
          password: "F4!Str0ngAdmin",
          name: "F4 Admin",
          workspace: "F4 Workspace",
          timezone: "UTC",
        },
      });

      // First-run path: 201 Created with the wizard's admin email echoed.
      // Idempotency path (already completed) returns 200 with the existing
      // admin's email — also acceptable in this assertion.
      expect([200, 201]).toContain(res.statusCode);

      // Role flip: verify directly via owner connection (BYPASSRLS).
      const userRow = await ownerPool.query<{ role: string | null; email: string }>(
        `SELECT role, email FROM users WHERE lower(email) = lower($1) LIMIT 1`,
        [email],
      );
      expect(userRow.rowCount).toBe(1);
      expect(userRow.rows[0]?.role).toBe("admin");

      // setup_state flipped to 'completed' (singleton row enforced by
      // migration 0017 CHECK + UNIQUE constraint).
      const stateRow = await ownerPool.query<{ status: string }>(
        `SELECT status FROM setup_state LIMIT 1`,
      );
      expect(stateRow.rowCount).toBe(1);
      expect(stateRow.rows[0]?.status).toBe("completed");
    } finally {
      await app.close();
      // Reset setup_state for the negative test (mirrors the test-only
      // /api/_test/reset-setup endpoint behavior, but executed directly
      // via owner pool — keeps this test self-contained without spinning
      // up that test-only route surface here).
      await ownerPool.query(`UPDATE setup_state SET status = 'pending'`);
    }
  }, 60_000);

  it("NEGATIVE: buildApp WITHOUT setupAdmin opt → POST /api/setup/admin returns 404 (F1 reproduction)", async () => {
    // The exact production failure mode from chart 1.0.5/1.0.6:
    // DATABASE_URL_OWNER missing → probeOwnerPool undefined →
    // buildOpts.setupAdmin omitted → routes/index.ts:511 skips the
    // route → wizard 404s. This test PROVES the failure mode reproduces
    // when the chart wires the api without DATABASE_URL_OWNER, AND that
    // chart 1.0.7's fix (always projecting DATABASE_URL_OWNER) is the
    // exact countermeasure.
    const app: FastifyInstance = await buildApp({
      db: appDb as never,
      auth: auth as never,
      // NO setupAdmin — exactly what happens when probeOwnerPool is undefined
      // because process.env.DATABASE_URL_OWNER was not projected.
    });
    try {
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/setup/admin",
        payload: {
          email: "f4-neg@example.test",
          password: "F4!Str0ngAdmin",
          name: "F4 Negative",
          workspace: "F4 Workspace",
          timezone: "UTC",
        },
      });
      expect(res.statusCode).toBe(404);
      const body = res.json() as { error?: string };
      expect(body.error).toBeDefined();
    } finally {
      await app.close();
    }
  }, 30_000);

  it("NEGATIVE: GET /api/setup-state still returns 200 even WITHOUT setupAdmin (independent route)", async () => {
    // Sanity check: GET /api/setup-state is NOT gated on probeOwnerPool —
    // it uses the regular db handle (apps/api/src/routes/setup-state.ts).
    // The F1 bug only affected POST /api/setup/admin. Live prod evidence
    // showed GET still returned 200 even when POST 404'd.
    const app: FastifyInstance = await buildApp({
      db: appDb as never,
      auth: auth as never,
    });
    try {
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/setup-state" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { status: string };
      expect(["pending", "completed", "skipped_legacy"]).toContain(body.status);
    } finally {
      await app.close();
    }
  }, 30_000);
});
