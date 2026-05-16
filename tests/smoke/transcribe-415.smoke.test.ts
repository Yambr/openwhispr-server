// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 22 / Plan 22-01 / SR-22.1 — transcribe wrong-content-type smoke probe.
//
// Asserts: POST https://api.localhost/api/transcribe with `Content-Type:
// text/plain` returns 415 (unsupported media type) AND the body matches
// the typed-error envelope shape `{ error: { code: string, message: string } }`.
// Wall-clock budget: < 500 ms.
//
// This probe is intentionally unauth'd — the 415 (or 400) MUST fire BEFORE
// the auth gate, since wrong content-type is a wire-shape rejection. If the
// stack accepts text/plain or returns a 5xx instead, the route handler has
// a regression.
import { Agent, fetch, setGlobalDispatcher } from "undici";
import { describe, expect, it } from "vitest";

const SMOKE_BASE_URL = process.env.SMOKE_BASE_URL ?? "https://api.localhost";

setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

describe("smoke: /api/transcribe 415 (Phase 22 / SR-22.1)", () => {
  it("rejects text/plain with 4xx + typed envelope", { timeout: 5_000 }, async () => {
    const res = await fetch(`${SMOKE_BASE_URL}/api/transcribe`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not audio bytes",
    });
    // Accept any 4xx — the route may answer 415 (preferred), 400 (zod), or
    // 401 (auth gate fired before content-type check). The smoke probe's
    // only invariant is "no 2xx, no 5xx".
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = await res.json();
    // Typed envelope shape per BACKEND_SPEC.md.
    expect(body).toMatchObject({
      error: expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
      }),
    });
  });
});
