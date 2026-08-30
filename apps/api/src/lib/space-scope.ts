// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Row visibility once team spaces exist.
 *
 * THIS IS A SECURITY PREDICATE, not a convenience filter. Row-level security in
 * this database is TENANT-scoped only (migration 0033: `notes_isolation`
 * compares `tenant_id`), so every row of every colleague in the tenant reaches
 * the handler and only the `WHERE` clause below keeps them apart. A mistake
 * here is one employee reading another's notes, and RLS will not catch it.
 * Pinned by routes/notes/__tests__/space-isolation.integration.test.ts, which
 * leads with the negative case.
 *
 * Two disjoint grants, and nothing else:
 *   * `space_id IS NULL` — a personal row, visible to its owner alone. This is
 *     every row that existed before spaces, and the rule for them is unchanged.
 *   * `space_id` in a space assigned to a team the caller belongs to. Ownership
 *     is irrelevant here: shared notes are the point, and a `user_id = me`
 *     predicate would hide a colleague's note in a space we both belong to.
 *
 * Membership is re-derived on every request. There is no cached grant, so
 * removing someone from a team takes effect on their next call.
 */
import { type SQL, sql } from "drizzle-orm";
import { ForbiddenError } from "../errors.js";

/**
 * Visibility for a caller that understands spaces (`?scope=all`).
 *
 * The sub-select is deliberately a join over `space_teams` + `team_members`
 * rather than a precomputed list: the two indexes added in migration 0035
 * (`team_members_user_idx`, `space_teams_team_idx`) serve it directly, and a
 * cached list is exactly the shape of bug that keeps access alive after a
 * membership is revoked.
 */
export function buildSpaceScopedWhere(userId: string): SQL {
  return sql`(
    ("space_id" IS NULL AND "user_id" = ${userId}::uuid)
    OR "space_id" IN (
      SELECT st."space_id"
        FROM "space_teams" st
        JOIN "team_members" tm ON tm."team_id" = st."team_id"
       WHERE tm."user_id" = ${userId}::uuid
    )
  )`;
}

/**
 * Visibility for a caller that does NOT understand spaces (no `?scope=`).
 *
 * Personal rows only — and note this is NOT the same as the pre-spaces
 * predicate `user_id = me`, which would now also match a space row the caller
 * happens to own. Such a client has no space to file it into and would land it
 * in the user's personal tree, silently de-scoping shared content. Withholding
 * it is the safe answer: the row is still there when the client can place it.
 */
export function buildPersonalOnlyWhere(userId: string): SQL {
  return sql`("space_id" IS NULL AND "user_id" = ${userId}::uuid)`;
}

/** Pick the predicate matching what the caller declared it can handle. */
export function buildVisibilityWhere(userId: string, scope: "all" | undefined): SQL {
  return scope === "all" ? buildSpaceScopedWhere(userId) : buildPersonalOnlyWhere(userId);
}

/**
 * Refuse a write into a space the caller cannot reach.
 *
 * Deliberately a 403 and not a 400: naming a space you are not in is an access
 * attempt, not a malformed body, and the distinction is what tells an operator
 * reading the logs which of the two happened. A missing space is answered the
 * same way as an unreachable one — "does this space exist" is not a question an
 * outsider gets to have answered.
 *
 * Membership is read inside the caller's own transaction, so it cannot drift
 * from the visibility predicate used to read the rows back.
 */
export async function assertSpaceWritable(
  tx: { execute(query: SQL): Promise<unknown> },
  userId: string,
  spaceId: string,
): Promise<void> {
  const result = (await tx.execute(sql`
    SELECT 1
      FROM "spaces" s
      JOIN "space_teams" st ON st."space_id" = s."id"
      JOIN "team_members" tm
        ON tm."team_id" = st."team_id" AND tm."user_id" = ${userId}::uuid
     WHERE s."id" = ${spaceId}::uuid AND s."deleted_at" IS NULL
     LIMIT 1
  `)) as { rows?: unknown[] };
  if ((result.rows ?? []).length === 0) {
    throw new ForbiddenError("SPACE_FORBIDDEN", "no access to that space");
  }
}
