// SPDX-License-Identifier: FSL-1.1-ALv2
// Tenant-scoped audit log. RLS attaches in 0000_initial.sql; the table
// is converted to a monthly RANGE-partitioned parent in migration
// 0014_audit_log_partition.sql (Phase 6 / Plan 02, DATA-04 D-A2).
//
// Drizzle does NOT model partitioned tables natively — at the ORM layer
// the table behaves like a flat table (queries and writes go through
// the partitioned parent, and PostgreSQL routes rows to the right
// monthly child by `created_at`). The CHECK constraint on `action` is
// declared here so drizzle-kit `generate`/`push` introspection stays
// in sync; the production DDL lives in migration 0014.
//
// No `updated_at` — append-only.

import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * D-A6 — canonical 18-action enumeration. The same list is enforced at
 * the database layer via the `audit_log_action_check` CHECK constraint
 * created by migration 0014. Application code should reference
 * `AuditLogAction` as the union type when emitting audit rows.
 */
export const AUDIT_LOG_ACTIONS = [
  "auth.signin",
  "auth.signin_failed",
  "auth.signout",
  "auth.password_change",
  "auth.oauth_link",
  "account.delete",
  "account.delete_requested",
  "key.issued",
  "key.revoked",
  "settings.tenant_changed",
  "settings.user_changed",
  "admin.tenant_created",
  "admin.tenant_suspended",
  "admin.user_impersonated",
  "admin.role_changed",
  "security.cross_tenant_attempt",
  "security.rate_limit_exceeded",
  "security.ssrf_blocked",
] as const;

export type AuditLogAction = (typeof AUDIT_LOG_ACTIONS)[number];

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("audit_log_tenant_id_idx").on(t.tenantId),
    createdIdx: index("audit_log_created_at_idx").on(t.createdAt),
    actionCheck: check(
      "audit_log_action_check",
      sql`${t.action} IN (
        'auth.signin','auth.signin_failed','auth.signout','auth.password_change',
        'auth.oauth_link','account.delete','account.delete_requested',
        'key.issued','key.revoked','settings.tenant_changed','settings.user_changed',
        'admin.tenant_created','admin.tenant_suspended','admin.user_impersonated',
        'admin.role_changed','security.cross_tenant_attempt',
        'security.rate_limit_exceeded','security.ssrf_blocked'
      )`,
    ),
  }),
);
