// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 1 — keyset-pagination unit tests.
//
// Pure JS — no Postgres. Asserts the parse/clamp behavior + the SQL
// fragments emit the tuple-comparison signature so Plan 06-09 grep
// audits ("paged via (created_at, id) tuple compare") light up.
import { describe, expect, it } from "vitest";
import {
  buildKeysetOrderLimit,
  buildKeysetWhere,
  parseListQuery,
} from "../../../../src/lib/keyset-pagination.js";

function stringify(s: unknown): string {
  const q = s as { queryChunks?: unknown[] };
  const chunks = q.queryChunks ?? [];
  const parts: string[] = [];
  for (const c of chunks) {
    if (typeof c === "string") {
      parts.push(c);
    } else if (c && typeof c === "object") {
      if ("value" in c) {
        const v = (c as { value: unknown }).value;
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
          parts.push((v as string[]).join(""));
        } else {
          parts.push("?");
        }
      } else if ("queryChunks" in c) {
        parts.push(stringify(c));
      } else {
        parts.push(String(c));
      }
    }
  }
  return parts.join("");
}

describe("parseListQuery — D-25 limit/before/since clamping", () => {
  it("returns default limit=50 when no limit provided", () => {
    expect(parseListQuery({}).limit).toBe(50);
  });

  it("returns parsed limit=10 when limit='10'", () => {
    expect(parseListQuery({ limit: "10" }).limit).toBe(10);
  });

  it("clamps limit=500 to 200 (D-25 max)", () => {
    expect(parseListQuery({ limit: "500" }).limit).toBe(200);
  });

  it("clamps limit=9999 to 200 (deleteAll legacy fallback path)", () => {
    expect(parseListQuery({ limit: "9999" }).limit).toBe(200);
  });

  it("clamps limit=0 to default (>0 required)", () => {
    expect(parseListQuery({ limit: "0" }).limit).toBe(50);
  });

  it("clamps negative limit to default", () => {
    expect(parseListQuery({ limit: "-5" }).limit).toBe(50);
  });

  it("falls back to default on non-numeric limit", () => {
    expect(parseListQuery({ limit: "all" }).limit).toBe(50);
  });

  it("parses before timestamp", () => {
    const parsed = parseListQuery({ before: "2026-01-01T00:00:00Z" });
    expect(parsed.before).toBeInstanceOf(Date);
    expect(parsed.before?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("parses since timestamp", () => {
    const parsed = parseListQuery({ since: "2026-05-11T12:00:00Z" });
    expect(parsed.since).toBeInstanceOf(Date);
  });

  it("throws TypeError on invalid before", () => {
    expect(() => parseListQuery({ before: "garbage" })).toThrow(TypeError);
  });

  it("throws TypeError on invalid since", () => {
    expect(() => parseListQuery({ since: "not-a-date" })).toThrow(TypeError);
  });

  it("returns undefined before/since when not provided", () => {
    const p = parseListQuery({});
    expect(p.before).toBeUndefined();
    expect(p.since).toBeUndefined();
  });
});

describe("buildKeysetWhere — SQL fragment for keyset paging", () => {
  it("returns empty fragment when neither before nor since set", () => {
    const sql = buildKeysetWhere({
      before: undefined,
      beforeId: undefined,
      since: undefined,
      sinceId: undefined,
    });
    expect(stringify(sql).trim()).toBe("");
  });

  it("emits created_at < before fragment when before set", () => {
    const sql = buildKeysetWhere({
      before: new Date("2026-01-01T00:00:00Z"),
      beforeId: undefined,
      since: undefined,
      sinceId: undefined,
    });
    expect(stringify(sql)).toMatch(/created_at < /);
    expect(stringify(sql)).toMatch(/timestamptz/);
  });

  // The delta axis is `updated_at`, not `created_at`. This expectation used to
  // read `created_at > since`, which is what silently dropped every edit to an
  // older note from every delta pull — the client's cursor is an `updated_at`
  // (SyncService.pullNotes). The old expectation described the bug, so it moved
  // with the fix rather than being preserved.
  it("emits updated_at > since fragment when since set", () => {
    const sql = buildKeysetWhere({
      before: undefined,
      beforeId: undefined,
      since: new Date("2026-01-01T00:00:00Z"),
      sinceId: undefined,
    });
    expect(stringify(sql)).toMatch(/updated_at > /);
  });

  it("emits both fragments joined with AND when both set", () => {
    const sql = buildKeysetWhere({
      before: new Date("2026-02-01T00:00:00Z"),
      beforeId: undefined,
      since: new Date("2026-01-01T00:00:00Z"),
      sinceId: undefined,
    });
    const text = stringify(sql);
    expect(text).toMatch(/created_at < /);
    expect(text).toMatch(/updated_at > /);
    expect(text).toMatch(/AND/);
  });

  it("emits a (created_at, id) tuple compare when before_id accompanies before", () => {
    const sql = buildKeysetWhere({
      before: new Date("2026-01-01T00:00:00Z"),
      beforeId: "11111111-1111-4111-8111-111111111111",
      since: undefined,
      sinceId: undefined,
    });
    expect(stringify(sql)).toMatch(/\(created_at, id\) < /);
  });

  it("emits an (updated_at, id) tuple compare when since_id accompanies since", () => {
    const sql = buildKeysetWhere({
      before: undefined,
      beforeId: undefined,
      since: new Date("2026-01-01T00:00:00Z"),
      sinceId: "11111111-1111-4111-8111-111111111111",
    });
    expect(stringify(sql)).toMatch(/\(updated_at, id\) > /);
  });
});

describe("buildKeysetOrderLimit — ORDER BY + LIMIT tail", () => {
  it("emits 'ORDER BY created_at DESC, id DESC LIMIT N' shape — pairs with notes_keyset_idx (created_at, id)", () => {
    const sql = buildKeysetOrderLimit({
      limit: 25,
      before: undefined,
      beforeId: undefined,
      since: undefined,
      sinceId: undefined,
    });
    const text = stringify(sql);
    // Grep audit: `(created_at, id)` ordering — pair with partial index.
    expect(text).toMatch(/ORDER BY created_at DESC, id DESC/);
    expect(text).toMatch(/LIMIT /);
  });

  it("emits '(updated_at, id) ASC' on a delta page so the client's cursor advances", () => {
    const sql = buildKeysetOrderLimit({
      limit: 25,
      before: undefined,
      beforeId: undefined,
      since: new Date("2026-01-01T00:00:00Z"),
      sinceId: undefined,
    });
    // The client takes the LAST row of the page as its next cursor. Descending
    // order hands it the oldest edit and it re-requests the same page forever.
    expect(stringify(sql)).toMatch(/ORDER BY updated_at ASC, id ASC/);
  });
});
