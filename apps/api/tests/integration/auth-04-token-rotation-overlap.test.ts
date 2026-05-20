// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 58 / Track C — data:CR-04 regression lock.
//
// Characterization / regression test for the AUTH-04 5-minute
// token-rotation overlap window.
//
// data:CR-04 ("previous_token_fp never populated") was raised by the
// reviewer scoped to Better Auth's drizzleAdapter write path — that path
// strips the lens-emitted sidecars, so a Better-Auth-owned session row
// never gets `previous_token_fp` populated through the adapter.
//
// BUT the actual writer of `previous_token_fp` is `recordPreviousToken`
// (apps/api/src/lib/token-rotation.ts) — it issues a RAW `sql` UPDATE
// inside `withTenant(...)`. It never traverses the lens or the
// drizzleAdapter, so the empty-ENCRYPTED_COLUMNS_MAP defect (closed by
// Phase 57 anyway) never applied to this path. The `onSend` hook in
// apps/api/src/index.ts fires `recordPreviousToken(db, tenant, sessionId,
// oldBearer)` on every `set-auth-token` rotation. The validation side
// `tryPreviousToken` resolves the old bearer by fingerprint within the
// 5-minute window.
//
// This test boots a real Postgres (testcontainers), applies all
// migrations, seeds a tenant + user + session row, exercises the exact
// production writer the onSend hook calls, then asserts:
//   1. `previous_token_fp` is populated == sha256(old bearer) after
//      rotation, with `previous_token_expires_at` ~= now()+5min.
//   2. `tryPreviousToken(old bearer)` resolves to the same
//      (user_id, tenant_id) inside the overlap window.
//   3. an EXPIRED `previous_token_expires_at` no longer matches — the
//      5-minute window is bounded, not open-ended.
//
// Finding verified ALREADY-CLOSED; this test locks it against a revert.

import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recordPreviousToken, tryPreviousToken } from "../../src/lib/token-rotation.js";

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

// Obviously-fake placeholder bearers — these are arbitrary opaque
// strings, NOT real credentials. `tests/**` is gitleaks-allowlisted.
// Each test uses a DISTINCT old bearer because `sessions.token_fp` is a
// GLOBAL unique index and these tests share one Postgres container.
const OLD_BEARER_POP = "fake-old-bearer-populate-aaaaaaaaaaaaaaaaaaaaaaa";
const OLD_BEARER_WINDOW = "fake-old-bearer-window-bbbbbbbbbbbbbbbbbbbbbbbbb";
const OLD_BEARER_EXPIRED = "fake-old-bearer-expired-ccccccccccccccccccccccc";
const NEW_BEARER = "fake-new-bearer-rotated-ddddddddddddddddddddddddd";

let container: StartedPostgreSqlContainer;
let ownerPool: Pool;
let appPool: Pool;

beforeAll(async () => {
  process.env.MASTER_KEK = process.env.MASTER_KEK ?? Buffer.alloc(32).toString("base64url");
  process.env.OPENWHISPR_KEY_PROVIDER = process.env.OPENWHISPR_KEY_PROVIDER ?? "env";

  container = await new PostgreSqlContainer("openwhispr/postgres:17.5-pgpartman")
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

  // App-role connection — `recordPreviousToken` runs inside
  // `withTenant(...)` which set_config's `app.tenant_id`; the UPDATE is
  // bound by the tenant_isolation RLS policy on `sessions`.
  appPool = new Pool({
    connectionString: `postgres://openwhispr_app:app-pw@${host}:${port}/openwhispr`,
  });
}, 240_000);

afterAll(async () => {
  await appPool?.end();
  await ownerPool?.end();
  await container?.stop();
}, 60_000);

