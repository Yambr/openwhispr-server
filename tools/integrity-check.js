// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 09 / Plan 11 — upgrade-matrix integrity check.
//
// Verifies the rows seeded by `tools/seed-test-data.js` survived the
// N-1 → N helm upgrade. Runs inside the api container via
//   kubectl exec deploy/ow-api -- node /app/tools/integrity-check.js
// after `helm upgrade ow … --wait`.
//
// Exits 0 iff:
//   - exactly 10 seeded rows exist
//   - every row's text + word_count match the expected fixture content
//
// Any other state (missing rows, mutated text, schema drift) → exit 1.

const pg = require("pg");
const { SEED_ROWS, DEFAULT_TENANT_ID } = require("./seed-test-data.js");

const defaultDeps = () => ({ Client: pg.Client });

async function check({
  databaseUrl = process.env.DATABASE_URL,
  tenantId = process.env.SEED_TENANT_ID || DEFAULT_TENANT_ID,
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
    await client.query("BEGIN");
    await client.query("SET LOCAL app.tenant_id = $1", [tenantId]);
    const res = await client.query(
      `SELECT id, text, word_count FROM transcriptions
       WHERE source = 'seed-test'
       ORDER BY id`,
    );
    await client.query("COMMIT");
    const issues = [];
    if (res.rowCount !== SEED_ROWS.length) {
      issues.push(`expected ${SEED_ROWS.length} seeded rows, found ${res.rowCount}`);
    }
    const seenById = new Map(res.rows.map((r) => [r.id, r]));
    for (const expected of SEED_ROWS) {
      const got = seenById.get(expected.id);
      if (!got) {
        issues.push(`missing row ${expected.id}`);
        continue;
      }
      if (got.text !== expected.text) {
        issues.push(`row ${expected.id} text drift: got "${got.text}"`);
      }
      if (got.word_count !== expected.wordCount) {
        issues.push(
          `row ${expected.id} word_count drift: got ${got.word_count}, expected ${expected.wordCount}`,
        );
      }
    }
    const ok = issues.length === 0;
    logger.log(JSON.stringify({ ok, rowsFound: res.rowCount ?? 0, issues }));
    return { ok, rowsFound: res.rowCount ?? 0, issues };
  } finally {
    await client.end();
  }
}

module.exports = { check };

/* c8 ignore start -- CLI entry point */
if (require.main === module) {
  check().then(
    (result) => process.exit(result.ok ? 0 : 1),
    (err) => {
      process.stderr.write(`integrity-check failed: ${err.message}\n`);
      process.exit(1);
    },
  );
}
/* c8 ignore stop */
