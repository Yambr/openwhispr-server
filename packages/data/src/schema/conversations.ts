// SPDX-License-Identifier: Apache-2.0
// Phase 5 / Plan 01 — Tenant-scoped conversations. RLS in 0008_conversations_messages.sql.
// content_search is a tsvector GENERATED column over (title), indexed with GIN.
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tsvector } from "./_helpers.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  clientConversationId: text("client_conversation_id"),
  contentSearch: tsvector("content_search").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
