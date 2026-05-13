// SPDX-License-Identifier: Apache-2.0
// Unit tests for the Fastify tenantPlugin — Phase 1 Plan 04 / D-19.
//
// The plugin registers an `onRequest` hook that reads `x-tenant-id` from
// the request headers and exposes it on `req.tenantId`. Phase 1 trusts
// the header (test fixture only); Phase 2 replaces this with a bearer-
// token -> sessions.tenant_id resolution. The default-tenant UUID
// (`00000000-0000-0000-0000-000000000000`) is the seeded D-17 row.
//
// We use Fastify's `app.inject()` rather than spinning up an HTTP listener
// — it routes a synthetic request through the full plugin lifecycle, which
// is exactly what the hook depends on.
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tenantPlugin } from "./tenant.js";

const DEFAULT_TENANT = "00000000-0000-0000-0000-000000000000";
const SAMPLE = "11111111-1111-1111-1111-111111111111";

describe("tenantPlugin — Phase 1 Plan 04", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(tenantPlugin);
    // Echo route so we can read req.tenantId out of the response body.
    app.get("/__tenant", async (req) => ({ tenantId: req.tenantId }));
  });

  afterEach(async () => {
    await app.close();
  });

  it("falls back to the default tenant UUID when x-tenant-id is missing", async () => {
    const res = await app.inject({ method: "GET", url: "/__tenant" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tenantId: DEFAULT_TENANT });
  });

  it("uses the x-tenant-id header verbatim when it is a single string", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/__tenant",
      headers: { "x-tenant-id": SAMPLE },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tenantId: SAMPLE });
  });

  it("falls back to the default tenant UUID when x-tenant-id is provided as an array (Fastify multi-header)", async () => {
    // Fastify exposes repeated headers as `string[]`. Phase 1 treats
    // any non-string value as missing and falls back to default
    // (typeof !== 'string' branch). This is a deliberate guard against
    // header-injection bypasses where an attacker sends two values
    // hoping one is honored.
    const res = await app.inject({
      method: "GET",
      url: "/__tenant",
      headers: { "x-tenant-id": [SAMPLE, "22222222-2222-2222-2222-222222222222"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tenantId: DEFAULT_TENANT });
  });
});
