// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-01 — singleton `setup_state` table + status pgEnum.
//
// Operator-global, NOT tenant-scoped. NO RLS attaches here (CONTEXT D-02):
// the table holds only the wizard state machine status + timestamps; no
// tenant_id, no user data crosses the trust boundary. The same posture
// as `tenants` (the root tenant table) — see `./tenants.ts`.
//
// CONTEXT D-01 — the wizard claim is gated by a state-machine column on a
// singleton row, NOT by a `users-count` heuristic. A v1-upgrade install
// (pre-existing users at migration time) lands with status='skipped_legacy'
// so the wizard route refuses to claim, preventing a second admin from
// being created. Migration 0017 ships the conditional backfill atomically
// with the table DDL.
//
// The `id = 1` singleton CHECK constraint is enforced in the migration
// SQL (drizzle-kit 0.31.10 / drizzle-orm 0.45.x does not emit raw CHECK
// from this DSL — same posture as the locale CHECK in users.ts / 0016).
import { pgEnum, pgTable, smallint, timestamp } from "drizzle-orm/pg-core";

export const setupStateStatus = pgEnum("setup_state_status", [
  "pending",
  "completed",
  "skipped_legacy",
] as const);

export const setupState = pgTable("setup_state", {
  id: smallint("id").primaryKey(),
  status: setupStateStatus("status").notNull().default("pending"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
