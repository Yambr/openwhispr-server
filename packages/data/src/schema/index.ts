// SPDX-License-Identifier: Apache-2.0
// Aggregate schema export. The TENANT_SCOPED_TABLES literal is the
// auto-discovery hook used by the Plan 05 RLS lint and the Plan 04
// PgBouncer-interleave property test — adding a new tenant-scoped table
// in a future migration MUST add it to this list as well.
export * from "./accounts.js";
export * from "./api_keys.js";
export * from "./audit_log.js";
export * from "./conversations.js";
export * from "./folders.js";
export * from "./messages.js";
export * from "./notes.js";
export * from "./oauth_state.js";
export * from "./sessions.js";
export * from "./tenant_settings.js";
export * from "./tenants.js";
export * from "./transcriptions.js";
export * from "./usage_ledger.js";
export * from "./usage_rollup_daily.js";
export * from "./user_settings.js";
export * from "./users.js";
export * from "./verifications.js";

export const TENANT_SCOPED_TABLES = [
  "users",
  "sessions",
  "audit_log",
  "usage_ledger",
  "account",
  "verification",
  "oauth_state",
  // Phase 5 / Plan 01 — settings + CRUD resource families
  "tenant_settings",
  "user_settings",
  "notes",
  "folders",
  "conversations",
  "messages",
  "transcriptions",
  "api_keys",
  // Phase 6 / Plan 06-08 — daily rollup written by usage-rollup-daily worker
  "usage_rollup_daily",
] as const;
export type TenantScopedTable = (typeof TENANT_SCOPED_TABLES)[number];
