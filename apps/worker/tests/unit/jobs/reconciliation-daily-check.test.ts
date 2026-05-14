// SPDX-License-Identifier: Apache-2.0
// Phase 6 Plan 06-08 — GREEN tests for reconciliation-daily-check (D-R2).
//
// Two Postgres containers (LiteLLM-shaped + app-shaped). Stubs the
// discrepancy queue. Asserts drift store population, threshold breach,
// and child enqueue per tenant.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Job } from "bullmq";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  _driftPctGaugeCallback,
  _driftUsdGaugeCallback,
  _readDriftStoreForTest,
  _resetDriftStoreForTest,
  buildReconciliationDailyCheckHandler,
  reconciliationDailyCheckSchema,
} from "../../../src/jobs/reconciliation-daily-check.js";
import { canRunDocker } from "../../../src/lib/can-run-docker.js";

const SUITE = canRunDocker() ? describe : describe.skip;
const TENANT_A = "11111111-1111-4111-a111-111111111111";
const TENANT_B = "22222222-2222-4222-a222-222222222222";
const USER_A = "33333333-3333-4333-a333-333333333333";
const USER_B = "44444444-4444-4444-a444-444444444444";

interface Harness {
  ll: StartedPostgreSqlContainer;
  app: StartedPostgreSqlContainer;
  llPool: Pool;
  appPool: Pool;
}
let h: Harness | undefined;

