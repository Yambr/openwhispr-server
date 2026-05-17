// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 01 — Better Auth `verification` table.
//
// Short-lived tokens for email verification + password reset. Tenant-
// scoped; FORCE RLS attaches in 0001_better_auth.sql.
//
// Phase 33 / Plan 33-05 — the plaintext `value` column dropped by
// migration 0020 is now envelope-encrypted at rest via 6 `bytea`
// sidecars. The Drizzle lens
// (`packages/data/src/encryption/lens.ts`) round-trips plaintext for
// callers; ciphertext is the only thing stored.
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./_helpers.js";
import { tenants } from "./tenants.js";

export const verifications = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    identifier: text("identifier").notNull(),

    // Plan 51-23 / Phase 33-05 — Better-Auth-introspection compat (see
    // accounts.ts for full rationale). Lens strips the plaintext key
    // before Drizzle builds the INSERT. LOCKER-08 inline-allowlisted.
    value: text("value"),

    // value — envelope-encrypted at rest. Plaintext column dropped by
    // migration 0020, restored as a never-written introspection
    // sentinel by 0025.
    valueDekWrapped: bytea("value_dek_wrapped"),
    valueDekIv: bytea("value_dek_iv"),
    valueDekAuthTag: bytea("value_dek_auth_tag"),
    valueValueIv: bytea("value_value_iv"),
    valueValueAuthTag: bytea("value_value_auth_tag"),
    valueValueCiphertext: bytea("value_value_ciphertext"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("verification_tenant_id_idx").on(t.tenantId),
    identifierIdx: index("verification_identifier_idx").on(t.identifier),
  }),
);
