// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-12tx — REVIEW api-routes-transcriptions HI-2.
// `transcriptions/list.ts` was emitting `{error: <raw parseListQuery
// message>}` directly to the wire from a `reply.code(400).send(...)`
// branch — bypassing the centralized `setErrorHandler` envelope and
// reflecting the user-supplied cursor verbatim if parseListQuery ever
// interpolates it into its error string. Pin behavior:
//   - the route file imports ValidationError from ../../errors.js;
//   - the catch branch THROWS ValidationError("INVALID_QUERY", ...);
//   - the bare `{ error: <raw> }` shape is gone from the source.
// Bonus pin: schema:querystring carries `ListQuerySchema` (LOCKER-04).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(TEST_DIR, "../../../src/routes/transcriptions/list.ts");

describe("Plan 51-12tx — transcriptions/list central error envelope (HI-2)", () => {
  const src = readFileSync(SRC, "utf8");

  it("imports ValidationError from errors.js", () => {
    expect(src).toMatch(/import\s*\{[^}]*ValidationError[^}]*\}\s*from\s*"\.\.\/\.\.\/errors\.js"/);
  });

  it("throws ValidationError with INVALID_QUERY code on parse failure", () => {
    expect(src).toMatch(
      /throw\s+new\s+ValidationError\(\s*"INVALID_QUERY"\s*,\s*"invalid query"\s*\)/,
    );
  });

  it("no longer emits raw err.message via reply.send", () => {
    // Pre-fix: `reply.code(400).send({ error: err instanceof Error ? err.message : ... })`.
    expect(src).not.toMatch(/err\s+instanceof\s+Error\s*\?\s*err\.message/);
  });

  it("carries `schema: { querystring: ... }` for LOCKER-04", () => {
    expect(src).toMatch(/schema:\s*\{\s*querystring:\s*ListQuerySchema/);
  });
});
