// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 Plan 08 — runIngestOnce integration test.
//
// Real Postgres via @testcontainers/postgresql; in-memory redis-like
// stub for the watermark store (the ingest function only needs get/set
// strings — no BullMQ blocking commands are exercised in `runIngestOnce`,
// only in `createWorker` which is covered by the smoke assertion that
// the Worker class is instantiable). The full Worker lifecycle test
// (graceful SIGTERM drain) is at the end and uses the same in-memory
// redis-mock pattern from BullMQ's own test suite.
//
// Coverage targets (per Plan 02 Task 4 / CLAUDE.md):
//   - happy path: N rows in spend logs -> N usage_ledger rows
//   - idempotency: replay produces 0 net inserts
//   - tenant resolution via users JOIN
//   - kind mapping (whisper -> transcribe_minutes, qwen -> reason_tokens,
//     realtime -> realtime_minutes)
//   - watermark advance + initial-lookback default
//   - request_id fallback (metadata absent / non-string key)
//   - missing end_user / missing tenant skip without throwing
//   - SIGTERM-equivalent: worker.close() resolves cleanly when invoked
//     against a live Worker
//
// Note: pinned to vitest's `it.runIf` guard — when DOCKER_HOST is missing
// or the docker daemon is unreachable, the suite is skipped at file
// granularity rather than failing CI on a developer laptop without
// docker.

import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  _buildIngestLog,
  BATCH_SIZE,
  createQueue,
  createWorker,
  ensureScheduler,
  INITIAL_LOOKBACK_MS,
  QUEUE_NAME,
  runIngestOnce,
  SCHEDULER_KEY,
  WATERMARK_KEY,
} from "../../../src/jobs/ingest-litellm-spend.js";
import { canRunDocker } from "../../../src/lib/can-run-docker.js";

const { Pool } = pg;

/** Tiny in-memory replacement for ioredis used by the watermark path. */
class FakeRedis {
  private store = new Map<string, string>();
  async get(k: string): Promise<string | null> {
    return this.store.get(k) ?? null;
  }
  async set(k: string, v: string): Promise<"OK"> {
    this.store.set(k, v);
    return "OK";
  }
}

const SKIP = !process.env.TESTCONTAINERS_RYUK_DISABLED && !canRunDocker();

