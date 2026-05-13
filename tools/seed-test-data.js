// Phase 09 / Plan 11 — upgrade-matrix data seeder.
//
// Inserts N=10 deterministic rows into the `transcriptions` table so the
// integrity-check.js script (run after the N-1 → N helm upgrade) can verify
// they survived the schema migration and rolling deploy. Uses `pg` directly
// (no Drizzle import) so this script remains self-contained inside the api
// image at /app/tools/seed-test-data.js.
//
// Environment:
//   DATABASE_URL — required; must point at the CNPG primary -rw service
//     because seeding requires session-mode connections that survive across
//     the multi-INSERT transaction. The Pooler is fine for the same reason
//     INSERT statements are short-lived.
//   SEED_TENANT_ID — defaults to the constitutional 00000000-... root tenant.
//   SEED_USER_ID   — defaults to a pinned UUID; created if not present.
//
// Exit codes:
//   0 — 10 rows inserted (or already present; idempotent ON CONFLICT)
//   1 — any failure (DB unreachable, schema mismatch, FK violation)

const pg = require("pg");

// Dependency-injection seam — tests pass a custom { Client } factory. Production
// callers leave it undefined and we use the real pg module.
const defaultDeps = () => ({ Client: pg.Client });

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";

// Deterministic UUIDs so integrity-check has stable expectations.
const SEED_ROWS = Array.from({ length: 10 }, (_, i) => ({
  id: `00000000-0000-0000-0000-9000000000${(i + 1).toString().padStart(2, "0")}`,
  text: `seed-row-${i + 1}: deterministic test fixture from seed-test-data.js`,
  wordCount: 8 + i,
}));

async function seed({
  databaseUrl = process.env.DATABASE_URL,
  tenantId = process.env.SEED_TENANT_ID || DEFAULT_TENANT_ID,
  userId = process.env.SEED_USER_ID || DEFAULT_USER_ID,
  logger = console,
  deps = defaultDeps(),
} = {}) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const { Client } = deps;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Ensure tenant exists (idempotent — `default` tenant is constitutional).
    await client.query(
      `INSERT INTO tenants (id, name) VALUES ($1, 'seed-test-data')
       ON CONFLICT (id) DO NOTHING`,
      [tenantId],
    );
    // Ensure user row exists. Schema requires email + an id.
    await client.query(
      `INSERT INTO users (id, tenant_id, email, name, email_verified, created_at, updated_at)
       VALUES ($1, $2, 'seed-test@openwhispr.test', 'seed-test', false, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [userId, tenantId],
    );
    // SET LOCAL app.tenant_id so RLS lets us write to transcriptions.
    await client.query("BEGIN");
    await client.query("SET LOCAL app.tenant_id = $1", [tenantId]);
    let inserted = 0;
    for (const row of SEED_ROWS) {
      const res = await client.query(
        `INSERT INTO transcriptions (id, tenant_id, user_id, text, word_count, status, source)
         VALUES ($1, $2, $3, $4, $5, 'completed', 'seed-test')
         ON CONFLICT (id) DO NOTHING`,
        [row.id, tenantId, userId, row.text, row.wordCount],
      );
      inserted += res.rowCount ?? 0;
    }
    await client.query("COMMIT");
    logger.log(JSON.stringify({ ok: true, seededRows: SEED_ROWS.length, insertedRows: inserted }));
    return { ok: true, seededRows: SEED_ROWS.length, insertedRows: inserted };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_e) {
      /* swallow — connection may already be terminated */
    }
    throw err;
  } finally {
    await client.end();
  }
}

module.exports = { seed, SEED_ROWS, DEFAULT_TENANT_ID, DEFAULT_USER_ID };

/* c8 ignore start -- CLI entry point */
if (require.main === module) {
  seed().then(
    () => process.exit(0),
    (err) => {
      process.stderr.write(`seed-test-data failed: ${err.message}\n`);
      process.exit(1);
    },
  );
}
/* c8 ignore stop */
