// SPDX-License-Identifier: Apache-2.0
// Phase 6 Plan 06-07 / D-W2 — withSystemContext escape hatch for cross-tenant
// BullMQ jobs (ingest-litellm-spend, reconciliation-daily-check, audit-archive,
// partman-maintenance, usage-rollup-daily dispatcher).
//
// Unlike withTenantContext, this HOF:
//   - Does NOT set the `app.tenant_id` GUC. The handler uses an owner pool
//     (BYPASSRLS) and is expected to either (a) operate on un-RLS'd tables
//     like LiteLLM_SpendLogs, or (b) explicitly iterate tenants by wrapping
//     each per-tenant section in `withTenantContext(...)`.
//   - Tags pino MDC + the OTel span with `mode: 'system'` so operators can
//     filter for cross-tenant work and so the app-pool runtime guard skips
//     its TenantContextMissingError raise (D-W4 layer 2).
//   - Does NOT manage a transaction. System jobs handle their own
//     transaction boundaries when needed; many simply do idempotent writes.
//   - Sets AsyncLocalStorage mode='system' with a sentinel tenant id so the
//     runtime guard's lookup succeeds.
//
// The opt-in is explicit: a job wired with this HOF is documenting "I read
// or write across tenants on purpose." The static lint (D-W4 layer 1, Plan
// 06-09) and the property test (D-W4 layer 3) both treat un-wrapped handlers
// as violations.
import { trace } from "@opentelemetry/api";
import { makePino } from "@openwhispr/observability";
import type { Job } from "bullmq";
import type { Logger } from "pino";
import type { z } from "zod";
import { tenantAls } from "./with-tenant-context.js";

const tracer = trace.getTracer("worker");
// Phase 6 / Plan 06-10 — pino instance comes from the shared
// @openwhispr/observability factory so the Worker tier scrubs the SAME
// D-T4 redact paths as the API tier. `service: 'worker'` lets operators
// filter by tier in Loki / Grafana.
const baseLog = makePino({ base: { service: "worker" } });

/** Sentinel tenant id used inside the ALS store for system-mode jobs. */
export const SYSTEM_TENANT_SENTINEL = "__system__";

export interface WithSystemContextOptions {
  /** Optional override for the pino logger (used in tests). */
  logger?: Logger;
}

/**
 * Wrap a BullMQ job handler in system-mode context.
 *
 * @param schema Optional Zod schema for `job.data`. Pass `null` for jobs
 *               with empty payloads (e.g. `partman-maintenance`).
 * @param handler Async function invoked with the parsed payload (or `{}`
 *                when schema is null).
 */
export function withSystemContext<S extends z.ZodTypeAny | null, R = void>(
  schema: S,
  handler: (data: S extends z.ZodTypeAny ? z.infer<S> : Record<string, never>) => Promise<R>,
  options: WithSystemContextOptions = {},
): (job: Job) => Promise<R> {
  const log = options.logger ?? baseLog;
  return async (job: Job): Promise<R> => {
    // Parse the payload first so schema violations surface before any span
    // or ALS setup. System jobs with `schema=null` skip parsing entirely.
    // When `job.data` is `undefined` (test stubs or BullMQ no-payload jobs)
    // we substitute `{}` so a schema with an empty-object branch validates.
    const rawData = (job.data ?? {}) as unknown;
    const data =
      schema === null
        ? ({} as S extends z.ZodTypeAny ? z.infer<S> : Record<string, never>)
        : (schema.parse(rawData) as S extends z.ZodTypeAny ? z.infer<S> : Record<string, never>);

    const jobId = job.id ?? "unknown";
    const span = tracer.startSpan(`bullmq.job.${job.queueName}`, {
      attributes: {
        mode: "system",
        job_id: jobId,
      },
    });
    const childLog = log.child({ mode: "system", job_id: jobId });

    try {
      let result!: R;
      await tenantAls.run({ tenantId: SYSTEM_TENANT_SENTINEL, mode: "system", jobId }, async () => {
        result = await handler(data);
      });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      childLog.error({ err }, "system job failed");
      throw err;
    } finally {
      span.end();
    }
  };
}
