// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 / Plan 05 / Task 1 — recordAudit helper tests.
//
// The helper writes one row to `audit_log` synchronously inside the
// caller-supplied tx (D-A1 — sync in-band INSERT). It enforces:
//   - the 18-action D-A6 const-union at compile time (TypeScript) and
//     at runtime (the Postgres CHECK constraint added in Plan 02).
//   - the per-action Zod payload schema (D-A7 conventions).
//   - the always-required base ctx fields (request_id, ip, user_agent).
//   - the forbidden-keys rejection list (D-A7 + threat T-bearer-leak)
//     so a programmer mistake cannot leak secrets into JSONB.
//   - AUDIT_REDACT_IP=true clamps payload.ip to null.
//   - user_agent is truncated to 512 chars.
//
// Real Postgres testcontainer per CLAUDE.md — RLS + CHECK must observably
// hold. No mocks of internal logic.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withTenant } from "@openwhispr/data";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AUDIT_ACTIONS,
  type AuditCtx,
  AuditCyrillicError,
  auditCtxFromRequest,
  auditPayloadSchemas,
  FORBIDDEN_AUDIT_KEYS,
  recordAudit,
} from "../../../src/lib/audit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/tests/unit/lib -> packages/data/migrations (5 levels up to repo root)
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
const PARTMAN_IMAGE = "ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1";

let container: StartedPostgreSqlContainer;

let pool: Pool;
let ownerPoolRead: Pool;
let db: NodePgDatabase;
let tenantA: string;
const TENANT_A_UUID = "11111111-1111-4111-8111-111111111111";
const USER_A_UUID = "22222222-2222-4222-8222-222222222222";
const REQ_ID = "33333333-3333-4333-8333-333333333333";

const baseCtx = (): AuditCtx => ({
  tenant_id: tenantA,
  actor_user_id: USER_A_UUID,
  request_id: REQ_ID,
  ip: "10.0.0.1",
  user_agent: "openwhispr-desktop/1.0",
});

async function countRows(action: string): Promise<number> {
  // Read via owner pool (BYPASSRLS) — the writer is openwhispr_app
  // under app.tenant_id GUC, but reads in tests do not open a
  // withTenant tx, so we bypass RLS for the verification.
  const r = await ownerPoolRead.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM audit_log WHERE action = $1`,
    [action],
  );
  return Number(r.rows[0]?.c ?? "0");
}

async function getPayload(action: string): Promise<Record<string, unknown>> {
  const r = await ownerPoolRead.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM audit_log WHERE action = $1 ORDER BY created_at DESC LIMIT 1`,
    [action],
  );
  return r.rows[0]?.payload ?? {};
}

