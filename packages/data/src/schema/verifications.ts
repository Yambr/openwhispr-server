// Phase 2 / Plan 01 — Better Auth `verification` table.
//
// Short-lived tokens for email verification + password reset. Tenant-
// scoped; FORCE RLS attaches in 0001_better_auth.sql.
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const verifications = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("verification_tenant_id_idx").on(t.tenantId),
    identifierIdx: index("verification_identifier_idx").on(t.identifier),
  }),
);
