// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 66 / CR-09 — shared assertDirectPostgres guard.
//
// Pure-unit: assertDirectPostgres throws for a PgBouncer-hostname URL and
// is a no-op for a direct postgres URL. Also a source-level assertion
// that index.ts's inline maintenancePool now routes through the helper
// (pre-fix it had no guard at all).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertDirectPostgres } from "../../../src/db/assert-direct-postgres.js";

describe("CR-09 — assertDirectPostgres", () => {
  it("CR-09: throws for a PgBouncer-hostname connection URL", () => {
    expect(() =>
      assertDirectPostgres("postgres://u:p@pgbouncer:6432/db", "DATABASE_URL_OWNER"),
    ).toThrow(/pgbouncer/i);
  });

  it("CR-09: includes the env var name in the thrown message", () => {
    expect(() =>
      assertDirectPostgres("postgres://u:p@pgbouncer:6432/db", "LITELLM_READ_DATABASE_URL"),
    ).toThrow(/LITELLM_READ_DATABASE_URL/);
  });

  it("CR-09: is a no-op for a direct postgres URL", () => {
    expect(() =>
      assertDirectPostgres("postgres://u:p@postgres:5432/db", "DATABASE_URL_OWNER"),
    ).not.toThrow();
  });

  it("CR-09: matches a host containing 'pgbouncer' case-insensitively", () => {
    expect(() =>
      assertDirectPostgres("postgres://u:p@PgBouncer-svc:6432/db", "DATABASE_URL_OWNER"),
    ).toThrow(/pgbouncer/i);
  });

  it("CR-09: does not throw on a malformed URL (pg.Pool surfaces it downstream)", () => {
    expect(() => assertDirectPostgres("not-a-url", "DATABASE_URL_OWNER")).not.toThrow();
  });

  it("CR-09: index.ts maintenancePool routes through assertDirectPostgres", () => {
    // Source-level contract: the inline maintenancePool construction must
    // call the shared guard BEFORE `new Pool`. Pre-fix it had no guard.
    const src = readFileSync(resolve(__dirname, "../../../src/index.ts"), "utf8");
    expect(src).toMatch(/assertDirectPostgres\(\s*maintenanceUrl/);
    const guardIdx = src.indexOf("assertDirectPostgres(maintenanceUrl");
    const poolIdx = src.indexOf("const maintenancePool = new Pool");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(poolIdx).toBeGreaterThan(-1);
    // The guard call precedes the pool construction.
    expect(guardIdx).toBeLessThan(poolIdx);
  });

  it("CR-09: makeAppOwnerPool and makeLitellmPool use the shared guard", () => {
    const appSrc = readFileSync(resolve(__dirname, "../../../src/db/app-pool.ts"), "utf8");
    const llSrc = readFileSync(resolve(__dirname, "../../../src/db/litellm-pool.ts"), "utf8");
    expect(appSrc).toMatch(/assertDirectPostgres\(url, "DATABASE_URL_OWNER"\)/);
    expect(llSrc).toMatch(/assertDirectPostgres\(url, "LITELLM_READ_DATABASE_URL"\)/);
  });
});
