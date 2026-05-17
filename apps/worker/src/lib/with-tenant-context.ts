// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-07 / D-W1 — withTenantContext HOF for BullMQ job handlers.
//
// Every tenant-scoped BullMQ job processor MUST be wrapped by this HOF or by
// the System escape hatch (withSystemContext). The HOF performs six locked
// steps per invocation (06-CONTEXT.md D-W1):
//
//   1. Parse + validate job.data against the supplied Zod schema (must
//      include `tenant_id: z.string().uuid()`). Bad shape throws before any
//      DB activity occurs.
//   2. Open an OTel span named `bullmq.job.<queueName>` with `tenant_id` and
//      `job_id` attributes — gives operators a per-job span to trace.
//   3. Attach `{tenant_id, request_id, job_id}` to a pino child logger so
//      every handler log line is tagged with the tenant.
//   4. Run the handler under AsyncLocalStorage (mode='tenant', tenantId,
//      jobId) so the app-pool runtime guard (D-W4 layer 2) can detect the
//      caller is in tenant context.
//   5. Acquire a pg client from the supplied pool (owner pool with BYPASSRLS
//      so the worker can write any tenant — RLS isolation is enforced by
//      the GUC binding inside the transaction). BEGIN; set the GUC via
//      `set_config('app.tenant_id', $1, true)` — the parameterized form
//      that prevents SQL injection (T-06-14). NEVER use `SET LOCAL
//      app.tenant_id = '${id}'` string interpolation.
//   6. Invoke handler inside the transaction. COMMIT on success, ROLLBACK
//      on throw; release the client and end the span in `finally`.
//
// The exported `tenantAls` and `getTenantContext()` are consumed by the
// app-pool runtime guard so it can distinguish tenant-mode callers (must
// have the GUC) from system-mode callers (BYPASSRLS allowed).
import { AsyncLocalStorage } from "node:async_hooks";
import { trace } from "@opentelemetry/api";
import { makePino } from "@openwhispr/observability";
import type { Job } from "bullmq";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "pino";
import type { z } from "zod";

export interface TenantContextStore {
  tenantId: string;
  mode: "tenant" | "system";
  jobId: string;
}

/**
 * Process-wide AsyncLocalStorage carrying the active tenant context for a
 * BullMQ job. Exported so the app-pool runtime guard (D-W4 layer 2) can
 * read it without coupling on the HOF function itself.
 */
export const tenantAls = new AsyncLocalStorage<TenantContextStore>();

/** Read the active tenant context, or `undefined` outside a wrapped job. */
export function getTenantContext(): TenantContextStore | undefined {
  return tenantAls.getStore();
}

const tracer = trace.getTracer("worker");
// Phase 6 / Plan 06-10 — pino instance comes from the shared
// @openwhispr/observability factory so the Worker tier scrubs the SAME
// D-T4 redact paths as the API tier. `service: 'worker'` lets operators
// filter by tier in Loki / Grafana.
const baseLog = makePino({ base: { service: "worker" } });

/**
 * Zod schema constraint for tenant-mode jobs: must define `tenant_id` as a
 * required string field (further refined as `.uuid()` at the call site).
 */
// biome-ignore lint/suspicious/noExplicitAny: ZodObject generic shape requires `any` to keep call-site inference open.
export type TenantJobSchema = z.ZodObject<{ tenant_id: z.ZodString } & Record<string, any>>;

export interface WithTenantContextOptions {
  /** Optional override for the pino logger (used in tests to capture log lines). */
  logger?: Logger;
}

/**
 * Wrap a BullMQ job handler so it runs inside a tenant-scoped Postgres
 * transaction with `app.tenant_id` bound.
 *
 * @param schema Zod schema validating `job.data`. Must include `tenant_id`.
 * @param pool   pg.Pool to acquire the per-job connection from. Production
 *               passes the owner pool (BYPASSRLS); tests can inject a
 *               testcontainer-backed pool.
 * @param handler Async function invoked with the parsed payload inside the
 *                transaction. Receives `(data, client)` where `client` is
 *                the same `pg.PoolClient` the GUC was bound on; handlers
 *                MUST run their tenant-scoped SQL through this client (or
 *                through transactions started on it) so `app.tenant_id`
 *                travels with the query. Reusing `pool.query()` from the
 *                outer pool checks out a DIFFERENT connection without the
 *                GUC and trips the app-pool RLS guard
 *                (`TenantContextMissingError`). Plan 51-05 (REVIEW CR-7)
 *                fix.
 *                May throw to trigger ROLLBACK.
 */
export function withTenantContext<S extends TenantJobSchema>(
  schema: S,
  pool: Pool,
  handler: (data: z.infer<S>, client: PoolClient) => Promise<void>,
  options: WithTenantContextOptions = {},
): (job: Job) => Promise<void> {
  const log = options.logger ?? baseLog;
  return async (job: Job): Promise<void> => {
    // Step 1: Zod parse FIRST — happens before any DB or span allocation
    // so bad-shape jobs fail fast with a clear error and no resource
    // acquisition. `parse` throws `ZodError` on failure.
    const data = schema.parse(job.data) as z.infer<S>;
    const tenantId = data.tenant_id;
    const jobId = job.id ?? "unknown";

    // Step 2: open span before MDC + ALS so the handler's logs land inside
    // an active span and OTel pino instrumentation injects trace_id/span_id.
    const span = tracer.startSpan(`bullmq.job.${job.queueName}`, {
      attributes: {
        tenant_id: tenantId,
        job_id: jobId,
        mode: "tenant",
      },
    });

    // Step 3: child logger with the tenant_id / job_id MDC fields.
    const requestId =
      typeof (data as { request_id?: unknown }).request_id === "string"
        ? ((data as { request_id?: string }).request_id ?? null)
        : null;
    const childLog = log.child({
      tenant_id: tenantId,
      job_id: jobId,
      ...(requestId ? { request_id: requestId } : {}),
    });

    try {
      // Step 4: AsyncLocalStorage so the app-pool runtime guard can see us.
      await tenantAls.run({ tenantId, mode: "tenant", jobId }, async () => {
        // Step 5: connection + BEGIN + parameterized set_config.
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          // CRITICAL: parameterized form. NEVER interpolate tenantId into
          // the SQL string. T-06-14 mitigation.
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
          try {
            await handler(data, client);
            await client.query("COMMIT");
          } catch (handlerErr) {
            await client.query("ROLLBACK");
            throw handlerErr;
          }
        } finally {
          client.release();
        }
      });
    } catch (err) {
      span.recordException(err as Error);
      childLog.error({ err }, "tenant job failed");
      throw err;
    } finally {
      span.end();
    }
  };
}
