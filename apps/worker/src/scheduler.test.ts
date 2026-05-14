// SPDX-License-Identifier: Apache-2.0
// Phase 6 Plan 06-08 — GREEN tests for installSchedulers.
//
// Verifies the 4 recurring jobs land on their queues with the expected cron
// patterns. Queue handles are stubbed (BullMQ Job Scheduler API surface).

import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULER_CONFIG, installSchedulers } from "./scheduler.js";

interface Capture {
  id: string;
  repeat: unknown;
  jobData: unknown;
}

function makeQueueStub() {
  const captures: Capture[] = [];
  return {
    captures,
    async upsertJobScheduler(id: string, repeat: unknown, jobData: unknown) {
      captures.push({ id, repeat, jobData });
      return {} as never;
    },
    // The QueueRegistry typings require these but installSchedulers does
    // not call them.
    async add() {
      return {} as never;
    },
    underlying: {} as never,
    async close() {
      /* noop */
    },
  };
}

function makeRegistry() {
  return {
    usageRollupDispatcher: makeQueueStub(),
    reconciliationDailyCheck: makeQueueStub(),
    partmanMaintenance: makeQueueStub(),
    // Unused but required to match shape.
    emailDelivery: makeQueueStub(),
    usageRollupTenant: makeQueueStub(),
    reconciliationDiscrepancy: makeQueueStub(),
    auditArchive: makeQueueStub(),
  };
}

describe("installSchedulers (Phase 6 Plan 06-08)", () => {
  it("upserts the usage-rollup-daily-dispatcher cron at 5 0 * * *", async () => {
    const r = makeRegistry();
    // biome-ignore lint/suspicious/noExplicitAny: registry shape compat
    await installSchedulers(r as any, {}, new Date("2026-05-11T00:00:00Z"));
    expect(r.usageRollupDispatcher.captures).toHaveLength(1);
    expect(r.usageRollupDispatcher.captures[0]?.repeat).toMatchObject({
      pattern: "5 0 * * *",
      tz: "UTC",
    });
    // biome-ignore lint/suspicious/noExplicitAny: introspection
    expect((r.usageRollupDispatcher.captures[0]?.jobData as any).data.date).toBe("2026-05-11");
  });

  it("upserts reconciliation-daily-check at 0 1 * * * with a 24h window", async () => {
    const r = makeRegistry();
    // biome-ignore lint/suspicious/noExplicitAny: registry shape compat
    await installSchedulers(r as any, {}, new Date("2026-05-11T12:00:00Z"));
    expect(r.reconciliationDailyCheck.captures[0]?.repeat).toMatchObject({
      pattern: "0 1 * * *",
      tz: "UTC",
    });
    // biome-ignore lint/suspicious/noExplicitAny: introspection
    const data = (r.reconciliationDailyCheck.captures[0]?.jobData as any).data;
    expect(data.window_start).toBe("2026-05-10T00:00:00.000Z");
    expect(data.window_end).toBe("2026-05-11T00:00:00.000Z");
  });

  it("upserts partman-maintenance at 0 2 * * * with empty payload", async () => {
    const r = makeRegistry();
    // biome-ignore lint/suspicious/noExplicitAny: registry shape compat
    await installSchedulers(r as any);
    expect(r.partmanMaintenance.captures[0]?.repeat).toMatchObject({
      pattern: "0 2 * * *",
      tz: "UTC",
    });
    // biome-ignore lint/suspicious/noExplicitAny: introspection
    expect((r.partmanMaintenance.captures[0]?.jobData as any).data).toEqual({});
  });

  // Phase 14 / Plan 05 — the virtual-key-rotation cron + queue were
  // removed wholesale (CONTEXT decision 3 + BYOK-03 audit closure).
  // The previous "upserts virtual-key-rotation at 0 3 * * 0" test is
  // deleted; the corresponding negative-assertion lives in
  // tests/integration/virtual-key-rotation-removed.test.ts.

  it("honors override cron strings supplied in SchedulerConfig", async () => {
    const r = makeRegistry();
    // biome-ignore lint/suspicious/noExplicitAny: registry shape compat
    await installSchedulers(r as any, {
      usageRollupCron: "15 0 * * *",
      reconciliationCron: "30 1 * * *",
      partmanCron: "45 2 * * *",
    });
    expect(r.usageRollupDispatcher.captures[0]?.repeat).toMatchObject({ pattern: "15 0 * * *" });
    expect(r.reconciliationDailyCheck.captures[0]?.repeat).toMatchObject({ pattern: "30 1 * * *" });
    expect(r.partmanMaintenance.captures[0]?.repeat).toMatchObject({ pattern: "45 2 * * *" });
  });

  it("DEFAULT_SCHEDULER_CONFIG locks the three documented cron strings", () => {
    expect(DEFAULT_SCHEDULER_CONFIG).toEqual({
      usageRollupCron: "5 0 * * *",
      reconciliationCron: "0 1 * * *",
      partmanCron: "0 2 * * *",
    });
  });
});
