// @openwhispr/data — Phase 1 Wave 2 surface.
//
// Plan 03 (this) lands schema + two-pool client factory + the first migration.
// Plan 04 will add `tenant-context` and the `encryption/` envelope helpers
// and re-export them from this barrel.
export * from "./client.js";
export type { TenantScopedTable } from "./schema/index.js";
export * as schema from "./schema/index.js";
export { TENANT_SCOPED_TABLES } from "./schema/index.js";
