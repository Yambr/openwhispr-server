// SPDX-License-Identifier: Apache-2.0
// Phase 5 / Plan 01 — User-scoped overrides on top of tenant_settings.
// RLS attaches in 0006_tenant_settings.sql. Every row carries tenant_id
// so the canonical isolation policy applies even though PK is user_id.
import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  sttOverrides: jsonb("stt_overrides").notNull().default({}),
  noteRecordingOverrides: jsonb("note_recording_overrides").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