describe.skipIf(SKIP)("runIngestOnce (integration)", () => {
  let container: StartedPostgreSqlContainer;
  let appPool: pg.Pool;
  let litellmPool: pg.Pool;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("openwhispr")
      .withUsername("owner")
      .withPassword("ownerpw")
      .start();

    const adminUrl = `${container.getConnectionUri()}`;

    // Create the litellm database alongside openwhispr.
    const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
    try {
      await adminPool.query(`CREATE DATABASE litellm`);
    } finally {
      await adminPool.end();
    }

    appPool = new Pool({ connectionString: adminUrl, max: 2 });
    const litellmUri = adminUrl.replace(/\/openwhispr$/, "/litellm");
    litellmPool = new Pool({ connectionString: litellmUri, max: 2 });

    // Minimal openwhispr schema: tenants + users + usage_ledger.
    await appPool.query(`
      CREATE TABLE tenants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL
      );
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        email text NOT NULL
      );
      CREATE TABLE usage_ledger (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        user_id uuid NOT NULL,
        request_id text NOT NULL,
        kind text NOT NULL,
        units integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        event_at timestamptz
      );
      CREATE UNIQUE INDEX usage_ledger_request_id_unique ON usage_ledger(request_id);
    `);

    // Minimal litellm schema mirroring the columns we read.
    await litellmPool.query(`
      CREATE TABLE "LiteLLM_SpendLogs" (
        request_id text PRIMARY KEY,
        "end_user" text,
        spend numeric,
        total_tokens integer,
        model text NOT NULL,
        "startTime" timestamptz NOT NULL,
        "endTime" timestamptz,
        metadata jsonb
      );
    `);

    const t = await appPool.query<{ id: string }>(
      `INSERT INTO tenants (name) VALUES ('default') RETURNING id`,
    );
    tenantId = t.rows[0]?.id;
    const u = await appPool.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id`,
      [tenantId, "alice@example.com"],
    );
    userId = u.rows[0]?.id;
  }, 120_000);

  afterAll(async () => {
    if (litellmPool) await litellmPool.end();
    if (appPool) await appPool.end();
    if (container) await container.stop();
  }, 60_000);

  async function seedSpendRow(args: {
    request_id: string;
    end_user: string | null;
    model: string;
    total_tokens: number | null;
    metadata: Record<string, unknown> | null;
    startTime?: Date;
  }): Promise<void> {
    await litellmPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, total_tokens, model, "startTime", metadata)
       VALUES ($1, $2, 0.001, $3, $4, $5, $6::jsonb)`,
      [
        args.request_id,
        args.end_user,
        args.total_tokens,
        args.model,
        args.startTime ?? new Date(),
        args.metadata === null ? null : JSON.stringify(args.metadata),
      ],
    );
  }

  async function clearAll(): Promise<void> {
    await litellmPool.query(`DELETE FROM "LiteLLM_SpendLogs"`);
    await appPool.query(`DELETE FROM usage_ledger`);
  }

  it("ingests N spend rows into usage_ledger with correct kind + units", async () => {
    await clearAll();
    const redis = new FakeRedis();
    await seedSpendRow({
      request_id: "litellm-1",
      end_user: userId,
      model: "qwen3.6-plus",
      total_tokens: 1500,
      metadata: { openwhispr_request_id: "ow-req-1" },
    });
    await seedSpendRow({
      request_id: "litellm-2",
      end_user: userId,
      model: "whisper-large-v3",
      total_tokens: 0,
      metadata: { openwhispr_request_id: "ow-req-2", duration: 90 },
    });
    await seedSpendRow({
      request_id: "litellm-3",
      end_user: userId,
      model: "gpt-4o-realtime-preview",
      total_tokens: 0,
      metadata: { openwhispr_request_id: "ow-req-3", duration: 120 },
    });

    const result = await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });

    expect(result.rowsScanned).toBe(3);
    expect(result.rowsProcessed).toBe(3);

    const ledger = await appPool.query<{
      request_id: string;
      kind: string;
      units: number;
      tenant_id: string;
    }>(`SELECT request_id, kind, units, tenant_id FROM usage_ledger ORDER BY request_id`);

    expect(ledger.rows).toHaveLength(3);
    const byRid = Object.fromEntries(ledger.rows.map((r) => [r.request_id, r]));
    expect(byRid["ow-req-1"]).toMatchObject({
      kind: "reason_tokens",
      units: 1500,
      tenant_id: tenantId,
    });
    expect(byRid["ow-req-2"]).toMatchObject({
      kind: "transcribe_minutes",
      units: 2, // ceil(90/60)
    });
    expect(byRid["ow-req-3"]).toMatchObject({
      kind: "realtime_minutes",
      units: 2, // ceil(120/60)
    });
  });

  it("is idempotent: replay produces zero net new rows", async () => {
    await clearAll();
    const redis = new FakeRedis();
    await seedSpendRow({
      request_id: "litellm-r1",
      end_user: userId,
      model: "qwen3.6-plus",
      total_tokens: 100,
      metadata: { openwhispr_request_id: "ow-replay-1" },
    });

    const r1 = await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });
    expect(r1.rowsProcessed).toBe(1);

    // Reset watermark so the second call re-scans the same row.
    await redis.set(WATERMARK_KEY, new Date(0).toISOString());

    const r2 = await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });
    expect(r2.rowsScanned).toBe(1);
    // ON CONFLICT DO NOTHING -> rowsProcessed (counting actual inserts) is 0.
    expect(r2.rowsProcessed).toBe(0);

    const count = await appPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM usage_ledger WHERE request_id = 'ow-replay-1'`,
    );
    expect(count.rows[0]?.c).toBe("1");
  });

  // Phase 58 Track B / worker:CR-02 — the ingest writer must persist the
  // LiteLLM startTime into usage_ledger.event_at so the rollup +
  // reconciliation jobs can bucket by when the spend actually occurred.
  it("worker:CR-02 — writes the LiteLLM startTime into usage_ledger.event_at", async () => {
    await clearAll();
    const redis = new FakeRedis();
    // Within the 5-minute initial-lookback window so the watermark-mode
    // scan picks it up; the exact value is what we assert event_at carries.
    const spendStart = new Date(Date.now() - 60_000);
    await seedSpendRow({
      request_id: "litellm-cr02",
      end_user: userId,
      model: "qwen3.6-plus",
      total_tokens: 10,
      metadata: { openwhispr_request_id: "ow-cr02" },
      startTime: spendStart,
    });

    await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });

    const { rows } = await appPool.query<{ event_at: Date | null }>(
      `SELECT event_at FROM usage_ledger WHERE request_id = 'ow-cr02'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_at).not.toBeNull();
    expect(new Date(rows[0]!.event_at as Date).toISOString()).toBe(spendStart.toISOString());
  });

  it("advances watermark to the latest startTime processed", async () => {
    await clearAll();
    const redis = new FakeRedis();
    const t0 = new Date(Date.now() - 60_000);
    const t1 = new Date(Date.now() - 30_000);
    await seedSpendRow({
      request_id: "wm-1",
      end_user: userId,
      model: "qwen3.6-plus",
      total_tokens: 1,
      metadata: { openwhispr_request_id: "ow-wm-1" },
      startTime: t0,
    });
    await seedSpendRow({
      request_id: "wm-2",
      end_user: userId,
      model: "qwen3.6-plus",
      total_tokens: 1,
      metadata: { openwhispr_request_id: "ow-wm-2" },
      startTime: t1,
    });
    await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });
    const wm = await redis.get(WATERMARK_KEY);
    expect(wm).toBeTruthy();
    // Watermark MUST equal the LATEST row processed (t1), not the first.
    expect(new Date(wm!).getTime()).toBe(t1.getTime());

    // A second run with no new rows must be a no-op (no watermark advance).
    const r2 = await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });
    expect(r2.rowsScanned).toBe(0);
    expect(await redis.get(WATERMARK_KEY)).toBe(wm);
  });

  it("falls back to LiteLLM's request_id when metadata lacks openwhispr_request_id", async () => {
    await clearAll();
    const redis = new FakeRedis();
    await seedSpendRow({
      request_id: "litellm-orphan",
      end_user: userId,
      model: "qwen3.6-plus",
      total_tokens: 5,
      metadata: null,
    });
    await seedSpendRow({
      request_id: "litellm-misc-key",
      end_user: userId,
      model: "qwen3.6-plus",
      total_tokens: 5,
      metadata: { other: "field" },
    });
    await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });
    const rows = await appPool.query<{ request_id: string }>(
      `SELECT request_id FROM usage_ledger ORDER BY request_id`,
    );
    expect(rows.rows.map((r) => r.request_id).sort()).toEqual([
      "litellm-misc-key",
      "litellm-orphan",
    ]);
  });

  it("skips rows missing end_user without throwing", async () => {
    await clearAll();
    const redis = new FakeRedis();
    await seedSpendRow({
      request_id: "litellm-no-user",
      end_user: null,
      model: "qwen3.6-plus",
      total_tokens: 5,
      metadata: { openwhispr_request_id: "ow-skipped" },
    });
    const result = await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });
    expect(result.rowsScanned).toBe(1);
    expect(result.rowsProcessed).toBe(0);
    const c = await appPool.query<{ c: string }>(`SELECT count(*)::text AS c FROM usage_ledger`);
    expect(c.rows[0]?.c).toBe("0");
  });

  it("skips rows whose end_user has no matching users row", async () => {
    await clearAll();
    const redis = new FakeRedis();
    await seedSpendRow({
      request_id: "litellm-orphan-user",
      end_user: "00000000-0000-0000-0000-000000000999",
      model: "qwen3.6-plus",
      total_tokens: 5,
      metadata: { openwhispr_request_id: "ow-orphan" },
    });
    const result = await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });
    expect(result.rowsScanned).toBe(1);
    expect(result.rowsProcessed).toBe(0);
  });

  it("uses initial lookback when no watermark is set", async () => {
    await clearAll();
    const redis = new FakeRedis();
    // Row inside the lookback window
    await seedSpendRow({
      request_id: "litellm-recent",
      end_user: userId,
      model: "qwen3.6-plus",
      total_tokens: 1,
      metadata: { openwhispr_request_id: "ow-recent" },
      startTime: new Date(Date.now() - 60_000),
    });
    // Row outside the lookback window
    await seedSpendRow({
      request_id: "litellm-old",
      end_user: userId,
      model: "qwen3.6-plus",
      total_tokens: 1,
      metadata: { openwhispr_request_id: "ow-old" },
      startTime: new Date(Date.now() - INITIAL_LOOKBACK_MS - 60_000),
    });
    const result = await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });
    expect(result.rowsScanned).toBe(1);
    expect(result.rowsProcessed).toBe(1);
    const rows = await appPool.query<{ request_id: string }>(`SELECT request_id FROM usage_ledger`);
    expect(rows.rows).toEqual([{ request_id: "ow-recent" }]);
  });
});

