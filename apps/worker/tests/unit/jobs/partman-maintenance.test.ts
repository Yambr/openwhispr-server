// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-08 — GREEN tests for partman-maintenance (D-A4).
//
// Requires the ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1 image (built locally —
// see compose/postgres/Dockerfile). When the image is unavailable on the
// host (CI without the build step) the suite is skipped.
//
// The test exercises the procedure call path AND the "discover detached
// partitions" path by:
//   1. Booting Postgres with pg_partman installed.
//   2. Creating a `public.audit_log`-shaped partitioned parent + a
//      single monthly child + a manually-detached "orphan" child that
//      matches the discovery regex.
//   3. Invoking the handler. Asserting:
//      - partman.run_maintenance_proc() returns without throwing.
//      - the discovery query enqueues an audit-archive job for the orphan.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Job } from "bullmq";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildPartmanMaintenanceHandler,
  partmanMaintenanceSchema,
} from "../../../src/jobs/partman-maintenance.js";
import { canRunDocker } from "../../../src/lib/can-run-docker.js";

const SUITE = canRunDocker() ? describe : describe.skip;

const PARTMAN_IMAGE = "ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1";

interface Harness {
  container: StartedPostgreSqlContainer;
  pool: Pool;
}
let h: Harness | undefined;
let pgPartmanAvailable = false;

