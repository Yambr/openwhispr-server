// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 22 / Plan 22-01 / SR-22.1 — web shell smoke probe.
//
// Asserts: GET https://web.localhost/ → 200 + body contains "<html"
// substring. Proves Next.js is reachable through Traefik on the web
// host. Wall-clock budget: < 500 ms.
import { Agent, fetch, setGlobalDispatcher } from "undici";
import { describe, expect, it } from "vitest";

const SMOKE_WEB_URL = process.env.SMOKE_WEB_URL ?? "https://web.localhost";

setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

describe("smoke: web root (Phase 22 / SR-22.1)", () => {
  it("returns 200 and HTML body shell", { timeout: 5_000 }, async () => {
    const res = await fetch(`${SMOKE_WEB_URL}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.toLowerCase()).toMatch(/<html/);
  });
});
