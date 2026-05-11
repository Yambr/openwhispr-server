// tests/e2e/phase-05-negative-matrix — host-side e2e for WIRE-29 + WIRE-16.
//
// Runs the same negative matrix as
// `packages/contract-tests/src/negative-matrix.test.ts` against the
// LIVE compose stack via Traefik HTTPS. The contract suite runs in
// the same process as the api container's docker network; this e2e
// suite exercises the full ingress hop (TLS termination, request
// log, dual-auth hook, error handler) so any envelope drift
// introduced by Traefik or downstream proxy hops surfaces here.
//
// One negative case per WIRE-* requirement covered in Phase 2-5 (per
// CLAUDE.md "every phase that touches a user-visible route MUST ship
// at least one e2e test"). Gated by `E2E=1` via vitest.e2e.config.ts.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL } from "./compose-helper.js";

const TolerantEnvelope = z.union([
  z.object({ error: z.string().min(1) }),
  z.object({
    error: z.object({
      message: z.string().min(1),
      code: z.string().optional(),
    }),
  }),
]);

interface FetchResult {
  status: number;
  body: unknown;
}

async function probe(method: string, path: string, body?: string): Promise<FetchResult> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = body;
  }
  const res = await fetch(`${BACKEND_URL}${path}`, init);
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

describe("e2e — Phase 05 negative matrix (envelope passthrough via Traefik TLS)", () => {
  // One representative negative case per WIRE-* requirement covered
  // in Phase 2-5. Each MUST surface a 4xx/5xx with a TolerantEnvelope-
  // conformant body. The shapes asserted here mirror the contract
  // suite's union (D-33).

  it("WIRE-09 — POST /api/streaming-usage without auth → 401 envelope", async () => {
    const res = await probe("POST", "/api/streaming-usage", "{}");
    expect([400, 401, 415]).toContain(res.status);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });

  it("WIRE-10 — GET /api/usage without auth → 401 envelope", async () => {
    const res = await probe("GET", "/api/usage");
    expect(res.status).toBe(401);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });

  it("WIRE-08 — POST /api/agent/web-search without auth → 401 envelope", async () => {
    const res = await probe("POST", "/api/agent/web-search", "{}");
    expect([400, 401, 415]).toContain(res.status);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });

  it("WIRE-11 — GET /api/stt-config without auth → 401 envelope", async () => {
    const res = await probe("GET", "/api/stt-config");
    expect(res.status).toBe(401);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });

  it("WIRE-12 — GET /api/note-recording-config without auth → 401 envelope", async () => {
    const res = await probe("GET", "/api/note-recording-config");
    expect(res.status).toBe(401);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });

  it("WIRE-22 — POST /api/notes/create without auth → 401 envelope", async () => {
    const res = await probe("POST", "/api/notes/create", "{}");
    expect([400, 401, 415]).toContain(res.status);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });

  it("WIRE-23 — POST /api/folders/create without auth → 401 envelope", async () => {
    const res = await probe("POST", "/api/folders/create", "{}");
    expect([400, 401, 415]).toContain(res.status);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });

  it("WIRE-24 — POST /api/conversations/create without auth → 401 envelope", async () => {
    const res = await probe("POST", "/api/conversations/create", "{}");
    expect([400, 401, 415]).toContain(res.status);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });

  it("WIRE-25 — GET /api/conversations/messages without auth → 401 envelope", async () => {
    const res = await probe("GET", "/api/conversations/messages");
    expect(res.status).toBe(401);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });

  it("WIRE-26 — POST /api/transcriptions/create without auth → 401 envelope", async () => {
    const res = await probe("POST", "/api/transcriptions/create", "{}");
    expect([400, 401, 415]).toContain(res.status);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });

  it("WIRE-27 — GET /api/v1/keys/list without auth → 401 envelope", async () => {
    const res = await probe("GET", "/api/v1/keys/list");
    expect(res.status).toBe(401);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });

  it("WIRE-16 + D-35 — synthetic /api/nonexistent-* → 404 envelope", async () => {
    const res = await probe(
      "GET",
      `/api/nonexistent-${crypto.randomUUID()}-e2e`,
    );
    expect(res.status).toBe(404);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });

  it("WIRE-29 — out-of-scope Stripe path → 404 envelope (v2-deferred)", async () => {
    const res = await probe("POST", "/api/stripe/checkout", "{}");
    expect(res.status).toBe(404);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });

  it("WIRE-29 — out-of-scope referrals path → 404 envelope (v2-deferred)", async () => {
    const res = await probe("GET", "/api/referrals/stats");
    expect(res.status).toBe(404);
    expect(() => TolerantEnvelope.parse(res.body)).not.toThrow();
  });
});