describe("data:CR-04 — AUTH-04 5-minute token-rotation overlap", () => {
  it("data:CR-04 — recordPreviousToken populates previous_token_fp == sha256(old bearer) on rotation", async () => {
    // Seed a tenant + user + session row directly (owner role bypasses
    // RLS) — this stands in for a signed-up Better Auth user holding
    // OLD_BEARER as the active session token.
    const tenantId = "00000000-0000-0000-0000-0000000000c4";
    await ownerPool.query(
      `INSERT INTO tenants (id, name) VALUES ($1, 'cr04-tenant')
       ON CONFLICT (id) DO NOTHING`,
      [tenantId],
    );
    const userRes = await ownerPool.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id`,
      [tenantId, `cr04-${Date.now()}@example.test`],
    );
    const userId = userRes.rows[0]?.id as string;
    expect(userId).toMatch(/^[0-9a-f-]{36}$/i);

    const tokenFp = createHash("sha256").update(OLD_BEARER_POP, "utf8").digest();
    const sessRes = await ownerPool.query<{ id: string }>(
      `INSERT INTO sessions (tenant_id, user_id, token_fp, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 day') RETURNING id`,
      [tenantId, userId, tokenFp],
    );
    const sessionId = sessRes.rows[0]?.id as string;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i);

    // Pre-rotation: previous_token_fp is NULL (overlap window not armed).
    const before = await ownerPool.query<{
      previous_token_fp: Buffer | null;
      previous_token_expires_at: Date | null;
    }>(`SELECT previous_token_fp, previous_token_expires_at FROM sessions WHERE id = $1`, [
      sessionId,
    ]);
    expect(before.rows[0]?.previous_token_fp).toBeNull();

    // Exercise the EXACT production writer the onSend hook calls when a
    // route emits `set-auth-token` (the bearer rotates OLD_BEARER ->
    // NEW_BEARER). NEW_BEARER is not persisted by this helper — only the
    // OLD bearer's fingerprint, which is the overlap-window contract.
    await recordPreviousToken(drizzle(appPool) as never, tenantId, sessionId, OLD_BEARER_POP);
    void NEW_BEARER;

    const after = await ownerPool.query<{
      previous_token_fp: Buffer | null;
      previous_token_expires_at: Date | null;
    }>(`SELECT previous_token_fp, previous_token_expires_at FROM sessions WHERE id = $1`, [
      sessionId,
    ]);
    const row = after.rows[0];
    // (1) previous_token_fp IS populated and equals sha256(old bearer).
    expect(Buffer.isBuffer(row?.previous_token_fp)).toBe(true);
    const expectedFp = createHash("sha256").update(OLD_BEARER_POP, "utf8").digest();
    expect((row?.previous_token_fp as Buffer).equals(expectedFp)).toBe(true);
    // (2) previous_token_expires_at is ~now()+5min (allow generous skew).
    expect(row?.previous_token_expires_at).toBeInstanceOf(Date);
    const deltaMs = (row?.previous_token_expires_at as Date).getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(4 * 60 * 1000);
    expect(deltaMs).toBeLessThan(6 * 60 * 1000);
  }, 60_000);

  it("data:CR-04 — old bearer resolves via tryPreviousToken inside the 5-minute window", async () => {
    const tenantId = "00000000-0000-0000-0000-0000000000c5";
    await ownerPool.query(
      `INSERT INTO tenants (id, name) VALUES ($1, 'cr04-window-tenant')
       ON CONFLICT (id) DO NOTHING`,
      [tenantId],
    );
    const userRes = await ownerPool.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id`,
      [tenantId, `cr04-window-${Date.now()}@example.test`],
    );
    const userId = userRes.rows[0]?.id as string;
    const tokenFp = createHash("sha256").update(OLD_BEARER_WINDOW, "utf8").digest();
    const sessRes = await ownerPool.query<{ id: string }>(
      `INSERT INTO sessions (tenant_id, user_id, token_fp, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 day') RETURNING id`,
      [tenantId, userId, tokenFp],
    );
    const sessionId = sessRes.rows[0]?.id as string;

    await recordPreviousToken(drizzle(appPool) as never, tenantId, sessionId, OLD_BEARER_WINDOW);

    // Validation path: a request carrying the OLD bearer inside the
    // window resolves to the same (user_id, tenant_id) — the AUTH-04
    // overlap is functional, in-flight requests during rotation do not 401.
    //
    // `tryPreviousToken` is documented (packages/data/src/sessions/
    // lookup-by-previous-token.ts header) to run on a BYPASSRLS pool:
    // the dual-auth hook calls it BEFORE the tenant is known, and
    // `sessions` has FORCE ROW LEVEL SECURITY — a plain SELECT with no
    // `app.tenant_id` GUC matches zero rows. Exercised here on the owner
    // (BYPASSRLS) connection, which is its contract.
    const match = await tryPreviousToken(drizzle(ownerPool), OLD_BEARER_WINDOW);
    expect(match).not.toBeNull();
    expect(match?.userId).toBe(userId);
    expect(match?.tenantId).toBe(tenantId);
  }, 60_000);

  it("data:CR-04 — overlap window is bounded: an expired previous_token_expires_at no longer matches", async () => {
    const tenantId = "00000000-0000-0000-0000-0000000000c6";
    await ownerPool.query(
      `INSERT INTO tenants (id, name) VALUES ($1, 'cr04-expired-tenant')
       ON CONFLICT (id) DO NOTHING`,
      [tenantId],
    );
    const userRes = await ownerPool.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id`,
      [tenantId, `cr04-expired-${Date.now()}@example.test`],
    );
    const userId = userRes.rows[0]?.id as string;
    const tokenFp = createHash("sha256").update(OLD_BEARER_EXPIRED, "utf8").digest();
    const sessRes = await ownerPool.query<{ id: string }>(
      `INSERT INTO sessions (tenant_id, user_id, token_fp, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 day') RETURNING id`,
      [tenantId, userId, tokenFp],
    );
    const sessionId = sessRes.rows[0]?.id as string;

    // Arm the overlap, then force the window into the past — simulates a
    // bearer presented > 5 minutes after rotation.
    await recordPreviousToken(drizzle(appPool) as never, tenantId, sessionId, OLD_BEARER_EXPIRED);
    await ownerPool.query(
      `UPDATE sessions SET previous_token_expires_at = now() - interval '1 minute'
       WHERE id = $1`,
      [sessionId],
    );

    // tryPreviousToken filters `previous_token_expires_at > now()` — an
    // expired window MUST NOT authenticate the stale bearer. Run on the
    // BYPASSRLS owner connection (the helper's documented contract) so
    // this assertion isolates the window-bounding logic, not RLS.
    const match = await tryPreviousToken(drizzle(ownerPool), OLD_BEARER_EXPIRED);
    expect(match).toBeNull();
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────
  // data:CR-04 — production-wiring characterization.
  //
  // `recordPreviousToken` (writer) is functional — proven above. The
  // helper `tryPreviousToken` (reader) is functional ON A BYPASSRLS
  // connection — proven above. BUT the deployed binary
  // (apps/api/src/index.ts:470-495) wires the dual-auth hook's
  // `tryPreviousToken` adapter onto `opts.db` === makeAppDb() — the
  // RLS-SUBJECT `openwhispr_app` role. `sessions` carries
  // FORCE ROW LEVEL SECURITY (migration 0000_initial.sql:115), and the
  // dual-auth hook invokes the adapter BEFORE any tenant is resolved,
  // so `app.tenant_id` is unset and the lookup SELECT matches zero
  // rows. The AUTH-04 overlap window is therefore non-functional in
  // production via the standard wiring — a different mechanism than
  // the reviewer's drizzleAdapter scope, but a real gap.
  //
  // This test PINS that behavior so the SUMMARY / deferred-items entry
  // is anchored to executable evidence. It is NOT a "fix" — re-routing
  // the adapter onto a BYPASSRLS pool is a production change deferred
  // under CLAUDE.md hard rule 1 (see .planning/deferred-items.md).
  it("data:CR-04 — characterizes the wiring gap: tryPreviousToken on the RLS-subject app role matches zero rows", async () => {
    const tenantId = "00000000-0000-0000-0000-0000000000c7";
    await ownerPool.query(
      `INSERT INTO tenants (id, name) VALUES ($1, 'cr04-rls-tenant')
       ON CONFLICT (id) DO NOTHING`,
      [tenantId],
    );
    const userRes = await ownerPool.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id`,
      [tenantId, `cr04-rls-${Date.now()}@example.test`],
    );
    const userId = userRes.rows[0]?.id as string;
    const tokenFp = createHash("sha256").update(NEW_BEARER, "utf8").digest();
    const sessRes = await ownerPool.query<{ id: string }>(
      `INSERT INTO sessions (tenant_id, user_id, token_fp, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 day') RETURNING id`,
      [tenantId, userId, tokenFp],
    );
    const sessionId = sessRes.rows[0]?.id as string;

    await recordPreviousToken(drizzle(appPool) as never, tenantId, sessionId, NEW_BEARER);

    // BYPASSRLS owner connection — the helper's contract — resolves it.
    const ownerMatch = await tryPreviousToken(drizzle(ownerPool), NEW_BEARER);
    expect(ownerMatch).not.toBeNull();
    expect(ownerMatch?.userId).toBe(userId);

    // RLS-subject app connection with NO `app.tenant_id` set — exactly
    // how the deployed dual-auth hook calls it — matches zero rows.
    // This is the residual gap captured in deferred-items.md.
    const appMatch = await tryPreviousToken(drizzle(appPool), NEW_BEARER);
    expect(appMatch).toBeNull();
  }, 60_000);
});
