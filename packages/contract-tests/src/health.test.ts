// Phase 2 / Plan 06 — GET /api/health contract test (WIRE-04).
//
// Desktop client polls /api/health with a 3s timeout and inspects only
// `res.ok`/`res.status` (the body is unread). We additionally enforce
// `{status: "ok"}` since Plan 03's HealthResponse is the documented
// shape — drift here would surface in any future operator dashboard.
import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "./env.js";
import { HealthResponse } from "./schemas.js";

const REACHABLE = await probeBackend();

describe.skipIf(!REACHABLE)("GET /api/health", () => {
  it("returns 200 with { status: 'ok' } within 3s budget", async () => {
    const start = Date.now();
    const res = await fetch(`${BACKEND_URL}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    expect(res.status).toBe(200);
    expect(Date.now() - start).toBeLessThan(3000);
    HealthResponse.parse(await res.json());
  });

  it("does not require auth (no Authorization header → 200)", async () => {
    const res = await fetch(`${BACKEND_URL}/api/health`);
    expect(res.status).toBe(200);
  });
});
