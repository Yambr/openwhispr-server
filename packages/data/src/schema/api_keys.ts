// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 5 / Plan 01 — Tenant-scoped API keys. RLS in 0010_api_keys.sql.
//
// Storage shape per D-29:
//   * `key_prefix` is GLOBALLY UNIQUE — used for fast lookup before hash
//     verification (prefix derived as `pak_<first-6>` from the clear-text
//     key on creation). Listing only ever returns the prefix.
//   * `key_hash` is Argon2id digest of the FULL clear-text key. Only the
//     creator sees the clear text once at issuance time
//     (CreateApiKeyResponse.key); subsequent reads expose just the prefix.
//   * `revoked_at` is the soft-revoke marker; partial UNIQUE on
//     (tenant_id, name) WHERE revoked_at IS NULL prevents duplicate
//     active names per tenant.
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  scopes: text("scopes").array().notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
