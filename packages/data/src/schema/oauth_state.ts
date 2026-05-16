// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 01 — OAuth shim state storage.
//
// 10-minute TTL; single-use semantics enforced by setting consumed_at on
// the first callback claim. Tenant-scoped; FORCE RLS attaches in
// 0002_oauth_state.sql.
//
// Phase 33 / Plan 33-05 — the plaintext `code_verifier` column dropped
// by migration 0020 is now envelope-encrypted at rest via 6 `bytea`
// sidecars. The route handlers
// (`apps/api/src/routes/{desktop-signin,auth-callback}.ts`) call into
// `packages/data/src/encryption/oauth-state-codec.ts` (Plan 33-04) at
// the three raw-`sql` fragment sites; the codec wraps/unwraps the
// 6-sidecar shape.
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./_helpers.js";
import { tenants } from "./tenants.js";

export const oauthState = pgTable(
  "oauth_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    provider: text("provider").notNull(),
    callbackUrl: text("callback_url").notNull(),
    scheme: text("scheme").notNull(),

    // code_verifier — envelope-encrypted at rest. Plaintext column
    // dropped by migration 0020.
    codeVerifierDekWrapped: bytea("code_verifier_dek_wrapped"),
    codeVerifierDekIv: bytea("code_verifier_dek_iv"),
    codeVerifierDekAuthTag: bytea("code_verifier_dek_auth_tag"),
    codeVerifierValueIv: bytea("code_verifier_value_iv"),
    codeVerifierValueAuthTag: bytea("code_verifier_value_auth_tag"),
    codeVerifierValueCiphertext: bytea("code_verifier_value_ciphertext"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("oauth_state_tenant_id_idx").on(t.tenantId),
  }),
);
