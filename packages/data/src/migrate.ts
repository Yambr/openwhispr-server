// SPDX-License-Identifier: FSL-1.1-ALv2
// Programmatic migration runner — invoked by `make migrate` and by the
// `pnpm --filter @openwhispr/data run migrate` script.
//
// Connects via DATABASE_URL_OWNER (NOT DATABASE_URL) so the migration
// runs as openwhispr_owner against Postgres directly on 5432, NOT
// through PgBouncer. Refusing to silently fall back to the app URL
// guards against accidentally running DDL through the transaction-pool
// connection-reuse path (RESEARCH-DB §Anti-Patterns).
//
// Phase 03 / Plan 01 Task 2 — HIGH-1 fix: BEFORE running Drizzle's
// migrate(), open a direct admin connection to the `postgres` database
// and CREATE DATABASE litellm IF NOT EXISTS. initdb scripts only run on
// a freshly-initialized data volume, so existing-volume operators
// upgrading from Phase 2 would otherwise have LiteLLM crash on boot
// with `database "litellm" does not exist`. Auto-create is non-
// destructive and idempotent — `make clean-stack` is NOT required.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
// Phase 51 / Plan 51-14 (REVIEW HI-03) — TLS-by-default pool builder.
// Eliminates the `sslmode=prefer` fallback that left credentials and
// tenant rows traversing plaintext when the server happened to
// reject the TLS handshake.
import { buildPoolConfig } from "./client.js";

// Resolve script directory across both runtimes:
//   - tsx (ESM, dev / vitest) — import.meta.url is set.
//   - tsup --format cjs (container image) — falls back to __dirname.
// In the container the bundle ships at /app/packages/data/dist/migrate.cjs
// and the migrations live alongside at /app/packages/data/migrations.
const here =
  typeof import.meta?.url === "string"
    ? dirname(fileURLToPath(import.meta.url))
    : typeof __dirname !== "undefined"
      ? __dirname
      : process.cwd();
const MIGRATIONS_FOLDER = resolve(here, "..", "migrations");

/**
 * Whitelist a Postgres identifier for safe interpolation into DDL where
 * parameterized binds are not accepted (CREATE DATABASE OWNER ...).
 * Accepts only the canonical SQL identifier shape `[A-Za-z_][A-Za-z0-9_]*`.
 * Throws on anything else — never falls back to quoting.
 */
export function pgIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`pgIdent: refusing unsafe identifier ${JSON.stringify(name)}`);
  }
  return name;
}

/**
 * HIGH-1 (Phase 03 Plan 01 Task 2) — auto-create the `litellm` database
 * when missing. Idempotent: the second call is a no-op that logs the
 * skip message. Uses a SHORT-lived admin pool (max=1) connected to the
 * `postgres` maintenance database; CREATE DATABASE cannot run inside a
 * transaction so we let pg's auto-commit single-statement path handle
 * it.
 *
 * @param adminUrl  postgres://owner@postgres:5432/postgres (NOT pgbouncer)
 * @param owner     role name for the new database's OWNER. MUST already
 *                  satisfy pgIdent.
 * @param log       optional logger (default: console.log) — injectable
 *                  so tests can assert log lines without spying on the
 *                  module-level console.
 */
export async function ensureLitellmDatabase(
  adminUrl: string,
  owner: string,
  log: (msg: string) => void = (m) => {
    // biome-ignore lint/suspicious/noConsole: one-shot CLI script
    console.log(m);
  },
): Promise<void> {
  const safeOwner = pgIdent(owner);
  const admin = new Pool(buildPoolConfig(adminUrl, { max: 1 }));
  try {
    const { rows } = await admin.query<{ exists: number }>(
      `SELECT 1 AS exists FROM pg_database WHERE datname = 'litellm'`,
    );
    if (rows.length === 0) {
      // CREATE DATABASE cannot run inside a transaction. pg's default
      // single-statement query auto-commits — safe.
      await admin.query(`CREATE DATABASE litellm OWNER ${safeOwner}`);
      log("[migrate] created litellm database");
    } else {
      log("[migrate] litellm database already exists — skipping create");
    }
  } finally {
    await admin.end();
  }
}

/**
 * Resolve the admin URL for litellm-DB auto-create. Preference order:
 *   1. POSTGRES_ADMIN_URL — explicit operator config (Phase 03 Plan 01).
 *   2. Derived from DATABASE_URL_OWNER by swapping the path component
 *      to `/postgres`. The owner role has CREATEDB in production
 *      (init/00-roles.sql.tpl) so this is the safe default.
 * Returns `null` if neither is available.
 */
