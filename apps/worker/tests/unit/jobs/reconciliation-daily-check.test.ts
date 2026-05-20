// SPDX-License-Identifier: FSL-1.1-ALv2
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
       created_at timestamptz NOT NULL DEFAULT now(),
       event_at timestamptz
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

  // Phase 58 Track B / worker:CR-02 — the ledger-side window must bucket on
  // COALESCE(event_at, created_at), the SAME expression the rollup uses, so
  // the drift gauge stays meaningful. A row whose spend occurred yesterday
  // (event_at in-window) but was ingested today (created_at out-of-window)
  // is counted; LiteLLM buckets the same row by startTime → drift is 0.
  // Pre-fix the ledger query filters on `created_at` → the row is excluded →
  // ledger_count=0 vs litellm_count=1 → false 100% drift breach.
  it("worker:CR-02 — reconciliation buckets ledger rows by event_at, not created_at", async () => {
    if (!h) throw new Error("harness");
    // LiteLLM: one spend row, startTime inside the [05-10, 05-11) window.
    await h.llPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, "startTime")
       VALUES ('late', $1, 0, '2026-05-10 23:59:50+00')`,
      [USER_A],
    );
    // Ledger: same logical row — event_at in-window (yesterday 23:59:50Z),
    // created_at OUT of window (ingested today 00:00:20Z).
    await h.appPool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units, created_at, event_at)
       VALUES ($1::uuid, $2::uuid, 'late', 'reason_tokens', 1,
               '2026-05-11 00:00:20+00', '2026-05-10 23:59:50+00')`,
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
    const result = (await handler(fakeJob(WIN))) as unknown as { breached: number };
    expect(result.breached).toBe(0);
    expect(_readDriftStoreForTest().get(TENANT_A)?.drift_pct).toBe(0);
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

  // Phase 41.d / HI-2 — the per-tenant aggregation loop must resolve
  // user_id -> tenant_id in ONE batched ANY($1::uuid[]) query, not in a
  // per-end_user serialized round-trip. With 2 tenants x 3 users each
  // (6 distinct end_users in LiteLLM_SpendLogs), the old code issued
  // 6 sequential `SELECT tenant_id FROM users WHERE id=$1` queries;
  // the fix issues exactly ONE such query.
  it("resolves user_id->tenant_id in a single batched query (not per-row)", async () => {
    if (!h) throw new Error("harness");
    // Seed 6 distinct end_users spanning 2 tenants.
    const USER_A2 = "33333333-3333-4333-a333-333333333334";
    const USER_A3 = "33333333-3333-4333-a333-333333333335";
    const USER_B2 = "44444444-4444-4444-a444-444444444445";
    const USER_B3 = "44444444-4444-4444-a444-444444444446";
    await h.appPool.query(
      `INSERT INTO users (id, tenant_id) VALUES
       ($1, $5), ($2, $5), ($3, $6), ($4, $6)
       ON CONFLICT (id) DO NOTHING`,
      [USER_A2, USER_A3, USER_B2, USER_B3, TENANT_A, TENANT_B],
    );
    await h.llPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, "startTime") VALUES
       ('m1', $1, 0, '2026-05-10 10:00:00+00'),
       ('m2', $2, 0, '2026-05-10 10:00:00+00'),
       ('m3', $3, 0, '2026-05-10 10:00:00+00'),
       ('m4', $4, 0, '2026-05-10 10:00:00+00'),
       ('m5', $5, 0, '2026-05-10 10:00:00+00'),
       ('m6', $6, 0, '2026-05-10 10:00:00+00')`,
      [USER_A, USER_A2, USER_A3, USER_B, USER_B2, USER_B3],
    );

    // Spy on appOwnerPool to count the user->tenant resolution queries.
    const userTenantQueryCalls: unknown[][] = [];
    const realQuery = h.appPool.query.bind(h.appPool);
    const spyPool: Pool = {
      ...h.appPool,
      query: (async (text: string, params?: unknown[]) => {
        if (
          /FROM\s+users\s+WHERE\s+id\s*=\s*ANY/i.test(text) ||
          /FROM\s+users\s+WHERE\s+id\s*=\s*\$1/i.test(text)
        ) {
          userTenantQueryCalls.push(params ?? []);
        }
        return realQuery(text, params);
      }) as never,
    } as Pool;

    const handler = buildReconciliationDailyCheckHandler({
      litellmPool: h.llPool,
      appOwnerPool: spyPool,
      discrepancyQueue: {
        async add() {
          return {} as never;
        },
      },
      env: () => undefined,
    });
    await handler(fakeJob(WIN));
    // Exactly ONE batched user->tenant resolution query.
    expect(userTenantQueryCalls).toHaveLength(1);
    // Drift store iterates by DISTINCT TENANT (2 tenants), not by
    // distinct end_user (6 users) — exactly two entries.
    expect(_readDriftStoreForTest().size).toBe(2);
  });

  // Phase 41.d / HI-3 — atomic snapshot swap. The OTel exporter fires
  // gauge callbacks every 15s; the handler runs once/day. If the handler
  // mid-mutates module-level driftStore (clear() at start, set() in a
  // for-loop), exporter callbacks firing in the gap observe an empty or
  // partial state. The fix builds a fresh local nextDriftStore inside
  // the handler and atomically swaps it into the module-level
  // driftStore as the LAST statement — so callbacks observe either
  // tick N's complete state or tick N+1's complete state, never a
  // mid-mutation void.
  //
  // RED detection: pause handler execution AFTER its DB queries return
  // but BEFORE it has fully populated driftStore. With the buggy
  // implementation, driftStore.clear() has already run -> callbacks see
  // empty / partial state. With the fixed implementation, driftStore
  // still holds the previous tick's complete snapshot until the final
  // swap.
  it("gauge callbacks observe a consistent snapshot mid-handler (no clear-then-set race)", async () => {
    if (!h) throw new Error("harness");
    // Tick 1: populate driftStore with a known breach.
    await h.llPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, "startTime") VALUES
       ('s1', $1, 0, '2026-05-10 09:00:00+00')`,
      [USER_A],
    );
    let handler = buildReconciliationDailyCheckHandler({
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
    expect(_readDriftStoreForTest().get(TENANT_A)?.drift_pct).toBe(100);

    // Tick 2: install a slow appOwnerPool that yields control AFTER the
    // user->tenant batched query returns — simulating the exporter
    // callback firing in the gap between handler steps.
    await h.llPool.query(`TRUNCATE "LiteLLM_SpendLogs"`);
    await h.llPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, "startTime") VALUES
       ('s2', $1, 0, '2026-05-11 09:00:00+00')`,
      [USER_B],
    );
    const NEXT_WIN = {
      window_start: "2026-05-11T00:00:00Z",
      window_end: "2026-05-12T00:00:00Z",
    };

    const midHandlerObservations: Array<[number, Record<string, string>]> = [];
    handler = buildReconciliationDailyCheckHandler({
      litellmPool: h.llPool,
      appOwnerPool: h.appPool,
      discrepancyQueue: {
        // Hook discrepancyQueue.add — its `await` inside the inner
        // for-loop yields control to the event loop. Simulate the OTel
        // exporter firing during that yield: snapshot driftStore.
        async add() {
          const stub = {
            observe: (v: number, attrs: Record<string, string>) =>
              midHandlerObservations.push([v, attrs]),
          };
          _driftPctGaugeCallback(stub);
          return {} as never;
        },
      },
      env: () => undefined,
    });
    await handler(fakeJob(NEXT_WIN));

    // Mid-handler, the gauge callback MUST have observed tick-1's
    // complete snapshot (tenant A @ 100% drift). The buggy implementation
    // had already called driftStore.clear() then begun re-populating
    // mid-loop — so the observation would see either {} (empty) or
    // {tenant B} (mid-mutation partial), but NEVER {tenant A}. With the
    // fix, driftStore retains tick-1's full snapshot until the atomic
    // swap as the handler's last statement.
    expect(midHandlerObservations).toHaveLength(1);
    expect(midHandlerObservations[0]?.[1].tenant_id).toBe(TENANT_A);
    expect(midHandlerObservations[0]?.[0]).toBe(100);
  });

  it("gauge callbacks observe fresh post-tick state (no stale prior-tick leak)", async () => {
    if (!h) throw new Error("harness");
    // Tick 1: seed a breaching row so driftStore gets populated.
    await h.llPool.query(
      `INSERT INTO "LiteLLM_SpendLogs" (request_id, "end_user", spend, "startTime") VALUES
       ('s1', $1, 0, '2026-05-10 09:00:00+00')`,
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
    // Confirm tick-1 populated the store.
    expect(_readDriftStoreForTest().get(TENANT_A)?.drift_pct).toBe(100);

    // Tick 2: clear LiteLLM rows so no tenants are observed this tick.
    await h.llPool.query(`TRUNCATE "LiteLLM_SpendLogs"`);
    // The next window has zero activity for any tenant. The handler
    // must replace driftStore with the new (empty) snapshot — NOT leave
    // tenant A's stale 100% drift behind for the OTel exporter to
    // re-observe on every 15s collection tick over the next 23h.
    const NEXT_WIN = {
      window_start: "2026-05-11T00:00:00Z",
      window_end: "2026-05-12T00:00:00Z",
    };
    await handler(fakeJob(NEXT_WIN));
    const observations: Array<[number, Record<string, string>]> = [];
    const stub = {
      observe: (v: number, attrs: Record<string, string>) => observations.push([v, attrs]),
    };
    _driftPctGaugeCallback(stub);
    _driftUsdGaugeCallback(stub);
    // No tenant has activity in tick 2 -> zero observations emitted.
    // Previously the store retained tenant A from tick 1 -> two stale
    // observations leaked.
    expect(observations).toHaveLength(0);
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
