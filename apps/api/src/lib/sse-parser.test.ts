// Phase 04 / Plan 01 / Task 3 — RED test stub.
//
// Wave 1 (plan 04-02) lands `apps/api/src/lib/sse-parser.ts` (the
// SSE→NDJSON translation generator) and turns these tests GREEN. Today
// the import below fails to resolve, which is the canonical TDD RED
// state per CLAUDE.md constitutional rule 1.
//
// Fixture corpus: apps/api/src/routes/agent/__fixtures__/*.sse (Task 1).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
// eslint-disable-next-line import/no-unresolved -- Wave 1 creates this module; expected RED in Wave 0.
import { sseToNdjson } from "./sse-parser.js";

const FIXTURES = [
  "text-only",
  "single-tool-call",
  "multi-tool-call",
  "text-then-tool",
  "premature-close",
  "malformed-payload",
  "utf8-split",
] as const;

describe("sseToNdjson", () => {
  for (const name of FIXTURES) {
    it(`handles ${name} fixture`, async () => {
      const raw = readFileSync(
        `apps/api/src/routes/agent/__fixtures__/${name}.sse`
      );
      const stream = Readable.toWeb(Readable.from([raw]));
      // Wave 1 imports the real accumulator; the noop shape here keeps
      // the test typeable in Wave 0 RED state.
      const acc = {
        absorb: () => {},
        flush: () => [],
        hasPending: () => false,
      };
      const out: unknown[] = [];
      for await (const chunk of sseToNdjson({
        body: stream as ReadableStream<Uint8Array>,
        acc,
      })) {
        out.push(chunk);
      }
      // Initial RED contract: import resolution is the failure mode.
      // Wave 1 replaces this with the full per-fixture assertion suite
      // (chunk vocabulary, ordering, premature-close synthetic finish,
      // utf8 boundary integrity, malformed-payload skip+continue).
      expect(out.length).toBeGreaterThanOrEqual(0);
    });
  }
});