beforeAll(async () => {
  if (!canRunDocker()) return;
  const [ll, app] = await Promise.all([
    new PostgreSqlContainer("postgres:17-bookworm")
      .withDatabase("ll_test")
      .withUsername("ps")
      .withPassword("pw")
      .start(),
    new PostgreSqlContainer("postgres:17-bookworm")
      .withDatabase("app_test")
      .withUsername("ps")
      .withPassword("pw")
      .start(),
  ]);
  const llPool = new Pool({ connectionString: ll.getConnectionUri(), max: 4 });
  const appPool = new Pool({ connectionString: app.getConnectionUri(), max: 4 });
  await llPool.query(
    `CREATE TABLE "LiteLLM_SpendLogs" (
       request_id text NOT NULL,
       "end_user" text,
       spend numeric NOT NULL DEFAULT 0,
       "startTime" timestamptz NOT NULL DEFAULT now()
     )`,
  );
  await appPool.query(`CREATE TABLE users (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)`);
  await appPool.query(
    `CREATE TABLE usage_ledger (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id uuid NOT NULL,
       user_id uuid NOT NULL,
       request_id text NOT NULL,
       kind text NOT NULL,
       units integer NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  await appPool.query(`INSERT INTO users (id, tenant_id) VALUES ($1, $2), ($3, $4)`, [
    USER_A,
    TENANT_A,
    USER_B,
    TENANT_B,
  ]);
  h = { ll, app, llPool, appPool };
}, 180_000);

afterAll(async () => {
  if (h) {
    await h.llPool.end();
    await h.appPool.end();
    await h.ll.stop();
    await h.app.stop();
  }
}, 60_000);

beforeEach(async () => {
  if (!h) return;
  await h.llPool.query(`TRUNCATE "LiteLLM_SpendLogs"`);
  await h.appPool.query("TRUNCATE usage_ledger");
  _resetDriftStoreForTest();
});

function fakeJob(data: unknown): Job {
  return { data, queueName: "reconciliation-daily-check", id: "rd-1" } as unknown as Job;
}

const WIN = {
  window_start: "2026-05-10T00:00:00Z",
  window_end: "2026-05-11T00:00:00Z",
};

SUITE("reconciliation-daily-check (D-R2)", () => {
  it("schema rejects non-ISO timestamps", () => {
    expect(() =>
      reconciliationDailyCheckSchema.parse({
        window_start: "2026/05/10",
        window_end: WIN.window_end,
      }),
    ).toThrow();
  });

  it("emits zero drift entries when LiteLLM and ledger row counts match", async () => {
    if (!h) throw new Error("harness");
    await h.llPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, "startTime") VALUES
       ('r1', $1, 0, '2026-05-10 10:00:00+00'),
       ('r2', $1, 0, '2026-05-10 11:00:00+00')`,
      [USER_A],
    );
    await h.appPool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units, created_at) VALUES
       ($1::uuid, $2::uuid, 'r1', 'reason_tokens', 1, '2026-05-10 10:00:00+00'),
       ($1::uuid, $2::uuid, 'r2', 'reason_tokens', 1, '2026-05-10 11:00:00+00')`,
      [TENANT_A, USER_A],
    );
    const enq: unknown[] = [];
    const handler = buildReconciliationDailyCheckHandler({
      litellmPool: h.llPool,
      appOwnerPool: h.appPool,
      discrepancyQueue: {
        async add(_n, d) {
          enq.push(d);
          return {} as never;
        },
      },
      env: () => undefined,
    });
    const result = (await handler(fakeJob(WIN))) as unknown as {
      tenants: number;
      breached: number;
    };
    expect(result.breached).toBe(0);
    const store = _readDriftStoreForTest();
    const a = store.get(TENANT_A);
    expect(a?.drift_pct).toBe(0);
  });

  it("computes drift_pct when LiteLLM has rows the ledger missed and enqueues a child", async () => {
    if (!h) throw new Error("harness");
    // 4 LiteLLM rows but only 1 ledger row for tenant A → 75% drift.
    await h.llPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, "startTime") VALUES
       ('a1', $1, 0, '2026-05-10 09:00:00+00'),
       ('a2', $1, 0, '2026-05-10 10:00:00+00'),
       ('a3', $1, 0, '2026-05-10 11:00:00+00'),
       ('a4', $1, 0, '2026-05-10 12:00:00+00')`,
      [USER_A],
    );
    await h.appPool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units, created_at)
       VALUES ($1::uuid, $2::uuid, 'a1', 'reason_tokens', 1, '2026-05-10 09:00:00+00')`,
      [TENANT_A, USER_A],
    );
    const enq: Array<{ tenant_id: string; drift_pct: number }> = [];
    const handler = buildReconciliationDailyCheckHandler({
      litellmPool: h.llPool,
      appOwnerPool: h.appPool,
      discrepancyQueue: {
        async add(_n, d) {
          enq.push(d as { tenant_id: string; drift_pct: number });
          return {} as never;
        },
      },
      env: () => undefined,
    });
    await handler(fakeJob(WIN));
    expect(enq).toHaveLength(1);
    expect(enq[0]?.tenant_id).toBe(TENANT_A);
    expect(enq[0]?.drift_pct).toBeCloseTo(75, 1);
  });

  it("skips zero-activity tenants from the gauge store (cardinality bound)", async () => {
    if (!h) throw new Error("harness");
    // No rows seeded anywhere — driftStore stays empty.
    const handler = buildReconciliationDailyCheckHandler({
      litellmPool: h.llPool,
      appOwnerPool: h.appPool,
      discrepancyQueue: {
        async add() {
          return {} as never;
        },
      },
      env: () => undefined,
    });
    await handler(fakeJob(WIN));
    expect(_readDriftStoreForTest().size).toBe(0);
  });

  it("honors RECONCILIATION_DRIFT_PCT_THRESHOLD env override", async () => {
    if (!h) throw new Error("harness");
    // 2 LiteLLM rows, 1 ledger row → 50% drift. With threshold=60 the
    // breach must NOT enqueue.
    await h.llPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, "startTime") VALUES
       ('x1', $1, 0, '2026-05-10 09:00:00+00'),
       ('x2', $1, 0, '2026-05-10 10:00:00+00')`,
      [USER_A],
    );
    await h.appPool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units, created_at)
       VALUES ($1::uuid, $2::uuid, 'x1', 'reason_tokens', 1, '2026-05-10 09:00:00+00')`,
      [TENANT_A, USER_A],
    );
    const enq: unknown[] = [];
    const handler = buildReconciliationDailyCheckHandler({
      litellmPool: h.llPool,
      appOwnerPool: h.appPool,
      discrepancyQueue: {
        async add(_n, d) {
          enq.push(d);
          return {} as never;
        },
      },
      env: (k) =>
        k === "RECONCILIATION_DRIFT_PCT_THRESHOLD"
          ? "60"
          : k === "RECONCILIATION_DRIFT_USD_CENTS_THRESHOLD"
            ? "1000"
            : undefined,
    });
    await handler(fakeJob(WIN));
    expect(enq).toHaveLength(0);
  });

  it("OTel gauge callbacks emit one observation per tenant in the drift store", async () => {
    if (!h) throw new Error("harness");
    _resetDriftStoreForTest();
    // Seed the store by running the handler once with a breaching tenant.
    await h.llPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, "startTime") VALUES
       ('cb1', $1, 1.50, '2026-05-10 09:00:00+00')`,
      [USER_A],
    );
    const handler = buildReconciliationDailyCheckHandler({
      litellmPool: h.llPool,
      appOwnerPool: h.appPool,
      discrepancyQueue: {
        async add() {
          return {} as never;
        },
      },
      env: () => undefined,
    });
    await handler(fakeJob(WIN));
    // Now invoke the callbacks against a stub observer.
    const observations: Array<[number, Record<string, string>]> = [];
    const stub = {
      observe: (v: number, attrs: Record<string, string>) => observations.push([v, attrs]),
    };
    _driftPctGaugeCallback(stub);
    _driftUsdGaugeCallback(stub);
    // Both gauges emit one observation per tenant in the store (1 here).
    expect(observations.length).toBe(2);
    expect(observations[0]?.[1].tenant_id).toBe(TENANT_A);
  });

  it("falls back to default thresholds when env returns non-numeric values", async () => {
    if (!h) throw new Error("harness");
    await h.llPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, "startTime") VALUES
       ('nn1', $1, 0, '2026-05-10 09:00:00+00'),
       ('nn2', $1, 0, '2026-05-10 10:00:00+00')`,
      [USER_A],
    );
    await h.appPool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units, created_at)
       VALUES ($1::uuid, $2::uuid, 'nn1', 'reason_tokens', 1, '2026-05-10 09:00:00+00')`,
      [TENANT_A, USER_A],
    );
    const enq: unknown[] = [];
    const handler = buildReconciliationDailyCheckHandler({
      litellmPool: h.llPool,
      appOwnerPool: h.appPool,
      discrepancyQueue: {
        async add(_n, d) {
          enq.push(d);
          return {} as never;
        },
      },
      env: (k) =>
        k === "RECONCILIATION_DRIFT_PCT_THRESHOLD"
          ? "not-a-number"
          : k === "RECONCILIATION_DRIFT_USD_CENTS_THRESHOLD"
            ? "garbage"
            : undefined,
    });
    await handler(fakeJob(WIN));
    // With defaults (0.5 / 1), the 50% drift breaches → discrepancy enqueued.
    expect(enq).toHaveLength(1);
  });

  it("emits ledger-only tenants (no LiteLLM rows) into the drift store as 100% drift", async () => {
    if (!h) throw new Error("harness");
    await h.appPool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units, created_at)
       VALUES ($1::uuid, $2::uuid, 'lo', 'reason_tokens', 1, '2026-05-10 09:00:00+00')`,
      [TENANT_B, USER_B],
    );
    const handler = buildReconciliationDailyCheckHandler({
      litellmPool: h.llPool,
      appOwnerPool: h.appPool,
      discrepancyQueue: {
        async add() {
          return {} as never;
        },
      },
      env: () => undefined,
    });
    await handler(fakeJob(WIN));
    const store = _readDriftStoreForTest();
    expect(store.get(TENANT_B)?.drift_pct).toBe(100);
  });

  it("skips LiteLLM rows with NULL end_user", async () => {
    if (!h) throw new Error("harness");
    await h.llPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, "startTime")
       VALUES ('null1', NULL, 0, '2026-05-10 09:00:00+00')`,
    );
    const handler = buildReconciliationDailyCheckHandler({
      litellmPool: h.llPool,
      appOwnerPool: h.appPool,
      discrepancyQueue: {
        async add() {
          return {} as never;
        },
      },
      env: () => undefined,
    });
    await handler(fakeJob(WIN));
    expect(_readDriftStoreForTest().size).toBe(0);
  });

  it("skips LiteLLM rows whose end_user has no matching user row", async () => {
    if (!h) throw new Error("harness");
    const ORPHAN = "99999999-9999-4999-a999-999999999999";
    await h.llPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, "startTime")
       VALUES ('orphan1', $1, 0, '2026-05-10 09:00:00+00')`,
      [ORPHAN],
    );
    const handler = buildReconciliationDailyCheckHandler({
      litellmPool: h.llPool,
      appOwnerPool: h.appPool,
      discrepancyQueue: {
        async add() {
          return {} as never;
        },
      },
      env: () => undefined,
    });
    await handler(fakeJob(WIN));
    expect(_readDriftStoreForTest().size).toBe(0);
  });

  it("uses process.env when deps.env is not provided (default branch)", async () => {
    if (!h) throw new Error("harness");
    // Don't seed any rows — just confirm handler construction with no env
    // override completes.
    const handler = buildReconciliationDailyCheckHandler({
      litellmPool: h.llPool,
      appOwnerPool: h.appPool,
      discrepancyQueue: {
        async add() {
          return {} as never;
        },
      },
    });
    await handler(fakeJob(WIN));
    expect(_readDriftStoreForTest().size).toBe(0);
  });

  it("honors RECONCILIATION_DRIFT_USD_CENTS_THRESHOLD env override", async () => {
    if (!h) throw new Error("harness");
    await h.llPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, "startTime") VALUES
       ('y1', $1, 5.00, '2026-05-10 09:00:00+00')`,
      [USER_A],
    );
    // No ledger row → drift_pct=100, drift_usd_cents=500.
    const enq: Array<{ drift_usd_cents: number }> = [];
    const handler = buildReconciliationDailyCheckHandler({
      litellmPool: h.llPool,
      appOwnerPool: h.appPool,
      discrepancyQueue: {
        async add(_n, d) {
          enq.push(d as { drift_usd_cents: number });
          return {} as never;
        },
      },
      // Pin pct threshold absurdly high so only the usd axis can breach.
      env: (k) =>
        k === "RECONCILIATION_DRIFT_PCT_THRESHOLD"
          ? "10000"
          : k === "RECONCILIATION_DRIFT_USD_CENTS_THRESHOLD"
            ? "1"
            : undefined,
    });
    await handler(fakeJob(WIN));
    expect(enq).toHaveLength(1);
    expect(enq[0]?.drift_usd_cents).toBeGreaterThan(1);
  });
});
