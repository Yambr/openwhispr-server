// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-12tx4 — REVIEW api-routes-transcriptions HI-3.
// Pre-fix `agent/stream.ts` relied solely on `Readable.toWeb(...).cancel()`
// to propagate client disconnect to the undici socket. Forensic finding
// (08.2-RESEARCH.md candidate #4) showed cancel() does NOT abort the
// in-flight request under the project's SSRF-wrapped Agent in
// undici 7.25 — so a client that opened+disconnected mid-stream kept
// burning paid LLM tokens until LiteLLM finished. Plan 51-12tx4 holds
// a mutable upstreamBodyRef and the close-handler explicitly invokes
// `.destroy()` on it, which terminates the undici socket regardless
// of the toWeb cancel-propagation behavior.
//
// Source-pattern test: pins the destroy() wiring without booting a
// real Fastify+undici stack (already covered by stream.test.ts Test 8
// which exercises the close-listener attachment).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(TEST_DIR, "../../../../src/routes/agent/stream.ts");

describe("Plan 51-12tx4 — agent/stream destroys upstream body on client close (HI-3)", () => {
  const src = readFileSync(SRC, "utf8");

  it("holds a mutable upstreamBodyRef declared in handler scope", () => {
    expect(src).toMatch(/let\s+upstreamBodyRef:\s*Readable\s*\|\s*null\s*=\s*null/);
  });

  it("close-handler invokes upstreamBodyRef.destroy() when present + not yet destroyed", () => {
    // The handler block must reference both the .destroyed guard and
    // the .destroy() call so a future refactor that drops one breaks
    // the test.
    expect(src).toMatch(/upstreamBodyRef\s*!==\s*null\s*&&\s*!upstreamBodyRef\.destroyed/);
    expect(src).toMatch(/upstreamBodyRef\.destroy\(\)/);
  });

  it("upstreamBodyRef is assigned from upstream.body before the drain loop", () => {
    // The assignment must come BEFORE the Readable.toWeb call so the
    // close-handler has a valid ref by the time drain begins.
    const assignIdx = src.indexOf("upstreamBodyRef = upstream.body");
    const toWebIdx = src.indexOf("Readable.toWeb(upstreamBodyRef)");
    expect(assignIdx).toBeGreaterThan(-1);
    expect(toWebIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeLessThan(toWebIdx);
  });

  it("close handler still calls abort.abort() for in-route consumers", () => {
    // T-08.2-03 preserved: the AbortController flip still fires for any
    // in-route consumers that read signal.aborted; the destroy() call
    // is additive defence-in-depth.
    expect(src).toMatch(/req\.raw\.once\("close",\s*\(\)\s*=>\s*\{[^}]*abort\.abort\(\)/s);
  });
});
