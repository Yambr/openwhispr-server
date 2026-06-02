// SPDX-License-Identifier: FSL-1.1-ALv2
// @openwhispr/data — Phase 1 Wave 2 surface.
//
// Plan 03 lands schema + two-pool client factory + the first migration.
// Plan 04 adds `tenant-context` and the `encryption/` envelope helpers
// and extends this barrel with their exports.
export * from "./client.js";
export * from "./encryption/index.js";
export type { TenantScopedTable } from "./schema/index.js";
export * as schema from "./schema/index.js";
export { TENANT_SCOPED_TABLES } from "./schema/index.js";
export type {
  BypassPool,
  BypassPoolClient,
  ExecutableTx,
  TransactionalDb,
} from "./tenant-context.js";
export { withSystemBypass, withSystemBypassClient, withTenant } from "./tenant-context.js";
