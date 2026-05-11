// Phase 6 Plan 06-08 — GREEN tests for usage-rollup-daily (D-W5).
//
// Two handlers covered: System dispatcher (reads tenants from owner pool +
// enqueues per-tenant children) and Tenant child (UPSERT into
// usage_rollup_daily).
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Job } from "bullmq";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canRunDocker } from "../lib/can-run-docker.js";
import {
  buildUsageRollupDispatcher,
  buildUsageRollupTenantHandler,
  usageRollupDispatcherSchema,
  usageRollupTenantSchema,
} from "./usage-rollup-daily.js";

const SUITE = canRunDocker() ? describe : describe.skip;
const TENANT_A = "11111111-1111-4111-a111-111111111111";
const TENANT_B = "22222222-2222-4222-a222-222222222222";
const USER_A = "33333333-3333-4333-a333-333333333333";

interface Harness {
  container: StartedPostgreSqlContainer;
  pool: Pool;
}
let h: Harness | undefined;

beforeAll(async () => {
  if (!canRunDocker()) return;
  const container = await new PostgreSqlContainer("postgres:17-bookworm")
    .withDatabase("rollup_test")
    .withUsername("postgres_super")
    .withPassword("pw")
    .start();
  const pool = new Pool({ connectionString: container.getConnectionUri(), max: 6 });
  // Minimal schema mirroring just the columns the rollup job touches.
  await pool.query(
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
  await pool.query(
    `CREATE TABLE usage_rollup_daily (
       tenant_id uuid NOT NULL,
       date date NOT NULL,
       total_units integer NOT NULL DEFAULT 0,
       kind_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
       rolled_up_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (tenant_id, date)
     )`,
  );
  h = { container, pool };
}, 120_000);

afterAll(async () => {
  if (h) {
    await h.pool.end();
    await h.container.stop();
  }
}, 60_000);

function fakeJob(data: unknown, qn = "q"): Job {
  return { data, queueName: qn, id: "rj-1" } as unknown as Job;
}

SUITE("usage-rollup-daily dispatcher (System)", () => {
  it("schema accepts {date: 'YYYY-MM-DD'} and rejects other shapes", () => {
    expect(() => usageRollupDispatcherSchema.parse({ date: "2026-05-11" })).not.toThrow();
    expect(() => usageRollupDispatcherSchema.parse({ date: "11/05/2026" })).toThrow();
  });

  it("SELECTs distinct tenant_ids in the date window and enqueues one child per tenant", async () => {
    if (!h) throw new Error("harness");
    await h.pool.query("TRUNCATE usage_ledger, usage_rollup_daily");
    // Seed 3 rows for tenant A on 2026-05-10 + 1 row for tenant B same day +
    // 1 row for tenant A on a DIFFERENT day (must NOT be enqueued).
    await h.pool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units, created_at) VALUES
       ($1::uuid, $3::uuid, 'r1', 'transcribe_minutes', 1, '2026-05-10 12:00:00+00'),
       ($1::uuid, $3::uuid, 'r2', 'transcribe_minutes', 2, '2026-05-10 13:00:00+00'),
       ($1::uuid, $3::uuid, 'r3', 'reason_tokens',      100, '2026-05-10 14:00:00+00'),
       ($2::uuid, $3::uuid, 'r4', 'reason_tokens',      50, '2026-05-10 15:00:00+00'),
       ($1::uuid, $3::uuid, 'r5', 'reason_tokens',      999, '2026-05-09 09:00:00+00')`,
      [TENANT_A, TENANT_B, USER_A],
    );

    const enqueued: Array<{ tenant_id: string; date: string }> = [];
    const dispatcher = buildUsageRollupDispatcher({
      ownerPool: h.pool,
      childQueue: {
        async add(_name, data) {
          enqueued.push(data as { tenant_id: string; date: string });
          return {} as never;
        },
      },
    });
    await dispatcher(fakeJob({ date: "2026-05-10" }));

    expect(enqueued).toHaveLength(2);
    const tenants = new Set(enqueued.map((e) => e.tenant_id));
    expect(tenants.has(TENANT_A)).toBe(true);
    expect(tenants.has(TENANT_B)).toBe(true);
    for (const e of enqueued) expect(e.date).toBe("2026-05-10");
  });

  it("emits zero enqueues when the date window has no ledger rows", async () => {
    if (!h) throw new Error("harness");
    await h.pool.query("TRUNCATE usage_ledger, usage_rollup_daily");
    const enqueued: unknown[] = [];
    const dispatcher = buildUsageRollupDispatcher({
      ownerPool: h.pool,
      childQueue: {
        async add(_n, d) {
          enqueued.push(d);
          return {} as never;
        },
      },
    });
    await dispatcher(fakeJob({ date: "2026-05-10" }));
    expect(enqueued).toHaveLength(0);
  });
});

SUITE("usage-rollup-daily tenant child (Tenant)", () => {
  it("schema requires {tenant_id (uuid), date (YYYY-MM-DD)}", () => {
    expect(() =>
      usageRollupTenantSchema.parse({ tenant_id: "not-uuid", date: "2026-05-10" }),
    ).toThrow();
    expect(() =>
      usageRollupTenantSchema.parse({ tenant_id: TENANT_A, date: "2026-05-10" }),
    ).not.toThrow();
  });

  it("UPSERTs aggregated total + kind_breakdown into usage_rollup_daily", async () => {
    if (!h) throw new Error("harness");
    await h.pool.query("TRUNCATE usage_ledger, usage_rollup_daily");
    await h.pool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units, created_at) VALUES
       ($1::uuid, $2::uuid, 'rr1', 'transcribe_minutes', 3, '2026-05-10 10:00:00+00'),
       ($1::uuid, $2::uuid, 'rr2', 'transcribe_minutes', 4, '2026-05-10 11:00:00+00'),
       ($1::uuid, $2::uuid, 'rr3', 'reason_tokens', 200, '2026-05-10 12:00:00+00')`,
      [TENANT_A, USER_A],
    );

    const handler = buildUsageRollupTenantHandler({ pool: h.pool });
    await handler(fakeJob({ tenant_id: TENANT_A, date: "2026-05-10" }));

    const { rows } = await h.pool.query<{
      total_units: number;
      kind_breakdown: Record<string, number>;
    }>(
      "SELECT total_units, kind_breakdown FROM usage_rollup_daily WHERE tenant_id = $1::uuid AND date = '2026-05-10'",
      [TENANT_A],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.total_units).toBe(207);
    expect(rows[0]?.kind_breakdown).toEqual({
      transcribe_minutes: 7,
      reason_tokens: 200,
    });
  });

  it("is idempotent — re-running the same (tenant, date) replaces the row", async () => {
    if (!h) throw new Error("harness");
    await h.pool.query("TRUNCATE usage_ledger, usage_rollup_daily");
    await h.pool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units, created_at)
       VALUES ($1::uuid, $2::uuid, 'one', 'reason_tokens', 10, '2026-05-10 09:00:00+00')`,
      [TENANT_A, USER_A],
    );
    const handler = buildUsageRollupTenantHandler({ pool: h.pool });
    await handler(fakeJob({ tenant_id: TENANT_A, date: "2026-05-10" }));
    // Append more ledger rows then re-run.
    await h.pool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units, created_at)
       VALUES ($1::uuid, $2::uuid, 'two', 'reason_tokens', 5, '2026-05-10 10:00:00+00')`,
      [TENANT_A, USER_A],
    );
    await handler(fakeJob({ tenant_id: TENANT_A, date: "2026-05-10" }));
    const { rows } = await h.pool.query<{ total_units: number }>(
      "SELECT total_units FROM usage_rollup_daily WHERE tenant_id = $1::uuid AND date = '2026-05-10'",
      [TENANT_A],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.total_units).toBe(15);
  });

  it("inserts an empty rollup when no ledger rows exist for the day", async () => {
    if (!h) throw new Error("harness");
    await h.pool.query("TRUNCATE usage_ledger, usage_rollup_daily");
    const handler = buildUsageRollupTenantHandler({ pool: h.pool });
    await handler(fakeJob({ tenant_id: TENANT_B, date: "2026-05-10" }));
    const { rows } = await h.pool.query<{
      total_units: number;
      kind_breakdown: Record<string, unknown>;
    }>("SELECT total_units, kind_breakdown FROM usage_rollup_daily WHERE tenant_id = $1::uuid", [
      TENANT_B,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.total_units).toBe(0);
    expect(rows[0]?.kind_breakdown).toEqual({});
  });
});
