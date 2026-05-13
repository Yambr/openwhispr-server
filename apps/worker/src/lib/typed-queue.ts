// SPDX-License-Identifier: Apache-2.0
// Phase 6 Plan 06-07 / D-W3 — typedQueue: enqueue-time Zod validation wrapper
// around BullMQ Queue.
//
// Every job payload in Phase 6's 6-queue inventory has a Zod schema next to
// its handler. The enqueue site must parse the payload through that schema
// BEFORE `queue.add(...)` so a producer that drifts from the schema fails
// fast at the call site rather than at job pickup (when the failure surfaces
// as a job-retry storm).
//
// The wrapper preserves the underlying BullMQ Queue (exposed as `.underlying`)
// for advanced operations (waitUntilReady, getJobs, etc.) while gating the
// hot path — `.add()` and `.upsertJobScheduler()` — through `schema.parse()`.
//
// Type-level enforcement: the second parameter of `.add()` is typed as
// `z.infer<typeof schema>`, so a producer passing a structurally wrong
// object gets a TS error at compile time. The runtime `.parse()` catches
// shape drift that survives `as` casts.
import { type JobsOptions, Queue, type QueueOptions } from "bullmq";
import type { z } from "zod";

export interface TypedQueue<S extends z.ZodTypeAny> {
  /** The underlying BullMQ Queue, for advanced operations. */
  readonly underlying: Queue;
  /** Schema-validated enqueue. Throws ZodError if `data` doesn't match. */
  add(jobName: string, data: z.infer<S>, jobsOpts?: JobsOptions): Promise<ReturnType<Queue["add"]>>;
  /** Schema-validated `upsertJobScheduler`. Parses the inner job data when present. */
  upsertJobScheduler(
    schedulerId: string,
    repeatOpts: Parameters<Queue["upsertJobScheduler"]>[1],
    jobData?: { name: string; data: z.infer<S> },
  ): Promise<ReturnType<Queue["upsertJobScheduler"]>>;
  /** Close the underlying queue (BullMQ teardown). */
  close(): Promise<void>;
}

/**
 * Construct a Zod-validated wrapper around a BullMQ Queue.
 *
 * @param name BullMQ queue name (same as `new Queue(name, opts)`).
 * @param schema Zod schema for the job payload.
 * @param opts BullMQ QueueOptions (must include `connection`).
 */
export function typedQueue<S extends z.ZodTypeAny>(
  name: string,
  schema: S,
  opts: QueueOptions,
): TypedQueue<S> {
  const q = new Queue(name, opts);
  return {
    underlying: q,
    async add(jobName, data, jobsOpts) {
      const parsed = schema.parse(data) as z.infer<S>;
      return q.add(jobName, parsed, jobsOpts);
    },
    async upsertJobScheduler(schedulerId, repeatOpts, jobData) {
      if (jobData) {
        // Re-parse so the in-flight scheduler entry can't drift past the
        // type system via `as` casts.
        schema.parse(jobData.data);
      }
      return q.upsertJobScheduler(
        schedulerId,
        repeatOpts,
        // BullMQ's upsertJobScheduler typings differ across minor versions;
        // we forward jobData verbatim after our explicit parse above.
        jobData as Parameters<Queue["upsertJobScheduler"]>[2],
      );
    },
    async close() {
      await q.close();
    },
  };
}
