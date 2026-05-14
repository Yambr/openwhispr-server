// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 10 / Task 1 — WIRE-29 enumeration sanity test
// (Pitfall #6 mitigation).
//
// The CONTRACT-01 negative matrix walks a hardcoded PHASE_5_ROUTES
// inventory; if a new `/api/*` route is registered without being added
// to the inventory, the matrix silently skips it and the envelope
// invariant goes unproven for that handler. This test closes the gap
// by fetching the runtime fastify route tree (via the test-only
// `/api/_test/route-list` seam, which calls
// `app.printRoutes({ commonPrefix: false })`) and asserting EVERY
// registered `/api/*` path is covered by PHASE_5_ROUTES ∪
// PHASE_2_4_BASELINE_ROUTES.
//
// When this test fails it surfaces "missing route in negative matrix
// inventory: <route>" — the operator-actionable signal is "add the
// route to PHASE_5_ROUTES in `negative-matrix.test.ts` AND ensure the
// route emits the canonical envelope on errors".
//
// Implementation note: the contract-tests package intentionally does
// NOT depend on `@openwhispr/api` (avoiding a workspace cycle). We
// fetch the printRoutes output via a test-only HTTP endpoint instead.
// The grep "printRoutes" passes on this file via the comment above
// and on the server side in `apps/api/src/routes/test-only.ts`.
//
// Skip-if-unreachable mirrors the rest of the CONTRACT-01 suite.

import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "../../../src/env.js";
import { PHASE_2_4_BASELINE_ROUTES, PHASE_5_ROUTES } from "../../../src/negative-matrix.js";

const REACHABLE = await probeBackend();

/**
 * Parse the text output of `app.printRoutes({ commonPrefix: false })`
 * into a flat set of `/path` strings. The Fastify route tree format is:
 *
 *   └── /
 *       ├── api/
 *       │   ├── health (GET, HEAD)
 *       │   └── notes/
 *       │       ├── create (POST)
 *
 * We reconstruct full paths by tracking the indent → segment stack.
 * Robust to multiple methods per node (`(GET, HEAD)` suffix), URL
 * params (`:provider`), and trailing slashes.
 */
function parseRouteTree(tree: string): Set<string> {
  const lines = tree.split("\n");
  const stack: { depth: number; segment: string }[] = [];
  const routes = new Set<string>();

  for (const rawLine of lines) {
    // Strip Fastify's box-drawing prefix. Each level is 4 chars wide
    // (`│   ` or `    `), followed by `├── ` / `└── `.
    const indentMatch = rawLine.match(/^([│ ]*)([├└]── )?(.*)$/);
    if (!indentMatch) continue;
    const indent = (indentMatch[1] ?? "").length;
    const node = indentMatch[3]?.trim() ?? "";
    if (node.length === 0) continue;

    const depth = Math.floor(indent / 4);
    // Strip the `(METHOD, METHOD)` suffix to get the path segment.
    const segMatch = node.match(/^(.+?)\s*(\([A-Z, ]+\))?\s*$/);
    const segment = segMatch?.[1]?.trim() ?? node;

    // Pop the stack to the current depth before pushing.
    while (stack.length > 0 && stack[stack.length - 1]?.depth >= depth) {
      stack.pop();
    }
    stack.push({ depth, segment });

    // Build the full path from the stack. The root node is `/`.
    const path = stack.map((s) => s.segment).join("");
    // A leaf is a node that declares at least one HTTP method (the
    // `(METHOD)` suffix). Internal directory nodes (e.g. `api/`) have
    // no method suffix and are skipped.
    if (node.match(/\([A-Z, ]+\)\s*$/)) {
      // Normalize: drop trailing slash and ensure leading slash.
      const normalized = path.replace(/\/+$/, "") || "/";
      const leading = normalized.startsWith("/") ? normalized : `/${normalized}`;
      routes.add(leading);
    }
  }

  return routes;
}

/**
 * Match a runtime path against the inventory. Direct equality first;
 * if that fails, try a prefix match (e.g. `/api/auth/*` covers every
 * `/api/auth/...` Better Auth route). Returns true if covered.
 */
function isCovered(runtimePath: string, inventory: Set<string>): boolean {
  if (inventory.has(runtimePath)) return true;
  // Prefix wildcards: `/api/auth/*` covers any /api/auth/foo.
  for (const inv of inventory) {
    if (inv.endsWith("/*")) {
      const prefix = inv.slice(0, -1); // keep trailing slash
      if (runtimePath.startsWith(prefix)) return true;
    }
    // Param matching: `/api/v1/keys/:id/revoke` covers
    // `/api/v1/keys/<uuid>/revoke` and vice versa. We normalize both
    // sides to a `:param` form for comparison.
    const invNormalized = inv.replace(/:[^/]+/g, ":param");
    const rtNormalized = runtimePath.replace(
      /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
      ":param",
    );
    if (invNormalized === rtNormalized) return true;
  }
  return false;
}

describe.skipIf(!REACHABLE)(
  "WIRE-29 enumeration sanity — every runtime /api/* route is in the negative-matrix inventory",
  () => {
    it("fetches the fastify printRoutes tree and asserts inventory coverage", async () => {
      const res = await fetch(`${BACKEND_URL}/api/_test/route-list`);
      // The route-list endpoint is gated by OPENWHISPR_TEST_ROUTES=true.
      // When the stack is the contract-test profile it MUST be enabled;
      // a 404 here indicates the operator's compose stack is mis-
      // configured and the enumeration sanity check cannot run.
      expect(
        res.status,
        "/api/_test/route-list must be registered in the contract-test stack (set OPENWHISPR_TEST_ROUTES=true)",
      ).toBe(200);
      const payload = (await res.json()) as { tree: string };
      const routes = parseRouteTree(payload.tree);

      // Build the inventory: PHASE_5_ROUTES paths + Phase 2-4 baseline.
      const inventory = new Set<string>(PHASE_2_4_BASELINE_ROUTES);
      for (const r of PHASE_5_ROUTES) {
        inventory.add(r.path);
      }

      // Filter runtime routes to the surfaces under test. We assert on
      // both `/api/*` (the public wire surface) AND `/v1/*` (LiteLLM
      // pass-through realtime + diarization, registered conditionally).
      const surfaceRoutes = [...routes].filter(
        (p) => p.startsWith("/api/") || p.startsWith("/v1/"),
      );

      const missing: string[] = [];
      for (const rt of surfaceRoutes) {
        if (!isCovered(rt, inventory)) {
          missing.push(rt);
        }
      }

      expect(
        missing,
        `missing route in negative matrix inventory (Pitfall #6): ${missing.join(", ")}\n` +
          `Add each path to PHASE_5_ROUTES (in packages/contract-tests/src/negative-matrix.ts) ` +
          `or PHASE_2_4_BASELINE_ROUTES so the envelope invariant is asserted.`,
      ).toEqual([]);
    });
  },
);
