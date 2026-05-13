// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 01 — Better Auth `account` table.
//
// One row per (user, provider) pair. Tenant-scoped; FORCE RLS attaches in
// 0001_better_auth.sql. Better Auth's Drizzle adapter consumes this
// definition (the schema arg passed to drizzleAdapter) — column names
// MUST match the SQL migration verbatim.
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const accounts = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("account_tenant_id_idx").on(t.tenantId),
    userIdx: index("account_user_id_idx").on(t.userId),
    providerAccountTenantUnique: unique("account_provider_account_tenant_unique").on(
      t.providerId,
      t.accountId,
      t.tenantId,
    ),
  }),
);
