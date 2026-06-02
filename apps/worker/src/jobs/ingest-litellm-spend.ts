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

import { metrics } from "@opentelemetry/api";
import { withSystemBypassClient } from "@openwhispr/data";
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

/**
 * Phase 41.d / HI-4 — minutes-priced model duration validation.
 *
 * For `transcribe_minutes` / `realtime_minutes` rows, `metadata.duration`
 * is the SOLE billing signal. Prior to this phase a non-numeric duration
 * (string, missing, wrong type) silently produced a `units=0` ledger
 * insert — pure data loss on the revenue path with no log, no metric.
 *
 * The fix:
 *   1. Validate the duration is a finite positive number via
 *      `validateDuration`. On failure, return `null`.
 *   2. On null: log warn, increment OTel counter
 *      `worker_billing_anomalies_total{reason="non_numeric_duration"}`,
 *      SKIP the insert (matches the existing skip pattern for
 *      missing end_user / missing tenant at the same call-site).
 *
 * Decision rationale (skip vs insert-with-NULL): see
 * `.planning/phases/41-residual-high-sweep/41-d-DECISIONS.md §D-1`.
 */
const billingAnomalyCounter = metrics
  .getMeter("worker.ingest-litellm-spend")
  .createCounter("worker_billing_anomalies_total", {
    description: "Count of LiteLLM spend rows skipped due to billing-data anomalies",
  });

// Test-seam: in-process tally of counter increments. The OTel API doesn't
// expose a public read on a Counter; tests verify the increment via this
// mirror. Kept underscore-prefixed to match the project's `_for-test`
// export convention.
const _billingAnomalies = new Map<string, number>();
export function _readBillingAnomalies(): Array<{ reason: string; count: number }> {
  return Array.from(_billingAnomalies.entries()).map(([reason, count]) => ({ reason, count }));
}
export function _resetBillingAnomalies(): void {
  _billingAnomalies.clear();
}
function recordBillingAnomaly(reason: string): void {
  billingAnomalyCounter.add(1, { reason });
  _billingAnomalies.set(reason, (_billingAnomalies.get(reason) ?? 0) + 1);
}

/**
 * Validate `metadata.duration` is a finite positive number (seconds).
 * Returns the validated number on success, `null` on failure. Callers
 * MUST treat `null` as a skip-with-anomaly signal — never coerce to 0.
 */
export function validateDuration(
  metadata: Record<string, unknown> | null | undefined,
): number | null {
  if (!metadata) return null;
  const d = metadata["duration"];
  if (typeof d !== "number") return null;
  if (!Number.isFinite(d)) return null;
  if (d <= 0) return null;
  return d;
}

export const QUEUE_NAME = "litellm-spend-ingest";
export const SCHEDULER_KEY = "ingest-litellm-spend";
export const WATERMARK_KEY = "litellm:spend:last_start_time";
export const BATCH_SIZE = 1000;
export const TICK_MS = 30_000;
/** First-run lookback window: process spend rows from the last 5 minutes. */
export const INITIAL_LOOKBACK_MS = 5 * 60_000;

/**
 * Phase 58 Track A / worker:CR-01 — bounded watermark-hold cap.
 *
 * When a spend row is skipped for a *recoverable* reason (missing end_user,
 * missing tenant mapping — the mapping can materialize later), the watermark
 * is held just before that row so the next tick re-scans it. To prevent the
 * watermark stalling ingest forever on a row whose prerequisite never
 * materializes, a recoverable-skip row OLDER than `now - MAX_RECOVERABLE_HOLD_MS`
 * no longer holds the watermark — it ages out (treated as unrecoverable) and
 * emits `recordBillingAnomaly("recoverable_skip_aged_out")` so operators see it.
 */
export const MAX_RECOVERABLE_HOLD_MS = 24 * 60 * 60_000;

/**
 * Epsilon (ms) subtracted from a held row's startTime so the next tick's
 * `startTime > watermark` filter re-includes the held row itself.
 */
