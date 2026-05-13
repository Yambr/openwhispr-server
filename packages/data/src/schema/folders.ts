// SPDX-License-Identifier: Apache-2.0
// Phase 5 / Plan 01 — Tenant-scoped folders. RLS in 0007_notes_folders.sql.
// Self-referential parent_folder_id; soft-delete via deleted_at timestamptz.
// Partial UNIQUE on (tenant_id, user_id, client_folder_id) per D-24.
// Phase 5 / Plan 06 — extended with the 2 columns required by the
// upstream CloudFolder wire shape (~/openwhispr/src/services/FoldersService.ts).
// Migration 0012 adds the columns to the live table; this Drizzle schema
// mirrors the new shape so the typed query layer recognises them.
import {
  type AnyPgColumn,
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
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
  // Plan 06 / 0012 — upstream CloudFolder columns.
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
