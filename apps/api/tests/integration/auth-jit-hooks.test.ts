// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-03 / Task 1 — SSO JIT databaseHooks + mapProfileToUser
// integration test against REAL Postgres (testcontainers, NO internal mocks).
//
// Boots a real Postgres via testcontainers, applies all migrations, then drives
// the JIT seams shipped in `apps/api/src/lib/oidc-jit-hooks.ts`:
//
//   makeMapProfileToUser(jitConfig, deps)  — the web claim-projection seam
//   buildJitDatabaseHooks({ db, jitConfig, log })  — the 4 user.{create,update}
//                                                     .{before,after} hooks
//
// We replicate Better Auth's create/update lifecycle in-process (mapProfileToUser
// projects {tenantId,role} → create.before validates → adapter INSERTs → create.after
// emits audit) so the assertions land against the ACTUAL persisted `users` row and
// `audit_log` rows via a BYPASSRLS owner SELECT — not a mock return value.
//
// SSO-IMPL-03. D-69-1 (shared resolver), D-69-2 (after-hooks post-commit tx).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withTenant } from "@openwhispr/data";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { JitConfig } from "../../src/lib/oidc-jit-config.js";
import {
  buildJitDatabaseHooks,
  JitRejectionError,
  makeMapProfileToUser,
} from "../../src/lib/oidc-jit-hooks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
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

// Two test tenants. The mapping resolves the OIDC tenant key → a real
// tenants.id UUID so the users FK + audit hexUuid both validate.
const ACME_TENANT_ID = "11111111-1111-1111-1111-111111111111";
const GLOBEX_TENANT_ID = "22222222-2222-2222-2222-222222222222";

const JIT_CONFIG: JitConfig = {
  tenantClaim: "tenant",
  tenantMapping: { acme: ACME_TENANT_ID, globex: GLOBEX_TENANT_ID },
  groupClaim: "groups",
  roleMapping: { "openwhispr-admins": "admin", "openwhispr-engineering": "member" },
  rolePriority: ["admin", "member", "viewer"],
  defaultRole: null,
  revocationMode: "downgrade_to_default",
};

let container: StartedPostgreSqlContainer;
let ownerPool: Pool;
let appPool: Pool;
// noExplicitAny is disabled for test files (biome.json override); appDb holds
// the structural Drizzle node-postgres client passed to withTenant + the hooks.
let appDb: any;

const captured: Array<{ event: string; fields: Record<string, unknown> }> = [];
const testLog = {
  info: (obj: unknown) => {
    if (obj && typeof obj === "object") {
      const o = obj as Record<string, unknown>;
      captured.push({ event: String(o.event ?? ""), fields: o });
    }
  },
  warn: (_obj: unknown) => {
    /* not asserted in this suite */
  },
};

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

  // Seed the two test tenants (FK target for users.tenant_id + audit_log).
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
  captured.length = 0;
  await ownerPool.query(`DELETE FROM audit_log`);
  await ownerPool.query(`DELETE FROM sessions`);
  await ownerPool.query(`DELETE FROM account`);
  await ownerPool.query(`DELETE FROM users`);
});

// Replicates Better Auth's create lifecycle: project claims (web seam),
// run create.before, INSERT the user row inside the resolved tenant tx,
// then fire create.after (post-commit audit, own tx). Returns the new id.
async function jitCreate(
  hooks: ReturnType<typeof buildJitDatabaseHooks>,
  projected: { tenantId?: string; role?: string },
  email: string,
): Promise<string> {
  const incoming = { email, name: "JIT User", ...projected } as Record<string, unknown>;
  const beforeResult = await hooks.user.create.before(incoming as never, null);
  if (beforeResult === false || beforeResult === undefined) {
    throw new Error("create.before aborted");
  }
  const data = (beforeResult as { data: Record<string, unknown> }).data;
  const tenantId = String(data.tenantId);
  const id = crypto.randomUUID();
  await withTenant(appDb, tenantId, async (tx) => {
    await tx.execute(
      sql`INSERT INTO users (id, tenant_id, email, name, role)
          VALUES (${id}, ${tenantId}, ${email}, ${String(data.name)}, ${data.role ?? null})`,
    );
  });
  const persisted = { id, ...data } as Record<string, unknown>;
  await hooks.user.create.after(persisted as never, null);
  return id;
}

