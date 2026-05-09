// Phase 2 / Plan 01 — OAuth shim state storage.
//
// 10-minute TTL; single-use semantics enforced by setting consumed_at on
// the first callback claim. Tenant-scoped; FORCE RLS attaches in
// 0002_oauth_state.sql.
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
    codeVerifier: text("code_verifier").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("oauth_state_tenant_id_idx").on(t.tenantId),
  }),
);
