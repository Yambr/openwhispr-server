// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-08 — GREEN tests for reconciliation-discrepancy (D-R3).
//
// Real Postgres testcontainer for the withTenantContext pool acquisition;
// the LiteLLM read pool + Redis are stubbed (network boundary).
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Job } from "bullmq";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as ingestModule from "../../../src/jobs/ingest-litellm-spend.js";
import {
  buildReconciliationDiscrepancyHandler,
  reconciliationDiscrepancySchema,
} from "../../../src/jobs/reconciliation-discrepancy.js";
import { canRunDocker } from "../../../src/lib/can-run-docker.js";

const SUITE = canRunDocker() ? describe : describe.skip;
const TENANT = "11111111-1111-4111-a111-111111111111";

interface Harness {
  container: StartedPostgreSqlContainer;
  pool: Pool;
}
let h: Harness | undefined;

beforeAll(async () => {
  if (!canRunDocker()) return;
  const container = await new PostgreSqlContainer("postgres:17-bookworm")
    .withDatabase("rd_test")
    .withUsername("ps")
    .withPassword("pw")
    .start();
  const pool = new Pool({ connectionString: container.getConnectionUri(), max: 4 });
  h = { container, pool };
}, 120_000);

afterAll(async () => {
  if (h) {
    await h.pool.end();
    await h.container.stop();
  }
}, 60_000);

function fakeJob(data: unknown): Job {
  return { data, queueName: "reconciliation-discrepancy", id: "rd-1" } as unknown as Job;
}

const GOOD = {
  tenant_id: TENANT,
  since: "2026-05-10T00:00:00Z",
  until: "2026-05-11T00:00:00Z",
  drift_pct: 12.5,
  drift_usd_cents: 7,
};

SUITE("reconciliation-discrepancy (D-R3)", () => {
  it("schema rejects when since/until are not ISO datetimes", () => {
    expect(() => reconciliationDiscrepancySchema.parse({ ...GOOD, since: "yesterday" })).toThrow();
  });

  it("schema rejects negative drift values", () => {
    expect(() => reconciliationDiscrepancySchema.parse({ ...GOOD, drift_pct: -1 })).toThrow();
    expect(() => reconciliationDiscrepancySchema.parse({ ...GOOD, drift_usd_cents: -1 })).toThrow();
  });

  it("calls runIngestOnce with the supplied ingest deps (Tenant context wrap)", async () => {
    if (!h) throw new Error("harness");
    const runSpy = vi
      .spyOn(ingestModule, "runIngestOnce")
      .mockResolvedValue({ rowsProcessed: 5, rowsScanned: 5 });
    const fakeIngestDeps = {
      // The handler delegates the actual SQL to runIngestOnce; the deps are
      // forwarded verbatim and (here) intercepted by the spy.
      litellmPool: {} as never,
      appOwnerPool: {} as never,
      connection: {} as never,
      redis: {
        async get() {
          return null;
        },
        async set() {
          return "";
        },
      },
    };
    const handler = buildReconciliationDiscrepancyHandler({
      pool: h.pool,
      ingestDeps: fakeIngestDeps,
    });
    await handler(fakeJob(GOOD));
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledWith(fakeIngestDeps);
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
        redis: {
          async get() {
            return null;
          },
          async set() {
            return "";
          },
        },
      },
    });
    await expect(handler(fakeJob(GOOD))).rejects.toThrow("upstream-down");
    runSpy.mockRestore();
  });
});