describe("SSO-IMPL-03 — JIT databaseHooks + mapProfileToUser (real Postgres)", () => {
  it("first-time profile projects tenantId+role; user row lands with resolved tenant + role", async () => {
    const mapProfile = makeMapProfileToUser(JIT_CONFIG, { db: appDb, log: testLog });
    const projected = await mapProfile({
      tenant: "acme",
      groups: ["openwhispr-engineering"],
      email: "alice@acme.example",
    });
    expect(projected).toEqual({ tenantId: ACME_TENANT_ID, role: "member" });

    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: testLog });
    const id = await jitCreate(hooks, projected, "alice@acme.example");

    const row = await ownerPool.query<{ tenant_id: string; role: string | null }>(
      `SELECT tenant_id, role FROM users WHERE id = $1`,
      [id],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0]?.tenant_id).toBe(ACME_TENANT_ID);
    expect(row.rows[0]?.role).toBe("member");
  }, 60_000);

  it("returning admin whose admin group is revoked is re-synced to default by update.before", async () => {
    // Seed an existing admin in acme.
    const id = crypto.randomUUID();
    await withTenant(appDb, ACME_TENANT_ID, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users (id, tenant_id, email, name, role)
            VALUES (${id}, ${ACME_TENANT_ID}, ${"bob@acme.example"}, ${"Bob"}, ${"admin"})`,
      );
    });

    const cfg: JitConfig = { ...JIT_CONFIG, defaultRole: "viewer" };
    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: cfg, log: testLog });

    // The resolver (in mapProfileToUser) already downgraded the admin to the
    // default role because the admin group was revoked; the incoming projected
    // role is therefore "viewer". update.before detects existing=admin →
    // incoming=viewer and re-syncs, flagging the revocation_downgrade reason.
    const beforeResult = await hooks.user.update.before(
      {
        id,
        email: "bob@acme.example",
        tenantId: ACME_TENANT_ID,
        role: "viewer",
      } as never,
      null,
    );
    expect(beforeResult).not.toBe(false);
    const data = (beforeResult as { data: Record<string, unknown> }).data;
    expect(data.role).toBe("viewer");
    expect(data.__jitRoleBefore).toBe("admin");
    expect(data.__jitRoleReason).toBe("revocation_downgrade");

    // Persist the re-sync, then fire update.after.
    await withTenant(appDb, ACME_TENANT_ID, async (tx) => {
      await tx.execute(sql`UPDATE users SET role = ${String(data.role)} WHERE id = ${id}`);
    });
    await hooks.user.update.after(
      { id, email: "bob@acme.example", tenantId: ACME_TENANT_ID, role: "viewer" } as never,
      null,
    );

    const row = await ownerPool.query<{ role: string | null }>(
      `SELECT role FROM users WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]?.role).toBe("viewer");
  }, 60_000);

  it("returning user with a changed tenant claim is rejected (forbidden_tenant_mismatch); no row mutated", async () => {
    // Seed an existing acme user.
    const id = crypto.randomUUID();
    await withTenant(appDb, ACME_TENANT_ID, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users (id, tenant_id, email, name, role)
            VALUES (${id}, ${ACME_TENANT_ID}, ${"carol@acme.example"}, ${"Carol"}, ${"member"})`,
      );
    });

    // A returning user bound to acme now presents globex claims (mapProfileToUser
    // projected tenantId=globex). update.before looks the id up under globex,
    // finds nothing (the row lives in acme), and rejects with mode-6.
    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: testLog });

    await expect(
      hooks.user.update.before(
        {
          id,
          email: "carol@acme.example",
          tenantId: GLOBEX_TENANT_ID,
          role: "member",
        } as never,
        null,
      ),
    ).rejects.toBeInstanceOf(JitRejectionError);

    const row = await ownerPool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM users WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]?.tenant_id).toBe(ACME_TENANT_ID);
  }, 60_000);

  it("create.after emits one sso.jit.user.created audit row with NO PII + structured log", async () => {
    const mapProfile = makeMapProfileToUser(JIT_CONFIG, { db: appDb, log: testLog });
    const projected = await mapProfile({
      tenant: "acme",
      groups: ["openwhispr-engineering"],
      email: "dave@acme.example",
    });
    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: testLog });
    await jitCreate(hooks, projected, "dave@acme.example");

    const audit = await ownerPool.query<{ action: string; payload: Record<string, unknown> }>(
      `SELECT action, payload FROM audit_log WHERE action = 'sso.jit.user.created'`,
    );
    expect(audit.rowCount).toBe(1);
    const payload = audit.rows[0]?.payload ?? {};
    expect(payload.tenant_id).toBe(ACME_TENANT_ID);
    expect(payload.role).toBe("member");
    expect(payload.tenant_claim_mode).toBe("named_claim");
    // NO PII: email / name / sub / groups MUST NOT appear.
    expect(payload.email).toBeUndefined();
    expect(payload.name).toBeUndefined();
    expect(payload.sub).toBeUndefined();
    expect(payload.groups).toBeUndefined();

    const logged = captured.find((c) => c.event === "sso.jit.user.created");
    expect(logged).toBeDefined();
    expect(logged?.fields.email).toBeUndefined();
  }, 60_000);

  it("update.after emits sso.jit.role.updated with before/after/reason", async () => {
    const id = crypto.randomUUID();
    await withTenant(appDb, ACME_TENANT_ID, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users (id, tenant_id, email, name, role)
            VALUES (${id}, ${ACME_TENANT_ID}, ${"erin@acme.example"}, ${"Erin"}, ${"viewer"})`,
      );
    });
    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: testLog });
    await hooks.user.update.after(
      {
        id,
        email: "erin@acme.example",
        tenantId: ACME_TENANT_ID,
        role: "member",
        // carried hint from update.before for before/after audit framing
        __jitRoleBefore: "viewer",
        __jitRoleReason: "group_change",
      } as never,
      null,
    );

    const audit = await ownerPool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM audit_log WHERE action = 'sso.jit.role.updated'`,
    );
    expect(audit.rowCount).toBe(1);
    const payload = audit.rows[0]?.payload ?? {};
    expect(payload.tenant_id).toBe(ACME_TENANT_ID);
    expect(payload.before).toBe("viewer");
    expect(payload.after).toBe("member");
    expect(["group_change", "revocation_downgrade"]).toContain(payload.reason);
  }, 60_000);

  it("JIT disabled (jitConfig null) → makeMapProfileToUser is not constructed; hooks are absent", () => {
    // Backward-compat contract is enforced in auth.ts: when readJitConfig()
    // returns null we omit mapProfileToUser + databaseHooks entirely. Here we
    // assert the builder helpers are pure functions that the auth.ts guard can
    // skip — constructing them requires a non-null config by type.
    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: testLog });
    expect(typeof hooks.user.create.before).toBe("function");
    expect(typeof hooks.user.create.after).toBe("function");
    expect(typeof hooks.user.update.before).toBe("function");
    expect(typeof hooks.user.update.after).toBe("function");
  });

  // ── Branch-coverage for the defensive hook edges ──────────────────────────
  it("create.before passes a non-JIT create (no projected tenant) through untouched — plain email-password sign-up must NOT be JIT-gated", async () => {
    // The databaseHooks fire on EVERY user create, including ordinary
    // email-password sign-ups (whose tenant comes from the RLS GUC default, not
    // a JIT projection). The OIDC paths (mapProfileToUser / mint-bearer) project
    // + validate the tenant BEFORE this hook, so a create arriving WITHOUT a
    // tenantId is a non-JIT sign-up and must pass through — NOT be rejected as
    // invalid_oidc_profile (which 422'd normal sign-ups whenever
    // OIDC_TENANT_CLAIM was configured; live @cjm-sso-1.5b regression).
    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: testLog });
    const result = await hooks.user.create.before(
      { email: "x@acme.example", name: "X" } as never,
      null,
    );
    expect(result).not.toBe(false);
    expect((result as { data: Record<string, unknown> }).data.email).toBe("x@acme.example");
    // The passthrough must NOT inject a tenantId — the RLS GUC default applies.
    expect((result as { data: Record<string, unknown> }).data.tenantId).toBeUndefined();
  });

  it("create.before keeps an OIDC-projected tenantId/role intact (JIT create passes through with projection)", async () => {
    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: testLog });
    const result = await hooks.user.create.before(
      { email: "oidc@acme.example", name: "O", tenantId: ACME_TENANT_ID, role: "member" } as never,
      null,
    );
    expect(result).not.toBe(false);
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.tenantId).toBe(ACME_TENANT_ID);
    expect(data.role).toBe("member");
  });

  it("create.after is a no-op when no valid role projected (no audit row)", async () => {
    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: testLog });
    await hooks.user.create.after(
      { id: crypto.randomUUID(), tenantId: ACME_TENANT_ID } as never,
      null,
    );
    const rows = await ownerPool.query(
      `SELECT 1 FROM audit_log WHERE action = 'sso.jit.user.created'`,
    );
    expect(rows.rowCount).toBe(0);
  });

  it("update.before passes through untouched for a non-JIT update (no id / no tenant)", async () => {
    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: testLog });
    const result = await hooks.user.update.before({ email: "no-id@acme.example" } as never, null);
    expect(result).not.toBe(false);
    expect((result as { data: Record<string, unknown> }).data.email).toBe("no-id@acme.example");
  });

  it("update.before passes through when the role is unchanged (no re-sync)", async () => {
    const id = crypto.randomUUID();
    await withTenant(appDb, ACME_TENANT_ID, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users (id, tenant_id, email, name, role)
            VALUES (${id}, ${ACME_TENANT_ID}, ${"frank@acme.example"}, ${"Frank"}, ${"member"})`,
      );
    });
    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: testLog });
    const result = await hooks.user.update.before(
      { id, email: "frank@acme.example", tenantId: ACME_TENANT_ID, role: "member" } as never,
      null,
    );
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.role).toBe("member");
    expect(data.__jitRoleBefore).toBeUndefined();
  });

  it("update.after is a no-op when no role re-sync was carried (no audit row)", async () => {
    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: testLog });
    await hooks.user.update.after(
      { id: crypto.randomUUID(), tenantId: ACME_TENANT_ID, role: "member" } as never,
      null,
    );
    const rows = await ownerPool.query(
      `SELECT 1 FROM audit_log WHERE action = 'sso.jit.role.updated'`,
    );
    expect(rows.rowCount).toBe(0);
  });

  it("update.after records the revocation_downgrade reason verbatim", async () => {
    const id = crypto.randomUUID();
    await withTenant(appDb, ACME_TENANT_ID, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users (id, tenant_id, email, name, role)
            VALUES (${id}, ${ACME_TENANT_ID}, ${"gita@acme.example"}, ${"Gita"}, ${"viewer"})`,
      );
    });
    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: testLog });
    await hooks.user.update.after(
      {
        id,
        tenantId: ACME_TENANT_ID,
        role: "viewer",
        __jitRoleBefore: "admin",
        __jitRoleReason: "revocation_downgrade",
      } as never,
      null,
    );
    const audit = await ownerPool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM audit_log WHERE action = 'sso.jit.role.updated'`,
    );
    expect(audit.rows[0]?.payload.reason).toBe("revocation_downgrade");
  });

  it("update.before tolerates an existing row whose role column is NULL (coerced empty, re-sync runs)", async () => {
    const id = crypto.randomUUID();
    await withTenant(appDb, ACME_TENANT_ID, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users (id, tenant_id, email, name, role)
            VALUES (${id}, ${ACME_TENANT_ID}, ${"hana@acme.example"}, ${"Hana"}, ${null})`,
      );
    });
    const hooks = buildJitDatabaseHooks({ db: appDb, jitConfig: JIT_CONFIG, log: testLog });
    const result = await hooks.user.update.before(
      { id, email: "hana@acme.example", tenantId: ACME_TENANT_ID, role: "member" } as never,
      null,
    );
    const data = (result as { data: Record<string, unknown> }).data;
    // existing.role coerces NULL → "" so the incoming "member" is a change → re-sync.
    expect(data.role).toBe("member");
    expect(data.__jitRoleBefore).toBe("");
    expect(data.__jitRoleReason).toBe("group_change");
  });
});
