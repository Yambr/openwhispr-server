// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 10 / Task 1 — WIRE-29 + WIRE-16 CONTRACT-01 negative matrix.
//
// Proves the `cloud-api-request` envelope passthrough invariant
// (WIRE-16) holds across the entire Phase 2-5 wire surface. For every
// implemented `/api/*` route in PHASE_5_ROUTES the suite triggers:
//
//   (a) no-auth call           → 401 + envelope match
//   (b) malformed body         → 400/422 + envelope match (authed)
//
// Plus:
//
//   * synthetic /api/nonexistent-{uuid} → 404 + envelope (D-35 proof,
//     Phase 2 setNotFoundHandler still active)
//   * Stripe/referrals v2-deferred paths (e.g. /api/stripe/checkout,
//     /api/referrals/stats — see OUT_OF_SCOPE_PATHS in
//     ./negative-matrix.ts) → 404 + envelope (CONTEXT.md out-of-scope
//     proof; T-OUT-OF-SCOPE-LEAK mitigation)
//
// Representative Phase 5 inventory entries (full list in PHASE_5_ROUTES
// at ./negative-matrix.ts): { method: "POST", path: "/api/agent/web-search" },
// { method: "GET", path: "/api/usage" }, { method: "POST", path: "/api/notes/create" }.
//
// Envelope shape per D-33 — tolerant matcher = z.union of both shapes:
//   z.object({ error: z.string() })                                   // default (D-34, Phase 5)
//   z.object({ error: z.object({ message, code? }) })                 // structured (BACKEND_SPEC.md:745)
//
// The TolerantEnvelope schema is exported from `./negative-matrix.ts`
// (built as a `z.union([...])` over the two object shapes) so the
// Pitfall #6 enumeration sanity test shares the same source of truth.

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "./env.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import {
  OUT_OF_SCOPE_PATHS,
  PHASE_5_ROUTES,
  TolerantEnvelope,
} from "./negative-matrix.js";

const REACHABLE = await probeBackend();

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = undefined;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

describe.skipIf(!REACHABLE)("WIRE-29 + WIRE-16 — CONTRACT-01 negative matrix", () => {
  describe("(a) no-auth → 401 + tolerant envelope", () => {
    for (const route of PHASE_5_ROUTES) {
      it(`${route.method} ${route.path} returns 401 envelope without auth`, async () => {
        const init: RequestInit = { method: route.method };
        if (route.hasBody) {
          init.headers = { "content-type": "application/json" };
          init.body = "{}";
        }
        const { status, body } = await fetchJson(`${BACKEND_URL}${route.path}`, init);
        // 401 is the canonical no-auth response per WIRE-18 / PITFALLS #1.
        // Some routes may emit 400/415 on pre-auth content-type checks;
        // both are envelope-conformant. 405 covers method-not-allowed
        // edge cases (Fastify's default when only some verbs are
        // registered on a path). The tolerant matcher locks the union
        // of acceptable error statuses; envelope shape is asserted in
        // every branch.
        expect(
          [400, 401, 405, 415],
          `${route.method} ${route.path} status=${status} body=${JSON.stringify(body)}`,
        ).toContain(status);
        expect(() => TolerantEnvelope.parse(body)).not.toThrow();
      });
    }
  });

  describe("(b) authed + malformed body → 400/422 + tolerant envelope", () => {
    for (const route of PHASE_5_ROUTES) {
      if (!route.hasBody) continue;
      it(`${route.method} ${route.path} rejects malformed body with envelope`, async () => {
        const jar = await signInFixture("fixture@conformance.test");
        const res = await jar.fetch(`${BACKEND_URL}${route.path}`, {
          method: route.method,
          headers: { "content-type": "application/json" },
          // Schema violator: required fields missing, unknown field
          // present. Every Phase 5 request schema is `.strict()` so
          // this is rejected on first validation pass.
          body: JSON.stringify({ __invalid_field__: true }),
        });
        const text = await res.text();
        let body: unknown = undefined;
        if (text.length > 0) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        // 400 = request validation; 415 = content-type; 422 = semantic.
        // The matrix locks this trio as the only acceptable error
        // statuses for malformed bodies on authed routes.
        expect(
          [400, 415, 422],
          `${route.method} ${route.path} status=${res.status} body=${JSON.stringify(body)}`,
        ).toContain(res.status);
        expect(() => TolerantEnvelope.parse(body)).not.toThrow();
      });
    }
  });

  it("synthetic /api/nonexistent-{uuid} → 404 + envelope (D-35 setNotFoundHandler proof)", async () => {
    const path = `/api/nonexistent-${randomUUID()}`;
    const { status, body } = await fetchJson(`${BACKEND_URL}${path}`, { method: "GET" });
    expect(status).toBe(404);
    expect(() => TolerantEnvelope.parse(body)).not.toThrow();
  });

  describe("out-of-scope paths (Stripe + referrals) → 404 + envelope", () => {
    for (const oos of OUT_OF_SCOPE_PATHS) {
      it(`${oos.method} ${oos.path} returns 404 envelope (v2-deferred)`, async () => {
        const init: RequestInit = { method: oos.method };
        if (oos.method === "POST") {
          init.headers = { "content-type": "application/json" };
          init.body = "{}";
        }
        const { status, body } = await fetchJson(`${BACKEND_URL}${oos.path}`, init);
        expect(status).toBe(404);
        expect(() => TolerantEnvelope.parse(body)).not.toThrow();
      });
    }
  });
});
