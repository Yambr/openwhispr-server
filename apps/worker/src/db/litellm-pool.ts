// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 Plan 08 — pg.Pool factory for the LiteLLM co-tenant database.
//
// MUST connect DIRECT to postgres:5432 (NOT pgbouncer). Cross-database reads
// against `LiteLLM_SpendLogs` rely on a stable session — transaction-mode
// pooling reuses the same backend connection across statements and breaks
// cross-DB query semantics (RESEARCH Pitfall #9). Same defensive guard as
// packages/data/src/migrate.ts applies here at module construction time.
import pg from "pg";
import { assertDirectPostgres } from "./assert-direct-postgres.js";

const { Pool } = pg;

export function makeLitellmPool(env: NodeJS.ProcessEnv = process.env): pg.Pool {
  const url = env.LITELLM_READ_DATABASE_URL ?? env.LITELLM_DATABASE_URL;
  if (!url) {
    throw new Error("LITELLM_READ_DATABASE_URL or LITELLM_DATABASE_URL is required");
  }
  // Phase 66 / CR-09 — shared PgBouncer-hostname guard (Pitfall #9 —
  // cross-DB reads fail through a transaction-mode pool).
  assertDirectPostgres(url, "LITELLM_READ_DATABASE_URL");
  return new Pool({ connectionString: url, max: 5 });
}
