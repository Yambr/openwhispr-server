// Tenant-scoped users table. RLS attaches in 0000_initial.sql.
// (tenant_id, email) is unique per tenant so the same email may exist
// under multiple tenants without collision.
//
// Phase 2 / Plan 01 extends with Better Auth required fields:
//   * name, email_verified, image, password_hash
// Plus our own:
//   * email_verified_at — set when verification completes; the boolean
//     above is a fast lookup, the timestamp is the audit-quality record.
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    name: text("name"),
    emailVerified: boolean("email_verified").notNull().default(false),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    image: text("image"),
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("users_tenant_id_idx").on(t.tenantId),
    emailUnique: uniqueIndex("users_tenant_email_unique").on(t.tenantId, t.email),
  }),
);