export function resolveAdminUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.POSTGRES_ADMIN_URL;
  if (explicit && explicit.length > 0) return explicit;

  const owner = env.DATABASE_URL_OWNER;
  if (!owner) return null;
  try {
    const u = new URL(owner);
    u.pathname = "/postgres";
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * HI-01 (Phase 41.e) — operator escape hatch for the LiteLLM-DB
 * auto-create step. Returns `true` iff `SKIP_LITELLM_DB_AUTOCREATE` is
 * the string `"1"` or `"true"` (case-insensitive). Anything else
 * (unset / `"0"` / `"false"` / arbitrary value) returns `false`,
 * preserving the production default of auto-create-on-boot.
 *
 * When this returns `true` the migrate runner skips BOTH
 * `resolveAdminUrl()` (so an operator without `POSTGRES_ADMIN_URL` /
 * `DATABASE_URL_OWNER` can still run migrate against the openwhispr
 * database) AND `ensureLitellmDatabase()` (so a pre-existing or
 * externally-managed LiteLLM database is not touched). The downstream
 * Drizzle `migrate()` call against the openwhispr database is
 * unaffected.
 *
 * Mirrors the established opt-out pattern from
 * `OPENWHISPR_DISABLE_RATE_LIMIT` (Phase 8) and
 * `OPENWHISPR_DISABLE_EMAIL_VERIFICATION` (Phase 8-07).
 */
export function shouldSkipLitellmDbAutocreate(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  const raw = env.SKIP_LITELLM_DB_AUTOCREATE;
  if (typeof raw !== "string") return false;
  const lowered = raw.toLowerCase();
  return lowered === "1" || lowered === "true";
}

/**
 * Resolve the owner role name from the connection URL. Used by the
 * migrate runner to pass the OWNER for `CREATE DATABASE litellm OWNER ...`
 * without requiring an extra env var.
 */
export function ownerFromUrl(url: string): string {
  const u = new URL(url);
  const user = decodeURIComponent(u.username);
  if (!user) {
    throw new Error("ownerFromUrl: connection URL has no username");
  }
  return user;
}

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

  // HIGH-1: ensure the LiteLLM database exists BEFORE Drizzle migrate
  // (which connects to the `openwhispr` database). Failure to resolve
  // an admin URL is fail-fast — we never silently skip.
  //
  // Phase 41.e / HI-01 escape hatch: operators with a pre-existing or
  // externally-managed LiteLLM database can set
  // `SKIP_LITELLM_DB_AUTOCREATE=1` to bypass both the admin-URL
  // resolution AND the ensureLitellmDatabase call. Documented in README.
  if (shouldSkipLitellmDbAutocreate(process.env)) {
    // biome-ignore lint/suspicious/noConsole: one-shot CLI script
    console.log(
      "migrate: SKIP_LITELLM_DB_AUTOCREATE=1 — skipping litellm-DB auto-create (operator opt-out).",
    );
  } else {
    const adminUrl = resolveAdminUrl();
    if (!adminUrl) {
      // biome-ignore lint/suspicious/noConsole: one-shot CLI script
      console.error(
        "migrate: cannot derive admin URL for litellm-DB auto-create. Set POSTGRES_ADMIN_URL or ensure DATABASE_URL_OWNER is well-formed, or set SKIP_LITELLM_DB_AUTOCREATE=1 to opt out.",
      );
      process.exit(4);
    }
    const owner = ownerFromUrl(url);
    await ensureLitellmDatabase(adminUrl, owner);
  }

  const pool = new Pool(buildPoolConfig(url, { max: 2 }));
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

// Phase 03 Plan 01 Task 2 — guard the auto-execution so this module is
// safely importable from tests. Drizzle's tsup build emits a single
// `.cjs` file that is invoked via `node migrate.cjs` from the migrate
// container; in that path `import.meta.url` is unset (CommonJS) and
// `require.main === module` is the canonical "run as CLI" check.
// In the tsx ESM path (dev / vitest), `import.meta.url` is set and we
// only call main() when the file matches argv[1].
function isCliEntry(): boolean {
  // CommonJS path (tsup --format cjs).
  if (typeof require !== "undefined" && typeof module !== "undefined") {
    return require.main === module;
  }
  // ESM path.
  if (typeof import.meta?.url === "string" && typeof process !== "undefined") {
    try {
      const argv1 = process.argv[1];
      if (!argv1) return false;
      const here = fileURLToPath(import.meta.url);
      return resolve(argv1) === resolve(here);
    } catch {
      return false;
    }
  }
  return false;
}

if (isCliEntry()) {
  main().catch((err: unknown) => {
    // biome-ignore lint/suspicious/noConsole: one-shot CLI script
    console.error("migrate: failed", err);
    process.exit(1);
  });
}
