// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-04 / Task 2 — desktop bearer-mint JIT seam, REAL Postgres
// (testcontainers, NO internal mocks; only the userinfo/token HTTP boundary is
// stubbed). D-69-1 Option C, second call-site.
//
// Boots a real Postgres (PgBouncer/Valkey not required for the JIT persist +
// audit assertions — the seam touches only `users` + `audit_log`), applies all
// migrations, seeds two tenants, then drives `buildMintBearer` end-to-end:
//
//   NEW user      → createOAuthUser (runs the Plan-03 databaseHooks via the
//                   real-PG lifecycle) → users row lands with the resolved
//                   tenant+role + a sso.jit.user.created audit row.
//   RETURNING re-sync (mode 5) → the if(existing) reuse branch persists the
//                   role downgrade on the real row + emits sso.jit.role.updated.
//   RETURNING reject (mode 6)  → the reuse branch refuses reuse + mint; the row's
//                   tenant_id is UNCHANGED + a sso.jit.rejected row exists.
//   NEW unknown-tenant → no users row, no bearer.
//   Valid sign-in → an opaque bearer (raw 32-char session token, no ".") is
//                   returned. The channel-scheme deep-link echo is produced by
//                   the auth-callback route and is regression-covered, UNCHANGED,
//                   by tests/unit/__tests__/oauth-channel-scheme-mint-bearer.ts.
//
// SSO-IMPL-01, SSO-IMPL-03.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withTenant } from "@openwhispr/data";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildMintBearer } from "../../../src/lib/mint-bearer.js";
import type { JitConfig } from "../../../src/lib/oidc-jit-config.js";
import { buildJitDatabaseHooks } from "../../../src/lib/oidc-jit-hooks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "data",
  "migrations",
);

const ACME_TENANT_ID = "11111111-1111-1111-1111-111111111111";
const GLOBEX_TENANT_ID = "22222222-2222-2222-2222-222222222222";

const JIT_CONFIG: JitConfig = {
  tenantClaim: "tenant",
  tenantMapping: { acme: ACME_TENANT_ID, globex: GLOBEX_TENANT_ID },
  groupClaim: "groups",
  roleMapping: { "openwhispr-admins": "admin", "openwhispr-engineering": "member" },
  rolePriority: ["admin", "member", "viewer"],
  defaultRole: "viewer",
  revocationMode: "downgrade_to_default",
};

const ARGS = {
  code: "auth-code-fixture",
  codeVerifier: "verifier-xyz",
  stateId: "11111111-2222-3333-4444-555555555555",
  provider: "oidc",
  tenantId: "00000000-0000-0000-0000-000000000000",
  scheme: "openwhispr-dev",
};

let container: StartedPostgreSqlContainer;
let ownerPool: Pool;
let appPool: Pool;
// noExplicitAny is disabled for test files (biome.json override); appDb holds the
// structural Drizzle node-postgres client passed to withTenant + the seam.
let appDb: any;

const noopLog = { info: () => {}, warn: () => {} };

beforeAll(async () => {
  process.env.MASTER_KEK = process.env.MASTER_KEK ?? Buffer.alloc(32).toString("base64url");
  process.env.OPENWHISPR_KEY_PROVIDER = process.env.OPENWHISPR_KEY_PROVIDER ?? "env";

  container = await new PostgreSqlContainer(
    "ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1",
  )
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superUri = container.getConnectionUri();
  const superPool = new Pool({ connectionString: superUri });
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
  const ownerUri = `postgres://openwhispr_owner:owner-pw@${host}:${port}/openwhispr`;

  ownerPool = new Pool({ connectionString: ownerUri });
  await migrate(drizzle(ownerPool), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });

  await ownerPool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, 'acme'), ($2, 'globex') ON CONFLICT (id) DO NOTHING`,
    [ACME_TENANT_ID, GLOBEX_TENANT_ID],
  );

  const appUri = `postgres://openwhispr_app:app-pw@${host}:${port}/openwhispr`;
  appPool = new Pool({ connectionString: appUri });
  appDb = drizzle(appPool);
}, 240_000);

