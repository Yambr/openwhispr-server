// Programmatic migration runner — invoked by `make migrate` and by the
// `pnpm --filter @openwhispr/data run migrate` script.
//
// Connects via DATABASE_URL_OWNER (NOT DATABASE_URL) so the migration
// runs as openwhispr_owner against Postgres directly on 5432, NOT
// through PgBouncer. Refusing to silently fall back to the app URL
// guards against accidentally running DDL through the transaction-pool
// connection-reuse path (RESEARCH-DB §Anti-Patterns).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Resolve script directory across both runtimes:
//   - tsx (ESM, dev / vitest) — import.meta.url is set.
//   - tsup --format cjs (container image) — falls back to __dirname.
// In the container the bundle ships at /app/packages/data/dist/migrate.cjs
// and the migrations live alongside at /app/packages/data/migrations.
const here =
  typeof import.meta?.url === "string"
    ? dirname(fileURLToPath(import.meta.url))
    : (typeof __dirname !== "undefined" ? __dirname : process.cwd());
const MIGRATIONS_FOLDER = resolve(here, "..", "migrations");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    // biome-ignore lint/suspicious/noConsole: one-shot CLI script
    console.error("migrate: DATABASE_URL_OWNER not set — refusing to run as owner");
    process.exit(2);
  }

  // CONTAINER-A1 (Phase 2 Plan 02): refuse to run DDL through PgBouncer
  // transaction-mode. Transaction-pool connection reuse breaks
  // CREATE INDEX CONCURRENTLY and any DDL-in-transaction sequence; the
  // owner role MUST connect direct to Postgres on 5432.
  let parsedHost: string | null = null;
  try {
    parsedHost = new URL(url).hostname;
  } catch {
    // If the URL is malformed pg.Pool will surface a clearer error below;
    // do NOT swallow that diagnostic.
  }
  if (parsedHost && /pgbouncer/i.test(parsedHost)) {
    // biome-ignore lint/suspicious/noConsole: one-shot CLI script
    console.error(
      `migrate: refusing to run DDL through pgbouncer host "${parsedHost}" — owner must connect direct to postgres:5432`,
    );
    process.exit(3);
  }

  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const db = drizzle(pool);
    await migrate(db, {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: "_meta",
      migrationsTable: "__drizzle_migrations",
    });
    // biome-ignore lint/suspicious/noConsole: one-shot CLI script
    console.log("migrate: ok");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  // biome-ignore lint/suspicious/noConsole: one-shot CLI script
  console.error("migrate: failed", err);
  process.exit(1);
});
