// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.2 / Plan 02 / Task 02-01 — RED leg for shared-pg fixture.
//
// Verifies reuse semantics (D-03), idempotent role bootstrap (D-12 carryover
// pitfall §2), and the OPENWHISPR_SKIP_TESTCONTAINERS skip gate (Plan 01 D-02).
//
// Two of three describe blocks are gated on Docker availability; the
// skip-gate test runs unconditionally so CI without Docker still verifies
// the typed-error path.

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapSharedRoles, getSharedPostgres } from "../shared-pg.js";

const dockerSkipped = process.env.OPENWHISPR_SKIP_TESTCONTAINERS === "1";

describe.skipIf(dockerSkipped)("getSharedPostgres — reuse semantics (D-03)", () => {
  it("returns the same container instance across consecutive calls", async () => {
    const a = await getSharedPostgres();
    const b = await getSharedPostgres();
    expect(b).toBe(a);
    expect(b.getConnectionUri()).toBe(a.getConnectionUri());
  });
});

describe.skipIf(dockerSkipped)("bootstrapSharedRoles — idempotency (pitfall §2)", () => {
  let pool: Pool;

  beforeAll(async () => {
    const container = await getSharedPostgres();
    pool = new Pool({ connectionString: container.getConnectionUri() });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("does not throw role-already-exists on second invocation", async () => {
    await bootstrapSharedRoles(pool);
    // Second call must be a no-op — Postgres 17 has no CREATE ROLE IF NOT EXISTS.
    await expect(bootstrapSharedRoles(pool)).resolves.toBeUndefined();
  });
});

describe("getSharedPostgres — OPENWHISPR_SKIP_TESTCONTAINERS skip gate (D-02)", () => {
  it("rejects fast (< 50ms) with typed error when flag is set", async () => {
    const prior = process.env.OPENWHISPR_SKIP_TESTCONTAINERS;
    process.env.OPENWHISPR_SKIP_TESTCONTAINERS = "1";
    try {
      const start = Date.now();
      // Force a fresh module-level cache check — call accepts whatever the
      // cached state is; the env gate is checked AHEAD of any cache touch.
      await expect(getSharedPostgres()).rejects.toThrow(/OPENWHISPR_SKIP_TESTCONTAINERS/);
      expect(Date.now() - start).toBeLessThan(50);
    } finally {
      if (prior === undefined) delete process.env.OPENWHISPR_SKIP_TESTCONTAINERS;
      else process.env.OPENWHISPR_SKIP_TESTCONTAINERS = prior;
    }
  });
});
