// SPDX-License-Identifier: Apache-2.0
// Phase 6 Plan 06-07 — GREEN tests for typedQueue (D-W3).
//
// We avoid booting a real BullMQ+Redis here (the integration aspect is
// covered by the worker-rls property test in packages/data/). The unit-
// level contract is: typedQueue must `schema.parse(data)` before delegating
// to BullMQ's `.add()` / `.upsertJobScheduler()`. We assert that by
// constructing a typedQueue against a stub Queue and observing parse
// invocations + parsed payload forwarding.
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { typedQueue } from "../../../src/lib/typed-queue.js";

// Minimal stub for ioredis: BullMQ's Queue constructor calls .duplicate(),
// .on(), and various ioredis methods on init. We monkey-patch the Queue
// AFTER construction by replacing the `add` / `upsertJobScheduler` /
// `close` properties. To keep the test fast and Redis-free, we mock the
// BullMQ module entirely.
vi.mock("bullmq", () => {
  return {
    Queue: class FakeQueue {
      name: string;
      opts: unknown;
      added: Array<{ name: string; data: unknown; opts: unknown }> = [];
      schedulers: Array<{
        id: string;
        repeat: unknown;
        jobData: unknown;
      }> = [];
      closed = false;
      constructor(name: string, opts: unknown) {
        this.name = name;
        this.opts = opts;
      }
      async add(jobName: string, data: unknown, opts?: unknown) {
        this.added.push({ name: jobName, data, opts });
        return { id: `${this.added.length}` };
      }
      async upsertJobScheduler(id: string, repeat: unknown, jobData?: unknown) {
        this.schedulers.push({ id, repeat, jobData });
        return { id };
      }
      async close() {
        this.closed = true;
      }
    },
  };
});

const PAYLOAD = z.object({ tenant_id: z.string().uuid(), kind: z.literal("x") });

describe("typedQueue (D-W3)", () => {
  it("parses payload through the Zod schema before queue.add", async () => {
    const parseSpy = vi.spyOn(PAYLOAD, "parse");
    const q = typedQueue("q1", PAYLOAD, { connection: {} as never });
    await q.add("job", {
      tenant_id: "11111111-1111-4111-a111-111111111111",
      kind: "x",
    });
    expect(parseSpy).toHaveBeenCalledTimes(1);
    parseSpy.mockRestore();
  });

  it("forwards parsed data + jobName + opts to the underlying queue.add", async () => {
    const q = typedQueue("q2", PAYLOAD, { connection: {} as never });
    await q.add(
      "do-thing",
      { tenant_id: "22222222-2222-4222-a222-222222222222", kind: "x" },
      { delay: 500 },
    );
    const underlying = q.underlying as unknown as {
      added: Array<{ name: string; data: unknown; opts: unknown }>;
    };
    expect(underlying.added).toHaveLength(1);
    expect(underlying.added[0]).toEqual({
      name: "do-thing",
      data: { tenant_id: "22222222-2222-4222-a222-222222222222", kind: "x" },
      opts: { delay: 500 },
    });
  });

  it("rejects with ZodError when payload doesn't match the schema", async () => {
    const q = typedQueue("q3", PAYLOAD, { connection: {} as never });
    await expect(
      // @ts-expect-error — deliberately bad payload to assert runtime parse.
      q.add("bad", { tenant_id: "not-uuid", kind: "y" }),
    ).rejects.toThrow();
  });

  it("parses scheduler payload too (covers upsertJobScheduler path)", async () => {
    const parseSpy = vi.spyOn(PAYLOAD, "parse");
    const q = typedQueue("q4", PAYLOAD, { connection: {} as never });
    await q.upsertJobScheduler(
      "sched-1",
      { every: 30_000 },
      {
        name: "tick",
        data: {
          tenant_id: "33333333-3333-4333-a333-333333333333",
          kind: "x",
        },
      },
    );
    expect(parseSpy).toHaveBeenCalledTimes(1);
    parseSpy.mockRestore();
  });

  it("upsertJobScheduler with no jobData skips parse (recurring no-payload jobs)", async () => {
    const parseSpy = vi.spyOn(PAYLOAD, "parse");
    const q = typedQueue("q5", PAYLOAD, { connection: {} as never });
    await q.upsertJobScheduler("sched-2", { every: 60_000 });
    expect(parseSpy).not.toHaveBeenCalled();
    parseSpy.mockRestore();
  });

  it("rejects scheduler upsert when jobData payload is invalid", async () => {
    const q = typedQueue("q6", PAYLOAD, { connection: {} as never });
    await expect(
      q.upsertJobScheduler(
        "sched-bad",
        { every: 60_000 },
        {
          name: "tick",
          // @ts-expect-error — bad payload
          data: { tenant_id: "nope", kind: "x" },
        },
      ),
    ).rejects.toThrow();
  });

  it("close() forwards to the underlying queue", async () => {
    const q = typedQueue("q7", PAYLOAD, { connection: {} as never });
    await q.close();
    expect((q.underlying as any).closed).toBe(true);
  });
});
