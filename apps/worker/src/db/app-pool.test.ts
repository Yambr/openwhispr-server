import { describe, expect, it } from "vitest";
import { makeAppOwnerPool } from "./app-pool.js";

describe("makeAppOwnerPool", () => {
  it("throws when DATABASE_URL_OWNER is unset", () => {
    expect(() => makeAppOwnerPool({})).toThrow(/DATABASE_URL_OWNER/);
  });

  it("refuses to construct when URL host contains 'pgbouncer'", () => {
    expect(() =>
      makeAppOwnerPool({
        DATABASE_URL_OWNER: "postgres://owner:pw@pgbouncer:5432/openwhispr",
      }),
    ).toThrow(/pgbouncer/i);
  });

  it("constructs pool when URL points DIRECT to postgres", async () => {
    const pool = makeAppOwnerPool({
      DATABASE_URL_OWNER: "postgres://owner:pw@postgres:5432/openwhispr",
    });
    expect(pool).toBeDefined();
    expect(typeof pool.query).toBe("function");
    await pool.end();
  });
});