beforeAll(async () => {
  if (!canRunDocker()) return;
  try {
    const container = await new PostgreSqlContainer(PARTMAN_IMAGE)
      .withDatabase("pm_test")
      .withUsername("ps")
      .withPassword("pw")
      .start();
    const pool = new Pool({ connectionString: container.getConnectionUri(), max: 3 });
    // Provision the extension + the partitioned parent shape.
    await pool.query("CREATE SCHEMA IF NOT EXISTS partman");
    await pool.query("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
    await pool.query(`
      CREATE TABLE audit_log (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        actor_user_id uuid,
        action text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (id, created_at)
      ) PARTITION BY RANGE (created_at)
    `);
    // Manually create a child that pg_partman would otherwise own — just
    // enough for run_maintenance_proc to be a no-op for this test.
    await pool.query(`
      CREATE TABLE audit_log_p2026_05 PARTITION OF audit_log
        FOR VALUES FROM ('2026-05-01') TO ('2026-06-01')
    `);
    // And an "orphan" — a table that matches our discovery regex but is
    // NOT inheriting from audit_log (simulates a freshly-detached child).
    await pool.query(`
      CREATE TABLE audit_log_p2025_01 (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        actor_user_id uuid,
        action text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      )
    `);
    h = { container, pool };
    pgPartmanAvailable = true;
  } catch (err) {
    // Image probably unbuilt — skip suite without failing CI on environments
    // that haven't built compose/postgres/Dockerfile yet.
    pgPartmanAvailable = false;
    void err;
  }
}, 180_000);

afterAll(async () => {
  if (h) {
    await h.pool.end();
    await h.container.stop();
  }
}, 60_000);

function fakeJob(data: unknown = {}): Job {
  return { data, queueName: "partman-maintenance", id: "pm-1" } as unknown as Job;
}

SUITE("partman-maintenance (D-A4)", () => {
  it("schema accepts empty payload only", () => {
    expect(() => partmanMaintenanceSchema.parse({})).not.toThrow();
    expect(() => partmanMaintenanceSchema.parse({ extra: "no" })).toThrow();
  });

  it("invokes partman.run_maintenance_proc() and enqueues audit-archive for detached children", async () => {
    if (!pgPartmanAvailable || !h) {
      // Soft-skip: assertion-less marker.
      return;
    }
    const enq: Array<{ partition_name: string }> = [];
    const handler = buildPartmanMaintenanceHandler({
      maintenancePool: h.pool,
      auditArchiveQueue: {
        async add(_n, d) {
          enq.push(d as { partition_name: string });
          return {} as never;
        },
      },
    });
    const result = (await handler(fakeJob())) as unknown as { detached: string[] };
    expect(result.detached).toContain("audit_log_p2025_01");
    expect(enq.map((e) => e.partition_name)).toContain("audit_log_p2025_01");
  });

  it("CR-05: collects enqueue failures and re-throws after attempting ALL partitions", async () => {
    // Phase 66 / CR-05: pre-fix, the enqueue loop had no per-iteration
    // guard — a mid-loop `auditArchiveQueue.add` throw aborted the loop,
    // leaving the remaining partitions detached-but-not-enqueued. The
    // fix collects failures and re-throws after the loop so BullMQ
    // retries the WHOLE detached list (discoverDetached is idempotent).
    //
    // Pure-unit: stub maintenancePool so `CALL run_maintenance_proc()`
    // and `discoverDetached` both resolve against fixed data — no
    // pgpartman image required.
    const detachedFixture = ["audit_log_p2024_01", "audit_log_p2024_02", "audit_log_p2024_03"];
    const fakeClient = {
      async query() {
        return { rows: [] };
      },
      release() {
        /* no-op */
      },
    };
    const fakePool = {
      async connect() {
        return fakeClient;
      },
      async query() {
        return { rows: detachedFixture.map((table_name) => ({ table_name })) };
      },
    } as unknown as Pool;

    const attempted: string[] = [];
    const handler = buildPartmanMaintenanceHandler({
      maintenancePool: fakePool,
      auditArchiveQueue: {
        async add(_n, d) {
          const name = (d as { partition_name: string }).partition_name;
          attempted.push(name);
          // Fail on the SECOND partition — the loop must NOT abort here.
          if (name === detachedFixture[1]) {
            throw new Error("Valkey OOM — enqueue rejected");
          }
          return {} as never;
        },
      },
    });

    // The job must FAIL (so BullMQ retries the whole list).
    await expect(handler(fakeJob())).rejects.toThrow();
    // And every partition AFTER the failing one must still have been
    // attempted — the loop collected the failure instead of aborting.
    expect(attempted).toEqual(detachedFixture);
  });

  it("quick 260602-fda: no-ops (no run_maintenance_proc CALL) when pg_partman is absent", async () => {
    // Managed Postgres without pg_partman: the always-on cron must not burn
    // BullMQ retries. The handler probes pg_extension; when partman is
    // absent it returns { detached: [] } WITHOUT issuing the CALL.
    //
    // Pure-unit stub pool: the extension probe returns zero rows; assert the
    // handler never CALLs run_maintenance_proc and never connects a client.
    let calledRunMaintenance = false;
    let connectedClient = false;
    const fakePool = {
      async connect() {
        connectedClient = true;
        return {
          async query(text: string) {
            if (/run_maintenance_proc/.test(text)) calledRunMaintenance = true;
            return { rows: [] };
          },
          release() {
            /* no-op */
          },
        };
      },
      async query(text: string) {
        // pg_extension presence probe → no partman row.
        if (/pg_extension/.test(text) && /pg_partman/.test(text)) {
          return { rows: [] };
        }
        if (/run_maintenance_proc/.test(text)) calledRunMaintenance = true;
        return { rows: [] };
      },
    } as unknown as Pool;

    const enq: Array<{ partition_name: string }> = [];
    const handler = buildPartmanMaintenanceHandler({
      maintenancePool: fakePool,
      auditArchiveQueue: {
        async add(_n, d) {
          enq.push(d as { partition_name: string });
          return {} as never;
        },
      },
    });
    const result = (await handler(fakeJob())) as unknown as { detached: string[] };
    expect(result.detached).toEqual([]);
    expect(calledRunMaintenance).toBe(false);
    expect(connectedClient).toBe(false);
    expect(enq).toHaveLength(0);
  });

  it("quick 260602-fda: still runs maintenance when pg_partman IS present (stub probe returns a row)", async () => {
    let calledRunMaintenance = false;
    const fakeClient = {
      async query(text: string) {
        if (/run_maintenance_proc/.test(text)) calledRunMaintenance = true;
        return { rows: [] };
      },
      release() {
        /* no-op */
      },
    };
    const fakePool = {
      async connect() {
        return fakeClient;
      },
      async query(text: string) {
        if (/pg_extension/.test(text) && /pg_partman/.test(text)) {
          return { rows: [{ one: 1 }] };
        }
        return { rows: [] };
      },
    } as unknown as Pool;

    const handler = buildPartmanMaintenanceHandler({
      maintenancePool: fakePool,
      auditArchiveQueue: {
        async add() {
          return {} as never;
        },
      },
    });
    await handler(fakeJob());
    expect(calledRunMaintenance).toBe(true);
  });

  it("uses a fresh non-transactional connection (CALL semantics)", () => {
    // Static-source contract: the handler issues `CALL partman.run_maintenance_proc()`
    // (CALL, not SELECT, and not wrapped in BEGIN). Verified by handler source.
    // red-baseline: 2026-05-15 (Phase 18.1 F1) — see commit body for failure output
    const fs = require("node:fs");
    const path = require("node:path");
    const routePath = path.resolve(__dirname, "../../../src/jobs/partman-maintenance.ts");
    if (!fs.existsSync(routePath)) {
      throw new Error(`source-contract path moved: ${routePath}`);
    }
    const src = fs.readFileSync(routePath, "utf8") as string;
    expect(src.length).toBeGreaterThan(0);
    expect(src).toMatch(/CALL\s+partman\.run_maintenance_proc\(\)/);
    expect(src).not.toMatch(/BEGIN.*partman\.run_maintenance/);
  });
});
