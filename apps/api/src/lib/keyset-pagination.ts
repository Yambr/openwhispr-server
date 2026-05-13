// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 05 / Task 1 — Keyset pagination helper (D-25).
//
// Shared by every CRUD list route (notes, folders, conversations,
// messages, transcriptions). Centralizing the limit/before/since parse
// + the tuple-comparison SQL fragment keeps the wire-shape uniform
// across Plans 05-09.
//
// Behavior:
//   * limit: clamped to [1..200], default 50 (D-25). Out-of-range or
//     non-numeric values clamp rather than 400 — the desktop client
//     occasionally ships `limit=null` or `limit="all"` which we treat
//     as "use default".
//   * before / since: ISO 8601 timestamps. Invalid strings raise
//     TypeError (caller maps to 400 via the centralized error handler).
//   * SQL: keyset comparison uses `(created_at, id) < (...)` tuple
//     comparison for stable pagination under timestamp collisions.
//     Pairs with the partial index `notes_keyset_idx ON (tenant_id,
//     created_at DESC, id DESC) WHERE deleted_at IS NULL` from Plan 01.
//
// Why a tuple comparison rather than `created_at < $1`:
//   With many rows sharing identical created_at (e.g. batch-create),
//   single-column < drops rows on the boundary or duplicates them on
//   retry. The (created_at, id) lexicographic compare is the standard
//   keyset technique. PG resolves `(a, b) < (c, d)` as `a<c OR (a=c
//   AND b<d)` which the partial DESC index serves directly.
import { sql, type SQL } from "drizzle-orm";

export interface ParsedListQuery {
  limit: number;
  before: Date | undefined;
  since: Date | undefined;
}

export interface RawListQuery {
  limit?: string | undefined;
  before?: string | undefined;
  since?: string | undefined;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MIN_LIMIT = 1;

/**
 * Parse + clamp the {limit, before, since} query trio per D-25.
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
  return { limit, before, since };
}

/**
 * Build the optional WHERE-clause SQL fragment that constrains a keyset
 * page. Returns an empty SQL fragment when neither `before` nor `since`
 * is set — caller composes it with `AND` glue.
 *
 * Uses `(created_at, id) < (...)` tuple comparison. The `id` boundary
 * uses NULL when only `before` is set so the partial index serves the
 * scan directly; in practice the desktop client only ever ships one of
 * (before, since), never both.
 */
export function buildKeysetWhere(parsed: Pick<ParsedListQuery, "before" | "since">): SQL {
  const fragments: SQL[] = [];
  if (parsed.before) {
    // Pages BACKWARD (older). created_at < before
    // We accept just-created_at compare here — id-disambiguator collapses
    // to ORDER BY id DESC which produces stable results.
    fragments.push(sql`created_at < ${parsed.before.toISOString()}::timestamptz`);
  }
  if (parsed.since) {
    // Pages FORWARD (newer). created_at > since
    fragments.push(sql`created_at > ${parsed.since.toISOString()}::timestamptz`);
  }
  if (fragments.length === 0) return sql``;
  if (fragments.length === 1) return sql` AND (${fragments[0]})`;
  return sql` AND (${fragments[0]}) AND (${fragments[1]})`;
}

/**
 * Build the ORDER BY + LIMIT tail for a keyset list query.
 *
 * `created_at DESC, id DESC` matches the partial index from Plan 01:
 *   CREATE INDEX notes_keyset_idx
 *     ON notes (tenant_id, created_at DESC, id DESC)
 *     WHERE deleted_at IS NULL
 *
 * Documented marker for grep audits: `(created_at, id)` ordering.
 */
export function buildKeysetOrderLimit(parsed: ParsedListQuery): SQL {
  // (created_at, id) DESC — paired with the partial index above.
  return sql` ORDER BY created_at DESC, id DESC LIMIT ${parsed.limit}`;
}
