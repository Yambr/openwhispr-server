// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-04 — RED→GREEN for REVIEW-INDEX.md CR-4.
//
// The pre-fix account RSC at apps/web/src/app/(auth)/app/account/page.tsx
// read `session.session.token` (a Better Auth bearer) and passed it
// down as a client-component prop. The prop ended up in `__NEXT_DATA__`
// / the JS heap — i.e. accessible to any XSS, defeating the HttpOnly
// cookie protection.
//
// Fix contract:
//   * apps/web/src/app/(auth)/app/account/page.tsx MUST NOT read
//     `session.session.token` at all.
//   * The "this device" badge in SessionsTable compares on the safe
//     `session.id` identifier instead.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PAGE_SRC = resolve(TEST_DIR, "../../src/app/(auth)/app/account/page.tsx");
const TABLE_SRC = resolve(TEST_DIR, "../../src/components/screens/account/SessionsTable.tsx");

describe("Plan 51-04 — account RSC must not leak session.token to the client", () => {
  it("source: account/page.tsx no longer reads session.session.token", () => {
    const src = readFileSync(PAGE_SRC, "utf8");
    // Strip line comments so a narrative-comment reference to the old
    // anti-pattern (citing the fix rationale) doesn't false-positive.
    const stripped = src.replace(/\/\/[^\n]*/g, "");
    expect(/session\.session\.token/.test(stripped)).toBe(false);
  });

  it("source: account/page.tsx no longer passes `currentSessionToken` to AccountClient", () => {
    const src = readFileSync(PAGE_SRC, "utf8");
    const stripped = src.replace(/\/\/[^\n]*/g, "");
    expect(/currentSessionToken=/.test(stripped)).toBe(false);
  });

  it("source: SessionsTable compares against `currentSessionId` (safe) rather than `currentSessionToken`", () => {
    const src = readFileSync(TABLE_SRC, "utf8");
    expect(/currentSessionId/.test(src)).toBe(true);
  });
});
