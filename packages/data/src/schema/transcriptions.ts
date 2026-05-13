// SPDX-License-Identifier: Apache-2.0
// Phase 5 / Plan 01 — Tenant-scoped transcriptions. RLS in 0009_transcriptions.sql.
// Phase 5 / Plan 08 — adds raw_text, word_count, source, status (0013).
import { integer, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const transcriptions = pgTable("transcriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  text: text("text").notNull().default(""),
  rawText: text("raw_text"),
  wordCount: integer("word_count").notNull().default(0),
  source: text("source").notNull().default("desktop"),
  status: text("status").notNull().default("completed"),
  language: text("language"),
  durationSeconds: real("duration_seconds"),
  audioDurationMs: integer("audio_duration_ms"),
  model: text("model"),
  provider: text("provider"),
  clientTranscriptionId: text("client_transcription_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
