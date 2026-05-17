// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-12 — RED→GREEN regressions for REVIEW-INDEX.md
// api-routes-conversations HIGH:
//   * notes/delete-all count vs DELETE asymmetry — count filtered
//     deleted_at IS NULL, DELETE was total. A user could soft-delete
//     N rows via /notes/delete and then hard-purge past the
//     MAX_INLINE_PURGE gate.
//   * messages.content unbounded — asymmetric DoS vs the 4 KiB
//     metadata cap. Content flows verbatim to LiteLLM downstream.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const DELETE_ALL_SRC = resolve(TEST_DIR, "../../../src/routes/notes/delete-all.ts");
const MESSAGES_SRC = resolve(TEST_DIR, "../../../src/routes/conversations/messages.ts");

describe("Plan 51-12 — conversations / notes hardening", () => {
  it("notes/delete-all: count + DELETE now cover the same rowset (tombstone bypass closed)", () => {
    const src = readFileSync(DELETE_ALL_SRC, "utf8");
    // Strip JSDoc / comments first so a narrative reference to the
    // old `deleted_at IS NULL` predicate doesn't false-positive.
    const stripped = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // The count SQL block must NOT carry `deleted_at IS NULL`.
    const countBlock = stripped.match(/SELECT COUNT[\s\S]+?FROM "notes"[\s\S]+?`/);
    expect(countBlock, "count SQL block not found").toBeTruthy();
    expect(/deleted_at\s+IS\s+NULL/i.test(countBlock?.[0] ?? "")).toBe(false);
  });

  it("conversations/messages: content cap MESSAGE_CONTENT_MAX_BYTES present and enforced via .max()", () => {
    const src = readFileSync(MESSAGES_SRC, "utf8");
    expect(/MESSAGE_CONTENT_MAX_BYTES\s*=\s*\d+/.test(src)).toBe(true);
    expect(/content:\s*z\.string\(\)\.max\(MESSAGE_CONTENT_MAX_BYTES\)/.test(src)).toBe(true);
  });
});
