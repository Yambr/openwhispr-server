// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41.e / HI-03 — account-token TTL enforcement at the lens layer.
//
// Source: .planning/review/data.md HI-03. After Phase 33's bytea
// envelope-encryption, account.access_token / refresh_token are
// transparently decrypted by the lens on read. The `expires_at` columns
// (access_token_expires_at / refresh_token_expires_at) remain plaintext
// but no read path enforces the TTL — a route handler that consumes a
// decrypted token without explicitly filtering by `expires_at > now()`
// will replay an expired bearer against the upstream IdP.
//
// Fix (41-e-DECISIONS §D-3): extend `EncryptedColumnConfig` with an
// optional `expiresColumn: string`. After successful decrypt, the lens
// checks `row[expiresColumn]`; if the value is a Date (or ISO string)
// and is in the past, the lens throws `AccountTokenExpiredError` with
// (model, column, expiresAt) context — no plaintext payload (Pitfall #4
// compliant).
//
// Why lens-layer: it is the single chokepoint for every decryption
// path (Better Auth internalAdapter findUserById, findUserByEmail,
// future refresh-token consumers). Defense-in-depth vs forgotten
// per-route assertFresh() calls.
import { randomBytes } from "node:crypto";
import type { CleanedWhere, DBAdapter } from "better-auth";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AccountTokenExpiredError,
  type EncryptedColumnMap,
  EnvKeyProvider,
  wrapAdapter,
} from "../../../src/index.js";

function makeKek(): string {
  return randomBytes(32).toString("base64url");
}

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
    return where.every((clause) => row[clause.field] === clause.value);
  }
  const adapter: DBAdapter = {
    id: "mock-ttl",
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
    count: async () => 0,
    update: async () => null,
    updateMany: async () => 0,
    delete: async () => undefined,
    deleteMany: async () => 0,
    transaction: async (cb: any) => cb(adapter as any),
  };
  return { adapter, store };
}

const COLUMN_MAP_WITH_TTL: EncryptedColumnMap = {
  account: {
    access_token: {
      sidecarPrefix: "access_token",
      expiresColumn: "access_token_expires_at",
    },
    refresh_token: {
      sidecarPrefix: "refresh_token",
      expiresColumn: "refresh_token_expires_at",
    },
  },
};

const COLUMN_MAP_NO_TTL: EncryptedColumnMap = {
  account: {
    access_token: { sidecarPrefix: "access_token" },
  },
};

