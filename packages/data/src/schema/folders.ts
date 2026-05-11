// Phase 5 / Plan 01 — Tenant-scoped folders. RLS in 0007_notes_folders.sql.
// Self-referential parent_folder_id; soft-delete via deleted_at timestamptz.
// Partial UNIQUE on (tenant_id, user_id, client_folder_id) per D-24.
import { type AnyPgColumn, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const folders = pgTable("folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  parentFolderId: uuid("parent_folder_id").references((): AnyPgColumn => folders.id, {
    onDelete: "set null",
  }),
  clientFolderId: text("client_folder_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
