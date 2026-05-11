// Phase 05 / Plan 05 / Task 1 — Soft-delete helper (D-23).
//
// Single SQL fragment shared by every read path (list, search, get) on
// every soft-deletable resource family (notes, folders, conversations,
// transcriptions). Centralizing the `deleted_at IS NULL` predicate
// guarantees no read path forgets the filter — T-05-06 mitigation
// (Information Disclosure via soft-delete bypass).
//
// Pairs with the partial keyset index from Plan 01:
//   CREATE INDEX notes_keyset_idx
//     ON notes (tenant_id, created_at DESC, id DESC)
//     WHERE deleted_at IS NULL
// — soft-deleted rows do not consume index space.
//
// `hard_delete=true` short-circuits the filter for paths that
// deliberately read tombstones (e.g. operator audit queries). Phase 5
// CRUD routes NEVER pass `hard_delete=true`.
import { sql, type SQL } from "drizzle-orm";

/**
 * Returns ` AND deleted_at IS NULL` as a leading-AND SQL fragment.
 *
 * Why leading AND: every caller composes this onto an existing WHERE
 * clause that has at least one term (tenant_id binding via RLS still
 * lands in the SQL even though FORCE-RLS gates it; route handlers
 * typically also filter by user_id explicitly to make the predicate
 * obvious in EXPLAIN output).
 */
export function withSoftDelete(): SQL {
  return sql` AND deleted_at IS NULL`;
}

/**
 * Returns the bare ` deleted_at IS NULL` predicate for callers that
 * compose their WHERE clause from scratch. Less common than
 * `withSoftDelete()` but exported for completeness.
 */
export function softDeletePredicate(): SQL {
  return sql`deleted_at IS NULL`;
}