describe("lens TTL enforcement — Phase 41.e HI-03", () => {
  let prevKek: string | undefined;

  beforeEach(() => {
    prevKek = process.env.MASTER_KEK;
    process.env.MASTER_KEK = makeKek();
  });

  afterEach(() => {
    if (prevKek === undefined) delete process.env.MASTER_KEK;
    else process.env.MASTER_KEK = prevKek;
  });

  it("AccountTokenExpiredError is exported with model/column/expiresAt fields", () => {
    const expiresAt = new Date("2020-01-01T00:00:00Z");
    const err = new AccountTokenExpiredError("account", "access_token", expiresAt);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AccountTokenExpiredError");
    expect(err.model).toBe("account");
    expect(err.column).toBe("access_token");
    expect(err.expiresAt).toEqual(expiresAt);
    // The error message MUST NOT include the actual token payload
    // (Pitfall #4: never leak DEK or plaintext via thrown error stacks).
    // The literal word "plaintext" in a refusal message is fine — what
    // matters is that no token-payload bytes appear.
    const sensitivePayload = "secret-token-value-abc123";
    const err2 = new AccountTokenExpiredError("account", "access_token", expiresAt);
    expect(err2.message).not.toContain(sensitivePayload);
  });

  it("findOne throws AccountTokenExpiredError when access_token is past expires_at", async () => {
    const provider = new EnvKeyProvider();
    const { adapter, store } = makeMockAdapter();
    const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP_WITH_TTL);

    const pastDate = new Date(Date.now() - 60 * 60 * 1000);
    // Write WITHOUT expires_at so create()'s echo-decrypt succeeds.
    await wrapped.create({
      model: "account",
      data: { id: "acc-expired", access_token: "expired-token-value", user_id: "user-1" },
    });
    // Mutate the stored row to simulate the OAuth provider issuing a
    // refresh token and the original access_token rotating out.
    store.get("account")!.get("acc-expired")!.access_token_expires_at = pastDate;

    await expect(
      wrapped.findOne({
        model: "account",
        where: [{ field: "id", value: "acc-expired", operator: "eq", connector: "AND" }],
      }),
    ).rejects.toBeInstanceOf(AccountTokenExpiredError);
  });

  it("findOne returns plaintext when access_token is fresh (expires_at in future)", async () => {
    const provider = new EnvKeyProvider();
    const { adapter } = makeMockAdapter();
    const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP_WITH_TTL);

    const futureDate = new Date(Date.now() + 60 * 60 * 1000); // +1h.
    await wrapped.create({
      model: "account",
      data: {
        id: "acc-fresh",
        access_token: "fresh-token-value",
        access_token_expires_at: futureDate,
        user_id: "user-1",
      },
    });

    const row = (await wrapped.findOne({
      model: "account",
      where: [{ field: "id", value: "acc-fresh", operator: "eq", connector: "AND" }],
    })) as Record<string, unknown> | null;
    expect(row).toBeTruthy();
    expect(row!.access_token).toBe("fresh-token-value");
  });

  it("findOne returns plaintext when expiresColumn is null (no expiry set)", async () => {
    const provider = new EnvKeyProvider();
    const { adapter } = makeMockAdapter();
    const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP_WITH_TTL);

    await wrapped.create({
      model: "account",
      data: {
        id: "acc-nullexp",
        access_token: "no-expiry-token",
        access_token_expires_at: null,
        user_id: "user-1",
      },
    });

    const row = (await wrapped.findOne({
      model: "account",
      where: [{ field: "id", value: "acc-nullexp", operator: "eq", connector: "AND" }],
    })) as Record<string, unknown> | null;
    expect(row).toBeTruthy();
    expect(row!.access_token).toBe("no-expiry-token");
  });

  it("findOne does not enforce TTL when expiresColumn is not configured", async () => {
    const provider = new EnvKeyProvider();
    const { adapter } = makeMockAdapter();
    const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP_NO_TTL);

    const pastDate = new Date(Date.now() - 60 * 60 * 1000);
    await wrapped.create({
      model: "account",
      data: {
        id: "acc-no-ttl-config",
        access_token: "expired-but-ttl-not-checked",
        access_token_expires_at: pastDate,
        user_id: "user-1",
      },
    });

    // No expiresColumn in map → lens passes through without enforcement.
    const row = (await wrapped.findOne({
      model: "account",
      where: [{ field: "id", value: "acc-no-ttl-config", operator: "eq", connector: "AND" }],
    })) as Record<string, unknown> | null;
    expect(row!.access_token).toBe("expired-but-ttl-not-checked");
  });

  it("findMany propagates AccountTokenExpiredError on the first expired row", async () => {
    const provider = new EnvKeyProvider();
    const { adapter, store } = makeMockAdapter();
    const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP_WITH_TTL);

    const pastDate = new Date(Date.now() - 60 * 60 * 1000);
    await wrapped.create({
      model: "account",
      data: { id: "acc-many-1", access_token: "expired-many", user_id: "user-1" },
    });
    store.get("account")!.get("acc-many-1")!.access_token_expires_at = pastDate;

    await expect(wrapped.findMany({ model: "account", where: undefined })).rejects.toBeInstanceOf(
      AccountTokenExpiredError,
    );
  });

  it("accepts ISO-string expires_at values (JSON-deserialized round trip)", async () => {
    const provider = new EnvKeyProvider();
    const { adapter, store } = makeMockAdapter();
    const wrapped = wrapAdapter(adapter, provider, COLUMN_MAP_WITH_TTL);

    const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await wrapped.create({
      model: "account",
      data: { id: "acc-iso", access_token: "iso-expired", user_id: "user-1" },
    });
    store.get("account")!.get("acc-iso")!.access_token_expires_at = pastIso;

    await expect(
      wrapped.findOne({
        model: "account",
        where: [{ field: "id", value: "acc-iso", operator: "eq", connector: "AND" }],
      }),
    ).rejects.toBeInstanceOf(AccountTokenExpiredError);
  });
});
