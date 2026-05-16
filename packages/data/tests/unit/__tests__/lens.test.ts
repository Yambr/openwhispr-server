// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 02 — Better-Auth Adapter encryption lens (wrap-adapter, research §Q6 (c)).
//
// What we're proving:
//   - `wrapAdapter(inner, provider, columnMap)` returns a DBAdapter that
//     transparently encrypts the 8 configured credential columns on
//     create/update and decrypts them on findOne/findMany.
//   - The 6-bytea EncryptedRow shape from envelope.ts is written to
//     `<col>_<sidecar>` sibling fields; the plaintext key is set to null
//     on writes and stripped from results on reads.
//   - SHA-256 fingerprint sidecars (`token_fp`, `previous_token_fp`) are
//     written alongside the 6 sidecars when `fingerprint` is configured.
//   - Read paths support `<col>_fp_lookup` where-clause rewriting: the
//     lens hashes the provided plaintext and replaces the field with the
//     fingerprint column + bytea(32) sha256 value.
//   - Tampered ciphertext propagates the GCM auth-tag mismatch through
//     decryptValue (no swallowed errors).
//   - Reading with a different KEK provider fails with a descriptive
//     error.
//   - Dual-KEK rotation: row encrypted under provider A still decrypts
//     when the active chain is [B, A] (provider chain fallback).
//   - findMany / count / update / delete pass-through correctly.
//
// Mocked surface (DISCIPLINE Rule 4): only Better-Auth's `DBAdapter`
// interface — that's a process boundary (Better-Auth itself is external
// to this package). Lens internals call REAL envelope.ts and REAL
// EnvKeyProvider; no internal logic is mocked.
import { createHash, randomBytes } from "node:crypto";
import type { CleanedWhere, DBAdapter } from "better-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvKeyProvider } from "../../../src/encryption/env-key-provider.js";
import type { EncryptedColumnMap } from "../../../src/encryption/lens.js";
import { wrapAdapter } from "../../../src/encryption/lens.js";

function makeKek(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * In-memory mock of Better-Auth's DBAdapter (DBAdapter interface from
 * better-auth/types). Stores rows under `model -> id -> row`. We only
 * implement what the lens tests exercise; unimplemented methods throw.
 */
function makeMockAdapter(): {
  adapter: DBAdapter;
  store: Map<string, Map<string, Record<string, unknown>>>;
} {
  const store = new Map<string, Map<string, Record<string, unknown>>>();

  function ensureModel(model: string): Map<string, Record<string, unknown>> {
    let m = store.get(model);
    if (!m) {
      m = new Map();
      store.set(model, m);
    }
    return m;
  }

  function matches(row: Record<string, unknown>, where: CleanedWhere[]): boolean {
    return where.every((clause) => {
      const v = row[clause.field];
      const target = clause.value;
      // Buffer equality for bytea fields (fingerprint lookup path).
      if (Buffer.isBuffer(v) && Buffer.isBuffer(target)) {
        return v.equals(target);
      }
      return v === target;
    });
  }

  const adapter: DBAdapter = {
    id: "mock-adapter",
    create: async ({ model, data }: any) => {
      const m = ensureModel(model);
      const id = (data.id as string | undefined) ?? `id-${m.size + 1}`;
      const row = { ...data, id };
      m.set(id, row);
      return row;
    },
    findOne: async ({ model, where }: any) => {
      const m = ensureModel(model);
      for (const row of m.values()) {
        if (matches(row, where)) return { ...row };
      }
      return null;
    },
    findMany: async ({ model, where }: any) => {
      const m = ensureModel(model);
      const rows: Record<string, unknown>[] = [];
      for (const row of m.values()) {
        if (!where || matches(row, where)) rows.push({ ...row });
      }
      return rows;
    },
    count: async ({ model, where }: any) => {
      const m = ensureModel(model);
      if (!where) return m.size;
      let n = 0;
      for (const row of m.values()) if (matches(row, where)) n++;
      return n;
    },
    update: async ({ model, where, update }: any) => {
      const m = ensureModel(model);
      for (const [id, row] of m.entries()) {
        if (matches(row, where)) {
          const merged = { ...row, ...update };
          m.set(id, merged);
          return { ...merged };
        }
      }
      return null;
    },
    updateMany: async ({ model, where, update }: any) => {
      const m = ensureModel(model);
      let n = 0;
      for (const [id, row] of m.entries()) {
        if (matches(row, where)) {
          m.set(id, { ...row, ...update });
          n++;
        }
      }
      return n;
    },
    delete: async ({ model, where }: any) => {
      const m = ensureModel(model);
      for (const [id, row] of m.entries()) {
        if (matches(row, where)) {
          m.delete(id);
          return;
        }
      }
    },
    deleteMany: async ({ model, where }: any) => {
      const m = ensureModel(model);
      let n = 0;
      for (const [id, row] of m.entries()) {
        if (matches(row, where)) {
          m.delete(id);
          n++;
        }
      }
      return n;
    },
    transaction: async (cb: any) => cb(adapter as any),
  };

  return { adapter, store };
}

