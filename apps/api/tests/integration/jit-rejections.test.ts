// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-03 / Task 2 — JIT rejection HTTP mapping + sso.jit.rejected
// audit emission (real Postgres testcontainers, NO internal mocks).
//
// Two surfaces under test:
//
//   (1) HTTP mapping — the centralized error-handler maps a thrown
//       JitRejectionError to the canonical {error:<code>} envelope:
//         forbidden_missing_tenant_claim / forbidden_unknown_tenant /
//         forbidden_no_role_mapping / forbidden_tenant_mismatch → 403
//         invalid_oidc_profile → 400
//       Driven through a real Fastify instance via app.inject() so the
//       global setErrorHandler is exercised end-to-end.
//
//   (2) Audit emission — driving each of the 5 rejection codes through
//       makeMapProfileToUser (the web seam) writes EXACTLY ONE
//       sso.jit.rejected audit_log row with tenant_id=DEFAULT_TENANT_ID,
//       actor_user_id IS NULL, the matching code, and NO PII. A successful
//       projection writes NO rejection row. Asserted at the storage layer
//       via a BYPASSRLS owner SELECT.
//
// SSO-IMPL-04. D-69-2 (no-PII payloads), Pitfall 5 (rejected → default tenant).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { registerErrorHandler } from "../../src/error-handler.js";
import type { JitConfig } from "../../src/lib/oidc-jit-config.js";
import { JitRejectionError, makeMapProfileToUser } from "../../src/lib/oidc-jit-hooks.js";
import type { RejectionCode } from "../../src/lib/oidc-jit-resolver.js";

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

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const ACME_TENANT_ID = "11111111-1111-1111-1111-111111111111";

const JIT_CONFIG: JitConfig = {
  tenantClaim: "tenant",
  tenantMapping: { acme: ACME_TENANT_ID },
  groupClaim: "groups",
  roleMapping: { "openwhispr-engineering": "member" },
  rolePriority: ["admin", "member", "viewer"],
  defaultRole: null,
  revocationMode: "downgrade_to_default",
};

// The 5 rejection codes × the claim profile that triggers each.
const REJECTION_CASES: Array<{ code: RejectionCode; profile: Record<string, unknown> }> = [
  // No tenant claim at all.
  { code: "forbidden_missing_tenant_claim", profile: { groups: ["openwhispr-engineering"] } },
  // Tenant claim present but not in the mapping.
  {
    code: "forbidden_unknown_tenant",
    profile: { tenant: "globex", groups: ["openwhispr-engineering"] },
  },
  // No group matches AND defaultRole is null.
  { code: "forbidden_no_role_mapping", profile: { tenant: "acme", groups: ["unmapped-group"] } },
  // Structurally broken profile (tenant claim is not a string).
  { code: "invalid_oidc_profile", profile: { tenant: 12345, groups: ["openwhispr-engineering"] } },
];

let container: StartedPostgreSqlContainer;
let ownerPool: Pool;
let appPool: Pool;
// noExplicitAny is disabled for test files (biome.json override); appDb holds
// the structural Drizzle node-postgres client passed to the JIT seams.
let appDb: any;

