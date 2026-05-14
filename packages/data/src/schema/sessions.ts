// SPDX-License-Identifier: FSL-1.1-ALv2
// Tenant-scoped sessions table. RLS attaches in 0000_initial.sql.
//
// Phase 02.12 — adopt Better Auth v1.6.9's canonical plain-text `token`
// model. The bytea `token_hash` / `previous_token_hash` columns from
// Phase 02 Plan 01 (AUTH-04 v1 hash-only storage) are dropped by
// migration 0005_session_token_plain.sql. The AUTH-04 5-minute overlap
// CONTRACT (behavior, not storage shape) is preserved via the plain-text
// `previousToken` column. At-rest hardening is deferred to v2 (column-
// level pgcrypto or Postgres TDE — ADR placeholder in
// `.planning/STATE.md` Roadmap Evolution).
//
// Phase 02 Plan 01 also added (and these survive Phase 02.12 unchanged):
//   * previous_token_expires_at — AUTH-04 5-minute overlap window stamp.
//   * ip_address + user_agent — Better Auth's session shape; useful for
//     audit/operations.
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    // Better Auth v1.6.9's drizzle-adapter looks up `session.token` by
    // canonical name; storing the bearer plain-text matches every
    // mainstream OSS auth library (NextAuth, Auth.js, Lucia, BA itself).
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // AUTH-04 5-minute overlap: when Better Auth rotates a session, the
    // OLD bearer is copied here and `previousTokenExpiresAt` is stamped
    // to now()+5min so 100 in-flight concurrent requests don't cascade-
    // 401. The SECURITY DEFINER function
    // `lookup_session_by_previous_token(text)` (migration 0005) is the
    // canonical lookup path.
    previousToken: text("previous_token"),
    previousTokenExpiresAt: timestamp("previous_token_expires_at", { withTimezone: true }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("sessions_tenant_id_idx").on(t.tenantId),
    // UNIQUE token index — collisions raise 23505. Mirrors migration 0005's
    // `sessions_token_unique`.
    tokenUnique: uniqueIndex("sessions_token_unique").on(t.token),
    // Partial index on the AUTH-04 overlap column. Mirrors migration 0005's
    // `sessions_previous_token_idx` (WHERE previous_token IS NOT NULL).
    previousTokenIdx: index("sessions_previous_token_idx").on(t.previousToken),
  }),
);