const COLUMN_MAP: EncryptedColumnMap = {
  account: {
    access_token: { sidecarPrefix: "access_token" },
    refresh_token: { sidecarPrefix: "refresh_token" },
    id_token: { sidecarPrefix: "id_token" },
    password: { sidecarPrefix: "password" },
  },
  verification: {
    value: { sidecarPrefix: "value" },
  },
  sessions: {
    token: {
      sidecarPrefix: "token",
      fingerprint: { column: "token_fp", algorithm: "sha256" },
    },
    previous_token: {
      sidecarPrefix: "previous_token",
      fingerprint: { column: "previous_token_fp", algorithm: "sha256" },
    },
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

describe("encryption lens — Phase 33 Plan 02", () => {
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
    vi.unstubAllEnvs();
  });

  describe("round-trip — write encrypts, read decrypts", () => {
    it("encrypts account.access_token on create + decrypts on findOne", async () => {
      const provider = new EnvKeyProvider();
      const { adapter, store } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);

      await wrapped.create({
        model: "account",
        data: {
          id: "acc-1",
          access_token: "plaintext-access-token-123",
          refresh_token: "rt-456",
          id_token: "it-789",
          password: "pw-secret",
          user_id: "user-1",
        },
      });

      // Raw store assertions: plaintext columns are null, 6 sidecars per
      // encrypted column are present + buffers, fingerprints absent for
      // account (account.access_token has no fingerprint config).
      const raw = store.get("account")?.get("acc-1") as any;
      expect(raw).toBeDefined();
      expect(raw.access_token).toBeNull();
      expect(raw.refresh_token).toBeNull();
      expect(raw.id_token).toBeNull();
      expect(raw.password).toBeNull();
      for (const col of ["access_token", "refresh_token", "id_token", "password"]) {
        for (const sc of SIDECAR_KEYS) {
          const key = `${col}_${sc}`;
          expect(Buffer.isBuffer(raw[key])).toBe(true);
        }
      }
      // Ciphertext column must not equal the plaintext bytes.
      expect(
        (raw.access_token_value_ciphertext as Buffer).equals(
          Buffer.from("plaintext-access-token-123"),
        ),
      ).toBe(false);

      // Round-trip via lens: returned row has plaintext columns restored,
      // sidecars stripped.
      const found = await wrapped.findOne<any>({
        model: "account",
        where: [{ field: "id", value: "acc-1", operator: "eq", connector: "AND" }],
      });
      expect(found).toBeTruthy();
      expect(found!.access_token).toBe("plaintext-access-token-123");
      expect(found!.refresh_token).toBe("rt-456");
      expect(found!.id_token).toBe("it-789");
      expect(found!.password).toBe("pw-secret");
      // Sidecar fields stripped from public surface.
      for (const col of ["access_token", "refresh_token", "id_token", "password"]) {
        for (const sc of SIDECAR_KEYS) {
          expect(found![`${col}_${sc}`]).toBeUndefined();
        }
      }
    });

    it("writes SHA-256 fingerprint sidecars for sessions.token and previous_token", async () => {
      const provider = new EnvKeyProvider();
      const { adapter, store } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);

      await wrapped.create({
        model: "sessions",
        data: {
          id: "sess-1",
          token: "plaintext-session-token",
          previous_token: "prev-plaintext-token",
          user_id: "user-1",
        },
      });

      const raw = store.get("sessions")?.get("sess-1") as any;
      expect(raw).toBeDefined();
      expect(raw.token).toBeNull();
      expect(raw.previous_token).toBeNull();
      const tokenFp = createHash("sha256").update("plaintext-session-token").digest();
      const prevFp = createHash("sha256").update("prev-plaintext-token").digest();
      expect(Buffer.isBuffer(raw.token_fp)).toBe(true);
      expect((raw.token_fp as Buffer).equals(tokenFp)).toBe(true);
      expect((raw.previous_token_fp as Buffer).equals(prevFp)).toBe(true);
    });

    it("strips fingerprint sidecars from read results too", async () => {
      const provider = new EnvKeyProvider();
      const { adapter } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);
      await wrapped.create({
        model: "sessions",
        data: { id: "s1", token: "tk", user_id: "u" },
      });
      const found = await wrapped.findOne<any>({
        model: "sessions",
        where: [{ field: "id", value: "s1", operator: "eq", connector: "AND" }],
      });
      expect(found).toBeTruthy();
      expect(found!.token).toBe("tk");
      expect(found!.token_fp).toBeUndefined();
      for (const sc of SIDECAR_KEYS) {
        expect(found![`token_${sc}`]).toBeUndefined();
      }
    });

    it("findMany decrypts all rows + strips sidecars", async () => {
      const provider = new EnvKeyProvider();
      const { adapter } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);

      await wrapped.create({
        model: "verification",
        data: { id: "v1", value: "reset-token-A", identifier: "u1@x" },
      });
      await wrapped.create({
        model: "verification",
        data: { id: "v2", value: "reset-token-B", identifier: "u2@x" },
      });

      const rows = await wrapped.findMany<any>({ model: "verification" });
      expect(rows).toHaveLength(2);
      const values = rows.map((r: any) => r.value).sort();
      expect(values).toEqual(["reset-token-A", "reset-token-B"]);
      for (const r of rows) {
        for (const sc of SIDECAR_KEYS) {
          expect(r[`value_${sc}`]).toBeUndefined();
        }
      }
    });

    it("update encrypts the new value", async () => {
      const provider = new EnvKeyProvider();
      const { adapter, store } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);

      await wrapped.create({
        model: "account",
        data: { id: "a1", access_token: "old", user_id: "u1" },
      });
      await wrapped.update({
        model: "account",
        where: [{ field: "id", value: "a1", operator: "eq", connector: "AND" }],
        update: { access_token: "new-token" },
      });
      const raw = store.get("account")?.get("a1") as any;
      expect(raw.access_token).toBeNull();
      expect((raw.access_token_value_ciphertext as Buffer).equals(Buffer.from("new-token"))).toBe(
        false,
      );
      const back = await wrapped.findOne<any>({
        model: "account",
        where: [{ field: "id", value: "a1", operator: "eq", connector: "AND" }],
      });
      expect(back!.access_token).toBe("new-token");
    });

    it("rows missing all sidecars pass through unchanged (legacy plaintext window)", async () => {
      const provider = new EnvKeyProvider();
      const { adapter, store } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);

      // Pre-seed a row directly with a plaintext token but no sidecars
      // (simulates 33-03 backfill mid-window).
      store.set(
        "verification",
        new Map([["legacy-1", { id: "legacy-1", value: "legacy-plaintext", identifier: "x" }]]),
      );
      const row = await wrapped.findOne<any>({
        model: "verification",
        where: [{ field: "id", value: "legacy-1", operator: "eq", connector: "AND" }],
      });
      expect(row).toBeTruthy();
      // Plaintext untouched — lens doesn't try to decrypt absent sidecars.
      expect(row!.value).toBe("legacy-plaintext");
    });
  });

  describe("tamper resistance", () => {
    it("flipping a byte in value_ciphertext causes findOne to throw (GCM auth tag)", async () => {
      const provider = new EnvKeyProvider();
      const { adapter, store } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);

      await wrapped.create({
        model: "account",
        data: { id: "t1", access_token: "secret", user_id: "u" },
      });
      const raw = store.get("account")?.get("t1") as any;
      const ct = raw.access_token_value_ciphertext as Buffer;
      ct[0] = (ct[0] ?? 0) ^ 0x01;

      await expect(
        wrapped.findOne({
          model: "account",
          where: [{ field: "id", value: "t1", operator: "eq", connector: "AND" }],
        }),
      ).rejects.toThrow();
    });
  });

  describe("wrong-KEK rejection", () => {
    it("reading with a different KEK provider fails with a descriptive error", async () => {
      const providerA = new EnvKeyProvider();
      const { adapter } = makeMockAdapter();
      const wrappedA = wrapAdapter(adapter, providerA, COLUMN_MAP);
      await wrappedA.create({
        model: "account",
        data: { id: "wk1", access_token: "secret", user_id: "u" },
      });

      // Swap KEK to a brand-new one, instantiate a new provider, re-wrap.
      process.env.MASTER_KEK = makeKek();
      const providerB = new EnvKeyProvider();
      const wrappedB = wrapAdapter(adapter, providerB, COLUMN_MAP);

      await expect(
        wrappedB.findOne({
          model: "account",
          where: [{ field: "id", value: "wk1", operator: "eq", connector: "AND" }],
        }),
      ).rejects.toThrow();
    });
  });

  describe("KEK rotation — provider-chain fallback", () => {
    it("row encrypted under KEK_v1 still decrypts when chain is [v2, v1]", async () => {
      // Write under KEK_v1.
      process.env.MASTER_KEK = makeKek();
      const providerV1 = new EnvKeyProvider();
      const { adapter } = makeMockAdapter();
      const writer = wrapAdapter(adapter, providerV1, COLUMN_MAP);
      await writer.create({
        model: "account",
        data: { id: "rot-1", access_token: "rotating-secret", user_id: "u" },
      });

      // Rotate: KEK_v2 becomes active; chain accepts [v2, v1] for reads.
      process.env.MASTER_KEK = makeKek();
      const providerV2 = new EnvKeyProvider();
      const reader = wrapAdapter(adapter, [providerV2, providerV1], COLUMN_MAP);
      const row = await reader.findOne<any>({
        model: "account",
        where: [{ field: "id", value: "rot-1", operator: "eq", connector: "AND" }],
      });
      expect(row).toBeTruthy();
      expect(row!.access_token).toBe("rotating-secret");
    });

    it("new writes after rotation use the head (current) provider", async () => {
      process.env.MASTER_KEK = makeKek();
      const v1 = new EnvKeyProvider();
      process.env.MASTER_KEK = makeKek();
      const v2 = new EnvKeyProvider();
      const { adapter, store } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, [v2, v1], COLUMN_MAP);

      await wrapped.create({
        model: "account",
        data: { id: "post-rot-1", access_token: "fresh", user_id: "u" },
      });
      const raw = store.get("account")?.get("post-rot-1") as any;
      // Sanity: ciphertext exists, dek_wrapped is bound to v2's KEK
      // (i.e. v1 can NOT unwrap it). Verify by attempting to unwrap with v1.
      await expect(
        v1.unwrapDek(
          raw.access_token_dek_wrapped as Buffer,
          raw.access_token_dek_iv as Buffer,
          raw.access_token_dek_auth_tag as Buffer,
        ),
      ).rejects.toThrow();
      // And v2 succeeds:
      const dek = await v2.unwrapDek(
        raw.access_token_dek_wrapped as Buffer,
        raw.access_token_dek_iv as Buffer,
        raw.access_token_dek_auth_tag as Buffer,
      );
      expect(dek.length).toBe(32);
    });
  });

  describe("fingerprint lookup rewrite", () => {
    it("`token_fp_lookup` clause is rewritten to `token_fp = sha256(value)`", async () => {
      const provider = new EnvKeyProvider();
      const { adapter } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);

      await wrapped.create({
        model: "sessions",
        data: { id: "fp-1", token: "lookup-token-x", user_id: "u" },
      });

      const row = await wrapped.findOne<any>({
        model: "sessions",
        where: [
          { field: "token_fp_lookup", value: "lookup-token-x", operator: "eq", connector: "AND" },
        ],
      });
      expect(row).toBeTruthy();
      expect(row!.token).toBe("lookup-token-x");
      expect(row!.id).toBe("fp-1");
    });

    it("returns null when fp lookup misses", async () => {
      const provider = new EnvKeyProvider();
      const { adapter } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);
      await wrapped.create({
        model: "sessions",
        data: { id: "fp-2", token: "real-token", user_id: "u" },
      });
      const row = await wrapped.findOne<any>({
        model: "sessions",
        where: [
          { field: "token_fp_lookup", value: "wrong-plaintext", operator: "eq", connector: "AND" },
        ],
      });
      expect(row).toBeNull();
    });
  });

  describe("pass-through methods", () => {
    it("count delegates without transformation", async () => {
      const provider = new EnvKeyProvider();
      const { adapter } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);
      await wrapped.create({
        model: "account",
        data: { id: "c1", access_token: "x", user_id: "u" },
      });
      await wrapped.create({
        model: "account",
        data: { id: "c2", access_token: "y", user_id: "u" },
      });
      const n = await wrapped.count({ model: "account" });
      expect(n).toBe(2);
    });

    it("delete delegates", async () => {
      const provider = new EnvKeyProvider();
      const { adapter, store } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);
      await wrapped.create({
        model: "account",
        data: { id: "d1", access_token: "x", user_id: "u" },
      });
      await wrapped.delete({
        model: "account",
        where: [{ field: "id", value: "d1", operator: "eq", connector: "AND" }],
      });
      expect(store.get("account")?.size ?? 0).toBe(0);
    });

    it("deleteMany delegates and returns count", async () => {
      const provider = new EnvKeyProvider();
      const { adapter } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);
      await wrapped.create({ model: "account", data: { id: "dm1", user_id: "u" } });
      await wrapped.create({ model: "account", data: { id: "dm2", user_id: "u" } });
      const n = await wrapped.deleteMany({
        model: "account",
        where: [{ field: "user_id", value: "u", operator: "eq", connector: "AND" }],
      });
      expect(n).toBe(2);
    });

    it("updateMany delegates", async () => {
      const provider = new EnvKeyProvider();
      const { adapter, store } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);
      await wrapped.create({
        model: "account",
        data: { id: "um1", user_id: "u1", access_token: "a" },
      });
      await wrapped.create({
        model: "account",
        data: { id: "um2", user_id: "u1", access_token: "b" },
      });
      const n = await wrapped.updateMany({
        model: "account",
        where: [{ field: "user_id", value: "u1", operator: "eq", connector: "AND" }],
        update: { access_token: "rotated" },
      });
      expect(n).toBe(2);
      // Both rows decrypt back to "rotated".
      const rows = await wrapped.findMany<any>({ model: "account" });
      for (const r of rows) expect(r.access_token).toBe("rotated");
    });

    it("operations on unmapped models pass through unchanged", async () => {
      const provider = new EnvKeyProvider();
      const { adapter, store } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);
      await wrapped.create({
        model: "users",
        data: { id: "u1", name: "Alice", email: "a@x" },
      });
      const raw = store.get("users")?.get("u1") as any;
      expect(raw.name).toBe("Alice");
      const row = await wrapped.findOne<any>({
        model: "users",
        where: [{ field: "id", value: "u1", operator: "eq", connector: "AND" }],
      });
      expect(row!.name).toBe("Alice");
    });

    it("transaction passes through the inner adapter", async () => {
      const provider = new EnvKeyProvider();
      const { adapter } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);
      const r = await wrapped.transaction(async (_trx) => 42);
      expect(r).toBe(42);
    });

    it("exposes the inner adapter id", () => {
      const provider = new EnvKeyProvider();
      const { adapter } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);
      expect(wrapped.id).toBe("mock-adapter");
    });
  });

  describe("write-path edge cases", () => {
    it("undefined plaintext column is not encrypted (skipped)", async () => {
      const provider = new EnvKeyProvider();
      const { adapter, store } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);
      await wrapped.create({
        model: "account",
        data: { id: "u1", user_id: "u" /* no access_token */ },
      });
      const raw = store.get("account")?.get("u1") as any;
      expect(raw.access_token_value_ciphertext).toBeUndefined();
      // findOne should not throw on missing sidecars + missing plaintext.
      const r = await wrapped.findOne<any>({
        model: "account",
        where: [{ field: "id", value: "u1", operator: "eq", connector: "AND" }],
      });
      expect(r).toBeTruthy();
      expect(r!.access_token).toBeUndefined();
    });

    it("null plaintext column is not encrypted (skipped)", async () => {
      const provider = new EnvKeyProvider();
      const { adapter, store } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);
      await wrapped.create({
        model: "account",
        data: { id: "u2", user_id: "u", access_token: null },
      });
      const raw = store.get("account")?.get("u2") as any;
      expect(raw.access_token_value_ciphertext).toBeUndefined();
    });

    it("findMany returns [] when store empty + no rows to decrypt", async () => {
      const provider = new EnvKeyProvider();
      const { adapter } = makeMockAdapter();
      const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP);
      const rows = await wrapped.findMany<any>({ model: "account" });
      expect(rows).toEqual([]);
    });
  });
});
