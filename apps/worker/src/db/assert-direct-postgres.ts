// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 66 / CR-09 — shared "must connect DIRECT to postgres, not
// pgbouncer" guard.
//
// pg_partman's `run_maintenance_proc()` and the cross-database
// `LiteLLM_SpendLogs` reads both depend on a STABLE session — they issue
// internal COMMITs / span multiple statements on one backend connection.
// PgBouncer in transaction-mode reuses backend connections across
// statements, silently breaking those semantics (RESEARCH Pitfall #9).
//
// Pre-CR-09 this guard was duplicated inline in `app-pool.ts` and
// `litellm-pool.ts`, and the inline `maintenancePool` in `index.ts` had
// NO guard at all — a PgBouncer-pointed `DATABASE_URL_OWNER` would let
// `partman.run_maintenance_proc()` silently corrupt partman state. This
// module is the single shared guard used by all three pool constructors.

/**
 * Throw if `url`'s hostname looks like a PgBouncer endpoint. A malformed
 * URL is NOT rejected here — `pg.Pool` surfaces a clearer connection
 * error downstream. `envVarName` is interpolated into the thrown message
 * so the operator sees exactly which env var to fix.
 */
export function assertDirectPostgres(url: string, envVarName: string): void {
  let host: string | null = null;
  try {
    host = new URL(url).hostname;
  } catch {
    // Malformed URL — let pg.Pool surface the clearer error downstream.
    return;
  }
  if (host && /pgbouncer/i.test(host)) {
    throw new Error(
      `${envVarName} must point DIRECT to postgres:5432, not pgbouncer host "${host}" ` +
        `(Pitfall #9 — transaction-mode pooling breaks cross-DB reads and partman's internal COMMITs)`,
    );
  }
}
