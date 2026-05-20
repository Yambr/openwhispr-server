// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-08 — tests for reconciliation-discrepancy (D-R3).
// Phase 36.b (CRIT-FIX-08) — extended for windowed-backfill truth-telling.
//
// Real Postgres testcontainer for both the withTenantContext acquisition
// pool AND the windowed-backfill SQL paths in runIngestOnce. The two
// previous spy-based tests are kept (schema validation + error propagation)
// and new integration tests cover the explicit-window contract.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Job } from "bullmq";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as ingestModule from "../../../src/jobs/ingest-litellm-spend.js";
import {
  buildReconciliationDiscrepancyHandler,
  reconciliationDiscrepancySchema,
} from "../../../src/jobs/reconciliation-discrepancy.js";
import { canRunDocker } from "../../../src/lib/can-run-docker.js";

const { Pool } = pg;

const SUITE = canRunDocker() ? describe : describe.skip;
const TENANT = "11111111-1111-4111-a111-111111111111";

interface Harness {
  container: StartedPostgreSqlContainer;
  pool: pg.Pool; // owner pool — used as `withTenantContext` pool AND `appOwnerPool`
  litellmPool: pg.Pool;
  tenantId: string;
  userId: string;
}
let h: Harness | undefined;

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

beforeAll(async () => {
  if (!canRunDocker()) return;
  const container = await new PostgreSqlContainer("postgres:17-bookworm")
    .withDatabase("rd_test")
    .withUsername("ps")
    .withPassword("pw")
    .start();
  const adminUri = container.getConnectionUri();
  const admin = new Pool({ connectionString: adminUri, max: 1 });
  try {
    await admin.query(`CREATE DATABASE litellm`);
  } finally {
    await admin.end();
  }
  const pool = new Pool({ connectionString: adminUri, max: 4 });
  const litellmPool = new Pool({
    connectionString: adminUri.replace(/\/rd_test$/, "/litellm"),
    max: 2,
  });
  // Minimal app schema (tenants + users + usage_ledger).
  await pool.query(`
    CREATE TABLE tenants (id uuid PRIMARY KEY, name text NOT NULL);
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
  await pool.query(`INSERT INTO tenants (id, name) VALUES ($1, 'rd-test')`, [TENANT]);
  const uRes = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, 'rd@example.com') RETURNING id`,
    [TENANT],
  );
  const userId = uRes.rows[0]?.id ?? "";
  // Minimal LiteLLM_SpendLogs.
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
  h = { container, pool, litellmPool, tenantId: TENANT, userId };
}, 180_000);

afterAll(async () => {
  if (h) {
    await h.litellmPool.end();
    await h.pool.end();
    await h.container.stop();
  }
}, 60_000);

function fakeJob(data: unknown): Job {
  return { data, queueName: "reconciliation-discrepancy", id: "rd-1" } as unknown as Job;
}

const SINCE = "2026-05-10T00:00:00.000Z";
const UNTIL = "2026-05-11T00:00:00.000Z";

function payload(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    tenant_id: TENANT,
    since: SINCE,
    until: UNTIL,
    drift_pct: 12.5,
    drift_usd_cents: 7,
    ...over,
  };
}

async function clearLitellm(): Promise<void> {
  if (!h) return;
  await h.litellmPool.query(`DELETE FROM "LiteLLM_SpendLogs"`);
  await h.pool.query(`DELETE FROM usage_ledger`);
}

async function seedSpend(args: {
  request_id: string;
  end_user: string;
  total_tokens: number;
  model: string;
  startTime: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!h) return;
  await h.litellmPool.query(
    `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, total_tokens, model, "startTime", metadata)
     VALUES ($1, $2, 0.001, $3, $4, $5, $6::jsonb)`,
    [
      args.request_id,
      args.end_user,
      args.total_tokens,
      args.model,
      args.startTime,
      args.metadata ? JSON.stringify(args.metadata) : null,
    ],
  );
}

