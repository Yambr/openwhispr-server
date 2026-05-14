// SPDX-License-Identifier: FSL-1.1-ALv2
// Unit tests for tools/integrity-check.js.
//
// Exercised E2E in helm-upgrade-matrix.yml against a real CNPG cluster.
// These unit tests verify the assert-and-report contract via a fake
// pg.Client injected through the `deps` parameter.

import { describe, expect, it } from "vitest";
import { check } from "./integrity-check.js";
import { SEED_ROWS } from "./seed-test-data.js";

function makeFakeClient(selectReturn) {
  const calls = [];
  class FakeClient {
    async connect() {}
    async query(sql, params) {
      calls.push([sql, params]);
      if (/^SELECT/.test(sql) && selectReturn) return selectReturn;
      return { rowCount: 0, rows: [] };
    }
    async end() {}
  }
  return { Client: FakeClient, calls };
}

describe("integrity-check", () => {
  it("returns ok=true when all 10 seeded rows match the fixture exactly", async () => {
    const deps = makeFakeClient({
      rowCount: SEED_ROWS.length,
      rows: SEED_ROWS.map((r) => ({ id: r.id, text: r.text, word_count: r.wordCount })),
    });
    const logs = [];
    const result = await check({
      databaseUrl: "postgres://x/y",
      logger: { log: (s) => logs.push(s) },
      deps,
    });
    expect(result.ok).toBe(true);
    expect(result.rowsFound).toBe(10);
    expect(result.issues).toEqual([]);
    expect(JSON.parse(logs[0])).toMatchObject({ ok: true, rowsFound: 10 });
  });

  it("reports missing rows when count is too low", async () => {
    const deps = makeFakeClient({
      rowCount: 7,
      rows: SEED_ROWS.slice(0, 7).map((r) => ({
        id: r.id,
        text: r.text,
        word_count: r.wordCount,
      })),
    });
    const result = await check({
      databaseUrl: "postgres://x/y",
      logger: { log: () => {} },
      deps,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /expected 10 seeded rows, found 7/.test(i))).toBe(true);
    expect(result.issues.filter((i) => /missing row/.test(i))).toHaveLength(3);
  });

  it("reports text drift when row content was mutated", async () => {
    const drifted = SEED_ROWS.map((r, idx) => ({
      id: r.id,
      text: idx === 0 ? "MUTATED" : r.text,
      word_count: r.wordCount,
    }));
    const deps = makeFakeClient({ rowCount: drifted.length, rows: drifted });
    const result = await check({
      databaseUrl: "postgres://x/y",
      logger: { log: () => {} },
      deps,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /text drift/.test(i))).toBe(true);
  });

  it("reports word_count drift", async () => {
    const drifted = SEED_ROWS.map((r, idx) => ({
      id: r.id,
      text: r.text,
      word_count: idx === 5 ? 999 : r.wordCount,
    }));
    const deps = makeFakeClient({ rowCount: drifted.length, rows: drifted });
    const result = await check({
      databaseUrl: "postgres://x/y",
      logger: { log: () => {} },
      deps,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /word_count drift/.test(i))).toBe(true);
  });

  it("rejects when DATABASE_URL is missing", async () => {
    const deps = makeFakeClient();
    await expect(check({ databaseUrl: "", logger: { log: () => {} }, deps })).rejects.toThrow(
      /DATABASE_URL/,
    );
  });

  it("sets the tenant_id local for RLS before SELECT", async () => {
    const deps = makeFakeClient({ rowCount: 0, rows: [] });
    await check({ databaseUrl: "postgres://x/y", logger: { log: () => {} }, deps });
    const sqls = deps.calls.map((c) => c[0]);
    expect(sqls).toContain("BEGIN");
    expect(sqls.some((s) => /SET LOCAL app\.tenant_id/.test(s))).toBe(true);
    expect(sqls.some((s) => /^SELECT id, text, word_count/.test(s))).toBe(true);
  });

  it("rowsFound falls back to 0 when rowCount is null", async () => {
    const deps = makeFakeClient({ rowCount: null, rows: [] });
    const result = await check({
      databaseUrl: "postgres://x/y",
      logger: { log: () => {} },
      deps,
    });
    expect(result.rowsFound).toBe(0);
  });
});