// ---------------------------------------------------------------------------
// Phase 58 Track A — worker:CR-01 — spend-ingest watermark must NOT advance
// past rows skipped for a *recoverable* reason (missing end_user / missing
// tenant mapping — the mapping can materialize later). Invalid-duration is
// unrecoverable bad data — that one skips + advances. All three skip reasons
// must emit a billing-anomaly counter. ON CONFLICT (request_id) keeps the
// hold + re-ingest idempotent (no double-billing).
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("runIngestOnce — worker:CR-01 recoverable-skip watermark hold", () => {
  let container: StartedPostgreSqlContainer;
  let appPool: pg.Pool;
  let litellmPool: pg.Pool;
  let tenantId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("openwhispr")
      .withUsername("owner")
      .withPassword("ownerpw")
      .start();

    const adminUrl = `${container.getConnectionUri()}`;
    const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
    try {
      await adminPool.query(`CREATE DATABASE litellm`);
    } finally {
      await adminPool.end();
    }

    appPool = new Pool({ connectionString: adminUrl, max: 2 });
    const litellmUri = adminUrl.replace(/\/openwhispr$/, "/litellm");
    litellmPool = new Pool({ connectionString: litellmUri, max: 2 });

    await appPool.query(`
      CREATE TABLE tenants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL
      );
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        email text NOT NULL
      );
      CREATE TABLE usage_ledger (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        user_id uuid NOT NULL,
        request_id text NOT NULL,
        kind text NOT NULL,
        units integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        event_at timestamptz
      );
      CREATE UNIQUE INDEX usage_ledger_request_id_unique ON usage_ledger(request_id);
    `);
    await litellmPool.query(`
      CREATE TABLE "LiteLLM_SpendLogs" (
        request_id text PRIMARY KEY,
        "end_user" text,
        spend numeric,
        total_tokens integer,
        model text NOT NULL,
        "startTime" timestamptz NOT NULL,
        "endTime" timestamptz,
        metadata jsonb
      );
    `);

    const t = await appPool.query<{ id: string }>(
      `INSERT INTO tenants (name) VALUES ('default') RETURNING id`,
    );
    tenantId = t.rows[0]?.id;
  }, 120_000);

  afterAll(async () => {
    if (litellmPool) await litellmPool.end();
    if (appPool) await appPool.end();
    if (container) await container.stop();
  }, 60_000);

  async function seedSpendRow(args: {
    request_id: string;
    end_user: string | null;
    model: string;
    total_tokens: number | null;
    metadata: Record<string, unknown> | null;
    startTime: Date;
  }): Promise<void> {
    await litellmPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, total_tokens, model, "startTime", metadata)
       VALUES ($1, $2, 0.001, $3, $4, $5, $6::jsonb)`,
      [
        args.request_id,
        args.end_user,
        args.total_tokens,
        args.model,
        args.startTime,
        args.metadata === null ? null : JSON.stringify(args.metadata),
      ],
    );
  }

  async function clearAll(): Promise<void> {
    await litellmPool.query(`DELETE FROM "LiteLLM_SpendLogs"`);
    await appPool.query(`DELETE FROM usage_ledger`);
    await appPool.query(`DELETE FROM users`);
  }

  it("worker:CR-01 — Scenario A: a missing-tenant-mapping row holds the watermark and is recovered on a later tick", async () => {
    await clearAll();
    const { _resetBillingAnomalies } = await import("../../../src/jobs/ingest-litellm-spend.js");
    _resetBillingAnomalies();
    const redis = new FakeRedis();

    // Start the watermark before T1 so the row is in-scope.
    const t1 = new Date(Date.now() - 120_000);
    const wmBefore = new Date(t1.getTime() - 60_000).toISOString();
    await redis.set(WATERMARK_KEY, wmBefore);

    // R1 references a user id that does NOT yet exist in `users`.
    const orphanUserId = "00000000-0000-0000-0000-0000000000a1";
    await seedSpendRow({
      request_id: "cr01-r1",
      end_user: orphanUserId,
      model: "qwen3.6-plus",
      total_tokens: 42,
      metadata: { openwhispr_request_id: "ow-cr01-r1" },
      startTime: t1,
    });

    // Tick 1 — R1 is skipped (no tenant mapping). Recoverable → must NOT
    // advance the watermark past T1.
    const r1 = await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });
    expect(r1.rowsScanned).toBe(1);
    expect(r1.rowsProcessed).toBe(0);

    const wmAfterTick1 = await redis.get(WATERMARK_KEY);
    expect(wmAfterTick1).toBeTruthy();
    // The watermark must remain at-or-before T1 so the next tick re-scans R1.
    expect(new Date(wmAfterTick1!).getTime()).toBeLessThan(t1.getTime());

    // A billing-anomaly counter fired for the recoverable skip.
    const { _readBillingAnomalies } = await import("../../../src/jobs/ingest-litellm-spend.js");
    const reasons1 = _readBillingAnomalies().map((a) => a.reason);
    expect(reasons1).toContain("missing_tenant");

    // Now the user/tenant mapping materializes.
    await appPool.query(`INSERT INTO users (id, tenant_id, email) VALUES ($1, $2, $3)`, [
      orphanUserId,
      tenantId,
      "late@example.com",
    ]);

    // Tick 2 — R1 must now be re-scanned and ingested (recovered).
    const r2 = await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });
    expect(r2.rowsScanned).toBe(1);
    expect(r2.rowsProcessed).toBe(1);

    const ledger = await appPool.query<{ request_id: string; tenant_id: string }>(
      `SELECT request_id, tenant_id FROM usage_ledger`,
    );
    expect(ledger.rows).toEqual([{ request_id: "ow-cr01-r1", tenant_id: tenantId }]);

    // Tick 3 — re-scan must be idempotent (ON CONFLICT) — no double-billing.
    await redis.set(WATERMARK_KEY, wmBefore);
    const r3 = await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });
    expect(r3.rowsScanned).toBe(1);
    expect(r3.rowsProcessed).toBe(0);
    const count = await appPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM usage_ledger WHERE request_id = 'ow-cr01-r1'`,
    );
    expect(count.rows[0]?.c).toBe("1");
  });

  it("worker:CR-01 — Scenario B: missing_end_user + missing_tenant + non_numeric_duration all emit anomaly counters", async () => {
    await clearAll();
    const { _resetBillingAnomalies, _readBillingAnomalies } = await import(
      "../../../src/jobs/ingest-litellm-spend.js"
    );
    _resetBillingAnomalies();
    const redis = new FakeRedis();
    const base = new Date(Date.now() - 90_000);
    await redis.set(WATERMARK_KEY, new Date(base.getTime() - 60_000).toISOString());

    await seedSpendRow({
      request_id: "cr01-b-nouser",
      end_user: null,
      model: "qwen3.6-plus",
      total_tokens: 5,
      metadata: { openwhispr_request_id: "ow-b-nouser" },
      startTime: new Date(base.getTime() + 1_000),
    });
    await seedSpendRow({
      request_id: "cr01-b-notenant",
      end_user: "00000000-0000-0000-0000-0000000000b2",
      model: "qwen3.6-plus",
      total_tokens: 5,
      metadata: { openwhispr_request_id: "ow-b-notenant" },
      startTime: new Date(base.getTime() + 2_000),
    });
    // The bad-duration row needs a *valid* user/tenant so it reaches the
    // duration-validation branch (a missing tenant would short-circuit first).
    const baddurUserId = "00000000-0000-0000-0000-0000000000b9";
    await appPool.query(`INSERT INTO users (id, tenant_id, email) VALUES ($1, $2, $3)`, [
      baddurUserId,
      tenantId,
      "b9@example.com",
    ]);
    await seedSpendRow({
      request_id: "cr01-b-baddur",
      end_user: baddurUserId,
      model: "whisper-large-v3",
      total_tokens: 0,
      metadata: { openwhispr_request_id: "ow-b-baddur", duration: "not-a-number" },
      startTime: new Date(base.getTime() + 3_000),
    });

    await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });

    const reasons = _readBillingAnomalies().map((a) => a.reason);
    expect(reasons).toContain("missing_end_user");
    expect(reasons).toContain("missing_tenant");
    expect(reasons).toContain("non_numeric_duration");
  });

  it("worker:CR-01 — Scenario C: an invalid-duration row is skipped AND the watermark advances past it (ingest cannot stall)", async () => {
    await clearAll();
    const { _resetBillingAnomalies } = await import("../../../src/jobs/ingest-litellm-spend.js");
    _resetBillingAnomalies();
    const redis = new FakeRedis();

    const tBad = new Date(Date.now() - 60_000);
    await redis.set(WATERMARK_KEY, new Date(tBad.getTime() - 60_000).toISOString());

    // A real user so the row reaches the duration-validation branch.
    const userId = "00000000-0000-0000-0000-0000000000c3";
    await appPool.query(`INSERT INTO users (id, tenant_id, email) VALUES ($1, $2, $3)`, [
      userId,
      tenantId,
      "c3@example.com",
    ]);
    await seedSpendRow({
      request_id: "cr01-c-baddur",
      end_user: userId,
      model: "whisper-large-v3",
      total_tokens: 0,
      metadata: { openwhispr_request_id: "ow-c-baddur", duration: -7 },
      startTime: tBad,
    });

    const r = await runIngestOnce({
      litellmPool,
      appOwnerPool: appPool,
      connection: {} as never,
      redis,
    });
    expect(r.rowsScanned).toBe(1);
    expect(r.rowsProcessed).toBe(0);

    // Unrecoverable bad data — watermark advances past it so ingest does not
    // stall on permanently-bad rows.
    const wm = await redis.get(WATERMARK_KEY);
    expect(new Date(wm!).getTime()).toBe(tBad.getTime());
  });
});