const warnings: Array<Record<string, unknown>> = [];
const testLog = {
  info: (_obj: unknown) => {
    /* not asserted here */
  },
  warn: (obj: unknown) => {
    if (obj && typeof obj === "object") warnings.push(obj as Record<string, unknown>);
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

  // Seed the acme tenant so the unknown-tenant case is the ONLY tenant miss
  // (the default tenant is already seeded by 0000_initial).
  await ownerPool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, 'acme') ON CONFLICT (id) DO NOTHING`,
    [ACME_TENANT_ID],
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
  warnings.length = 0;
  await ownerPool.query(`DELETE FROM audit_log`);
});

describe("SSO-IMPL-04 — JitRejectionError → HTTP status (canonical envelope)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    app.get<{ Querystring: { code: string } }>("/throw-jit", async (req) => {
      throw new JitRejectionError(req.query.code as RejectionCode);
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ["forbidden_missing_tenant_claim", 403],
    ["forbidden_unknown_tenant", 403],
    ["forbidden_no_role_mapping", 403],
    ["forbidden_tenant_mismatch", 403],
    ["invalid_oidc_profile", 400],
  ] as const)("%s → HTTP %i with the code in the envelope", async (code, status) => {
    const res = await app.inject({ method: "GET", url: `/throw-jit?code=${code}` });
    expect(res.statusCode).toBe(status);
    const body = JSON.parse(res.body);
    // Canonical wire shape is {error:<string>}; the rejection code is the
    // message (non-PII, stable). Strict-parse to pin the shape.
    expect(() => ErrorEnvelope.parse(body)).not.toThrow();
    expect(body.error).toBe(code);
  });
});

describe("SSO-IMPL-04 — sso.jit.rejected audit emission (real Postgres)", () => {
  it.each(
    REJECTION_CASES,
  )("$code emits exactly one no-PII sso.jit.rejected row (default tenant, null actor)", async ({
    code,
    profile,
  }) => {
    const mapProfile = makeMapProfileToUser(JIT_CONFIG, { db: appDb, log: testLog });
    await expect(mapProfile(profile)).rejects.toMatchObject({ code });

    const rows = await ownerPool.query<{
      actor_user_id: string | null;
      tenant_id: string;
      payload: Record<string, unknown>;
    }>(`SELECT actor_user_id, tenant_id, payload FROM audit_log WHERE action = 'sso.jit.rejected'`);
    expect(rows.rowCount).toBe(1);
    const row = rows.rows[0];
    expect(row?.actor_user_id).toBeNull();
    expect(row?.tenant_id).toBe(DEFAULT_TENANT_ID);
    const payload = row?.payload ?? {};
    expect(payload.tenant_id).toBe(DEFAULT_TENANT_ID);
    expect(payload.code).toBe(code);
    // NO PII in the payload.
    expect(payload.email).toBeUndefined();
    expect(payload.sub).toBeUndefined();
    expect(payload.groups).toBeUndefined();

    // Structured-log line carries event + code, NO PII.
    const logged = warnings.find((w) => w.event === "sso.jit.rejected");
    expect(logged).toBeDefined();
    expect(logged?.code).toBe(code);
    expect(logged?.email).toBeUndefined();
    expect(logged?.sub).toBeUndefined();
  });

  it("rejection still throws (best-effort audit) when the audit INSERT fails on a dead pool", async () => {
    // Real infra failure (NO mock): a freshly-opened app pool is ended before
    // the rejection, so the emitRejected audit INSERT hits a real "pool ended"
    // error. The rejection MUST still propagate (the audit is best-effort) and
    // the failure is logged via sso.jit.rejected.audit_emit_failed.
    const host = container.getHost();
    const port = container.getMappedPort(5432);
    const deadPool = new Pool({
      connectionString: `postgres://openwhispr_app:app-pw@${host}:${port}/openwhispr`,
    });
    const deadDb = drizzle(deadPool);
    await deadPool.end();

    const mapProfile = makeMapProfileToUser(JIT_CONFIG, { db: deadDb, log: testLog });
    await expect(mapProfile({ groups: ["openwhispr-engineering"] })).rejects.toBeInstanceOf(
      JitRejectionError,
    );

    const failLog = warnings.find((w) => w.event === "sso.jit.rejected.audit_emit_failed");
    expect(failLog).toBeDefined();
    // No row landed (the INSERT failed) — proves the catch fired, not a silent skip.
    const rows = await ownerPool.query(`SELECT 1 FROM audit_log WHERE action = 'sso.jit.rejected'`);
    expect(rows.rowCount).toBe(0);
  });

  it("a successful projection writes NO sso.jit.rejected row", async () => {
    const mapProfile = makeMapProfileToUser(JIT_CONFIG, { db: appDb, log: testLog });
    const projected = await mapProfile({
      tenant: "acme",
      groups: ["openwhispr-engineering"],
      email: "alice@acme.example",
    });
    expect(projected).toEqual({ tenantId: ACME_TENANT_ID, role: "member" });

    const rows = await ownerPool.query(`SELECT 1 FROM audit_log WHERE action = 'sso.jit.rejected'`);
    expect(rows.rowCount).toBe(0);
  });
});
