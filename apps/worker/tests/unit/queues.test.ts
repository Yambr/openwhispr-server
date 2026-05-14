// SPDX-License-Identifier: Apache-2.0
// Phase 6 Plan 06-08 — GREEN tests for the typed queue registry.
//
// BullMQ Queue is mocked entirely (same approach as typed-queue.test.ts).
// We verify that buildQueueRegistry constructs typedQueue instances for
// all 8 documented queue names and that closeQueueRegistry awaits every
// underlying close().

import { describe, expect, it, vi } from "vitest";

vi.mock("bullmq", () => {
  return {
    Queue: class FakeQueue {
      name: string;
      closed = false;
      constructor(name: string) {
        this.name = name;
      }
      async add() {
        return { id: "1" };
      }
      async upsertJobScheduler() {
        return { id: "s" };
      }
      async close() {
        this.closed = true;
      }
    },
  };
});

const { QUEUE_NAMES, buildQueueRegistry, closeQueueRegistry, DEFAULT_JOB_OPTS } = await import(
  "../../src/queues"
);

describe("queues.ts — typed queue registry (Phase 6 Plan 06-08)", () => {
  it("exposes the 7 documented queue names", () => {
    // Phase 14 / Plan 05 — virtualKeyRotation was removed (CONTEXT
    // decision 3 + BYOK-03 audit closure). The previous 8th queue is
    // gone wholesale, not stubbed.
    expect(Object.keys(QUEUE_NAMES)).toHaveLength(7);
    expect(QUEUE_NAMES).toMatchObject({
      emailDelivery: "email-delivery",
      usageRollupDispatcher: "usage-rollup-daily-dispatcher",
      usageRollupTenant: "usage-rollup-daily-tenant",
      reconciliationDailyCheck: "reconciliation-daily-check",
      reconciliationDiscrepancy: "reconciliation-discrepancy",
      partmanMaintenance: "partman-maintenance",
      auditArchive: "audit-archive",
    });
  });

  it("buildQueueRegistry constructs a typed handle for every queue", () => {
    const reg = buildQueueRegistry({} as never);
    for (const key of Object.keys(QUEUE_NAMES) as Array<keyof typeof QUEUE_NAMES>) {
      expect((reg as any)[key]).toBeDefined();
      expect((reg as any)[key].underlying.name).toBe(QUEUE_NAMES[key]);
    }
  });

  it("DEFAULT_JOB_OPTS configures exponential retry policy", () => {
    expect(DEFAULT_JOB_OPTS.attempts).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_JOB_OPTS.backoff.type).toBe("exponential");
    expect(DEFAULT_JOB_OPTS.removeOnComplete).toBeDefined();
    expect(DEFAULT_JOB_OPTS.removeOnFail).toBeDefined();
  });

  it("closeQueueRegistry closes every underlying queue", async () => {
    const reg = buildQueueRegistry({} as never);
    await closeQueueRegistry(reg);
    for (const key of Object.keys(QUEUE_NAMES) as Array<keyof typeof QUEUE_NAMES>) {
      expect((reg as any)[key].underlying.closed).toBe(true);
    }
  });
});
