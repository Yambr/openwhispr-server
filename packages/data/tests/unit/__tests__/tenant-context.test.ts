// SPDX-License-Identifier: FSL-1.1-ALv2
// Unit tests for `withTenant<T>` — Phase 1 Plan 04 / D-18.
//
// These tests exercise the helper's contract WITHOUT a real Postgres:
//   - UUID validation runs BEFORE the wire is touched.
//   - Inside the transaction the FIRST SQL emitted is
//     `SELECT set_config('app.tenant_id', $1, true)` with the bound UUID.
//     This is the parameterized equivalent of `SET LOCAL` (Postgres
//     `SET LOCAL` does NOT accept bind params for the value — see
//     RESEARCH-DB Pattern 2 / Pitfall 1).
//   - `fn` runs after `set_config` resolves; its return value propagates.
//   - `fn` rejection propagates and would cause the (mocked) tx to roll back.
//
// We don't bring up a database here — the real PgBouncer-transaction-mode
// safety claim is covered by `pgbouncer-interleave.test.ts`. Here we only
// pin down the call shape (parameterization, ordering, validation gate).
import { describe, expect, it, vi } from "vitest";
import {
  withSystemBypass,
  withSystemBypassClient,
  withTenant,
} from "../../../src/tenant-context.js";

interface RecordedExecute {
  sqlString: string;
  params: unknown[];
}

/**
 * Minimal db.transaction() spy that records every tx.execute() call so
 * tests can assert ordering + parameter binding without a real driver.
 */
function makeSpyDb(fnReturnsBeforeError?: Error) {
  const calls: RecordedExecute[] = [];
  const tx = {
    execute: vi.fn(async (query: unknown) => {
      // drizzle's `sql` template tag produces an SQL object with a
      // `queryChunks` array of StringChunk objects ({ value: string[] })
      // for static SQL fragments, interleaved with raw bound values.
      // We flatten that back into (sqlFragment, params[]) for assertions.
      let sqlString = "";
      const params: unknown[] = [];
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks;
      if (Array.isArray(chunks)) {
        for (const c of chunks) {
          if (
            typeof c === "object" &&
            c !== null &&
            "value" in c &&
            Array.isArray((c as { value: unknown }).value)
          ) {
            // StringChunk: literal SQL fragment.
            const parts = (c as { value: unknown[] }).value;
            for (const p of parts) sqlString += String(p);
          } else {
            // Bound param: drizzle emits it as a raw primitive
            // (string/number/bool/buffer) interleaved between
            // StringChunks. Crucially this is NOT concatenated
            // into the SQL — the driver binds it via the wire
            // protocol, which is the parameterization guarantee.
            params.push(c);
            sqlString += "$<param>";
          }
        }
      }
      calls.push({ sqlString, params });
    }),
  };
  const transaction = vi.fn(async <T>(cb: (innerTx: typeof tx) => Promise<T>): Promise<T> => {
    if (fnReturnsBeforeError) {
      // caller provides a tx-level error path; not used in happy paths
    }
    return cb(tx);
  });
  const db = { transaction };
  return { db, tx, calls, transaction };
}

const VALID = "11111111-1111-1111-1111-111111111111";

