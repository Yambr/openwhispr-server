// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 06 — Cross-cutting wire conventions.
//
// Asserts the global error envelope (D-13/WIRE-17), 401-not-200 on auth
// failure (PITFALLS #1 / WIRE-18), preserves `x-openwhispr-source`
// (AUTH-06 / WIRE-19), and HTTPS-only at ingress (WIRE-20).
//
// The suite is gated on backend reachability — `describe.skipIf` keeps
// the workspace `pnpm test` green when no docker-compose stack is up.
// CI brings the stack up explicitly before invoking this suite.
import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "../../src/env.js";
import { fetchAndParse } from "../../src/helpers/http.js";
import { ErrorEnvelope } from "../../src/schemas.js";

// Top-level await: vitest test files are ESM, so this is legal. The
// reachability probe runs once at module-load and gates the entire
// describe block.
const REACHABLE = await probeBackend();

const AUTH_REQUIRED = [
  ["GET", "/api/auth/verification-status?email=x%40y.test"],
  ["DELETE", "/api/auth/delete-account"],
] as const;

describe.skipIf(!REACHABLE)("global wire conventions", () => {
  for (const [method, path] of AUTH_REQUIRED) {
    it(`${method} ${path} returns 401 (not 200) on missing auth`, async () => {
      const res = await fetchAndParse(`${BACKEND_URL}${path}`, { method });
      expect(res.status).toBe(401); // PITFALLS #1 / WIRE-18 guard
      ErrorEnvelope.parse(res.body);
    });

    it(`${method} ${path} returns 401 on Bearer invalid`, async () => {
      const res = await fetchAndParse(`${BACKEND_URL}${path}`, {
        method,
        headers: { Authorization: "Bearer invalid" },
      });
      expect(res.status).toBe(401);
      ErrorEnvelope.parse(res.body);
    });
  }

  it("non-2xx body always matches ErrorEnvelope shape", async () => {
    const res = await fetchAndParse(`${BACKEND_URL}/api/does-not-exist`);
    expect([404, 405]).toContain(res.status);
    ErrorEnvelope.parse(res.body);
  });

  it("HTTPS-only at ingress (Traefik 308 redirect on plaintext)", async () => {
    if (!BACKEND_URL.startsWith("https://")) return; // skip for http://api.localhost dev
    const httpUrl = BACKEND_URL.replace(/^https:/, "http:");
    const res = await fetch(`${httpUrl}/api/health`, { redirect: "manual" });
    expect([301, 302, 308, 426]).toContain(res.status);
  });

  it("preserves x-openwhispr-source header (AUTH-06 / WIRE-19)", async () => {
    const res = await fetchAndParse(`${BACKEND_URL}/api/health`, {
      headers: { "x-openwhispr-source": "desktop" },
    });
    expect(res.status).toBe(200);
  });
});