beforeAll(async () => {
  const ownerPw = "owner-pw-test";
  const appPw = "app-pw-test";
  container = await new PostgreSqlContainer(PARTMAN_IMAGE)
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  // Provision pg_partman (required by migration 0014).
  await superPool.query("CREATE SCHEMA IF NOT EXISTS partman");
  await superPool.query("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerPw}'`,
  );
  await superPool.query(`CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${appPw}'`);
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  // pg_partman grants required by migration 0014.
  await superPool.query(`GRANT ALL ON SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const ownerUri = `postgres://openwhispr_owner:${ownerPw}@${host}:${port}/openwhispr`;
  const appUri = `postgres://openwhispr_app:${appPw}@${host}:${port}/openwhispr`;

  // Apply migrations as owner.
  const ownerPool = new Pool({ connectionString: ownerUri });
  await migrate(drizzle(ownerPool), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  // Seed tenant + user as owner (bypasses RLS).
  await ownerPool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, 'Tenant A') ON CONFLICT (id) DO NOTHING`,
    [TENANT_A_UUID],
  );
  await ownerPool.query(
    `INSERT INTO users (id, tenant_id, email) VALUES ($1, $2, 'a@example.com') ON CONFLICT (id) DO NOTHING`,
    [USER_A_UUID, TENANT_A_UUID],
  );
  await ownerPool.end();
  tenantA = TENANT_A_UUID;

  // app pool (RLS-subject) — what recordAudit will write through.
  pool = new Pool({ connectionString: appUri });
  db = drizzle(pool);
  // owner pool kept open for RLS-bypassing reads in test assertions.
  ownerPoolRead = new Pool({ connectionString: ownerUri });
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await ownerPoolRead?.end();
  await container?.stop();
});

describe("recordAudit — D-A6 action enum (21 actions post D-69-2)", () => {
  it("exports exactly 21 actions (18 D-A6 + 3 D-69-2 sso.jit.*)", () => {
    // D-A6 locked 18 actions (migration 0014). Phase 69 / Plan 69-02
    // (D-69-2, migration 0032) extended the taxonomy to 21 by adding the
    // three SSO just-in-time provisioning actions.
    expect(AUDIT_ACTIONS).toHaveLength(21);
    expect(new Set(AUDIT_ACTIONS).size).toBe(21);
    // Spot-check canonical members.
    expect(AUDIT_ACTIONS).toContain("auth.signin");
    expect(AUDIT_ACTIONS).toContain("security.ssrf_blocked");
    expect(AUDIT_ACTIONS).toContain("account.delete");
    // D-69-2 additions.
    expect(AUDIT_ACTIONS).toContain("sso.jit.user.created");
    expect(AUDIT_ACTIONS).toContain("sso.jit.role.updated");
    expect(AUDIT_ACTIONS).toContain("sso.jit.rejected");
  });

  it("exposes a Zod schema for every action", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(auditPayloadSchemas[action]).toBeDefined();
    }
  });
});

describe("recordAudit — happy-path per action", () => {
  // One INSERT per action; verify the row exists and the payload carries
  // the always-required keys (request_id, ip, user_agent).
  const cases: Array<{ action: (typeof AUDIT_ACTIONS)[number]; payload: Record<string, unknown> }> =
    [
      { action: "auth.signin", payload: { method: "password" } },
      {
        action: "auth.signin_failed",
        payload: { method: "password", reason: "bad_credentials" },
      },
      { action: "auth.signout", payload: {} },
      { action: "auth.password_change", payload: { method: "self" } },
      { action: "auth.oauth_link", payload: { provider: "google" } },
      { action: "account.delete", payload: {} },
      { action: "account.delete_requested", payload: { grace_window_seconds: 86400 } },
      { action: "key.issued", payload: { key_id: "key_abc123" } },
      { action: "key.revoked", payload: { key_id: "key_abc123", reason: "manual" } },
      {
        action: "settings.tenant_changed",
        payload: {
          field: "stt.defaultModel",
          before_hash: "a".repeat(64),
          after_hash: "b".repeat(64),
        },
      },
      {
        action: "settings.user_changed",
        payload: {
          field: "noteRec.diarization",
          before_hash: "c".repeat(64),
          after_hash: "d".repeat(64),
        },
      },
      {
        action: "admin.tenant_created",
        payload: { tenant_id: "44444444-4444-4444-8444-444444444444" },
      },
      {
        action: "admin.tenant_suspended",
        payload: { tenant_id: "44444444-4444-4444-8444-444444444444", reason: "abuse" },
      },
      {
        action: "admin.user_impersonated",
        payload: { target_user_id: "55555555-5555-4555-8555-555555555555", reason: "support" },
      },
      {
        action: "admin.role_changed",
        payload: {
          target_user_id: "55555555-5555-4555-8555-555555555555",
          before: "member",
          after: "admin",
        },
      },
      {
        action: "security.cross_tenant_attempt",
        payload: {
          attempted_tenant_id: "66666666-6666-4666-8666-666666666666",
          route: "/api/notes/list",
        },
      },
      {
        action: "security.rate_limit_exceeded",
        payload: { rule: "per_user_60rpm", route: "/api/notes/create" },
      },
      {
        action: "security.ssrf_blocked",
        payload: { target_url_host: "169.254.169.254", rule: "rfc1918_block" },
      },
    ];

  for (const { action, payload } of cases) {
    it(`writes a row for ${action}`, async () => {
      const before = await countRows(action);
      await withTenant(db, tenantA, async (tx) => {
        await recordAudit(tx, baseCtx(), action, payload as never);
      });
      const after = await countRows(action);
      expect(after).toBe(before + 1);
      const stored = await getPayload(action);
      expect(stored.request_id).toBe(REQ_ID);
      expect(stored.ip).toBe("10.0.0.1");
      expect(stored.user_agent).toBe("openwhispr-desktop/1.0");
    });
  }
});

describe("recordAudit — forbidden-key sweep (T-bearer-leak)", () => {
  it("exposes the forbidden-keys list verbatim", () => {
    expect(FORBIDDEN_AUDIT_KEYS).toEqual(
      expect.arrayContaining([
        "password",
        "token",
        "bearer",
        "access_token",
        "refresh_token",
        "code",
        "state",
        "virtual_key",
        "api_key",
        "authorization",
      ]),
    );
  });

  for (const forbidden of [
    "password",
    "token",
    "bearer",
    "access_token",
    "refresh_token",
    "code",
    "state",
    "virtual_key",
    "api_key",
    "authorization",
  ]) {
    it(`rejects payload containing ${forbidden}`, async () => {
      await expect(
        withTenant(db, tenantA, async (tx) => {
          // Cast through unknown: the type system bars these keys, but
          // the runtime guard is what we're proving.
          await recordAudit(tx, baseCtx(), "auth.signin", {
            method: "password",
            [forbidden]: "sentinel-secret",
          } as never);
        }),
      ).rejects.toThrow(/forbidden/i);
    });
  }

  it("rejects forbidden keys case-insensitively (Authorization)", async () => {
    await expect(
      withTenant(db, tenantA, async (tx) => {
        await recordAudit(tx, baseCtx(), "auth.signin", {
          method: "password",
          Authorization: "Bearer xyz",
        } as never);
      }),
    ).rejects.toThrow(/forbidden/i);
  });
});

describe("recordAudit — IP redaction + UA truncation", () => {
  it("nulls payload.ip when AUDIT_REDACT_IP=true", async () => {
    const prev = process.env.AUDIT_REDACT_IP;
    process.env.AUDIT_REDACT_IP = "true";
    try {
      await withTenant(db, tenantA, async (tx) => {
        await recordAudit(tx, baseCtx(), "auth.signout", {});
      });
      const stored = await getPayload("auth.signout");
      expect(stored.ip).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.AUDIT_REDACT_IP;
      else process.env.AUDIT_REDACT_IP = prev;
    }
  });

  it("truncates user_agent to 512 chars", async () => {
    const longUa = "x".repeat(1000);
    await withTenant(db, tenantA, async (tx) => {
      await recordAudit(tx, { ...baseCtx(), user_agent: longUa }, "auth.signout", {});
    });
    const stored = await getPayload("auth.signout");
    expect((stored.user_agent as string).length).toBe(512);
  });
});

describe("recordAudit — Cyrillic guard (Phase 10-01d / T-10-01 mitigation)", () => {
  // Constitutional rule: audit_log payload values MUST stay English-only.
  // The Cyrillic guard fails LOUD on any Cyrillic codepoint in payload
  // values (programmer-error, not user-facing). No log, no INSERT.
  //
  // NOTE: this test FILE stays English-only — Cyrillic test fixtures are
  // constructed via \u escapes so tools/lint-english.ts does not flag the
  // source. The escapes below decode to short Russian phrases.
  // Cyrillic fixtures constructed via String.fromCharCode so this file
  // stays ASCII-clean for tools/lint-english.ts. Codepoints are within
  // the Cyrillic block U+0400..U+04FF that the runtime guard scans for.
  const CYR_PHRASE = String.fromCharCode(
    0x043d,
    0x0430,
    0x0440,
    0x0443,
    0x0448,
    0x0435,
    0x043d,
    0x0438,
    0x0435,
  ); // narushenie
  const CYR_GREETING = String.fromCharCode(0x041f, 0x0440, 0x0438, 0x0432, 0x0435, 0x0442); // Privet
  const CYR_UA = `${String.fromCharCode(
    0x0431,
    0x0440,
    0x0430,
    0x0443,
    0x0437,
    0x0435,
    0x0440,
  )}/1.0`; // brauzer/1.0

  it("AuditCyrillicError is an Error subclass with stable name", () => {
    const e = new AuditCyrillicError("test");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("AuditCyrillicError");
  });

  it("accepts pure-English payload (INSERT succeeds)", async () => {
    const before = await countRows("admin.tenant_suspended");
    await withTenant(db, tenantA, async (tx) => {
      await recordAudit(tx, baseCtx(), "admin.tenant_suspended", {
        tenant_id: "77777777-7777-4777-8777-777777777777",
        reason: "abuse policy violation",
      });
    });
    const after = await countRows("admin.tenant_suspended");
    expect(after).toBe(before + 1);
  });

  it("rejects payload with Cyrillic value (top-level)", async () => {
    await expect(
      withTenant(db, tenantA, async (tx) => {
        await recordAudit(tx, baseCtx(), "admin.tenant_suspended", {
          tenant_id: "77777777-7777-4777-8777-777777777777",
          reason: CYR_PHRASE,
        });
      }),
    ).rejects.toBeInstanceOf(AuditCyrillicError);
  });

  it("rejects payload with Cyrillic value in nested object", async () => {
    // Nested-object path: a programmer accidentally serializing a
    // localized string into a deep JSONB tree must also fail loud.
    await expect(
      withTenant(db, tenantA, async (tx) => {
        await recordAudit(tx, baseCtx(), "auth.oauth_link", {
          // Cast through unknown — schema would strip unknown nested keys
          // BUT the guard runs on the raw caller input before schema parse.
          provider: "google",
          nested: { deep: { value: CYR_GREETING } },
        } as never);
      }),
    ).rejects.toBeInstanceOf(AuditCyrillicError);
  });

  it("rejects payload with Cyrillic value in ctx user_agent", async () => {
    // ctx fields are payload-adjacent (merged into the JSONB row), so
    // the guard sweeps them too — a Cyrillic UA from a misbehaving
    // client header is a programmer-error if it reaches recordAudit.
    await expect(
      withTenant(db, tenantA, async (tx) => {
        await recordAudit(tx, { ...baseCtx(), user_agent: CYR_UA }, "auth.signout", {});
      }),
    ).rejects.toBeInstanceOf(AuditCyrillicError);
  });

  it("accepts numeric and boolean values without scanning them", async () => {
    // Guard only scans string values; numbers/booleans pass through.
    await withTenant(db, tenantA, async (tx) => {
      await recordAudit(tx, baseCtx(), "account.delete_requested", {
        grace_window_seconds: 86400,
      });
    });
    // No throw => success.
    expect(true).toBe(true);
  });

  it("throws BEFORE the DB INSERT (no row written on Cyrillic hit)", async () => {
    const before = await countRows("admin.tenant_suspended");
    try {
      await withTenant(db, tenantA, async (tx) => {
        await recordAudit(tx, baseCtx(), "admin.tenant_suspended", {
          tenant_id: "77777777-7777-4777-8777-777777777777",
          reason: CYR_PHRASE,
        });
      });
    } catch {
      // expected
    }
    const after = await countRows("admin.tenant_suspended");
    expect(after).toBe(before);
  });
});

describe("auditCtxFromRequest", () => {
  it("extracts ctx fields from a request-like shape", () => {
    const ctx = auditCtxFromRequest(
      {
        id: REQ_ID,
        ip: "10.1.2.3",
        headers: { "user-agent": "ua/1.0" },
      },
      TENANT_A_UUID,
      USER_A_UUID,
    );
    expect(ctx).toEqual({
      tenant_id: TENANT_A_UUID,
      actor_user_id: USER_A_UUID,
      request_id: REQ_ID,
      ip: "10.1.2.3",
      user_agent: "ua/1.0",
    });
  });

  it("substitutes 'unknown' when user-agent header missing", () => {
    const ctx = auditCtxFromRequest(
      { id: REQ_ID, ip: "10.1.2.3", headers: {} },
      TENANT_A_UUID,
      null,
    );
    expect(ctx.user_agent).toBe("unknown");
    expect(ctx.actor_user_id).toBeNull();
  });

  it("nulls ip when req.ip is undefined (proxy edge case)", () => {
    const ctx = auditCtxFromRequest(
      {
        id: REQ_ID,
        ip: undefined as unknown as string,
        headers: { "user-agent": "u" },
      },
      TENANT_A_UUID,
      null,
    );
    // Fastify types req.ip as string, but behind a misconfigured proxy
    // it can be undefined at runtime. The `?? null` defensive branch
    // catches that and emits a null-ip audit row rather than a Zod
    // failure on ctxSchema.parse.
    expect(ctx.ip).toBeNull();
  });
});

describe("recordAudit — actor_user_id null path", () => {
  it("writes a row with actor_user_id=null (unauth signin_failed)", async () => {
    const before = await (async () => {
      const r = await ownerPoolRead.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM audit_log WHERE action = 'auth.signin_failed' AND actor_user_id IS NULL`,
      );
      return Number(r.rows[0]?.c ?? "0");
    })();
    await withTenant(db, tenantA, async (tx) => {
      await recordAudit(tx, { ...baseCtx(), actor_user_id: null }, "auth.signin_failed", {
        method: "password",
        reason: "bad_credentials",
      });
    });
    const after = await (async () => {
      const r = await ownerPoolRead.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM audit_log WHERE action = 'auth.signin_failed' AND actor_user_id IS NULL`,
      );
      return Number(r.rows[0]?.c ?? "0");
    })();
    expect(after).toBe(before + 1);
  });
});

describe("recordAudit — schema enforcement", () => {
  it("rejects payload missing required key (key.issued without key_id)", async () => {
    await expect(
      withTenant(db, tenantA, async (tx) => {
        await recordAudit(tx, baseCtx(), "key.issued", {} as never);
      }),
    ).rejects.toThrow();
  });

  it("rejects ctx with non-UUID tenant_id", async () => {
    await expect(
      withTenant(db, tenantA, async (tx) => {
        await recordAudit(tx, { ...baseCtx(), tenant_id: "not-a-uuid" }, "auth.signout", {});
      }),
    ).rejects.toThrow();
  });

  it("accepts null ip in ctx (operator-disabled-IP path)", async () => {
    await withTenant(db, tenantA, async (tx) => {
      await recordAudit(tx, { ...baseCtx(), ip: null }, "auth.signout", {});
    });
    const stored = await getPayload("auth.signout");
    expect(stored.ip).toBeNull();
  });
});
