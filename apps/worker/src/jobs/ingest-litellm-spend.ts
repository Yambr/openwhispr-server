// Phase 03 Plan 08 — BullMQ Job Scheduler that ingests LiteLLM_SpendLogs
// rows into our usage_ledger every 30 seconds (LITELLM-07).
//
// Architecture (research §A7 + Plan 02 spike confirmation):
//   1. BullMQ Job Scheduler `ingest-litellm-spend` upserted at boot via
//      `queue.upsertJobScheduler('...', { every: 30_000 }, ...)`. This is
//      the modern API — `repeat: { every }` was deprecated in BullMQ 5.x
//      (RESEARCH Pitfall #4).
//   2. Each tick reads LiteLLM_SpendLogs WHERE startTime > watermark,
//      ORDER BY startTime ASC, LIMIT 1000.
//   3. For each row:
//        - resolve our request_id from metadata->>'openwhispr_request_id'
//          (Plan 02 spike confirmed this exact JSONB path), falling back
//          to LiteLLM's own request_id if absent.
//        - resolve tenant_id by JOINing users on end_user (which the api
//          routes set to req.user.id — D-03).
//        - infer kind from model alias.
//        - INSERT INTO usage_ledger ... ON CONFLICT (request_id) DO
//          NOTHING. The api route also writes to the same row from the
//          /api/transcribe and /api/reason hot paths (Plan 04/05); both
//          UPSERTs converge — first writer wins (DATA-03).
//   4. After processing the batch, advance the watermark to the LAST
//      row's startTime — replay-safe (Threat T-03-08-02).
//
// The handler is exported separately from the BullMQ wiring so the
// integration test can call `runIngestOnce(deps)` directly without
// orchestrating the full Worker/Queue lifecycle. The Worker class itself
// is a thin shim that delegates to runIngestOnce on every job invocation.

import type { ConnectionOptions } from "bullmq";
import { Queue, Worker } from "bullmq";
import type { Pool } from "pg";
import pino from "pino";
import { z } from "zod";
import { inferKind } from "../lib/infer-kind.js";
import { withSystemContext } from "../lib/with-system-context.js";

const log = pino({ name: "ingest-litellm-spend" });

export const QUEUE_NAME = "litellm-spend-ingest";
export const SCHEDULER_KEY = "ingest-litellm-spend";
export const WATERMARK_KEY = "litellm:spend:last_start_time";
export const BATCH_SIZE = 1000;
export const TICK_MS = 30_000;
/** First-run lookback window: process spend rows from the last 5 minutes. */
export const INITIAL_LOOKBACK_MS = 5 * 60_000;

/** Minimal redis surface needed by the job (get/set string watermark). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

export interface JobDeps {
  litellmPool: Pool;
  appOwnerPool: Pool;
  connection: ConnectionOptions;
  /**
   * Redis-like client used to read/write the watermark. In production this
   * is the same ioredis instance that BullMQ uses. Tests can pass an
   * in-memory stub.
   */
  redis: RedisLike;
}

interface SpendLogRow {
  request_id: string;
  end_user: string | null;
  total_tokens: number | null;
  model: string;
  startTime: Date | string;
  metadata: Record<string, unknown> | null;
}

export function createQueue(connection: ConnectionOptions): Queue {
  return new Queue(QUEUE_NAME, { connection });
}

/**
 * Registers (or refreshes) the recurring scheduler. Idempotent — calling
 * twice produces a single entry. Uses the modern `upsertJobScheduler`
 * API; `repeat:{ every }` was deprecated in BullMQ 5.x (Pitfall #4).
 */
export async function ensureScheduler(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(SCHEDULER_KEY, { every: TICK_MS }, { name: "ingest", data: {} });
}

/**
 * Process one ingestion tick. Returns the number of usage_ledger rows
 * actually inserted (skipped rows — missing user, missing tenant, ON
 * CONFLICT — are NOT counted toward `rowsProcessed`).
 *
 * Watermark semantics:
 *   - Read from redis (key WATERMARK_KEY). If unset: start from `now -
 *     INITIAL_LOOKBACK_MS` so a fresh deploy ingests the last 5 minutes.
 *   - Advance only AFTER the loop completes successfully — replay-safe
 *     (T-03-08-02). On crash mid-batch the next tick re-reads the same
 *     window; ON CONFLICT DO NOTHING keeps the ledger row count stable.
 */
