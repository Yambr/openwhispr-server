// SPDX-License-Identifier: FSL-1.1-ALv2
// Tenant-scoped sessions table. RLS attaches in 0000_initial.sql.
//
// Phase 33 / Plan 33-05 — the plaintext `token` + `previous_token`
// columns dropped by migration 0020 are now envelope-encrypted at
// rest. Each is replaced by 6 nullable `bytea` sidecars
// (`<col>_dek_wrapped`, ..., `<col>_value_ciphertext`) plus a
// SHA-256 fingerprint sidecar (`token_fp` NOT NULL — full UNIQUE
// INDEX; `previous_token_fp` nullable — partial INDEX for the
// AUTH-04 5-minute overlap window). The Drizzle lens
// (`packages/data/src/encryption/lens.ts`) handles plaintext ↔
// ciphertext round-tripping; fingerprint-based lookup is the
// canonical replacement for the previously dropped SQL function
// `lookup_session_by_previous_token(text)` and lives at
// `packages/data/src/sessions/lookup-by-previous-token.ts`. The
// AUTH-04 5-minute overlap CONTRACT is preserved as a behaviour
// guarantee — storage shape is now ciphertext-only.
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./_helpers.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // token — envelope-encrypted at rest. Plaintext column dropped
    // by migration 0020. `token_fp` (below) is NOT NULL so the
    // UNIQUE-token contract from Plan 02.12 is preserved at the
    // fingerprint layer.
    tokenDekWrapped: bytea("token_dek_wrapped"),
    tokenDekIv: bytea("token_dek_iv"),
    tokenDekAuthTag: bytea("token_dek_auth_tag"),
    tokenValueIv: bytea("token_value_iv"),
    tokenValueAuthTag: bytea("token_value_auth_tag"),
    tokenValueCiphertext: bytea("token_value_ciphertext"),
    tokenFp: bytea("token_fp").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    // previous_token — envelope-encrypted at rest. AUTH-04 5-minute
    // overlap window is enforced at the application layer
    // (`previousTokenExpiresAt`); the fingerprint is nullable
    // because most sessions outside the overlap window have no
    // previous-token state.
    previousTokenDekWrapped: bytea("previous_token_dek_wrapped"),
    previousTokenDekIv: bytea("previous_token_dek_iv"),
    previousTokenDekAuthTag: bytea("previous_token_dek_auth_tag"),
    previousTokenValueIv: bytea("previous_token_value_iv"),
    previousTokenValueAuthTag: bytea("previous_token_value_auth_tag"),
    previousTokenValueCiphertext: bytea("previous_token_value_ciphertext"),
    previousTokenFp: bytea("previous_token_fp"),

    previousTokenExpiresAt: timestamp("previous_token_expires_at", { withTimezone: true }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("sessions_tenant_id_idx").on(t.tenantId),
    // Full UNIQUE on the SHA-256 fingerprint (migration 0020 promoted
    // the partial-unique from 0019 to a full UNIQUE once token_fp
    // became NOT NULL). Replaces the dropped `sessions_token_unique`.
    tokenFpUnique: uniqueIndex("sessions_token_fp_unique").on(t.tokenFp),
    // Partial index on the AUTH-04 overlap-window fingerprint
    // (preserved from 0019 — `WHERE previous_token_fp IS NOT NULL`).
    // Replaces the dropped `sessions_previous_token_idx`.
    previousTokenFpIdx: index("sessions_previous_token_fp_idx").on(t.previousTokenFp),
  }),
);
