// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 01 — Better Auth `account` table.
//
// One row per (user, provider) pair. Tenant-scoped; FORCE RLS attaches in
// 0001_better_auth.sql. Better Auth's Drizzle adapter consumes this
// definition (the schema arg passed to drizzleAdapter) — column names
// MUST match the SQL migration verbatim.
//
// Phase 33 / Plan 33-05 — the 4 plaintext credential columns
// (`access_token`, `refresh_token`, `id_token`, `password`) were
// envelope-encrypted at rest via migration pair 0019 (additive bytea
// sidecars) and 0020 (drop plaintext). Each credential column is
// replaced by 6 nullable `bytea` sidecars (`<col>_dek_wrapped`,
// `<col>_dek_iv`, `<col>_dek_auth_tag`, `<col>_value_iv`,
// `<col>_value_auth_tag`, `<col>_value_ciphertext`). The Drizzle lens
// `wrapAdapter` in `packages/data/src/encryption/lens.ts` round-trips
// the legacy plaintext column names between adapter callers and the
// SQL wire. Plaintext-column reintroduction is refused by
// `tools/lint-no-plaintext-secret-columns.ts` (LOCKER-PLAINTEXT-COLS /
// DISCIPLINE Rule 15).
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./_helpers.js";
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

    // Plan 51-23 / Phase 33-05 — Better Auth-introspection compat columns.
    // Plaintext value NEVER lands here at runtime: the envelope-
    // encryption lens (packages/data/src/encryption/lens.ts) intercepts
    // every write, produces the 6 sidecars per credential, and DELETES
    // the plaintext key from the row payload BEFORE Drizzle builds the
    // INSERT. The column exists at the DB layer purely so Drizzle's
    // SQL generator has a target for the (default) bind that Better
    // Auth's adapter introspection requires the field name to be on
    // the model.  LOCKER-08 inline-allowlisted under
    // `LENS_INTROSPECTION_COMPAT` in tools/lint-no-plaintext-secret-columns.ts;
    // the constitutional amendment lives in that file's header.
    // Migration 0025 ADDs these columns as nullable, no DEFAULT.
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),

    // access_token — envelope-encrypted at rest.
    accessTokenDekWrapped: bytea("access_token_dek_wrapped"),
    accessTokenDekIv: bytea("access_token_dek_iv"),
    accessTokenDekAuthTag: bytea("access_token_dek_auth_tag"),
    accessTokenValueIv: bytea("access_token_value_iv"),
    accessTokenValueAuthTag: bytea("access_token_value_auth_tag"),
    accessTokenValueCiphertext: bytea("access_token_value_ciphertext"),

    // refresh_token — envelope-encrypted at rest.
    refreshTokenDekWrapped: bytea("refresh_token_dek_wrapped"),
    refreshTokenDekIv: bytea("refresh_token_dek_iv"),
    refreshTokenDekAuthTag: bytea("refresh_token_dek_auth_tag"),
    refreshTokenValueIv: bytea("refresh_token_value_iv"),
    refreshTokenValueAuthTag: bytea("refresh_token_value_auth_tag"),
    refreshTokenValueCiphertext: bytea("refresh_token_value_ciphertext"),

    // id_token — envelope-encrypted at rest.
    idTokenDekWrapped: bytea("id_token_dek_wrapped"),
    idTokenDekIv: bytea("id_token_dek_iv"),
    idTokenDekAuthTag: bytea("id_token_dek_auth_tag"),
    idTokenValueIv: bytea("id_token_value_iv"),
    idTokenValueAuthTag: bytea("id_token_value_auth_tag"),
    idTokenValueCiphertext: bytea("id_token_value_ciphertext"),

    // password — envelope-encrypted at rest.
    passwordDekWrapped: bytea("password_dek_wrapped"),
    passwordDekIv: bytea("password_dek_iv"),
    passwordDekAuthTag: bytea("password_dek_auth_tag"),
    passwordValueIv: bytea("password_value_iv"),
    passwordValueAuthTag: bytea("password_value_auth_tag"),
    passwordValueCiphertext: bytea("password_value_ciphertext"),

    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
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
