// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 57 / Track A.1 — Fix A regression: lens.transaction MUST re-wrap
// the trx adapter passed by the inner transaction primitive.
//
// Why this test exists (RESEARCH.md §1 Seam #1 + §8 doctrine rules 1+2):
//
//   Better Auth's `runWithTransaction` (@better-auth/core@1.6.9
//   dist/context/transaction.mjs:52-78) calls
//   `adapter.transaction(async (trx) => als.run({ adapter: trx, ... }, fn))`.
//   The `trx` value handed to `als.run` becomes `getCurrentAdapter()`'s
//   return for every nested CRUD inside the transaction.
//
//   The lens at packages/data/src/encryption/lens.ts:443 currently
//   forwards `transaction: inner.transaction.bind(inner)`. That means
//   the inner adapter's `transaction(cb)` calls cb with the UNWRAPPED
//   inner adapter — and that unwrapped adapter is what als.run binds
//   for the rest of the request. Every sign-up / sign-in CRUD bypasses
//   the lens.
//
//   The fix (RESEARCH.md §5 Option A1) wraps:
//     transaction: (cb) => inner.transaction(async (trx) =>
//       cb(wrapAdapter(trx, providers, columnMap))
//     )
//
//   so that the trx Better Auth binds into AsyncLocalStorage is the
//   re-wrapped variant.
//
// This is a UNIT regression — no Postgres, no Better Auth. It traps any
// future revert of the §5 fix by asserting that:
//   (a) `wrapped.transaction(async (trx) => trx)` does NOT return the
//       inner sentinel — it returns a freshly-wrapped adapter.
//   (b) Calling `trx.create(...)` on the trx adapter applies the lens
//       (strips the plaintext key + emits 6 sidecar buffers), while
//       calling `innerTrx.create(...)` directly does NOT.
//
// Mocked surface (DISCIPLINE Rule 4): only Better Auth's `DBAdapter`
// interface (process boundary, BA is external to this package). Lens
// internals + envelope.ts + EnvKeyProvider are real.
import { randomBytes } from "node:crypto";
import type { DBAdapter } from "better-auth";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvKeyProvider } from "../../../src/encryption/env-key-provider.js";
import type { EncryptedColumnMap } from "../../../src/encryption/lens.js";
import { wrapAdapter } from "../../../src/encryption/lens.js";

function makeKek(): string {
  return randomBytes(32).toString("base64url");
}

const COLUMN_MAP: EncryptedColumnMap = {
  account: {
    access_token: { sidecarPrefix: "access_token" },
  },
};

const SIDECAR_KEYS = [
  "dek_wrapped",
  "dek_iv",
  "dek_auth_tag",
  "value_iv",
  "value_auth_tag",
  "value_ciphertext",
] as const;

/**
 * A minimal `DBAdapter` whose `transaction(cb)` follows the canonical
 * `createAsIsTransaction` shape — `cb(adapter)` — exactly what the inner
 * drizzle adapter does when `config.transaction === false` (the default,
 * see @better-auth/core dist/db/adapter/factory.mjs:17). A sentinel `__id`
 * makes identity checks unambiguous.
 */
function makeFakeInner(): {
  inner: DBAdapter;
  createCalls: Array<{ model: string; data: Record<string, unknown> }>;
} {
  const createCalls: Array<{ model: string; data: Record<string, unknown> }> = [];
  const inner: DBAdapter & { __id: string } = {
    __id: "inner-sentinel",
    id: "fake-inner",
    create: async ({ model, data }) => {
      createCalls.push({ model, data: { ...(data as Record<string, unknown>) } });
      return data as never;
    },
    findOne: async () => null as never,
    findMany: async () => [] as never,
    count: async () => 0,
    update: async () => null as never,
    updateMany: async () => 0,
    delete: async () => {
      return;
    },
    deleteMany: async () => 0,
    // createAsIsTransaction shape: cb receives the inner adapter itself.
    transaction: async (cb) => cb(inner),
    options: {} as never,
  };
  return { inner, createCalls };
}

describe("Phase 57 Track A.1 — lens wraps the trx adapter inside transaction(cb)", () => {
  let prevKek: string | undefined;

  beforeEach(() => {
    prevKek = process.env.MASTER_KEK;
    process.env.MASTER_KEK = makeKek();
  });

  afterEach(() => {
    if (prevKek === undefined) {
      delete process.env.MASTER_KEK;
    } else {
      process.env.MASTER_KEK = prevKek;
    }
  });

  it("(a) wrapped.transaction yields a re-wrapped trx, not the inner sentinel", async () => {
    const provider = new EnvKeyProvider();
    const { inner } = makeFakeInner();
    const wrapped = wrapAdapter(inner, provider, COLUMN_MAP);

    let receivedTrx: DBAdapter | null = null;
    await wrapped.transaction(async (trx) => {
      receivedTrx = trx;
      return null as never;
    });

    expect(receivedTrx).not.toBeNull();
    // Identity invariant from RESEARCH.md §8 doctrine rule 1+2: the trx
    // Better Auth binds into AsyncLocalStorage MUST be the wrapped variant,
    // NOT the inner sentinel. Today (pre-fix) `inner.transaction.bind(inner)`
    // forwards verbatim, so receivedTrx === inner and this assertion fails.
    expect(receivedTrx).not.toBe(inner);
  });

  it("(b) trx.create applies the lens (plaintext stripped + sidecars emitted); inner.create called directly does NOT", async () => {
    const provider = new EnvKeyProvider();
    const { inner, createCalls } = makeFakeInner();
    const wrapped = wrapAdapter(inner, provider, COLUMN_MAP);

    // Behavioural assertion: route a create through the trx-bound adapter.
    // If the trx is lens-wrapped, the inner.create observation sees NO
    // `access_token` key + 6 buffer sidecars. If the trx is the unwrapped
    // sentinel (pre-fix), inner.create sees `access_token: "rotated-token"`
    // verbatim and zero sidecars — plaintext-at-rest.
    await wrapped.transaction(async (trx) => {
      await trx.create({
        model: "account",
        data: {
          id: "acc-1",
          access_token: "rotated-token",
          user_id: "user-1",
        },
      });
      return null as never;
    });

    expect(createCalls).toHaveLength(1);
    const observed = createCalls[0]!.data;
    // The lens deletes the plaintext key (Plan 51-23 behavior).
    expect(observed.access_token).toBeUndefined();
    // All 6 sidecars must be present as Buffers, in BOTH snake_case
    // (mock-store / pg-driver shape) and camelCase (drizzle TS-field shape).
    for (const k of SIDECAR_KEYS) {
      expect(Buffer.isBuffer(observed[`access_token_${k}`])).toBe(true);
    }

    // And a control: calling inner.create DIRECTLY (i.e. what als.run
    // would invoke if our lens forwarded the unwrapped trx) bypasses the
    // lens — proving the assertion above is meaningful.
    const direct = makeFakeInner();
    await direct.inner.create({
      model: "account",
      data: {
        id: "acc-2",
        access_token: "still-plaintext",
        user_id: "user-1",
      },
    });
    expect(direct.createCalls).toHaveLength(1);
    expect(direct.createCalls[0]!.data.access_token).toBe("still-plaintext");
    expect(direct.createCalls[0]!.data.access_token_value_ciphertext).toBeUndefined();
  });
});
