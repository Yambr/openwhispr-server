// Aggregate schema export. The TENANT_SCOPED_TABLES literal is the
// auto-discovery hook used by the Plan 05 RLS lint and the Plan 04
// PgBouncer-interleave property test — adding a new tenant-scoped table
// in a future migration MUST add it to this list as well.
export * from "./accounts.js";
export * from "./audit_log.js";
export * from "./oauth_state.js";
export * from "./sessions.js";
export * from "./tenants.js";
export * from "./usage_ledger.js";
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
] as const;
export type TenantScopedTable = (typeof TENANT_SCOPED_TABLES)[number];
