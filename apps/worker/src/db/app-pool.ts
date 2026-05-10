// Phase 03 Plan 08 — pg.Pool factory for the openwhispr application database
// connecting as `openwhispr_owner` (BYPASSRLS) so the worker can write
// usage_ledger rows for any tenant after resolving tenant_id per row.
//
// Same Pitfall #9 defensive guard as the LiteLLM pool: must point DIRECT
// to postgres:5432, never to pgbouncer.
import pg from "pg";

const { Pool } = pg;

export function makeAppOwnerPool(env: NodeJS.ProcessEnv = process.env): pg.Pool {
  const url = env.DATABASE_URL_OWNER;
  if (!url) {
    throw new Error("DATABASE_URL_OWNER is required");
  }
  let host: string | null = null;
  try {
    host = new URL(url).hostname;
  } catch {
    // pg.Pool will surface a clearer error below.
  }
  if (host && /pgbouncer/i.test(host)) {
    throw new Error(
      `DATABASE_URL_OWNER must point DIRECT to postgres:5432, not pgbouncer host "${host}"`,
    );
  }
  return new Pool({ connectionString: url, max: 5 });
}
