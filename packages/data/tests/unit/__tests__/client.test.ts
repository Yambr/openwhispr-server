// SPDX-License-Identifier: FSL-1.1-ALv2
// Two-pool client factory unit tests — Phase 1 Plan 04 / DATA-01 / DATA-06.
//
// These tests exercise the env-validation paths (no DATABASE_URL set, no
// DATABASE_URL_OWNER set) without requiring a real Postgres. The happy
// paths are exercised by the integration tests (migration-rollback.test,
// pgbouncer-interleave.test, rls-property.test) that already use
// testcontainers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAppDb, makeOwnerDb } from "../../../src/client.js";

describe("client — two-pool factory env validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("makeAppDb() throws when DATABASE_URL is unset", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => makeAppDb()).toThrowError(/makeAppDb: DATABASE_URL not set/);
  });

  it("makeOwnerDb() throws when DATABASE_URL_OWNER is unset", () => {
    vi.stubEnv("DATABASE_URL_OWNER", "");
    expect(() => makeOwnerDb()).toThrowError(
      /makeOwnerDb: DATABASE_URL_OWNER not set — refusing to run as owner/,
    );
  });

  it("makeAppDb() with a valid URL returns a db + pool pair (pool capped at 20)", () => {
    // Use a syntactically-valid URL that points nowhere — pg.Pool only
    // attempts to connect on the first query, so construction is cheap.
    vi.stubEnv("DATABASE_URL", "postgres://app:nopass@127.0.0.1:1/postgres");
    const { db, pool } = makeAppDb();
    expect(db).toBeDefined();
    expect(pool).toBeDefined();
    // pg's Pool exposes options.max — assert the cap.
    expect((pool as unknown as { options: { max: number } }).options.max).toBe(20);
    pool.end().catch(() => {
      /* nothing connected; cleanup is a no-op */
    });
  });

  it("makeOwnerDb() with a valid URL caps pool at 2 (DDL only)", () => {
    vi.stubEnv("DATABASE_URL_OWNER", "postgres://owner:nopass@127.0.0.1:1/postgres");
    const { db, pool } = makeOwnerDb();
    expect(db).toBeDefined();
    expect(pool).toBeDefined();
    expect((pool as unknown as { options: { max: number } }).options.max).toBe(2);
    pool.end().catch(() => {
      /* nothing connected */
    });
  });
});
