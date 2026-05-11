// Phase 5 / Plan 01 — Tenant-scoped settings rolled up at tenant level.
// RLS attaches in 0006_tenant_settings.sql (ENABLE + FORCE + isolation
// policy). AFTER INSERT trigger on tenants seeds a default row for every
// new tenant, and migration 0006 backfills existing tenants (Pitfall #8).
//
// Per CONTEXT D-31 these are READ-only in v1; mutation paths land in
// Phase 7. The JSONB columns hold the wire-shape responses for
// /api/stt-config and /api/note-recording-config.
import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  sttConfig: jsonb("stt_config").notNull().default({}),
  noteRecordingConfig: jsonb("note_recording_config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
