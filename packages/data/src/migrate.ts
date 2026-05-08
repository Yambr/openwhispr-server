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

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, "..", "migrations");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    // biome-ignore lint/suspicious/noConsole: one-shot CLI script
    console.error("migrate: DATABASE_URL_OWNER not set — refusing to run as owner");
    process.exit(2);
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