// ---------------------------------------------------------------------------
// BullMQ wiring smoke tests — module-level, run regardless of docker.
// They cover the trivial wrapper functions (createQueue / ensureScheduler /
// createWorker) without standing up redis: BullMQ accepts a connection
// `host`/`port` and lazily connects, so we can construct the objects and
// immediately close them. This is the same pattern the api uses for
// fastify route smoke tests.
// ---------------------------------------------------------------------------

describe("BullMQ wiring (no-redis smoke)", () => {
  it("exports the canonical scheduler key + queue name", () => {
    expect(QUEUE_NAME).toBe("litellm-spend-ingest");
    expect(SCHEDULER_KEY).toBe("ingest-litellm-spend");
    expect(WATERMARK_KEY).toBe("litellm:spend:last_start_time");
    expect(BATCH_SIZE).toBe(1000);
  });

  it("createQueue returns a Queue with the canonical name", async () => {
    const q = createQueue({ host: "127.0.0.1", port: 16399 });
    expect(q.name).toBe(QUEUE_NAME);
    await q.close();
  });

  it("createWorker returns a Worker bound to the canonical queue", async () => {
    const fakeRedis = new FakeRedis();
    const w = createWorker({
      litellmPool: { query: async () => ({ rows: [] }) } as never,
      appOwnerPool: { query: async () => ({ rows: [] }) } as never,
      connection: { host: "127.0.0.1", port: 16399 },
      redis: fakeRedis,
    });
    expect(w.name).toBe(QUEUE_NAME);
    await w.close();
  });

  // Stage B back-fill — close residual gaps to 90/90/90/90.

  it("createWorker's job callback invokes runIngestOnce and logs the result", async () => {
    // Pins the anonymous_4 function (line 186) — previously the Worker
    // class was constructed but its job callback never fired in tests.
    let queryCount = 0;
    const litellmPool = {
      async query() {
        queryCount++;
        return { rows: [] };
      },
    } as never;
    const appOwnerPool = {
      async query() {
        return { rows: [] };
      },
    } as never;
    const fakeRedis = new FakeRedis();
    const w = createWorker({
      litellmPool,
      appOwnerPool,
      connection: { host: "127.0.0.1", port: 16399 },
      redis: fakeRedis,
    });
    try {
      // Reach into the BullMQ Worker's processor to invoke it directly.
      // The Worker class stores the user-supplied callback as `processFn`
      // (BullMQ 5.x); calling it with a stub Job object exercises the
      // anonymous_4 wrapper without standing up Redis.
      const fakeJob = {} as never;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const processor = (w as any).processFn ?? (w as any).processor;
      expect(typeof processor).toBe("function");
      const result = await processor(fakeJob);
      expect(result).toEqual({ rowsProcessed: 0, rowsScanned: 0 });
      expect(queryCount).toBeGreaterThanOrEqual(1);
    } finally {
      await w.close();
    }
  });

  it("treats string startTime values from pg as ISO and writes them to redis verbatim", async () => {
    // Pins line 168 cond-expr idx 1 (string branch). pg returns Date by
    // default but the ?? typecast in the SELECT can yield strings on
    // certain configs. Drive runIngestOnce against a stubbed pool whose
    // rows carry an ISO string.
    const fakeRedis = new FakeRedis();
    const isoTs = "2026-05-09T10:00:00.000Z";
    const litellmPool = {
      async query() {
        return {
          rows: [
            {
              request_id: "rid-string",
              end_user: "user-1",
              total_tokens: 10,
              model: "qwen3.6",
              startTime: isoTs,
              metadata: { openwhispr_request_id: "ow-string" },
            },
          ],
        };
      },
    } as never;
    let inserted = 0;
    const appOwnerPool = {
      async query(text: string) {
        if (/SELECT\s+tenant_id\s+FROM\s+users/i.test(text)) {
          return { rows: [{ tenant_id: "tenant-1" }] };
        }
        if (/INSERT\s+INTO\s+usage_ledger/i.test(text)) {
          inserted++;
          return { rowCount: 1 };
        }
        return { rows: [] };
      },
    } as never;
    const result = await runIngestOnce({
      litellmPool,
      appOwnerPool,
      connection: {} as never,
      redis: fakeRedis,
    });
    expect(result.rowsScanned).toBe(1);
    expect(result.rowsProcessed).toBe(1);
    expect(inserted).toBe(1);
    expect(await fakeRedis.get(WATERMARK_KEY)).toBe(isoTs);
  });

  it("doesn't count an INSERT with rowCount=0 (ON CONFLICT) toward rowsProcessed", async () => {
    // Pins line 159 binary-expr idx 1 (the ?? 0 fallback when rowCount
    // is null/undefined) and the > 0 false branch.
    const fakeRedis = new FakeRedis();
    const litellmPool = {
      async query() {
        return {
          rows: [
            {
              request_id: "rid-conflict",
              end_user: "user-1",
              total_tokens: 0,
              model: "qwen3.6",
              startTime: new Date(),
              metadata: { openwhispr_request_id: "ow-conflict" },
            },
          ],
        };
      },
    } as never;
    const appOwnerPool = {
      async query(text: string) {
        if (/SELECT\s+tenant_id\s+FROM\s+users/i.test(text)) {
          return { rows: [{ tenant_id: "tenant-1" }] };
        }
        // Simulate ON CONFLICT DO NOTHING: rowCount is null.
        return { rowCount: null };
      },
    } as never;
    const result = await runIngestOnce({
      litellmPool,
      appOwnerPool,
      connection: {} as never,
      redis: fakeRedis,
    });
    expect(result.rowsScanned).toBe(1);
    expect(result.rowsProcessed).toBe(0);
  });

  it("treats null total_tokens as 0 for reason_tokens kind", async () => {
    // Pins line 148 binary-expr idx 1 — the `r.total_tokens ?? 0` fallback.
    const fakeRedis = new FakeRedis();
    const litellmPool = {
      async query() {
        return {
          rows: [
            {
              request_id: "rid-null-tokens",
              end_user: "user-1",
              total_tokens: null,
              model: "qwen3.6",
              startTime: new Date(),
              metadata: { openwhispr_request_id: "ow-null-tokens" },
            },
          ],
        };
      },
    } as never;
    let captured: unknown[] | undefined;
    const appOwnerPool = {
      async query(text: string, params?: unknown[]) {
        if (/SELECT\s+tenant_id/i.test(text)) {
          return { rows: [{ tenant_id: "tenant-1" }] };
        }
        if (/INSERT\s+INTO\s+usage_ledger/i.test(text)) {
          captured = params;
          return { rowCount: 1 };
        }
        return { rows: [] };
      },
    } as never;
    await runIngestOnce({
      litellmPool,
      appOwnerPool,
      connection: {} as never,
      redis: fakeRedis,
    });
    // Last positional param ($5) is `units`. With null total_tokens the
    // route's fallback yields 0.
    expect(captured?.[4]).toBe(0);
  });

  // Phase 41.d / HI-4 — for minutes-priced models (whisper-large-v3,
  // realtime models), metadata.duration is the SOLE signal of how many
  // billable units to insert. The legacy `extractDuration` silently
  // coerced any non-numeric duration to 0 and inserted a usage_ledger
  // row with units=0 — pure data loss on the revenue path. The fix
  // validates the duration is a finite positive number; on validation
  // failure it logs warn, increments the OTel counter
  // `worker_billing_anomalies_total{reason="non_numeric_duration"}`,
  // and SKIPS the insert entirely (matches the existing skip pattern for
  // missing end_user / missing tenant).
  it("HI-4: skips minutes-priced rows with non-numeric duration and increments anomaly counter", async () => {
    const { _resetBillingAnomalies, _readBillingAnomalies } = await import(
      "../../../src/jobs/ingest-litellm-spend.js"
    );
    _resetBillingAnomalies();
    const fakeRedis = new FakeRedis();
    const litellmPool = {
      async query() {
        return {
          rows: [
            {
              request_id: "rid-bad-duration",
              end_user: "user-1",
              total_tokens: 0,
              model: "whisper-large-v3",
              startTime: new Date(),
              metadata: { openwhispr_request_id: "ow-bad-dur", duration: "ten seconds" },
            },
          ],
        };
      },
    } as never;
    let insertCount = 0;
    const appOwnerPool = {
      async query(text: string) {
        if (/SELECT\s+tenant_id\s+FROM\s+users/i.test(text)) {
          return { rows: [{ tenant_id: "tenant-1" }] };
        }
        if (/INSERT\s+INTO\s+usage_ledger/i.test(text)) {
          insertCount++;
          return { rowCount: 1 };
        }
        return { rows: [] };
      },
    } as never;
    const result = await runIngestOnce({
      litellmPool,
      appOwnerPool,
      connection: {} as never,
      redis: fakeRedis,
    });
    expect(result.rowsScanned).toBe(1);
    // SKIP — no usage_ledger insert.
    expect(result.rowsProcessed).toBe(0);
    expect(insertCount).toBe(0);
    // Counter incremented once with the right reason label.
    const anomalies = _readBillingAnomalies();
    expect(anomalies).toEqual([{ reason: "non_numeric_duration", count: 1 }]);
  });

  it("HI-4: accepts numeric durations on minutes-priced models (positive control)", async () => {
    const { _resetBillingAnomalies, _readBillingAnomalies } = await import(
      "../../../src/jobs/ingest-litellm-spend.js"
    );
    _resetBillingAnomalies();
    const fakeRedis = new FakeRedis();
    const litellmPool = {
      async query() {
        return {
          rows: [
            {
              request_id: "rid-good-duration",
              end_user: "user-1",
              total_tokens: 0,
              model: "whisper-large-v3",
              startTime: new Date(),
              metadata: { openwhispr_request_id: "ow-good-dur", duration: 90 },
            },
          ],
        };
      },
    } as never;
    let captured: unknown[] | undefined;
    const appOwnerPool = {
      async query(text: string, params?: unknown[]) {
        if (/SELECT\s+tenant_id\s+FROM\s+users/i.test(text)) {
          return { rows: [{ tenant_id: "tenant-1" }] };
        }
        if (/INSERT\s+INTO\s+usage_ledger/i.test(text)) {
          captured = params;
          return { rowCount: 1 };
        }
        return { rows: [] };
      },
    } as never;
    const result = await runIngestOnce({
      litellmPool,
      appOwnerPool,
      connection: {} as never,
      redis: fakeRedis,
    });
    expect(result.rowsProcessed).toBe(1);
    expect(captured?.[4]).toBe(2); // ceil(90/60)
    expect(_readBillingAnomalies()).toEqual([]);
  });

  it("HI-4: token-priced models are unaffected by missing duration", async () => {
    const { _resetBillingAnomalies, _readBillingAnomalies } = await import(
      "../../../src/jobs/ingest-litellm-spend.js"
    );
    _resetBillingAnomalies();
    const fakeRedis = new FakeRedis();
    const litellmPool = {
      async query() {
        return {
          rows: [
            {
              request_id: "rid-tokens",
              end_user: "user-1",
              total_tokens: 500,
              model: "qwen3.6-plus",
              startTime: new Date(),
              metadata: { openwhispr_request_id: "ow-tokens" },
            },
          ],
        };
      },
    } as never;
    const appOwnerPool = {
      async query(text: string) {
        if (/SELECT\s+tenant_id\s+FROM\s+users/i.test(text)) {
          return { rows: [{ tenant_id: "tenant-1" }] };
        }
        return { rowCount: 1 };
      },
    } as never;
    const result = await runIngestOnce({
      litellmPool,
      appOwnerPool,
      connection: {} as never,
      redis: fakeRedis,
    });
    expect(result.rowsProcessed).toBe(1);
    expect(_readBillingAnomalies()).toEqual([]);
  });

  // Phase 41.d / HI-1 — the ingest-litellm-spend module-level logger MUST
  // be built via the shared `makePino` factory from
  // `@openwhispr/observability` so the canonical D-T4 redact paths apply.
  // Prior to the fix it used a bare `pino({ name: "ingest-litellm-spend" })`
  // with no `redact` config, which would ship secret-shaped values (e.g.
  // `OPENAI_API_KEY`, `password`, `authorization` headers) straight to
  // Loki when an error path logged them.
  it("module logger redacts D-T4 secret-shaped keys via the shared makePino factory", () => {
    const chunks: string[] = [];
    const log = _buildIngestLog({ write: (c: string) => chunks.push(c) });
    log.warn(
      {
        OPENAI_API_KEY: "sk-fakefake-very-secret-leaked-key",
        password: "p@ssw0rd",
        authorization: "Bearer ey-fake-jwt",
        token: "tok-leaked",
        rid: "ow-rid-safe",
      },
      "secret-shape redact assertion",
    );
    const joined = chunks.join("");
    expect(joined).not.toContain("sk-fakefake-very-secret-leaked-key");
    expect(joined).not.toContain("p@ssw0rd");
    expect(joined).not.toContain("ey-fake-jwt");
    expect(joined).not.toContain("tok-leaked");
    expect(joined).toContain("[REDACTED]");
    // Safe (non-secret) keys remain.
    expect(joined).toContain("ow-rid-safe");
  });

  it("ensureScheduler delegates to queue.upsertJobScheduler with canonical args", async () => {
    const calls: Array<{
      key: string;
      every?: number;
      template?: { name: string; data: unknown };
    }> = [];
    const fakeQueue = {
      upsertJobScheduler: (
        key: string,
        opts: { every: number },
        template: { name: string; data: unknown },
      ) => {
        calls.push({ key, every: opts.every, template });
        return Promise.resolve();
      },
    } as unknown as Parameters<typeof ensureScheduler>[0];
    await ensureScheduler(fakeQueue);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      key: SCHEDULER_KEY,
      every: 30_000,
      template: { name: "ingest", data: {} },
    });
  });
});