describe("withTenant — Phase 1 Plan 04", () => {
  it("rejects invalid tenant UUIDs BEFORE opening a transaction", async () => {
    // Each invalid input must throw synchronously (well, awaited) AND
    // must NOT have called db.transaction() — that proves we bailed
    // before touching the wire.
    const cases: unknown[] = ["", "not-a-uuid", undefined, 12345, null];
    for (const bad of cases) {
      const { db, transaction } = makeSpyDb();
      await expect(
        withTenant(db as any, bad as any, async () => "unreachable"),
      ).rejects.toThrowError(/withTenant: invalid tenant UUID/);
      expect(transaction).not.toHaveBeenCalled();
    }
  });

  it("opens a tx and binds the tenantId via set_config('app.tenant_id', $1, true) before fn runs", async () => {
    const { db, calls, transaction } = makeSpyDb();
    let fnSawSetConfigBefore = false;
    await withTenant(db as never, VALID, async () => {
      // fn runs AFTER set_config resolved — by the time we land here
      // the spy must have recorded exactly one execute() call.
      fnSawSetConfigBefore = calls.length === 1;
      return "ok";
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(fnSawSetConfigBefore).toBe(true);
    expect(calls).toHaveLength(1);
    const first = calls[0];
    expect(first).toBeDefined();
    // Parameterization: the SQL fragment uses a placeholder, the value
    // is bound separately. Crucially we do NOT see the raw UUID string
    // concatenated into the SQL — that would be string interpolation,
    // the very anti-pattern we exist to avoid.
    expect(first?.sqlString).toContain("set_config('app.tenant_id'");
    expect(first?.params).toEqual([VALID]);
    expect(first?.sqlString).not.toContain(VALID);
  });

  it("propagates fn's resolved value", async () => {
    const { db } = makeSpyDb();
    const result = await withTenant(db as never, VALID, async () => 42);
    expect(result).toBe(42);
  });

  it("propagates fn's rejection (rolling back the tx)", async () => {
    const { db } = makeSpyDb();
    await expect(
      withTenant(db as never, VALID, async () => {
        throw new Error("fn-blew-up");
      }),
    ).rejects.toThrowError("fn-blew-up");
  });

  it("accepts uppercase-hex UUIDs (regex is case-insensitive)", async () => {
    const { db } = makeSpyDb();
    await expect(withTenant(db as never, VALID.toUpperCase(), async () => "ok")).resolves.toBe(
      "ok",
    );
  });
});

describe("withTenant — Phase 32 fail-closed contract", () => {
  // Doc-presence assertion: the file MUST document the Phase 32 contract
  // so future refactors don't strip the warning. The runtime contract is
  // enforced at the migration level (0018_rls_fail_closed.sql) and proved
  // by the 128-case property test in
  // packages/data/tests/unit/__tests__/rls-fail-closed.property.test.ts.
  it("JSDoc references Phase 32 + fail-closed + PG 42501", () => {
    // Lazy import to avoid coupling this assertion to the import path used
    // by the runtime helpers.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const src = readFileSync(
      resolve(__dirname, "..", "..", "..", "src", "tenant-context.ts"),
      "utf8",
    );
    expect(src).toMatch(/Phase 32/);
    expect(src).toMatch(/fail[- ]closed/i);
    expect(src).toMatch(/42501|permission denied/i);
  });
});

// Quick 260602-j9z / blocker #2 — claim-driven bypass helpers. Unit-level
// call-shape contract (the real cross-tenant behaviour is the security proof
// in rls-claim-bypass.property.test.ts against a NOBYPASSRLS testcontainer).
describe("withSystemBypass (Drizzle-tx variant)", () => {
  it("opens a tx and sets set_config('app.bypass', 'on', true) before fn runs", async () => {
    const { db, calls, transaction } = makeSpyDb();
    let fnSawBypassFirst = false;
    const result = await withSystemBypass(db as never, async () => {
      fnSawBypassFirst = calls.length === 1;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(fnSawBypassFirst).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sqlString).toContain("set_config('app.bypass', 'on', true)");
  });

  it("propagates fn rejection (tx rolls back)", async () => {
    const { db } = makeSpyDb();
    await expect(
      withSystemBypass(db as never, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrowError("boom");
  });
});

describe("withSystemBypassClient (raw pg.Pool variant)", () => {
  function makeSpyPool() {
    const queries: string[] = [];
    let released = false;
    const client = {
      query: vi.fn(async (text: string) => {
        queries.push(text);
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(() => {
        released = true;
      }),
    };
    const pool = { connect: vi.fn(async () => client) };
    return { pool, client, queries, isReleased: () => released };
  }

  it("BEGIN → set_config('app.bypass','on',true) → fn → COMMIT, then releases", async () => {
    const { pool, queries, isReleased } = makeSpyPool();
    let fnSawSetup = false;
    const result = await withSystemBypassClient(pool as never, async () => {
      fnSawSetup =
        queries[0] === "BEGIN" && queries[1] === "SELECT set_config('app.bypass', 'on', true)";
      return 7;
    });
    expect(result).toBe(7);
    expect(fnSawSetup).toBe(true);
    expect(queries).toEqual(["BEGIN", "SELECT set_config('app.bypass', 'on', true)", "COMMIT"]);
    expect(isReleased()).toBe(true);
  });

  it("ROLLBACK + release on fn rejection, and re-throws", async () => {
    const { pool, queries, isReleased } = makeSpyPool();
    await expect(
      withSystemBypassClient(pool as never, async () => {
        throw new Error("fn-failed");
      }),
    ).rejects.toThrowError("fn-failed");
    expect(queries).toEqual(["BEGIN", "SELECT set_config('app.bypass', 'on', true)", "ROLLBACK"]);
    expect(isReleased()).toBe(true);
  });
});
