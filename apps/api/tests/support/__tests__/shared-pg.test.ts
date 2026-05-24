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
import { bootstrapSharedRoles, getSharedPostgres, provisionPgPartman } from "../shared-pg.js";

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

describe.skipIf(dockerSkipped)(
  "provisionPgPartman — pg_partman extension available (Plan 03 retry #4)",
  () => {
    // Phase 18.1.2 / Plan 03 — Plan 02 shipped shared-pg pinned to
    // `postgres:17-alpine`, which lacks pg_partman. Migration 0014 invokes
    // partman.create_parent, so any integration test that runs the full
    // migration set against the shared container is wedged until the image
    // is swapped for `ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1`. This assertion
    // is the RED leg of the forward-fix: the extension MUST exist in the
    // partman schema after provisionPgPartman() runs on the shared container.
    let pool: Pool;

    beforeAll(async () => {
      const container = await getSharedPostgres();
      pool = new Pool({ connectionString: container.getConnectionUri() });
      await bootstrapSharedRoles(pool);
      await provisionPgPartman(pool);
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("creates the partman schema with pg_partman extension installed", async () => {
      const { rows } = await pool.query<{ extname: string; nspname: string }>(
        `SELECT e.extname, n.nspname
         FROM pg_extension e
         JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pg_partman'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.nspname).toBe("partman");
    });

    it("is idempotent — second invocation does not throw", async () => {
      await expect(provisionPgPartman(pool)).resolves.toBeUndefined();
    });
  },
);

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
