// SPDX-License-Identifier: FSL-1.1-ALv2
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

import { makePino } from "@openwhispr/observability";
import type { ConnectionOptions } from "bullmq";
import { Queue, Worker } from "bullmq";
import type { Pool } from "pg";
import type { DestinationStream, Logger } from "pino";
import { z } from "zod";
import { inferKind } from "../lib/infer-kind.js";
import { withSystemContext } from "../lib/with-system-context.js";

/**
 * Phase 41.d / HI-1 — module logger built via the shared `makePino` factory
 * from `@openwhispr/observability` so the canonical D-T4 redact paths apply
 * (bearer tokens, cookies, `*.token`/`*.secret`/`*.password`/`*.apiKey`,
 * provider API-key env names). Prior to this phase the module used a bare
 * `pino({ name: "ingest-litellm-spend" })` with NO redact config, which
 * shipped secret-shaped values straight to Loki via OTel pino-instrumentation.
 *
 * The `_buildIngestLog` test seam is exported (underscore-prefixed) so the
 * unit test can construct an isolated logger with a capturing destination
 * stream — same pattern as `_resetDriftStoreForTest` in
 * `reconciliation-daily-check.ts`.
 */
export function _buildIngestLog(destination?: DestinationStream): Logger {
  const opts: Parameters<typeof makePino>[0] = {
    base: { service: "worker", component: "ingest-litellm-spend" },
  };
  if (destination !== undefined) {
    opts.destination = destination;
  }
  return makePino(opts);
}
const log = _buildIngestLog();

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
 * Optional explicit-window arguments for `runIngestOnce`. Used by the
 * reconciliation-discrepancy handler (Phase 36.b / CRIT-FIX-08) to
 * backfill a specific time range for a specific tenant WITHOUT touching
 * the live watermark.
 *
 * - `since` / `until`: ISO datetime bounds (inclusive `since`, exclusive
 *   `until`). When provided, the SQL filters on `[since, until)` instead
 *   of the redis watermark, and the watermark is NEVER written.
 * - `tenantId`: when provided, restricts the LiteLLM_SpendLogs scan to
 *   rows whose `end_user` belongs to the named tenant — so a discrepancy
 *   fired for tenant T over window W ingests ONLY tenant T's rows.
 */
export interface RunIngestOptions {
  since?: string;
  until?: string;
  tenantId?: string;
}

/**
 * Process one ingestion tick. Returns the number of usage_ledger rows
 * actually inserted (skipped rows — missing user, missing tenant, ON
 * CONFLICT — are NOT counted toward `rowsProcessed`).
 *
 * Two operating modes:
 *
 * 1. **Watermark mode** (default, `opts` omitted/empty): read watermark
 *    from redis (key WATERMARK_KEY); if unset, start from `now -
 *    INITIAL_LOOKBACK_MS`. SQL filters on `startTime > watermark`.
 *    Advance the watermark AFTER the loop completes successfully —
 *    replay-safe (T-03-08-02). On crash mid-batch the next tick re-reads
 *    the same window; ON CONFLICT DO NOTHING keeps ledger count stable.
 *
 * 2. **Windowed mode** (`opts.since` + `opts.until` provided, optionally
 *    `opts.tenantId`): explicit `[since, until)` filter on `startTime`.
 *    When `tenantId` is set, the LiteLLM_SpendLogs scan is restricted to
 *    `end_user IN (users for that tenant)` via a subquery on the owner
 *    pool — protects against cross-tenant data motion. The watermark is
 *    NEVER written in windowed mode (don't poison the live tick).
 */
export async function runIngestOnce(
  deps: JobDeps,
  opts: RunIngestOptions = {},
): Promise<{ rowsProcessed: number; rowsScanned: number }> {
  const windowed = opts.since !== undefined && opts.until !== undefined;

  let rows: SpendLogRow[];
  if (windowed) {
    // Windowed mode — explicit [since, until). When tenantId is set,
    // restrict end_user to the tenant's users. We resolve the user IDs
    // up-front on the owner pool so the SpendLogs scan stays single-query.
    let allowedUserIds: string[] | null = null;
    if (opts.tenantId !== undefined) {
      const ures = await deps.appOwnerPool.query<{ id: string }>(
        `SELECT id::text AS id FROM users WHERE tenant_id = $1::uuid`,
        [opts.tenantId],
      );
      allowedUserIds = ures.rows.map((r) => r.id);
      if (allowedUserIds.length === 0) {
        // No users for this tenant — windowed scan would return 0 anyway,
        // and the empty-array branch of ANY($1::text[]) is correctly empty,
        // but skip the SQL round-trip.
        return { rowsProcessed: 0, rowsScanned: 0 };
      }
    }
    const res =
      allowedUserIds === null
        ? await deps.litellmPool.query<SpendLogRow>(
            `
              SELECT request_id, "end_user", total_tokens, model, "startTime", metadata
              FROM "LiteLLM_SpendLogs"
              WHERE "startTime" >= $1 AND "startTime" < $2
              ORDER BY "startTime" ASC
              LIMIT ${BATCH_SIZE}
            `,
            [opts.since, opts.until],
          )
        : await deps.litellmPool.query<SpendLogRow>(
            `
              SELECT request_id, "end_user", total_tokens, model, "startTime", metadata
              FROM "LiteLLM_SpendLogs"
              WHERE "startTime" >= $1 AND "startTime" < $2
                AND "end_user" = ANY($3::text[])
              ORDER BY "startTime" ASC
              LIMIT ${BATCH_SIZE}
            `,
            [opts.since, opts.until, allowedUserIds],
          );
    rows = res.rows;
  } else {
    const watermark =
      (await deps.redis.get(WATERMARK_KEY)) ??
      new Date(Date.now() - INITIAL_LOOKBACK_MS).toISOString();

    const res = await deps.litellmPool.query<SpendLogRow>(
      `
        SELECT request_id, "end_user", total_tokens, model, "startTime", metadata
        FROM "LiteLLM_SpendLogs"
        WHERE "startTime" > $1
        ORDER BY "startTime" ASC
        LIMIT ${BATCH_SIZE}
      `,
      [watermark],
    );
    rows = res.rows;
  }

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

  // Watermark is owned by the live tick. Windowed-backfill callers
  // (reconciliation-discrepancy) MUST NOT advance it — doing so would
  // skip rows in the live ingestion stream.
  if (!windowed && rows.length > 0) {
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
