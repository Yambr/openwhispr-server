// Phase 03 Plan 08 — pg.Pool factory for the LiteLLM co-tenant database.
//
// MUST connect DIRECT to postgres:5432 (NOT pgbouncer). Cross-database reads
// against `LiteLLM_SpendLogs` rely on a stable session — transaction-mode
// pooling reuses the same backend connection across statements and breaks
// cross-DB query semantics (RESEARCH Pitfall #9). Same defensive guard as
// packages/data/src/migrate.ts applies here at module construction time.
import pg from "pg";

const { Pool } = pg;

export function makeLitellmPool(env: NodeJS.ProcessEnv = process.env): pg.Pool {
  const url = env.LITELLM_READ_DATABASE_URL ?? env.LITELLM_DATABASE_URL;
  if (!url) {
    throw new Error(
      "LITELLM_READ_DATABASE_URL or LITELLM_DATABASE_URL is required",
    );
  }
  let host: string | null = null;
  try {
    host = new URL(url).hostname;
  } catch {
    // pg.Pool will surface a clearer error below; do not swallow.
  }
  if (host && /pgbouncer/i.test(host)) {
    throw new Error(
      `LITELLM_READ_DATABASE_URL must point DIRECT to postgres:5432, not pgbouncer host "${host}" (Pitfall #9 — cross-DB read fails through transaction-mode pool)`,
    );
  }
  return new Pool({ connectionString: url, max: 5 });
}
