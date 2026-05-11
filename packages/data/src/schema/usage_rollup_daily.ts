// Phase 6 / Plan 06-08 — usage_rollup_daily table.
//
// Per-tenant per-date aggregate of usage_ledger rows, written by the
// usage-rollup-daily BullMQ job (D-W5 cadence `5 0 * * *` UTC).
// RLS attaches in migration 0015_usage_rollup_daily.sql.
// PK is (tenant_id, date) — idempotency anchor for the rollup job
// (re-running the job replaces the row).

import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const usageRollupDaily = pgTable(
  "usage_rollup_daily",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    totalUnits: integer("total_units").notNull().default(0),
    kindBreakdown: jsonb("kind_breakdown").notNull().default({}),
    rolledUpAt: timestamp("rolled_up_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.date] }),
    dateIdx: index("usage_rollup_daily_date_idx").on(t.date),
  }),
);
