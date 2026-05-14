// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-01 / Task 1 — RED schema test (RESEARCH §1).
//
// Asserts the shape of the `setup_state` singleton Drizzle pgTable and its
// pgEnum, both reachable from `@openwhispr/data/schema` (the package barrel).
//
// Behaviour under test:
//   1. `setupState` and `setupStateStatus` are exported from the schema barrel.
//   2. `setupStateStatus` enum's values are exactly ['pending','completed','skipped_legacy']
//      in that declared order (matches RESEARCH §1 line-set 142-148).
//   3. `setupState` table has columns: id (smallint, primary key), status (enum, not-null),
//      completed_at (timestamptz, nullable), created_at (timestamptz, not-null, defaultNow).
//   4. Both bindings are re-exported via the package barrel (`@openwhispr/data/schema`).
//
// The `id = 1` CHECK constraint is a DDL-layer concern handled in migration
// 0017 (Drizzle 0.45.x cannot emit raw CHECK from the DSL — see RESEARCH §1
// line 165 and Phase 1 RLS lesson D-A1).

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
// Importing from the package barrel exercises the re-export contract.
import { setupState, setupStateStatus } from "../index.js";

describe("setup_state schema (Phase 12 / Plan 12-01)", () => {
  it("exports `setupState` (pgTable) and `setupStateStatus` (pgEnum) from the schema barrel", () => {
    expect(setupState).toBeDefined();
    expect(setupStateStatus).toBeDefined();
  });

  it("`setupStateStatus` enum values are ['pending','completed','skipped_legacy'] in order", () => {
    // drizzle pgEnum exposes its values on `.enumValues`.
    expect(setupStateStatus.enumValues).toEqual(["pending", "completed", "skipped_legacy"]);
  });

  it("`setupState` table name is 'setup_state'", () => {
    expect(getTableName(setupState)).toBe("setup_state");
  });

  it("`setupState` table declares the expected columns with the expected modifiers", () => {
    const cols = getTableColumns(setupState);

    // id: smallint primary key
    expect(cols.id).toBeDefined();
    expect(cols.id.primary).toBe(true);
    expect(cols.id.columnType).toBe("PgSmallInt");

    // status: enum, not-null, default 'pending'
    expect(cols.status).toBeDefined();
    expect(cols.status.notNull).toBe(true);
    expect(cols.status.hasDefault).toBe(true);
    expect(cols.status.default).toBe("pending");

    // completed_at: timestamptz, nullable
    expect(cols.completedAt).toBeDefined();
    expect(cols.completedAt.notNull).toBe(false);
    expect(cols.completedAt.columnType).toBe("PgTimestamp");

    // created_at: timestamptz, not-null, has default (defaultNow)
    expect(cols.createdAt).toBeDefined();
    expect(cols.createdAt.notNull).toBe(true);
    expect(cols.createdAt.hasDefault).toBe(true);
    expect(cols.createdAt.columnType).toBe("PgTimestamp");
  });
});
