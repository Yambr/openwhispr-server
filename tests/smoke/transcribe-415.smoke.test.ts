// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 22 / Plan 22-01 / SR-22.1 — transcribe wrong-content-type smoke probe.
//
// Asserts: POST https://api.localhost/api/transcribe with `Content-Type:
// text/plain` returns 4xx AND the body matches the canonical flat
// `ErrorEnvelope` shape `{ error: string }` (D-34 / D-35 / BACKEND_SPEC.md,
// canonical schema at `packages/wire-schemas/src/error-envelope.ts`,
// re-exported via `@openwhispr/contract-tests/schemas` as
// `ErrorEnvelope = z.object({ error: z.string().min(1) }).strict()`).
// Wall-clock budget: < 500 ms.
//
// This probe is intentionally unauth'd — the 415 (or 400 / 401) MUST fire
// BEFORE we proceed past the wire-shape gate. If the stack accepts
// text/plain or returns a 5xx instead, the route handler has a regression.
//
// We assert the flat envelope inline (rather than importing the
// canonical zod schema) because `tests/smoke/` is not a pnpm workspace
// and has no `@openwhispr/*` resolution; the schema is byte-for-byte
// matched here so any future shape drift fails this probe AND the
// canonical CONTRACT-01 suite simultaneously.
import { Agent, fetch, setGlobalDispatcher } from "undici";
import { describe, expect, it } from "vitest";

const SMOKE_BASE_URL = process.env.SMOKE_BASE_URL ?? "https://api.localhost";

setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

describe("smoke: /api/transcribe 415 (Phase 22 / SR-22.1)", () => {
  it("rejects text/plain with 4xx + canonical flat ErrorEnvelope", { timeout: 5_000 }, async () => {
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
    // Canonical flat envelope per BACKEND_SPEC.md D-34/D-35:
    // `{ error: string }` — no nested `{ code, message }`, no extras.
    expect(body).toEqual({ error: expect.any(String) });
    expect((body as { error: string }).error.length).toBeGreaterThan(0);
  });
});
