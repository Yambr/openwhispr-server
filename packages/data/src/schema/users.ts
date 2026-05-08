// Tenant-scoped users table. RLS attaches in 0000_initial.sql.
// (tenant_id, email) is unique per tenant so the same email may exist
// under multiple tenants without collision.
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("users_tenant_id_idx").on(t.tenantId),
    emailUnique: uniqueIndex("users_tenant_email_unique").on(t.tenantId, t.email),
  }),
);
