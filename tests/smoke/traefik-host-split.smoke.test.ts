// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 22 / Plan 22-01 / SR-22.1 — Traefik host-split regression probe.
//
// Per Phase 15 STRUCT-05: api.localhost and web.localhost MUST be routed
// to different upstream services. If /api/health on web.localhost returns
// 200, the host-split is broken (the web host is leaking the api router).
//
// Wall-clock budget: < 500 ms.
import { Agent, fetch, setGlobalDispatcher } from "undici";
import { describe, expect, it } from "vitest";

const SMOKE_WEB_URL = process.env.SMOKE_WEB_URL ?? "https://web.localhost";

setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

describe("smoke: Traefik host-split (Phase 22 / SR-22.1)", () => {
  it("/api/health on web.localhost is NOT served by the api router", {
    timeout: 5_000,
  }, async () => {
    const res = await fetch(`${SMOKE_WEB_URL}/api/health`);
    // Any non-2xx is acceptable — 404 (web router has no /api/* rule), 405
    // (web served a route that disallows GET), or even 502/503 (the web
    // service can't reach a non-existent upstream). The regression we
    // guard against is a 200 with migrations_completed in the body, which
    // would mean the api router was incorrectly handling the web host.
    if (res.status === 200) {
      const body = await res.text();
      expect(body).not.toMatch(/migrations_completed/i);
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });
});
