// Programmatic migration runner unit test — Phase 1 Plan 03 / DATA-02 +
// Phase 2 Plan 02 (CONTAINER-A1): also asserts that a connection string
// pointing at PgBouncer (transaction-mode pooler) is rejected at start
// time. DDL through transaction-mode pooling is the documented
// anti-pattern (RESEARCH-DB §Anti-Patterns) and the migrate runner is
// the load-bearing gate against it.
//
// Happy-path forward apply is covered by migration-rollback.test.ts via
// testcontainers; this test covers the two no-DB precondition checks.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MIGRATE_TS = resolve(HERE, "..", "migrate.ts");

describe("migrate — env validation", () => {
  it("exits 2 with a clear error when DATABASE_URL_OWNER is unset", () => {
    const result = spawnSync("pnpm", ["exec", "tsx", MIGRATE_TS], {
      env: { ...process.env, DATABASE_URL_OWNER: "" },
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/migrate: DATABASE_URL_OWNER not set — refusing to run as owner/);
  });

  it("exits non-zero with a clear error when DATABASE_URL_OWNER points at pgbouncer", () => {
    // CONTAINER-A1 (Phase 2 Plan 02): migrate must refuse to run DDL via
    // PgBouncer transaction-mode. The hostname check is purely string-based
    // (no network round trip) so this runs offline.
    const result = spawnSync("pnpm", ["exec", "tsx", MIGRATE_TS], {
      env: {
        ...process.env,
        DATABASE_URL_OWNER: "postgres://owner:pw@pgbouncer:5432/openwhispr",
      },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/pgbouncer/i);
    expect(result.stderr).toMatch(/refusing|direct|owner/i);
  });

  it("accepts a hostname that does not contain pgbouncer (validation passes)", () => {
    // Sanity: hostname `postgres` (the canonical Phase 1 service name) is
    // NOT rejected by the precondition check. We use an unreachable port so
    // the runner exits non-zero on connect/migrate failure, not on the
    // pgbouncer guard. We assert that the stderr does NOT mention pgbouncer.
    const result = spawnSync("pnpm", ["exec", "tsx", MIGRATE_TS], {
      env: {
        ...process.env,
        DATABASE_URL_OWNER: "postgres://owner:pw@127.0.0.1:1/openwhispr",
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    // Non-zero exit (connection refused) but the message must not mention
    // the pgbouncer guard.
    expect(result.stderr).not.toMatch(/pgbouncer/i);
  });
});
