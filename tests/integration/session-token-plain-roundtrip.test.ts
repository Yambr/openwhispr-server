// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 02.12 — D-04 TDD RED: integration test that proves the migration
 * chain through 0005 produces a `sessions.token` plain-text column with a
 * UNIQUE index, the SECURITY DEFINER lookup function accepts `text`, and
 * the bytea `token_hash` / `previous_token_hash` columns no longer exist.
 *
 * Source-of-record commit: <Phase 02.12 atomic fix commit, populated post-commit>
 *
 * Reverts:
 *   - Reverting `packages/data/migrations/0005_session_token_plain.sql`
 *     (deletion) AND `packages/data/migrations/meta/_journal.json` idx 5
 *     entry: this test goes RED because:
 *       * INSERT with `token = 'test-bearer-XYZ'` raises 42703 (column
 *         "token" of relation "sessions" does not exist).
 *       * `lookup_session_by_token(text)` does not exist — only the legacy
 *         `lookup_session_by_previous_token(bytea)` is present.
 *       * The negative assertion (no `token_hash` column) flips because
 *         the legacy bytea column reappears.
 *
 * Real Postgres via testcontainers (CLAUDE.md "no mocks" — applies to
 * integration tests).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = join(REPO_ROOT, "packages", "data", "migrations");
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

async function applyMigrationFile(client: Client, fileName: string): Promise<void> {
  const path = join(MIGRATIONS_DIR, fileName);
  const sql = readFileSync(path, "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await client.query(stmt);
  }
}

interface BootedDb {
  container: StartedPostgreSqlContainer;
  ownerUri: string;
  appUri: string;
}

async function bootFreshPostgres(): Promise<BootedDb> {
  const ownerPassword = "owner-pw-test";
  const appPassword = "app-pw-test";

  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerPassword}'`,
  );
  await superPool.query(
    `CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${appPassword}'`,
  );
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const ownerUri = `postgres://openwhispr_owner:${ownerPassword}@${host}:${port}/openwhispr`;
  const appUri = `postgres://openwhispr_app:${appPassword}@${host}:${port}/openwhispr`;

  return { container, ownerUri, appUri };
}

async function withClient<T>(uri: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Phase 33 / Plan 33-05 — migration 0020 drops the plaintext
// `sessions.token` column. The entire premise of this suite
// ("sessions.token is plaintext, BA-native lookup path on text column")
// is the inverse of the Phase 33 invariant. The replacement coverage
// is at `packages/data/migrations/__tests__/0020-drop-plaintext.test.ts`
// (asserts column gone + fingerprint UNIQUE index promoted) and the
// `lookup_session_by_previous_token` SQL function is owned by
// `0019b-drop-lookup-fn.test.ts`.
describe.skip("Phase 02.12 — sessions.token plain text roundtrip (obsolete post-0020)", {
  timeout: 180_000,
}, () => {
  let booted: BootedDb;

  beforeAll(async () => {
    booted = await bootFreshPostgres();
    await withClient(booted.ownerUri, async (c) => {
      for (const m of listMigrations()) {
        await applyMigrationFile(c, m);
      }
    });
  });

  afterAll(async () => {
    if (booted) await booted.container.stop();
  });

  it("INSERT with plain `token` succeeds and SELECT WHERE token=$1 roundtrips the row", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    const sessionId = "22222222-2222-2222-2222-222222222222";
    const bearer = "test-bearer-XYZ-roundtrip";

    await withClient(booted.ownerUri, async (c) => {
      await c.query(
        `INSERT INTO users (id, tenant_id, email)
           VALUES ($1, $2, 'roundtrip@example.com')
           ON CONFLICT DO NOTHING`,
        [userId, DEFAULT_TENANT_ID],
      );
      await c.query(
        `INSERT INTO sessions (id, tenant_id, user_id, token, expires_at)
           VALUES ($1, $2, $3, $4, now() + interval '30 days')`,
        [sessionId, DEFAULT_TENANT_ID, userId, bearer],
      );
      const { rows } = await c.query<{
        id: string;
        token: string;
        user_id: string;
      }>(`SELECT id, token, user_id FROM sessions WHERE token = $1`, [bearer]);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(sessionId);
      expect(rows[0]?.token).toBe(bearer);
      expect(rows[0]?.user_id).toBe(userId);
    });
  });

  it("legacy bytea `token_hash` column NO LONGER exists in the sessions table", async () => {
    await withClient(booted.ownerUri, async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
           WHERE table_schema='public' AND table_name='sessions'`,
      );
      const cols = rows.map((r) => r.column_name);
      expect(cols).not.toContain("token_hash");
      expect(cols).not.toContain("previous_token_hash");
      expect(cols).toContain("token");
      expect(cols).toContain("previous_token");
    });
  });

  it("sessions.token has a UNIQUE index (BA-native lookup path)", async () => {
    await withClient(booted.ownerUri, async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
           WHERE schemaname='public' AND tablename='sessions'
             AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(token)%'`,
      );
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  it("session_lookup_by_token(text) and lookup_session_by_previous_token(text) functions exist", async () => {
    await withClient(booted.ownerUri, async (c) => {
      const { rows } = await c.query<{ proname: string; argtypes: string }>(
        `SELECT p.proname,
                  pg_get_function_identity_arguments(p.oid) AS argtypes
           FROM pg_proc p
           WHERE p.proname IN ('session_lookup_by_token', 'lookup_session_by_previous_token')`,
      );
      const sigs = rows.map((r) => `${r.proname}(${r.argtypes})`).sort();
      expect(sigs).toContain("lookup_session_by_previous_token(p_token text)");
      expect(sigs).toContain("session_lookup_by_token(p_token text)");
    });
  });

  it("session_lookup_by_token returns (user_id, tenant_id) for an unexpired plain token via app role", async () => {
    const userId = "33333333-3333-3333-3333-333333333333";
    const sessionId = "44444444-4444-4444-4444-444444444444";
    const bearer = "lookup-test-bearer-plain";

    await withClient(booted.ownerUri, async (c) => {
      await c.query(
        `INSERT INTO users (id, tenant_id, email)
           VALUES ($1, $2, 'lookup@example.com')
           ON CONFLICT DO NOTHING`,
        [userId, DEFAULT_TENANT_ID],
      );
      await c.query(
        `INSERT INTO sessions (id, tenant_id, user_id, token, expires_at)
           VALUES ($1, $2, $3, $4, now() + interval '30 days')`,
        [sessionId, DEFAULT_TENANT_ID, userId, bearer],
      );
    });

    await withClient(booted.appUri, async (c) => {
      const { rows } = await c.query<{ user_id: string; tenant_id: string }>(
        `SELECT user_id, tenant_id FROM session_lookup_by_token($1)`,
        [bearer],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.user_id).toBe(userId);
      expect(rows[0]?.tenant_id).toBe(DEFAULT_TENANT_ID);
    });
  });
});
