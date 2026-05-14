// SPDX-License-Identifier: Apache-2.0
// Phase 5 / Plan 01 — settings-table introspection test.
//
// Boots a real Postgres 17 + PgBouncer 1.23 testcontainer, applies the
// full migration chain (0000..0010), then asserts via pg_class /
// pg_policies / information_schema introspection that:
//
//   * tenant_settings + user_settings both have relrowsecurity = TRUE and
//     relforcerowsecurity = TRUE.
//   * Each new Phase-5 table has at least one isolation policy whose
//     USING qual references current_setting('app.tenant_id'.
//   * The seed_tenant_settings trigger on tenants is AFTER, not BEFORE
//     (Pitfall #8).
//   * Inserting a fresh tenant via owner DB auto-populates a row in
//     tenant_settings (trigger fired).
//
// Per CLAUDE.md "no mocks of internal logic": real Postgres, real
// trigger firing path, real policy quals.
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionPgPartman } from "../../../src/__tests__/helpers.js";
import * as schema from "../../../src/schema/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, "..", "..", "migrations");

function migrationsReady(): boolean {
  if (!existsSync(MIGRATIONS_FOLDER)) return false;
  try {
    return readdirSync(MIGRATIONS_FOLDER).some((f) => f.endsWith(".sql"));
  } catch {
    return false;
  }
}

const READY = migrationsReady();
const SUITE = READY ? describe : describe.skip;

const NEW_TENANT_TABLES = [
  "tenant_settings",
  "user_settings",
  "notes",
  "folders",
  "conversations",
  "messages",
  "transcriptions",
  "api_keys",
] as const;

interface Harness {
  pg: StartedPostgreSqlContainer;
  ownerUri: string;
  stop: () => Promise<void>;
}

async function bootHarness(): Promise<Harness> {
  // Phase 6 / Plan 02 — migration 0014 requires pg_partman.
  const pg = await new PostgreSqlContainer("openwhispr/postgres:17.5-pgpartman")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: pg.getConnectionUri() });
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD 'owner-pw'`,
  );
  await superPool.query(`CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD 'app-pw'`);
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await provisionPgPartman(superPool);
  await superPool.end();

  const ownerUri = `postgres://openwhispr_owner:owner-pw@${pg.getHost()}:${pg.getMappedPort(5432)}/openwhispr`;
  const ownerPool = new Pool({ connectionString: ownerUri });
  const ownerDb = drizzle(ownerPool, { schema });
  await migrate(ownerDb, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  await ownerPool.end();

  return {
    pg,
    ownerUri,
    stop: async () => {
      await pg.stop();
    },
  };
}

const TIMEOUT = 180_000;

