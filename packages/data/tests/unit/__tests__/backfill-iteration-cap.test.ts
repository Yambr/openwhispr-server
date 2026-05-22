// SPDX-License-Identifier: FSL-1.1-ALv2
// AUDIT-HARD-03 (HACK-L5) — backfill loop iteration-cap regression test.
//
// What we're proving:
//   `runBackfill`'s per-column batched `for (;;)` loop has only two natural
//   exits — `rows.length === 0` and `batchProcessed < batchSize` — both of
//   which depend on the idempotency predicate eventually draining the work
//   set. A buggy predicate (or an UPDATE that never populates the ciphertext
//   sidecar) would leave a full batch eligible forever, spinning the loop
//   indefinitely while holding an owner-pool connection.
//
//   The fix adds a `maxIterations` safety cap. This test simulates the
//   pathological case with a fake pool whose SELECT ALWAYS returns a full
//   batch (a stuck predicate) and asserts `runBackfill` throws a clear,
//   bounded error instead of hanging.
//
// Mocked surface (DISCIPLINE Rule 4): only the pg.Pool — a process/network
// boundary. `runBackfill`, `encryptValue`, and the EnvKeyProvider are the
// real production code.

import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { type BackfillColumnMap, runBackfill } from "../../../src/encryption/backfill.js";
import { EnvKeyProvider } from "../../../src/encryption/env-key-provider.js";

// `oauth_state.code_verifier` is deliberately NOT a lens-managed column
// (it is codec-managed), so `runBackfill` will actually enter the batched
// loop for it rather than refusing it via the LENS_MANAGED_COLUMNS guard.
const COLUMN_MAP: BackfillColumnMap = {
  oauth_state: {
    code_verifier: {},
  },
};

/**
 * Fake pg.Pool whose SELECT always returns a full `batchSize` of rows —
 * simulating a buggy idempotency predicate that never drains. BEGIN /
 * COMMIT / ROLLBACK / UPDATE are no-ops. Each `connect()` hands back a
 * fresh client; `release()` is a no-op.
 */
function makeStuckPool(batchSize: number): Pool {
  const client = {
    async query(text: string) {
      const sql = String(text);
      if (sql.startsWith("SELECT")) {
        // Always a full batch → batchProcessed === batchSize on every
        // iteration → the loop never hits its natural exits.
        const rows = Array.from({ length: batchSize }, (_, i) => ({
          id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
          value: "plaintext-secret",
        }));
        return { rows, rowCount: rows.length };
      }
      // BEGIN / COMMIT / ROLLBACK / UPDATE
      return { rows: [], rowCount: 0 };
    },
    release() {
      /* no-op */
    },
  } as unknown as PoolClient;
  return {
    async connect() {
      return client;
    },
  } as unknown as Pool;
}

describe("AUDIT-HARD-03 — runBackfill iteration cap", () => {
  it("throws a bounded error instead of spinning forever on a stuck predicate", async () => {
    process.env.MASTER_KEK = randomBytes(32).toString("base64url");
    const provider = new EnvKeyProvider();
    try {
      const batchSize = 2;
      await expect(
        runBackfill({
          ownerPool: makeStuckPool(batchSize),
          keyProvider: provider,
          columnMap: COLUMN_MAP,
          batchSize,
          // Tiny cap so the test terminates fast; production default is
          // MAX_BACKFILL_ITERATIONS (1_000_000).
          maxIterations: 5,
        }),
      ).rejects.toThrow(/exceeded 5 iterations/);
    } finally {
      delete process.env.MASTER_KEK;
    }
  });
});