const WATERMARK_HOLD_EPSILON_MS = 1;

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
      // Quick 260602-j9z (blocker #2) — cross-tenant read of the FORCE-RLS
      // `users` table via the claim-driven bypass so a single NOBYPASSRLS role
      // works (no owner-BYPASSRLS reliance).
      const ures = await withSystemBypassClient(deps.appOwnerPool, (client) =>
        client.query(`SELECT id::text AS id FROM users WHERE tenant_id = $1::uuid`, [
          opts.tenantId,
        ]),
      );
      allowedUserIds = (ures as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
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

  /**
   * Phase 58 Track A / worker:CR-01 — oldest startTime among rows skipped for
   * a *recoverable* reason this tick (missing end_user / missing tenant). If
   * set, the watermark is held just before this row so the next tick re-scans
   * it. Rows older than `now - MAX_RECOVERABLE_HOLD_MS` age out (do NOT hold).
   */
  let oldestRecoverableSkip: Date | null = null;
  const holdCutoff = Date.now() - MAX_RECOVERABLE_HOLD_MS;
  const rowStart = (r: SpendLogRow): Date =>
    r.startTime instanceof Date ? r.startTime : new Date(r.startTime);
  /**
   * Record a recoverable skip: hold the watermark on the oldest such row
   * unless it has aged out past `MAX_RECOVERABLE_HOLD_MS`, in which case it
   * is treated as unrecoverable (does not hold) and an aged-out anomaly fires.
   */
  const noteRecoverableSkip = (r: SpendLogRow): void => {
    const ts = rowStart(r);
    if (ts.getTime() < holdCutoff) {
      // Prerequisite never materialized within the bounded window — age out.
      recordBillingAnomaly("recoverable_skip_aged_out");
      return;
    }
    if (oldestRecoverableSkip === null || ts.getTime() < oldestRecoverableSkip.getTime()) {
      oldestRecoverableSkip = ts;
    }
  };

  for (const r of rows) {
    const ourRid =
      (r.metadata && typeof r.metadata["openwhispr_request_id"] === "string"
        ? (r.metadata["openwhispr_request_id"] as string)
        : null) ?? r.request_id;

    const userId = r.end_user;
    if (!userId) {
      // Recoverable: the spend row may gain an end_user later (or the api
      // backfills it) — hold the watermark + emit an anomaly counter.
      log.warn({ rid: ourRid }, "spend log missing end_user — skipping (watermark held)");
      recordBillingAnomaly("missing_end_user");
      noteRecoverableSkip(r);
      continue;
    }

    const tenantRes = (await withSystemBypassClient(deps.appOwnerPool, (client) =>
      client.query(`SELECT tenant_id FROM users WHERE id = $1::uuid LIMIT 1`, [userId]),
    )) as { rows: Array<{ tenant_id: string }> };
    const tenantId = tenantRes.rows[0]?.tenant_id;
    if (!tenantId) {
      // Recoverable: the users row (user/tenant mapping) can materialize
      // after this tick — hold the watermark + emit an anomaly counter.
      log.warn({ rid: ourRid, userId }, "no tenant for user — skipping spend row (watermark held)");
      recordBillingAnomaly("missing_tenant");
      noteRecoverableSkip(r);
      continue;
    }

    const kind = inferKind(r.model);
    let units: number;
    if (kind === "reason_tokens") {
      units = r.total_tokens ?? 0;
    } else {
      // Phase 41.d / HI-4 — minutes-priced models REQUIRE a numeric
      // metadata.duration; missing/non-numeric values were previously
      // billed as 0 silently. Now: log warn, emit anomaly counter, skip
      // the row entirely (no usage_ledger insert).
      const seconds = validateDuration(r.metadata);
      if (seconds === null) {
        log.warn(
          { rid: ourRid, model: r.model, kind, metadata: r.metadata },
          "minutes-priced row has missing or non-numeric duration — skipping (no usage_ledger insert)",
        );
        recordBillingAnomaly("non_numeric_duration");
        continue;
      }
      units = Math.ceil(seconds / 60);
    }

    // Phase 58 Track B / worker:CR-02 — persist the LiteLLM startTime into
    // usage_ledger.event_at so usage-rollup-daily + reconciliation-daily-check
    // can bucket rows by when the spend actually occurred, not by the worker
    // ingest timestamp (created_at). Normalized to a Date via `rowStart` —
    // the same normalization used for the watermark below.
    // Quick 260602-j9z (blocker #2) — the FORCE-RLS usage_ledger INSERT is a
    // cross-tenant write (the worker iterates all tenants' spend), so it runs
    // through the claim-driven bypass. On a single NOBYPASSRLS role this would
    // otherwise raise 42501 and silently kill billing ingest.
    const insertRes = (await withSystemBypassClient(deps.appOwnerPool, (client) =>
      client.query(
        `
        INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units, event_at)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz)
        ON CONFLICT (request_id) DO NOTHING
      `,
        [tenantId, userId, ourRid, kind, units, rowStart(r).toISOString()],
      ),
    )) as { rowCount: number | null };
    if ((insertRes.rowCount ?? 0) > 0) {
      processed++;
    }
  }

  // Watermark is owned by the live tick. Windowed-backfill callers
  // (reconciliation-discrepancy) MUST NOT advance it — doing so would
  // skip rows in the live ingestion stream.
  //
  // Phase 58 Track A / worker:CR-01 — the watermark must NOT advance past a
  // row skipped for a recoverable reason (missing end_user / missing tenant),
  // or that billable spend is permanently orphaned once the prerequisite
  // materializes. Advance to min(lastRow.startTime, oldestRecoverableSkip - ε)
  // so the next tick re-scans the unresolved row. Re-scanning is idempotent:
  // INSERT ... ON CONFLICT (request_id) DO NOTHING — no double-billing.
  if (!windowed && rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last) {
      let advanceTo = rowStart(last).getTime();
      if (oldestRecoverableSkip !== null) {
        const hold = (oldestRecoverableSkip as Date).getTime() - WATERMARK_HOLD_EPSILON_MS;
        if (hold < advanceTo) {
          advanceTo = hold;
        }
      }
      await deps.redis.set(WATERMARK_KEY, new Date(advanceTo).toISOString());
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

// Phase 41.d / HI-4 — the legacy `extractDuration` (silent-coerce-to-0)
// helper is replaced by `validateDuration` above, which returns null on
// invalid input so callers can SKIP-with-anomaly-counter instead of
// silently zero-billing.
