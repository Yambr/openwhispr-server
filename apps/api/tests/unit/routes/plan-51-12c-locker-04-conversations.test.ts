// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-12c — REVIEW routes-conversations HIGH (LOCKER-04
// sweep, conversations slice). Pins:
//   - Every conversations/* route declaration carries `schema: {...}`
//     (body or querystring) per LOCKER-04 invariant 14.
//   - `MESSAGE_CONTENT_MAX_BYTES` is module-private (no `export`),
//     since the only external consumer was a regression test that
//     reads the source directly.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TEST_DIR, "../../..");

const ROUTES_WITH_BODY = [
  "src/routes/conversations/create.ts",
  "src/routes/conversations/delete.ts",
  "src/routes/conversations/search.ts",
  "src/routes/conversations/update.ts",
  "src/routes/conversations/messages.ts",
];

const ROUTES_WITH_QUERYSTRING = [
  "src/routes/conversations/list.ts",
  "src/routes/conversations/messages.ts",
];

describe("Plan 51-12c — conversations LOCKER-04 sweep", () => {
  it.each(ROUTES_WITH_BODY)("%s carries `schema: { body: ... }`", (rel) => {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    expect(src).toMatch(/schema:\s*\{\s*body:\s*\w+Schema/);
  });

  it.each(ROUTES_WITH_QUERYSTRING)("%s carries `schema: { querystring: ... }`", (rel) => {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    expect(src).toMatch(/schema:\s*\{\s*querystring:\s*\w+Schema/);
  });

  it("MESSAGE_CONTENT_MAX_BYTES is no longer exported", () => {
    const src = readFileSync(resolve(ROOT, "src/routes/conversations/messages.ts"), "utf8");
    expect(src).toMatch(/^const\s+MESSAGE_CONTENT_MAX_BYTES\b/m);
    expect(src).not.toMatch(/^export\s+const\s+MESSAGE_CONTENT_MAX_BYTES\b/m);
  });

  it("MESSAGE_METADATA_MAX_BYTES is no longer exported", () => {
    const src = readFileSync(resolve(ROOT, "src/routes/conversations/messages.ts"), "utf8");
    expect(src).toMatch(/^const\s+MESSAGE_METADATA_MAX_BYTES\b/m);
    expect(src).not.toMatch(/^export\s+const\s+MESSAGE_METADATA_MAX_BYTES\b/m);
  });
});
