// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260602-j9z / blocker #2 — grantAppRoleMembership unit test.
//
// When DATABASE_APP_ROLE names a non-default role (corporate `svcdb_*`), the
// migrate runner GRANTs it membership in `openwhispr_app` so it inherits the
// canonical GRANT chain. Pure-unit: stub pg.Pool.query and assert the emitted
// SQL + the guard branches (unset / default / role-absent). pgIdent rejects
// unsafe identifiers — verified here so a malicious env can't inject DDL.

import { describe, expect, it, vi } from "vitest";
import { grantAppRoleMembership } from "../../../src/migrate.js";

interface QueryCall {
  text: string;
  params?: unknown[];
}

function makeStubPool(bothExist: boolean) {
  const calls: QueryCall[] = [];
  const pool = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      if (/EXISTS/.test(text)) {
        return { rows: [{ both: bothExist }] };
      }
      return { rows: [] };
    }),
  };
  return { pool, calls };
}

describe("grantAppRoleMembership (quick 260602-j9z)", () => {
  it("no-ops when DATABASE_APP_ROLE is unset", async () => {
    const { pool, calls } = makeStubPool(true);
    await grantAppRoleMembership(pool as never, {}, () => {});
    expect(calls).toHaveLength(0);
  });

  it("no-ops when DATABASE_APP_ROLE equals the canonical openwhispr_app", async () => {
    const { pool, calls } = makeStubPool(true);
    await grantAppRoleMembership(pool as never, { DATABASE_APP_ROLE: "openwhispr_app" }, () => {});
    expect(calls).toHaveLength(0);
  });

  it("GRANTs membership when a custom role is set and both roles exist", async () => {
    const { pool, calls } = makeStubPool(true);
    await grantAppRoleMembership(pool as never, { DATABASE_APP_ROLE: "svcdb_owhspr" }, () => {});
    // First call probes existence; second is the GRANT.
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toMatch(/EXISTS/);
    expect(calls[0]?.params).toEqual(["svcdb_owhspr", "openwhispr_app"]);
    // pgIdent validates the [A-Za-z_][A-Za-z0-9_]* shape and returns the bare
    // identifier (no quoting) — safe because anything outside that charset is
    // rejected (see the unsafe-name case below).
    expect(calls[1]?.text).toBe("GRANT openwhispr_app TO svcdb_owhspr");
  });

  it("skips the GRANT when one of the roles does not exist", async () => {
    const { pool, calls } = makeStubPool(false);
    await grantAppRoleMembership(pool as never, { DATABASE_APP_ROLE: "svcdb_owhspr" }, () => {});
    // Probe ran, but NO grant followed.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toMatch(/EXISTS/);
  });

  it("rejects an unsafe role name (pgIdent) before issuing any GRANT", async () => {
    const { pool } = makeStubPool(true);
    await expect(
      grantAppRoleMembership(
        pool as never,
        { DATABASE_APP_ROLE: 'svcdb"; DROP TABLE users; --' },
        () => {},
      ),
    ).rejects.toThrow(/pgIdent/);
  });
});
