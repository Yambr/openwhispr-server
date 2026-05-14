// SPDX-License-Identifier: FSL-1.1-ALv2
// Unit tests for tools/seed-test-data.js.
//
// Exercised E2E in .github/workflows/helm-upgrade-matrix.yml against a real
// CNPG Cluster on kind. These unit tests verify the in-script SQL contract
// via a fake pg.Client injected through the `deps` parameter (no vi.mock).

import { describe, expect, it } from "vitest";
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID, SEED_ROWS, seed } from "./seed-test-data.js";

function makeFakeClient(behavior = {}) {
  const calls = [];
  let inserts = 0;
  class FakeClient {
    async connect() {}
    async query(sql, params) {
      calls.push([sql, params]);
      if (behavior.failOnTranscriptionInsertN && /INSERT INTO transcriptions/.test(sql)) {
        inserts += 1;
        if (inserts === behavior.failOnTranscriptionInsertN) {
          throw new Error(behavior.failMessage ?? "boom");
        }
      }
      return { rowCount: 1, rows: [] };
    }
    async end() {}
  }
  return { Client: FakeClient, calls };
}

describe("seed-test-data", () => {
  it("exposes 10 deterministic SEED_ROWS with stable UUIDs", () => {
    expect(SEED_ROWS).toHaveLength(10);
    const ids = SEED_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(10);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });

  it("rejects when DATABASE_URL is missing", async () => {
    const deps = makeFakeClient();
    await expect(seed({ databaseUrl: "", logger: { log: () => {} }, deps })).rejects.toThrow(
      /DATABASE_URL/,
    );
  });

  it("opens a transaction, sets app.tenant_id, inserts 10 rows, commits", async () => {
    const deps = makeFakeClient();
    const logged = [];
    const result = await seed({
      databaseUrl: "postgres://x/y",
      logger: { log: (s) => logged.push(s) },
      deps,
    });
    expect(result.ok).toBe(true);
    expect(result.seededRows).toBe(10);
    const sqls = deps.calls.map((c) => c[0]);
    expect(sqls.some((s) => /INSERT INTO tenants/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO users/.test(s))).toBe(true);
    expect(sqls.some((s) => /^BEGIN$/.test(s))).toBe(true);
    expect(sqls.some((s) => /SET LOCAL app\.tenant_id/.test(s))).toBe(true);
    const transcribeInserts = sqls.filter((s) => /INSERT INTO transcriptions/.test(s));
    expect(transcribeInserts).toHaveLength(10);
    expect(sqls.some((s) => /^COMMIT$/.test(s))).toBe(true);
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0])).toMatchObject({ ok: true, seededRows: 10 });
  });

  it("uses default tenant + user IDs when not overridden", async () => {
    const deps = makeFakeClient();
    await seed({ databaseUrl: "postgres://x/y", logger: { log: () => {} }, deps });
    const tenantInsert = deps.calls.find((c) => /INSERT INTO tenants/.test(c[0]));
    expect(tenantInsert[1]).toEqual([DEFAULT_TENANT_ID]);
    const userInsert = deps.calls.find((c) => /INSERT INTO users/.test(c[0]));
    expect(userInsert[1][0]).toBe(DEFAULT_USER_ID);
  });

  it("respects tenantId / userId override args", async () => {
    const deps = makeFakeClient();
    const tenant = "11111111-2222-3333-4444-555555555555";
    const user = "66666666-7777-8888-9999-aaaaaaaaaaaa";
    await seed({
      databaseUrl: "postgres://x/y",
      tenantId: tenant,
      userId: user,
      logger: { log: () => {} },
      deps,
    });
    const userInsert = deps.calls.find((c) => /INSERT INTO users/.test(c[0]));
    expect(userInsert[1]).toEqual([user, tenant]);
  });

  it("rolls back when an INSERT throws and re-raises the error", async () => {
    const deps = makeFakeClient({
      failOnTranscriptionInsertN: 3,
      failMessage: "FK violation",
    });
    await expect(
      seed({ databaseUrl: "postgres://x/y", logger: { log: () => {} }, deps }),
    ).rejects.toThrow(/FK violation/);
    const sqls = deps.calls.map((c) => c[0]);
    expect(sqls).toContain("ROLLBACK");
  });

  it("reads DATABASE_URL/SEED_TENANT_ID/SEED_USER_ID from process.env when not overridden", async () => {
    const deps = makeFakeClient();
    const oldDb = process.env.DATABASE_URL;
    const oldTenant = process.env.SEED_TENANT_ID;
    const oldUser = process.env.SEED_USER_ID;
    process.env.DATABASE_URL = "postgres://env/db";
    process.env.SEED_TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    process.env.SEED_USER_ID = "11111111-2222-3333-4444-555555555555";
    try {
      const r = await seed({ logger: { log: () => {} }, deps });
      expect(r.ok).toBe(true);
      const tenantInsert = deps.calls.find((c) => /INSERT INTO tenants/.test(c[0]));
      expect(tenantInsert[1]).toEqual([process.env.SEED_TENANT_ID]);
    } finally {
      process.env.DATABASE_URL = oldDb;
      process.env.SEED_TENANT_ID = oldTenant;
      process.env.SEED_USER_ID = oldUser;
    }
  });

  it("falls back to defaults when process.env vars are not set", async () => {
    const deps = makeFakeClient();
    const oldT = process.env.SEED_TENANT_ID;
    const oldU = process.env.SEED_USER_ID;
    delete process.env.SEED_TENANT_ID;
    delete process.env.SEED_USER_ID;
    try {
      await seed({ databaseUrl: "postgres://x", logger: { log: () => {} }, deps });
      const tenantInsert = deps.calls.find((c) => /INSERT INTO tenants/.test(c[0]));
      expect(tenantInsert[1]).toEqual([DEFAULT_TENANT_ID]);
    } finally {
      if (oldT !== undefined) process.env.SEED_TENANT_ID = oldT;
      if (oldU !== undefined) process.env.SEED_USER_ID = oldU;
    }
  });

  it("swallows ROLLBACK errors when the connection is already terminated", async () => {
    // Client whose ROLLBACK throws (simulates server-side connection drop).
    class DroppedClient {
      constructor() {
        this.calls = [];
      }
      async connect() {}
      async query(sql) {
        this.calls.push(sql);
        if (/INSERT INTO transcriptions/.test(sql)) {
          throw new Error("connection closed");
        }
        if (/^ROLLBACK$/.test(sql)) {
          throw new Error("cannot rollback — connection gone");
        }
        return { rowCount: 1, rows: [] };
      }
      async end() {}
    }
    await expect(
      seed({
        databaseUrl: "postgres://x/y",
        logger: { log: () => {} },
        deps: { Client: DroppedClient },
      }),
    ).rejects.toThrow(/connection closed/);
  });
});
