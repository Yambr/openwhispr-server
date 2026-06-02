// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-08 — GREEN tests for installSchedulers.
//
// Verifies the 4 recurring jobs land on their queues with the expected cron
// patterns. Queue handles are stubbed (BullMQ Job Scheduler API surface).

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULER_CONFIG,
  dateStringForJob,
  installSchedulers,
} from "../../src/scheduler.js";

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
  it("upserts the usage-rollup-daily-dispatcher cron at 5 0 * * * (Plan 51-05: empty payload)", async () => {
    // Phase 51 / Plan 51-05 (REVIEW CR-8) — pre-fix the scheduler
    // froze `date` into the payload at install time, so every cron
    // tick re-fired the same boot-day. Now the payload is empty and
    // handlers derive the date from `job.timestamp` themselves.
    const r = makeRegistry();
    await installSchedulers(r as any, {}, new Date("2026-05-11T00:00:00Z"));
    expect(r.usageRollupDispatcher.captures).toHaveLength(1);
    expect(r.usageRollupDispatcher.captures[0]?.repeat).toMatchObject({
      pattern: "5 0 * * *",
      tz: "UTC",
    });
    expect((r.usageRollupDispatcher.captures[0]?.jobData as any).data).toEqual({});
  });

  it("upserts reconciliation-daily-check at 0 1 * * * with empty payload (Plan 51-05)", async () => {
    // Phase 51 / Plan 51-05 — same fix as above; handler derives the
    // 24-hour window from job.timestamp at execution time.
    const r = makeRegistry();
    await installSchedulers(r as any, {}, new Date("2026-05-11T12:00:00Z"));
    expect(r.reconciliationDailyCheck.captures[0]?.repeat).toMatchObject({
      pattern: "0 1 * * *",
      tz: "UTC",
    });
    expect((r.reconciliationDailyCheck.captures[0]?.jobData as any).data).toEqual({});
  });

  it("upserts partman-maintenance at 0 2 * * * with empty payload", async () => {
    const r = makeRegistry();
    await installSchedulers(r as any);
    expect(r.partmanMaintenance.captures[0]?.repeat).toMatchObject({
      pattern: "0 2 * * *",
      tz: "UTC",
    });
    expect((r.partmanMaintenance.captures[0]?.jobData as any).data).toEqual({});
  });

  // Phase 14 / Plan 05 — the virtual-key-rotation cron + queue were
  // removed wholesale (CONTEXT decision 3 + BYOK-03 audit closure).
  // The previous "upserts virtual-key-rotation at 0 3 * * 0" test is
  // deleted; the corresponding negative-assertion lives in
  // tests/integration/virtual-key-rotation-removed.test.ts.

  it("honors override cron strings supplied in SchedulerConfig", async () => {
    const r = makeRegistry();
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

  // Quick 260602-eth — reconciliation scheduler is gated when the worker
  // runs without a LiteLLM DB (external-gateway deploy). usage-rollup +
  // partman ALWAYS install; only reconciliation-daily-check is suppressed.
  it("installs all three schedulers when reconciliationEnabled is omitted (default true)", async () => {
    const r = makeRegistry();
    await installSchedulers(r as any, {});
    expect(r.usageRollupDispatcher.captures).toHaveLength(1);
    expect(r.reconciliationDailyCheck.captures).toHaveLength(1);
    expect(r.partmanMaintenance.captures).toHaveLength(1);
  });

  it("installs all three schedulers when reconciliationEnabled is true", async () => {
    const r = makeRegistry();
    await installSchedulers(r as any, { reconciliationEnabled: true });
    expect(r.reconciliationDailyCheck.captures).toHaveLength(1);
  });

  it("does NOT upsert the reconciliation scheduler when reconciliationEnabled is false", async () => {
    const r = makeRegistry();
    await installSchedulers(r as any, { reconciliationEnabled: false });
    // reconciliation suppressed...
    expect(r.reconciliationDailyCheck.captures).toHaveLength(0);
    // ...but usage-rollup + partman still install.
    expect(r.usageRollupDispatcher.captures).toHaveLength(1);
    expect(r.partmanMaintenance.captures).toHaveLength(1);
  });
});

describe("dateStringForJob (Plan 51-05 helper)", () => {
  it("derives the UTC day from job.timestamp", () => {
    // 2026-05-11T23:30:00Z → same UTC calendar day.
    expect(dateStringForJob({ timestamp: Date.UTC(2026, 4, 11, 23, 30, 0) })).toBe("2026-05-11");
  });

  it("falls back to the current day when timestamp is absent", () => {
    // Without a numeric timestamp the helper uses Date.now(); assert the
    // ISO-date shape rather than an exact day to stay deterministic.
    expect(dateStringForJob({})).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
