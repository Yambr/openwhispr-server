// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 05 / Task 1 — soft-delete helper unit tests.
//
// Pure JS — no Postgres. Asserts the emitted SQL fragment has the
// `deleted_at IS NULL` predicate exactly once (T-05-06 mitigation
// surface).
import { describe, expect, it } from "vitest";
import { softDeletePredicate, withSoftDelete } from "../../../../src/lib/soft-delete.js";

function stringify(s: unknown): string {
  const q = s as { queryChunks?: unknown[] };
  const chunks = q.queryChunks ?? [];
  const parts: string[] = [];
  for (const c of chunks) {
    if (typeof c === "string") {
      parts.push(c);
    } else if (c && typeof c === "object" && "value" in c) {
      const v = (c as { value: unknown }).value;
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
        parts.push((v as string[]).join(""));
      } else {
        parts.push("?");
      }
    }
  }
  return parts.join("");
}

describe("withSoftDelete — leading AND fragment", () => {
  it("returns ' AND deleted_at IS NULL' as a composable fragment", () => {
    const text = stringify(withSoftDelete());
    expect(text).toMatch(/AND deleted_at IS NULL/);
  });

  it("starts with a leading space so it composes onto an existing WHERE clause", () => {
    const text = stringify(withSoftDelete());
    expect(text.startsWith(" ")).toBe(true);
  });
});

describe("softDeletePredicate — bare predicate", () => {
  it("returns 'deleted_at IS NULL' without the leading AND", () => {
    const text = stringify(softDeletePredicate());
    expect(text).toMatch(/^deleted_at IS NULL$/);
  });
});