export async function runIngestOnce(
  deps: JobDeps,
): Promise<{ rowsProcessed: number; rowsScanned: number }> {
  const watermark =
    (await deps.redis.get(WATERMARK_KEY)) ??
    new Date(Date.now() - INITIAL_LOOKBACK_MS).toISOString();

  const { rows } = await deps.litellmPool.query<SpendLogRow>(
    `
      SELECT request_id, "end_user", total_tokens, model, "startTime", metadata
      FROM "LiteLLM_SpendLogs"
      WHERE "startTime" > $1
      ORDER BY "startTime" ASC
      LIMIT ${BATCH_SIZE}
    `,
    [watermark],
  );

  let processed = 0;
  for (const r of rows) {
    const ourRid =
      (r.metadata && typeof r.metadata["openwhispr_request_id"] === "string"
        ? (r.metadata["openwhispr_request_id"] as string)
        : null) ?? r.request_id;

    const userId = r.end_user;
    if (!userId) {
      log.warn({ rid: ourRid }, "spend log missing end_user — skipping");
      continue;
    }

    const tenantRes = await deps.appOwnerPool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM users WHERE id = $1::uuid LIMIT 1`,
      [userId],
    );
    const tenantId = tenantRes.rows[0]?.tenant_id;
    if (!tenantId) {
      log.warn({ rid: ourRid, userId }, "no tenant for user — skipping spend row");
      continue;
    }

    const kind = inferKind(r.model);
    const units =
      kind === "reason_tokens"
        ? (r.total_tokens ?? 0)
        : Math.ceil(extractDuration(r.metadata) / 60);

    const insertRes = await deps.appOwnerPool.query(
      `
        INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5)
        ON CONFLICT (request_id) DO NOTHING
      `,
      [tenantId, userId, ourRid, kind, units],
    );
    if ((insertRes.rowCount ?? 0) > 0) {
      processed++;
    }
  }

  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last) {
      const ts =
        last.startTime instanceof Date ? last.startTime.toISOString() : String(last.startTime);
      await deps.redis.set(WATERMARK_KEY, ts);
    }
  }

  return { rowsProcessed: processed, rowsScanned: rows.length };
}

/**
 * Phase 6 Plan 06-07 / D-W2 — schema for the ingest-litellm-spend payload.
 * The recurring scheduler enqueues an empty `{}` payload today; the schema
 * is permissive so the System escape hatch documents intent without
 * breaking the existing scheduler wire shape. Future callers (the
 * reconciliation-discrepancy backfill, Plan 06-10) will pass
 * `{ since, until }`.
 */
export const ingestLitellmSpendSchema = z
  .object({
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
  })
  .strict()
  .or(z.object({}).strict());

/**
 * Construct the BullMQ Worker that runs `runIngestOnce` on every job tick.
 * Lifecycle ownership is the caller's — the entry point in `index.ts`
 * wires SIGTERM to `worker.close()`.
 *
 * Phase 6 Plan 06-07 / D-W2 — the handler is wrapped in `withSystemContext`
 * because this is a cross-tenant reconciliation job: it reads
 * LiteLLM_SpendLogs for all tenants and writes usage_ledger rows for the
 * resolved tenant_id of each row. RLS is intentionally bypassed via the
 * `openwhispr_owner` pool (BYPASSRLS). The System opt-in is explicit so
 * the static lint (D-W4 layer 1, Plan 06-09) treats this as an authorized
 * cross-tenant job.
 */
export function createWorker(deps: JobDeps): Worker {
  const handler = withSystemContext(ingestLitellmSpendSchema, async () => {
    const result = await runIngestOnce(deps);
    log.info({ ...result }, "ingest tick complete");
    return result;
  });
  return new Worker(QUEUE_NAME, handler, { connection: deps.connection });
}

function extractDuration(metadata: Record<string, unknown> | null | undefined): number {
  if (!metadata) return 0;
  const d = metadata["duration"];
  if (typeof d === "number" && Number.isFinite(d) && d > 0) return d;
  return 0;
}