afterAll(async () => {
  await appPool?.end();
  await ownerPool?.end();
  await container?.stop();
}, 60_000);

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv("OIDC_CLIENT_ID", "client-id-fixture");
  vi.stubEnv("OIDC_CLIENT_SECRET", "client-secret-fixture");
  vi.stubEnv("OIDC_TOKEN_URL", "https://idp.test/token");
  vi.stubEnv("OIDC_USERINFO_URL", "https://idp.test/userinfo");
  vi.stubEnv("AUTH_URL", "https://api.localhost");
  vi.stubEnv("OIDC_TENANT_CLAIM", "tenant");
  vi.stubEnv("OIDC_GROUP_CLAIM", "groups");
  vi.stubEnv(
    "OIDC_TENANT_MAPPING",
    JSON.stringify({ acme: ACME_TENANT_ID, globex: GLOBEX_TENANT_ID }),
  );
  vi.stubEnv(
    "OIDC_ROLE_MAPPING",
    JSON.stringify({ "openwhispr-admins": "admin", "openwhispr-engineering": "member" }),
  );
  vi.stubEnv("OIDC_DEFAULT_ROLE", "viewer");

  await ownerPool.query(`DELETE FROM audit_log`);
  await ownerPool.query(`DELETE FROM sessions`);
  await ownerPool.query(`DELETE FROM account`);
  await ownerPool.query(`DELETE FROM users`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Boundary-mock the IdP token + userinfo HTTP (the only allowed network mock). */
function stubFetch(userinfo: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/token") {
        return new Response(JSON.stringify({ access_token: "AT", id_token: "IDT" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(userinfo), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

/**
 * A real-PG-backed Better Auth internalAdapter surface for the desktop seam.
 * - findUserByEmail SELECTs the user by email under a BYPASSRLS owner read
 *   (returns the canonical {user:{id}} shape the seam consumes).
 * - createOAuthUser runs the Plan-03 create.before/create.after hooks around a
 *   real INSERT (mirrors createWithHooks: the hooks fire on the desktop NEW-user
 *   path exactly as on web), so sso.jit.user.created lands.
 * - createSession returns a raw 32-char opaque token.
 */
function buildRealAdapter(): {
  internalAdapter: {
    findUserByEmail: (email: string) => Promise<{ user: { id: string } } | null>;
    createOAuthUser: (
      user: Record<string, unknown>,
      account: Record<string, unknown>,
    ) => Promise<{ user: { id: string }; account: unknown }>;
    createSession: (userId: string) => Promise<{ token: string; userId: string }>;
  };
} {
  const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: noopLog });
  return {
    internalAdapter: {
      async findUserByEmail(email) {
        const r = await ownerPool.query<{ id: string }>(
          `SELECT id FROM users WHERE email = $1 LIMIT 1`,
          [email.toLowerCase()],
        );
        const row = r.rows[0];
        return row ? { user: { id: row.id } } : null;
      },
      async createOAuthUser(user) {
        const beforeResult = await hooks.user.create.before(user as never, null);
        if (beforeResult === false || beforeResult === undefined) {
          throw new Error("create.before aborted");
        }
        const data = (beforeResult as { data: Record<string, unknown> }).data;
        const tenantId = String(data.tenantId);
        const id = crypto.randomUUID();
        await withTenant(appDb, tenantId, async (tx) => {
          await tx.execute(
            sql`INSERT INTO users (id, tenant_id, email, name, role)
                VALUES (${id}, ${tenantId}, ${String(data.email)}, ${String(data.name)}, ${data.role ?? null})`,
          );
        });
        await hooks.user.create.after({ id, ...data } as never, null);
        return { user: { id }, account: {} };
      },
      async createSession(userId) {
        return { token: "z".repeat(32), userId };
      },
    },
  };
}

function buildSeam() {
  const auth = { $context: Promise.resolve(buildRealAdapter()) };
  return buildMintBearer({
    auth: auth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    db: appDb,
  });
}

describe("SSO-IMPL-01/03 — desktop bearer-mint JIT seam (real Postgres)", () => {
  it("first-time desktop profile lands resolved tenant+role + a sso.jit.user.created audit row", async () => {
    stubFetch({
      sub: "sub-alice",
      email: "alice@acme.example",
      name: "Alice",
      tenant: "acme",
      groups: ["openwhispr-engineering"],
    });
    const mint = buildSeam();
    const bearer = await mint(ARGS);

    expect(bearer).toBe("z".repeat(32));
    const row = await ownerPool.query<{ tenant_id: string; role: string | null }>(
      `SELECT tenant_id, role FROM users WHERE email = $1`,
      ["alice@acme.example"],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0]?.tenant_id).toBe(ACME_TENANT_ID);
    expect(row.rows[0]?.role).toBe("member");

    const audit = await ownerPool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM audit_log WHERE action = 'sso.jit.user.created'`,
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]?.payload.tenant_id).toBe(ACME_TENANT_ID);
    expect(audit.rows[0]?.payload.role).toBe("member");
    expect(audit.rows[0]?.payload.email).toBeUndefined();
  }, 60_000);

  it("returning desktop user whose group changed is re-synced (downgrade) + sso.jit.role.updated", async () => {
    // Seed an existing admin in acme.
    const id = crypto.randomUUID();
    await withTenant(appDb, ACME_TENANT_ID, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users (id, tenant_id, email, name, role)
            VALUES (${id}, ${ACME_TENANT_ID}, ${"bob@acme.example"}, ${"Bob"}, ${"admin"})`,
      );
    });
    // userinfo now carries only the engineering (member) group → resolved role member.
    stubFetch({
      sub: "sub-bob",
      email: "bob@acme.example",
      tenant: "acme",
      groups: ["openwhispr-engineering"],
    });
    const mint = buildSeam();
    const bearer = await mint(ARGS);

    expect(bearer).toBe("z".repeat(32)); // bearer still minted for the reused id
    const row = await ownerPool.query<{ role: string | null }>(
      `SELECT role FROM users WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]?.role).toBe("member");

    const audit = await ownerPool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM audit_log WHERE action = 'sso.jit.role.updated'`,
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]?.payload.before).toBe("admin");
    expect(audit.rows[0]?.payload.after).toBe("member");
    expect(audit.rows[0]?.payload.reason).toBe("revocation_downgrade");
  }, 60_000);

  it("returning desktop user whose tenant claim changed is rejected (no bearer, tenant unchanged) + sso.jit.rejected", async () => {
    const id = crypto.randomUUID();
    await withTenant(appDb, ACME_TENANT_ID, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users (id, tenant_id, email, name, role)
            VALUES (${id}, ${ACME_TENANT_ID}, ${"carol@acme.example"}, ${"Carol"}, ${"member"})`,
      );
    });
    // The returning user (bound to acme) now presents globex claims.
    stubFetch({
      sub: "sub-carol",
      email: "carol@acme.example",
      tenant: "globex",
      groups: ["openwhispr-engineering"],
    });
    const mint = buildSeam();
    await expect(mint(ARGS)).rejects.toMatchObject({ code: "forbidden_tenant_mismatch" });

    const row = await ownerPool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM users WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]?.tenant_id).toBe(ACME_TENANT_ID); // UNCHANGED

    const audit = await ownerPool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM audit_log WHERE action = 'sso.jit.rejected'`,
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]?.payload.code).toBe("forbidden_tenant_mismatch");
  }, 60_000);

  it("new desktop profile resolving an unknown tenant creates NO user row and mints NO bearer", async () => {
    stubFetch({
      sub: "sub-ghost",
      email: "ghost@no-such.example",
      tenant: "no-such",
      groups: ["openwhispr-engineering"],
    });
    const mint = buildSeam();
    await expect(mint(ARGS)).rejects.toMatchObject({ code: "forbidden_unknown_tenant" });

    const row = await ownerPool.query(`SELECT 1 FROM users WHERE email = $1`, [
      "ghost@no-such.example",
    ]);
    expect(row.rowCount).toBe(0);

    const audit = await ownerPool.query(
      `SELECT 1 FROM audit_log WHERE action = 'sso.jit.rejected'`,
    );
    expect(audit.rowCount).toBe(1);
  }, 60_000);

  it("returning desktop user with unchanged group + tenant: bearer minted, no re-sync audit", async () => {
    const id = crypto.randomUUID();
    await withTenant(appDb, ACME_TENANT_ID, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users (id, tenant_id, email, name, role)
            VALUES (${id}, ${ACME_TENANT_ID}, ${"dan@acme.example"}, ${"Dan"}, ${"member"})`,
      );
    });
    stubFetch({
      sub: "sub-dan",
      email: "dan@acme.example",
      tenant: "acme",
      groups: ["openwhispr-engineering"],
    });
    const mint = buildSeam();
    const bearer = await mint(ARGS);

    expect(bearer).toBe("z".repeat(32));
    const audit = await ownerPool.query(
      `SELECT 1 FROM audit_log WHERE action = 'sso.jit.role.updated'`,
    );
    expect(audit.rowCount).toBe(0);
    const row = await ownerPool.query<{ role: string | null }>(
      `SELECT role FROM users WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]?.role).toBe("member"); // UNCHANGED
  }, 60_000);

  it("a valid desktop sign-in returns an opaque bearer (raw token, not a signed JWT)", async () => {
    stubFetch({
      sub: "sub-erin",
      email: "erin@acme.example",
      tenant: "acme",
      groups: ["openwhispr-admins"],
    });
    const mint = buildSeam();
    const bearer = await mint(ARGS);
    // Opaque session token — the bearer plugin self-signs on receive only when
    // the token has no "." (verified in mint-bearer.ts header docs). UNCHANGED.
    expect(bearer).not.toContain(".");
    expect(bearer.length).toBe(32);
  }, 60_000);
});
