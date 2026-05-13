// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 06 — GET /api/auth/verification-status contract test
// (WIRE-02). Cookie-only endpoint — bearer must NOT bypass.
//
// Polling carve-out (D-28): the verification-status path is exempt from
// the standard 60-req/min limiter and instead has its own cap (~30/min
// per (ip,email)) — Plan 04 wires that. We poll past 30 and assert 429.
import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "./env.js";
import { fetchAndParse } from "./helpers/http.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import { ErrorEnvelope, VerificationStatusResponse } from "./schemas.js";

const REACHABLE = await probeBackend();

describe.skipIf(!REACHABLE)("GET /api/auth/verification-status", () => {
  it("cookie + verified email → { verified: true }", async () => {
    const jf = await signInFixture("verified@conformance.test");
    const res = await jf.fetch(
      `${BACKEND_URL}/api/auth/verification-status?email=verified%40conformance.test`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(VerificationStatusResponse.parse(body).verified).toBe(true);
  });

  it("cookie + unverified → { verified: false }", async () => {
    const jf = await signInFixture("pending@conformance.test", { verified: false });
    const res = await jf.fetch(
      `${BACKEND_URL}/api/auth/verification-status?email=pending%40conformance.test`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(VerificationStatusResponse.parse(body).verified).toBe(false);
  });

  it("no cookie → 401 (not 200)", async () => {
    const res = await fetchAndParse(
      `${BACKEND_URL}/api/auth/verification-status?email=anyone%40test.invalid`,
    );
    expect(res.status).toBe(401);
    ErrorEnvelope.parse(res.body);
  });

  it("polling carve-out: 31st in 60s for (ip,email) → 429 (D-28)", async () => {
    const jf = await signInFixture("poll@conformance.test");
    const url = `${BACKEND_URL}/api/auth/verification-status?email=poll%40conformance.test`;
    let saw429 = false;
    for (let i = 0; i < 35; i++) {
      const res = await jf.fetch(url);
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});
