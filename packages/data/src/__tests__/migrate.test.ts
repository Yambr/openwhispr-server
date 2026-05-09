// Programmatic migration runner unit test — Phase 1 Plan 03 / DATA-02.
//
// The runner is a one-shot CLI script. We exercise the env-validation
// path (DATABASE_URL_OWNER unset → exit 2) by spawning it as a
// subprocess. The happy path is covered by the migration-rollback
// integration test which boots a real Postgres in testcontainers.
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
});