SUITE("Phase 5 / Plan 01 — settings + new-table RLS introspection", () => {
  let harness: Harness | undefined;

  beforeAll(async () => {
    if (!READY) return;
    harness = await bootHarness();
  }, TIMEOUT);

  afterAll(async () => {
    if (harness) await harness.stop();
  }, 60_000);

  it(
    "every new Phase-5 table has relrowsecurity = TRUE and relforcerowsecurity = TRUE",
    async () => {
      if (!harness) throw new Error("harness not booted");
      const pool = new Pool({ connectionString: harness.ownerUri });
      try {
        const res = await pool.query<{
          relname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
        }>(
          `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
          [Array.from(NEW_TENANT_TABLES)],
        );
        const seen = new Map(res.rows.map((r) => [r.relname, r]));
        for (const t of NEW_TENANT_TABLES) {
          const row = seen.get(t);
          expect(row, `table ${t} should exist after migrations`).toBeDefined();
          expect(row?.relrowsecurity, `${t} ENABLE RLS`).toBe(true);
          expect(row?.relforcerowsecurity, `${t} FORCE RLS`).toBe(true);
        }
      } finally {
        await pool.end();
      }
    },
    TIMEOUT,
  );

  it(
    "every new Phase-5 table has an isolation policy referencing current_setting('app.tenant_id'",
    async () => {
      if (!harness) throw new Error("harness not booted");
      const pool = new Pool({ connectionString: harness.ownerUri });
      try {
        const res = await pool.query<{
          tablename: string;
          qual: string | null;
          with_check: string | null;
        }>(
          `SELECT tablename, qual, with_check
           FROM pg_policies
          WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
          [Array.from(NEW_TENANT_TABLES)],
        );
        const grouped = new Map<string, typeof res.rows>();
        for (const row of res.rows) {
          const list = grouped.get(row.tablename) ?? [];
          list.push(row);
          grouped.set(row.tablename, list);
        }
        for (const t of NEW_TENANT_TABLES) {
          const policies = grouped.get(t) ?? [];
          expect(policies.length, `${t} should have ≥1 policy`).toBeGreaterThan(0);
          const matchesGuc = policies.some(
            (p) =>
              (p.qual ?? "").includes("current_setting('app.tenant_id'") ||
              (p.with_check ?? "").includes("current_setting('app.tenant_id'"),
          );
          expect(matchesGuc, `${t} policy must reference app.tenant_id GUC`).toBe(true);
        }
      } finally {
        await pool.end();
      }
    },
    TIMEOUT,
  );

  it(
    "seed_tenant_settings trigger on tenants is AFTER INSERT (Pitfall #8)",
    async () => {
      if (!harness) throw new Error("harness not booted");
      const pool = new Pool({ connectionString: harness.ownerUri });
      try {
        const res = await pool.query<{ action_timing: string; event_manipulation: string }>(
          `SELECT action_timing, event_manipulation
           FROM information_schema.triggers
          WHERE event_object_table = 'tenants'
            AND trigger_name = 'tenants_seed_settings'`,
        );
        expect(res.rows.length).toBeGreaterThan(0);
        expect(res.rows[0]?.action_timing).toBe("AFTER");
        expect(res.rows[0]?.event_manipulation).toBe("INSERT");
      } finally {
        await pool.end();
      }
    },
    TIMEOUT,
  );

  it(
    "inserting a new tenant auto-seeds tenant_settings (trigger fires)",
    async () => {
      if (!harness) throw new Error("harness not booted");
      const pool = new Pool({ connectionString: harness.ownerUri });
      try {
        const newTenant = "00000000-0000-0000-0000-00000000abcd";
        await pool.query(
          `INSERT INTO tenants (id, name) VALUES ($1, 'trigger-test') ON CONFLICT DO NOTHING`,
          [newTenant],
        );
        const res = await pool.query<{ tenant_id: string }>(
          `SELECT tenant_id::text AS tenant_id FROM tenant_settings WHERE tenant_id = $1`,
          [newTenant],
        );
        expect(res.rowCount).toBe(1);
        expect(res.rows[0]?.tenant_id).toBe(newTenant);
      } finally {
        await pool.end();
      }
    },
    TIMEOUT,
  );

  it(
    "notes.content_search expression references only own-row immutable columns (Pitfall #1)",
    async () => {
      if (!harness) throw new Error("harness not booted");
      const pool = new Pool({ connectionString: harness.ownerUri });
      try {
        const res = await pool.query<{ generation_expression: string }>(
          `SELECT generation_expression
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'notes'
            AND column_name = 'content_search'`,
        );
        const expr = res.rows[0]?.generation_expression ?? "";
        // Must NOT reference now() or current_setting (would mutate per
        // request and invalidate the index).
        expect(expr.toLowerCase()).not.toContain("now(");
        expect(expr.toLowerCase()).not.toContain("current_setting");
        // Must reference both title + content for the GENERATED expression
        // (catches accidental drift from the canonical setweight() shape).
        expect(expr.toLowerCase()).toContain("title");
        expect(expr.toLowerCase()).toContain("content");
      } finally {
        await pool.end();
      }
    },
    TIMEOUT,
  );

  it(
    "notes content_search has a GIN index",
    async () => {
      if (!harness) throw new Error("harness not booted");
      const pool = new Pool({ connectionString: harness.ownerUri });
      try {
        const res = await pool.query<{ indexdef: string }>(
          `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'notes'`,
        );
        const hasGinOnSearch = res.rows.some(
          (r) => /USING gin/i.test(r.indexdef) && /content_search/i.test(r.indexdef),
        );
        expect(hasGinOnSearch).toBe(true);
      } finally {
        await pool.end();
      }
    },
    TIMEOUT,
  );

  it(
    "notes has partial UNIQUE on (tenant_id, user_id, client_note_id) WHERE NOT NULL",
    async () => {
      if (!harness) throw new Error("harness not booted");
      const pool = new Pool({ connectionString: harness.ownerUri });
      try {
        const res = await pool.query<{ indexdef: string }>(
          `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='notes' AND indexname='notes_client_id_idx'`,
        );
        expect(res.rowCount).toBe(1);
        const def = res.rows[0]?.indexdef ?? "";
        expect(def).toMatch(/UNIQUE/i);
        expect(def).toMatch(/client_note_id IS NOT NULL/i);
      } finally {
        await pool.end();
      }
    },
    TIMEOUT,
  );
});

if (!READY) {
  // biome-ignore lint/suspicious/noConsole: deliberate skip notice
  console.warn("[settings-rls] migrations not present yet — skipping.");
}
