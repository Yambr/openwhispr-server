// Phase 5 / Plan 01 — Tenant-scoped notes. RLS in 0007_notes_folders.sql.
// content_search is a tsvector GENERATED ALWAYS AS (... ) STORED column,
// indexed with GIN. Partial UNIQUE on (tenant_id, user_id, client_note_id)
// per D-24. Keyset pagination via partial index (created_at DESC, id DESC)
// WHERE deleted_at IS NULL per D-25.
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { folders } from "./folders.js";
import { tsvector } from "./_helpers.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
  clientNoteId: text("client_note_id"),
  title: text("title"),
  content: text("content").notNull().default(""),
  // Materialized GENERATED column over (title, content). Hand-augmented in
  // migration 0007; drizzle-kit cannot emit GENERATED expressions natively.
  contentSearch: tsvector("content_search").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
