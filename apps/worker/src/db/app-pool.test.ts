import { describe, expect, it } from "vitest";
import { makeAppOwnerPool } from "./app-pool.js";

// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-07 per 06-VALIDATION.md.
//
// Phase 6 ADDS a runtime tenant-context guard (D-W4 layer 2) on top of the
// existing Phase 3 makeAppOwnerPool factory:
//   - Wraps pool.query so it executes SELECT current_setting('app.tenant_id', true)
//     once per checkout.
//   - When the GUC is the empty string AND the caller is NOT in system-mode
//     (checked via AsyncLocalStorage flag), throws TenantContextMissingError.
//   - System-mode callers (withSystemContext) bypass this raise.
//
// TODO: integration tests in Plan 06-07 will use a real Postgres testcontainer.
const NOT_YET =
  "not yet implemented — Plan 06-07 adds D-W4 layer 2 runtime guard to apps/worker/src/db/app-pool.ts";

describe("app-pool runtime tenant-context guard (D-W4 layer 2)", () => {
  it("executes SELECT current_setting('app.tenant_id', true) once per checkout", () => {
    throw new Error(NOT_YET);
  });

  it("throws TenantContextMissingError when GUC is '' AND caller is not system-mode", () => {
    throw new Error(NOT_YET);
  });

  it("does NOT throw when caller is in system-mode (AsyncLocalStorage flag = 'system')", () => {
    throw new Error(NOT_YET);
  });

  it("does NOT throw when GUC is set to a valid tenant UUID", () => {
    throw new Error(NOT_YET);
  });

  it("exposes TenantContextMissingError as a named error class", () => {
    throw new Error(NOT_YET);
  });
});

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
