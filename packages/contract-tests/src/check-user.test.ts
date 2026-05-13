// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 06 — POST /api/check-user contract test (WIRE-01).
//
// Asserts the response shape (CheckUserResponse from the shared schema
// module) for both branches (existing seeded user / new email) and the
// rate-limit envelope (D-28: 10/min/IP returns
// `{error:"Too many requests"}` exactly per Plan 04).
import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "./env.js";
import { fetchAndParse } from "./helpers/http.js";
import { CheckUserResponse, ErrorEnvelope } from "./schemas.js";

const REACHABLE = await probeBackend();

describe.skipIf(!REACHABLE)("POST /api/check-user", () => {
  it("returns { exists: false } for a brand-new email", async () => {
    const res = await fetchAndParse(`${BACKEND_URL}/api/check-user`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ email: `nonexistent-${Date.now()}@test.invalid` }),
    });
    expect(res.status).toBe(200);
    expect(CheckUserResponse.parse(res.body).exists).toBe(false);
  });

  it("returns { exists: true } for a seeded fixture email", async () => {
    const res = await fetchAndParse(`${BACKEND_URL}/api/check-user`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "fixture@conformance.test" }),
    });
    expect(res.status).toBe(200);
    expect(CheckUserResponse.parse(res.body).exists).toBe(true);
  });

  it("rate-limits 11th call within 60s (D-28: 10/min/IP)", async () => {
    const opts: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `rl-${Date.now()}@test.invalid` }),
    };
    let saw429: { status: number; body: unknown } | null = null;
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${BACKEND_URL}/api/check-user`, opts);
      if (res.status === 429) {
        saw429 = { status: res.status, body: await res.json() };
        break;
      }
    }
    expect(saw429).not.toBeNull();
    if (saw429) {
      // Plan 04 emits EXACTLY {error: "Too many requests"} — single key.
      ErrorEnvelope.parse(saw429.body);
      expect(saw429.body).toEqual({ error: "Too many requests" });
    }
  });
});
