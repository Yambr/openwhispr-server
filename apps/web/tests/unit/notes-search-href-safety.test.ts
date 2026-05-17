// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-11c — REVIEW web HIGH HI-05.
//
// NotesSearchClient used to substitute `row.id` directly into
// `href={`/app/notes/${row.id}`}` with no shape validation. If the
// upstream API ever returned a malformed id containing
// `../../../admin` or a javascript-protocol fragment, the link would
// substitute it in. The fix narrows the rendered items to UUID-shape
// ids at the client boundary and pins the regex in source.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(TEST_DIR, "../../src/components/screens/notes/NotesSearchClient.tsx");

describe("Plan 51-11c — NotesSearchClient href safety", () => {
  it("declares a UUID-shape regex constant", () => {
    const src = readFileSync(SRC, "utf8");
    expect(src).toMatch(/UUID_RE\s*=\s*\//);
  });

  it("filters rendered items via the UUID regex before href substitution", () => {
    const src = readFileSync(SRC, "utf8");
    expect(src).toMatch(/UUID_RE\.test\(\s*row\.id\s*\)|safeItems/);
  });

  it("hrefs use encodeURIComponent on the id segment", () => {
    const src = readFileSync(SRC, "utf8");
    expect(src).toMatch(/encodeURIComponent\(\s*row\.id\s*\)/);
  });
});
