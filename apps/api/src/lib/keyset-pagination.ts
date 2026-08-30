// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 1 — Keyset pagination helper (D-25).
//
// Shared by every CRUD list route (notes, folders, conversations,
// messages, transcriptions). Centralizing the limit/before/since parse
// + the tuple-comparison SQL fragment keeps the wire-shape uniform
// across Plans 05-09.
//
// TWO AXES, NOT ONE. `before` and `since` are different queries against
// different columns, and conflating them cost the desktop every edit it ever
// made to an older note:
//
//   * `before` — SNAPSHOT paging, backward through history. Orders by
//     `(created_at, id) DESC` and walks to older rows. A note's position never
//     changes, so a full snapshot terminates.
//   * `since` — DELTA paging, forward through the change log. The desktop
//     stores its cursor as the last row's `updated_at`
//     (SyncService.pullNotes / pullConversations: `const next = since ?
//     last.updated_at : last.created_at`) and expects the LAST row of a page
//     to be the newest one it applied. So the delta axis MUST filter and order
//     by `(updated_at, id) ASC`. Keyed on `created_at` instead, a note created
//     last year and edited today never enters any delta window — the edit is
//     invisible to every other device — and descending order would hand the
//     client the oldest row of the page as its next cursor, re-requesting the
//     same page forever.
//
// Behavior:
//   * limit: clamped to [1..200], default 50 (D-25). Out-of-range or
//     non-numeric values clamp rather than 400 — the desktop client
//     occasionally ships `limit=null` or `limit="all"` which we treat
//     as "use default".
//   * before / since: ISO 8601 timestamps. Invalid strings raise
//     TypeError (caller maps to 400 via the centralized error handler).
//   * before_id / since_id: the row id that shared the cursor timestamp,
//     sent by the desktop as a tie-breaker (services/noteListQuery.ts). An id
//     without its timestamp is meaningless and is ignored.
//
// Why a tuple comparison rather than `created_at < $1`:
//   With many rows sharing identical created_at (e.g. batch-create),
//   single-column < drops rows on the boundary or duplicates them on
//   retry. The (created_at, id) lexicographic compare is the standard
//   keyset technique. PG resolves `(a, b) < (c, d)` as `a<c OR (a=c
//   AND b<d)` which the partial DESC index serves directly. The delta axis
//   pairs with the `<tbl>_delta_idx ON (tenant_id, user_id, updated_at, id)`
//   partial indexes from migration 0034.
import { type SQL, sql } from "drizzle-orm";

export interface ParsedListQuery {
  limit: number;
  before: Date | undefined;
  beforeId: string | undefined;
  since: Date | undefined;
  sinceId: string | undefined;
}

export interface RawListQuery {
  limit?: string | undefined;
  before?: string | undefined;
  since?: string | undefined;
  before_id?: string | undefined;
  since_id?: string | undefined;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MIN_LIMIT = 1;

/**
 * Parse + clamp the {limit, before, since} query trio per D-25, plus the
 * optional `before_id` / `since_id` keyset tie-breakers.
 *
 * Limit clamping is deliberate: callers shipping `limit=500` get 200,
 * not 400. The desktop client passes `limit=9999` in its `deleteAll`
 * legacy fallback path — we MUST NOT 400-bounce that.
 */
export function parseListQuery(q: RawListQuery): ParsedListQuery {
  const limitRaw = q.limit;
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    const parsed = parseInt(String(limitRaw), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(Math.max(parsed, MIN_LIMIT), MAX_LIMIT);
    }
  }
  const before = q.before ? new Date(q.before) : undefined;
  const since = q.since ? new Date(q.since) : undefined;
  if (before && Number.isNaN(before.getTime())) {
    throw new TypeError("Invalid 'before' timestamp");
  }
  if (since && Number.isNaN(since.getTime())) {
    throw new TypeError("Invalid 'since' timestamp");
  }
  return {
    limit,
    before,
    // A tie-breaker id is only meaningful alongside the timestamp it breaks
    // ties for; on its own it would silently widen the page.
    beforeId: before ? q.before_id : undefined,
    since,
    sinceId: since ? q.since_id : undefined,
  };
}

/**
 * Build the optional WHERE-clause SQL fragment that constrains a keyset
 * page. Returns an empty SQL fragment when neither `before` nor `since`
 * is set — caller composes it with `AND` glue.
 */
export function buildKeysetWhere(
  parsed: Pick<ParsedListQuery, "before" | "beforeId" | "since" | "sinceId">,
): SQL {
  const fragments: SQL[] = [];
  if (parsed.before) {
    // Pages BACKWARD (older) through the snapshot axis.
    fragments.push(
      parsed.beforeId
        ? sql`(created_at, id) < (${parsed.before.toISOString()}::timestamptz, ${parsed.beforeId}::uuid)`
        : sql`created_at < ${parsed.before.toISOString()}::timestamptz`,
    );
  }
  if (parsed.since) {
    // Pages FORWARD (newer) through the delta axis — see the header note on
    // why this is `updated_at`, not `created_at`.
    fragments.push(
      parsed.sinceId
        ? sql`(updated_at, id) > (${parsed.since.toISOString()}::timestamptz, ${parsed.sinceId}::uuid)`
        : sql`updated_at > ${parsed.since.toISOString()}::timestamptz`,
    );
  }
  if (fragments.length === 0) return sql``;
  if (fragments.length === 1) return sql` AND (${fragments[0]})`;
  return sql` AND (${fragments[0]}) AND (${fragments[1]})`;
}

/**
 * Build the ORDER BY + LIMIT tail for a keyset list query.
 *
 * Delta pages (`since`) order `updated_at ASC, id ASC` so the caller's next
 * cursor — the last row it applied — moves forward. Snapshot pages order
 * `created_at DESC, id DESC`, matching the partial index from Plan 01:
 *   CREATE INDEX notes_keyset_idx
 *     ON notes (tenant_id, created_at DESC, id DESC)
 *     WHERE deleted_at IS NULL
 *
 * Documented marker for grep audits: `(created_at, id)` ordering.
 */
export function buildKeysetOrderLimit(parsed: ParsedListQuery): SQL {
  if (parsed.since) {
    // (updated_at, id) ASC — paired with <tbl>_delta_idx (migration 0034).
    return sql` ORDER BY updated_at ASC, id ASC LIMIT ${parsed.limit}`;
  }
  // (created_at, id) DESC — paired with the partial index above.
  return sql` ORDER BY created_at DESC, id DESC LIMIT ${parsed.limit}`;
}
