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
import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./_helpers.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // HI-05: the tenant_id → tenants.id FK is `ON DELETE NO ACTION` (migration
    // 0000 declares it so; `.references()` with no `onDelete` reflects that).
    // DELIBERATE — `sessions` is a Better Auth identity table; a tenant cannot
    // be deleted while session rows reference it. This differs from the
    // sibling `ON DELETE CASCADE` tenant FKs on
    // notes/folders/conversations/messages/transcriptions/api_keys. See the
    // "Tenant deletion" section of docs/operations.md.
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Plan 51-23 / Phase 33-05 — Better-Auth-introspection compat (see
    // accounts.ts for full rationale). Lens strips the plaintext key
    // before Drizzle builds the INSERT — plaintext NEVER lands at rest.
    // LOCKER-08 inline-allowlisted; migration 0025 re-adds the columns
    // as nullable, no DEFAULT.
    token: text("token"),
    previousToken: text("previous_token"),

    // token — envelope-encrypted at rest. Plaintext column dropped
    // by migration 0020, restored as a never-written introspection
    // sentinel by 0025; it is NULL at rest for every real session
    // (the lens strips the plaintext key on write).
    tokenDekWrapped: bytea("token_dek_wrapped"),
    tokenDekIv: bytea("token_dek_iv"),
    tokenDekAuthTag: bytea("token_dek_auth_tag"),
    tokenValueIv: bytea("token_value_iv"),
    tokenValueAuthTag: bytea("token_value_auth_tag"),
    tokenValueCiphertext: bytea("token_value_ciphertext"),
    // token_fp — SHA-256 fingerprint of the session bearer; the
    // canonical session-resolution lookup key (R20).
    //
    // Post-Phase-57 the encryption lens DOES populate this on every
    // session create: `encryptInto()` emits `token_fp` (snake + camel)
    // whenever `fingerprint` is configured, and the codegen'd
    // `SIDECAR_ADDITIONAL_FIELDS` registration forwards `tokenFp`
    // through Better Auth's adapter `transformInput` whitelist so it
    // lands at the SQL layer. (Plan 51-24's claim that "drizzleAdapter
    // strips the sidecars, the fingerprint is never populated" predates
    // that Phase-57 wiring and is no longer true.)
    //
    // Nullable — kept relaxed so a replay against a pre-fix database
    // with residual NULL-token_fp rows does not trip 23502. The
    // UNIQUE-token contract from Plan 02.12 is enforced by the partial
    // unique index `sessions_token_fp_unique` (migration 0030).
    tokenFp: bytea("token_fp"),

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
    // Partial UNIQUE on the SHA-256 fingerprint — migration 0030 (R20)
    // recreated it partial (`WHERE token_fp IS NOT NULL`) after 0026
    // relaxed token_fp to nullable. This is the live uniqueness contract
    // for session tokens; the plaintext-`token` index from 0026 (which
    // indexed an always-NULL column) was dropped by 0030.
    tokenFpUnique: uniqueIndex("sessions_token_fp_unique")
      .on(t.tokenFp)
      .where(sql`${t.tokenFp} IS NOT NULL`),
    // Partial index on the AUTH-04 overlap-window fingerprint
    // (preserved from 0019 — `WHERE previous_token_fp IS NOT NULL`).
    // Replaces the dropped `sessions_previous_token_idx`.
    previousTokenFpIdx: index("sessions_previous_token_fp_idx").on(t.previousTokenFp),
  }),
);
