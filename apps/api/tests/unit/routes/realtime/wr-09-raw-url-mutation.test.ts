// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 65 / Plan 65-01 — WR-09 regression test for realtime.ts.
//
// WR-09 (Option A — see verify-first.log) — realtime.ts builds
// `new URL(rawUrl, "http://internal")` then mutates `req.raw.url` in place.
// The fix:
//   1. documents the `"http://internal"` sentinel parser base, and
//   2. guards against a non-relative `req.raw.url` — if `rawUrl` is ever
//      absolute the silent scheme/host-drop bug must surface loudly (the
//      preHandler rejects) instead of forwarding a foreign URL.
//
// `@fastify/http-proxy@11.4.4` exposes no per-request upstream-URL rewrite
// hook (only `wsClientOptions.rewriteRequestHeaders`, headers-only), so the
// in-place `req.raw.url` mutation is retained but scoped to the LAST
// preHandler statement.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROUTE_SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "src",
  "routes",
  "realtime.ts",
);

describe("realtime — WR-09 sentinel base + relative-url guard", () => {
  const src = readFileSync(ROUTE_SRC, "utf8");
  // Strip line comments — the code-shape assertions target executable code.
  const code = src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");

  it("WR-09: the http://internal sentinel base carries an explanatory comment", () => {
    // Target the actual `new URL(...)` call site (not a comment mention).
    const idx = src.indexOf('new URL(rawUrl, "http://internal")');
    expect(idx).toBeGreaterThan(-1);
    // A comment explaining the sentinel parser base must sit immediately
    // before the `new URL(...)` call.
    const window = src.slice(Math.max(0, idx - 800), idx);
    expect(window).toMatch(/sentinel|parser base|absolute base/i);
  });

  it("WR-09: the preHandler guards against a non-relative req.raw.url", () => {
    // The guard rejects (throws) when rawUrl is not a relative origin-form
    // path — so the silent scheme/host-drop bug surfaces loudly.
    expect(code).toMatch(/rawUrl\.startsWith\("\/"\)/);
  });

  it("WR-09: the req.raw.url mutation is the last statement of the preHandler", () => {
    // The user-id append is the final preHandler statement, minimising the
    // window an earlier hook could observe the mutated URL.
    const mutIdx = code.indexOf("req.raw.url = u.pathname");
    expect(mutIdx).toBeGreaterThan(-1);
    // Only whitespace + closing braces / parens follow the mutation (the
    // preHandler body ends right after it).
    const after = code.slice(mutIdx + "req.raw.url = u.pathname + u.search;".length);
    // The preHandler arrow body closes immediately: `},` then the register
    // options object + call close. No further statements run after the
    // mutation inside the preHandler.
    const preHandlerTail = after.slice(0, after.indexOf("};"));
    expect(preHandlerTail).not.toMatch(/\b(const|let|return|await)\b/);
    expect(preHandlerTail).not.toMatch(/req\.raw\.url\s*=/);
  });
});
