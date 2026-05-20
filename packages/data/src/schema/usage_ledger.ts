// SPDX-License-Identifier: FSL-1.1-ALv2
// Tenant-scoped usage ledger. RLS attaches in 0000_initial.sql.
// `request_id` is GLOBALLY UNIQUE (idempotency key per DATA-03). Re-posting
// the same request_id surfaces a unique-violation error rather than a
// duplicate ledger row. No `updated_at` — append-only.
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    requestId: text("request_id").notNull(),
    kind: text("kind").notNull(),
    units: integer("units").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Phase 58 Track B / worker:CR-02 — LiteLLM `startTime` (when the spend
    // actually occurred). Nullable: historical rows predate this column and
    // keep `created_at` bucketing via COALESCE(event_at, created_at) in the
    // rollup + reconciliation jobs — going-forward only.
    eventAt: timestamp("event_at", { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index("usage_ledger_tenant_id_idx").on(t.tenantId),
    requestIdUnique: uniqueIndex("usage_ledger_request_id_unique").on(t.requestId),
    eventAtIdx: index("usage_ledger_event_at_idx").on(t.tenantId, t.eventAt),
  }),
);
