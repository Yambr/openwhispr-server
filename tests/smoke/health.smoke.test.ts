// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 22 / Plan 22-01 / SR-22.1 — health smoke probe.
//
// Asserts: GET https://api.localhost/api/health → 200 + body.migrations_completed === true.
// Wall-clock budget: < 500 ms.
import { Agent, fetch, setGlobalDispatcher } from "undici";
import { describe, expect, it } from "vitest";

const SMOKE_BASE_URL = process.env.SMOKE_BASE_URL ?? "https://api.localhost";

// Self-signed mkcert dev certs are not in Node's CA bundle by default;
// allow them for *.localhost only.
setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

describe("smoke: /api/health (Phase 22 / SR-22.1)", () => {
  it("returns 200 with migrations_completed: true", { timeout: 5_000 }, async () => {
    const res = await fetch(`${SMOKE_BASE_URL}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { migrations_completed?: unknown };
    expect(body.migrations_completed).toBe(true);
  });
});