SUITE("reconciliation-discrepancy (D-R3 / CRIT-FIX-08)", () => {
  it("schema rejects when since/until are not ISO datetimes", () => {
    expect(() => reconciliationDiscrepancySchema.parse(payload({ since: "yesterday" }))).toThrow();
  });

  it("schema rejects negative drift values", () => {
    expect(() => reconciliationDiscrepancySchema.parse(payload({ drift_pct: -1 }))).toThrow();
    expect(() => reconciliationDiscrepancySchema.parse(payload({ drift_usd_cents: -1 }))).toThrow();
  });

  it("CRIT-FIX-08 — handler forwards {since, until, tenantId} to runIngestOnce", async () => {
    if (!h) throw new Error("harness");
    const runSpy = vi
      .spyOn(ingestModule, "runIngestOnce")
      .mockResolvedValue({ rowsProcessed: 5, rowsScanned: 5 });
    const fakeIngestDeps = {
      litellmPool: {} as never,
      appOwnerPool: {} as never,
      connection: {} as never,
      redis: new FakeRedis(),
    };
    const handler = buildReconciliationDiscrepancyHandler({
      pool: h.pool,
      ingestDeps: fakeIngestDeps,
    });
    const result = await handler(fakeJob(payload()));
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledWith(fakeIngestDeps, {
      since: SINCE,
      until: UNTIL,
      tenantId: TENANT,
    });
    // Real return type — destructure without `as unknown as` casts.
    expect(result.rowsProcessed).toBe(5);
    expect(result.rowsScanned).toBe(5);
    runSpy.mockRestore();
  });

  it("CRIT-FIX-08 — destructures cleanly (truth-telling return type)", async () => {
    if (!h) throw new Error("harness");
    const runSpy = vi
      .spyOn(ingestModule, "runIngestOnce")
      .mockResolvedValue({ rowsProcessed: 42, rowsScanned: 99 });
    const handler = buildReconciliationDiscrepancyHandler({
      pool: h.pool,
      ingestDeps: {
        litellmPool: {} as never,
        appOwnerPool: {} as never,
        connection: {} as never,
        redis: new FakeRedis(),
      },
    });
    // The previous implementation would have returned undefined here.
    const { rowsProcessed, rowsScanned } = await handler(fakeJob(payload()));
    expect(rowsProcessed).toBe(42);
    expect(rowsScanned).toBe(99);
    runSpy.mockRestore();
  });

  it("propagates errors from runIngestOnce (BullMQ retry surface)", async () => {
    if (!h) throw new Error("harness");
    const runSpy = vi
      .spyOn(ingestModule, "runIngestOnce")
      .mockRejectedValue(new Error("upstream-down"));
    const handler = buildReconciliationDiscrepancyHandler({
      pool: h.pool,
      ingestDeps: {
        litellmPool: {} as never,
        appOwnerPool: {} as never,
        connection: {} as never,
        redis: new FakeRedis(),
      },
    });
    await expect(handler(fakeJob(payload()))).rejects.toThrow("upstream-down");
    runSpy.mockRestore();
  });

  // ---------------------------------------------------------------------
  // End-to-end windowed-backfill integration test. Seeds spend rows
  // inside + outside the [since, until) window for the target tenant
  // AND for a DIFFERENT tenant; asserts only the target tenant's
  // in-window rows are materialized into usage_ledger.
  // ---------------------------------------------------------------------
  it("CRIT-FIX-08 — windowed backfill ingests only rows inside [since,until) for the target tenant", async () => {
    if (!h) throw new Error("harness");
    await clearLitellm();

    // Create a second tenant + user that MUST NOT be touched by the backfill.
    const otherTenant = "22222222-2222-4222-a222-222222222222";
    await h.pool.query(`INSERT INTO tenants (id, name) VALUES ($1, 'other')`, [otherTenant]);
    const otherUserRes = await h.pool.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email) VALUES ($1, 'other@example.com') RETURNING id`,
      [otherTenant],
    );
    const otherUserId = otherUserRes.rows[0]?.id ?? "";

    // Seed: in-window for target tenant, out-of-window for target tenant,
    // in-window for OTHER tenant.
    await seedSpend({
      request_id: "in-target-1",
      end_user: h.userId,
      total_tokens: 100,
      model: "qwen3.6-plus",
      startTime: "2026-05-10T12:00:00.000Z",
      metadata: { openwhispr_request_id: "ow-in-target-1" },
    });
    await seedSpend({
      request_id: "in-target-2",
      end_user: h.userId,
      total_tokens: 200,
      model: "qwen3.6-plus",
      startTime: "2026-05-10T18:00:00.000Z",
      metadata: { openwhispr_request_id: "ow-in-target-2" },
    });
    await seedSpend({
      request_id: "before-window",
      end_user: h.userId,
      total_tokens: 999,
      model: "qwen3.6-plus",
      startTime: "2026-05-09T23:00:00.000Z",
      metadata: { openwhispr_request_id: "ow-before" },
    });
    await seedSpend({
      request_id: "in-other-tenant",
      end_user: otherUserId,
      total_tokens: 500,
      model: "qwen3.6-plus",
      startTime: "2026-05-10T15:00:00.000Z",
      metadata: { openwhispr_request_id: "ow-other" },
    });

    const redis = new FakeRedis();
    const result = await ingestModule.runIngestOnce(
      {
        litellmPool: h.litellmPool,
        appOwnerPool: h.pool,
        connection: {} as never,
        redis,
      },
      { since: SINCE, until: UNTIL, tenantId: TENANT },
    );
    expect(result.rowsScanned).toBe(2);
    expect(result.rowsProcessed).toBe(2);

    // Watermark MUST NOT be advanced in windowed mode.
    expect(await redis.get(ingestModule.WATERMARK_KEY)).toBeNull();

    // usage_ledger has exactly the 2 target-tenant in-window rows.
    const ledger = await h.pool.query<{ request_id: string; tenant_id: string }>(
      `SELECT request_id, tenant_id::text AS tenant_id FROM usage_ledger ORDER BY request_id`,
    );
    expect(ledger.rows.map((r) => r.request_id).sort()).toEqual([
      "ow-in-target-1",
      "ow-in-target-2",
    ]);
    for (const r of ledger.rows) {
      expect(r.tenant_id).toBe(TENANT);
    }

    // Cleanup the second tenant fixture so other tests stay isolated.
    await h.pool.query(`DELETE FROM users WHERE tenant_id = $1`, [otherTenant]);
    await h.pool.query(`DELETE FROM tenants WHERE id = $1`, [otherTenant]);
  });

  it("CRIT-FIX-08 — windowed backfill returns {0,0} when tenant has no users", async () => {
    if (!h) throw new Error("harness");
    await clearLitellm();
    const emptyTenant = "33333333-3333-4333-a333-333333333333";
    // Tenant exists but has zero users.
    await h.pool.query(`INSERT INTO tenants (id, name) VALUES ($1, 'empty')`, [emptyTenant]);
    const redis = new FakeRedis();
    const result = await ingestModule.runIngestOnce(
      {
        litellmPool: h.litellmPool,
        appOwnerPool: h.pool,
        connection: {} as never,
        redis,
      },
      { since: SINCE, until: UNTIL, tenantId: emptyTenant },
    );
    expect(result).toEqual({ rowsProcessed: 0, rowsScanned: 0 });
    await h.pool.query(`DELETE FROM tenants WHERE id = $1`, [emptyTenant]);
  });

  it("CRIT-FIX-08 — windowed mode without tenantId scans every user inside the window", async () => {
    if (!h) throw new Error("harness");
    await clearLitellm();
    await seedSpend({
      request_id: "untenanted-1",
      end_user: h.userId,
      total_tokens: 50,
      model: "qwen3.6-plus",
      startTime: "2026-05-10T10:00:00.000Z",
      metadata: { openwhispr_request_id: "ow-no-tenant-filter" },
    });
    const redis = new FakeRedis();
    const result = await ingestModule.runIngestOnce(
      {
        litellmPool: h.litellmPool,
        appOwnerPool: h.pool,
        connection: {} as never,
        redis,
      },
      { since: SINCE, until: UNTIL }, // no tenantId
    );
    expect(result.rowsScanned).toBe(1);
    expect(result.rowsProcessed).toBe(1);
    expect(await redis.get(ingestModule.WATERMARK_KEY)).toBeNull();
  });
});
