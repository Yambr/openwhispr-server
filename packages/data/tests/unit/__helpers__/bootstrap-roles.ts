// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.1 / Plan 03 / D-12 — bootstrapRoles test helper.
//
// Centralizes the canonical two-role bootstrap that every RLS-touching test
// in @openwhispr/data (and tools/lint-rls.test.ts) replicates verbatim.
// Before extraction, six call sites carried near-identical inline SQL; one
// of them (tools/lint-rls.test.ts) was missing the CREATEROLE attribute
// + ADMIN OPTION grant, which caused migration 0003's `ALTER ROLE
// openwhispr_app SET app.tenant_id …` to fail with PG 42501 (D-11).
//
// What this helper does, in order, against the connected SUPERUSER pool:
//   1. CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE
//   2. CREATE ROLE openwhispr_app   WITH LOGIN          (RLS-subject)
//   3. GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION
//      (lets migration 0003 ALTER the app role's default GUC)
//   4. GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner
//      (lets migration 0003 set the custom GUC on the role)
//   5. ALTER DATABASE <opts.dbName> OWNER TO openwhispr_owner
//   6. ALTER SCHEMA public OWNER TO openwhispr_owner
//
// What it deliberately does NOT do:
//   - provision pg_partman (callers that need it call provisionPgPartman
//     separately — keeps the helper usable from lint-rls.test.ts which
//     never imports pg_partman).
//   - close `superPool` (caller owns the pool lifecycle).
//
// PROD-PARITY CAVEAT (planner risk #2 — D-12):
//   In production, only `openwhispr_owner` carries CREATEROLE; the app role
//   has none. This helper grants CREATEROLE only to the owner — matching
//   prod. If a future Phase 19.x prod-parity test ever demands a stricter
//   "owner-without-CREATEROLE" shape, split into `bootstrapMinimalRoles` +
//   `grantCreateRoleForTesting` so the elevation is opt-in.
import type { Pool } from "pg";

export interface BootstrapRolesOptions {
  /** Name of the database whose ownership should be transferred. */
  dbName: string;
  /** Password assigned to the bootstrap owner role. */
  ownerPassword: string;
  /** Password assigned to the bootstrap app role. */
  appPassword: string;
}

/**
 * Bootstraps the canonical `openwhispr_owner` + `openwhispr_app` role pair
 * against a fresh testcontainer-backed Postgres cluster. See file header
 * for the full SQL sequence and the prod-parity caveat.
 *
 * @param superPool node-postgres Pool connected as a superuser.
 * @param opts      database + role passwords.
 */
export async function bootstrapRoles(
  superPool: Pool,
  opts: BootstrapRolesOptions = {
    dbName: "openwhispr",
    ownerPassword: "owner-pw",
    appPassword: "app-pw",
  },
): Promise<void> {
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${opts.ownerPassword}'`,
  );
  await superPool.query(
    `CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${opts.appPassword}'`,
  );
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE ${opts.dbName} OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
}
