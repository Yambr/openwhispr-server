// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { makeLitellmPool } from "./litellm-pool.js";

describe("makeLitellmPool", () => {
  it("throws when neither LITELLM_READ_DATABASE_URL nor LITELLM_DATABASE_URL is set", () => {
    expect(() => makeLitellmPool({})).toThrow(/required/);
  });

  it("refuses to construct when URL host contains 'pgbouncer'", () => {
    expect(() =>
      makeLitellmPool({
        LITELLM_READ_DATABASE_URL:
          "postgres://owner:pw@pgbouncer:5432/litellm",
      }),
    ).toThrow(/pgbouncer/i);
  });

  it("refuses pgbouncer host even when only LITELLM_DATABASE_URL is set", () => {
    expect(() =>
      makeLitellmPool({
        LITELLM_DATABASE_URL: "postgres://owner:pw@pgbouncer-prod:5432/litellm",
      }),
    ).toThrow(/pgbouncer/i);
  });

  it("constructs pool when URL points DIRECT to postgres", async () => {
    const pool = makeLitellmPool({
      LITELLM_READ_DATABASE_URL: "postgres://owner:pw@postgres:5432/litellm",
    });
    expect(pool).toBeDefined();
    // Don't connect — just verify we got an object with the pg.Pool shape.
    expect(typeof pool.query).toBe("function");
    expect(typeof pool.end).toBe("function");
    await pool.end();
  });

  it("prefers LITELLM_READ_DATABASE_URL over LITELLM_DATABASE_URL", async () => {
    // Both set, READ takes precedence — verified by ensuring it does not
    // throw when READ is direct even if base URL is pgbouncer.
    const pool = makeLitellmPool({
      LITELLM_READ_DATABASE_URL: "postgres://owner:pw@postgres:5432/litellm",
      LITELLM_DATABASE_URL: "postgres://owner:pw@pgbouncer:5432/litellm",
    });
    expect(pool).toBeDefined();
    await pool.end();
  });
});
