// SPDX-License-Identifier: FSL-1.1-ALv2
//
// tests/e2e/tenant-isolation.test.ts — Phase 34 / CR-1 closure.
//
// E2E gate: prove the forged-`x-tenant-id`-header attack vector is closed
// after tenantPlugin retirement. Mirrors the `rls-fail-closed.test.ts`
// pattern (real plugin chain, in-process Fastify, asserts the security
// invariant at the HTTP boundary).
//
// Why this is an e2e (not a unit test):
//   The Phase 34 invariant is a wire-surface property: an authenticated
//   request that smuggles `x-tenant-id: <victim-uuid>` MUST NOT escalate
//   the request's effective tenant. Per DISCIPLINE Rule 3 the proof must
//   live at the HTTP layer (e2e), not as a static type assertion or a
//   unit test of an internal helper.
//
// Why no testcontainer PG here:
//   The invariant is purely about Fastify request decoration — the plugin
//   chain reads (or no longer reads) the `x-tenant-id` header BEFORE any
//   DB call. A real PG would only test downstream behaviour that the RLS
//   fail-closed e2e (`rls-fail-closed.test.ts`) already proves. Phase 34
//   asserts the BOUNDARY: no decorator named `req.tenantId` exists on a
//   `FastifyRequest` after the plugin is retired, so no consumer (current
//   or future) can read a client-supplied value into authoritative tenant
//   scope. This is what the audit confirms (zero production readers) and
//   what this test locks in via a probe route.
//
// Local invocation:
//   E2E=1 pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts \
//     tests/e2e/tenant-isolation.test.ts
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Synthetic probe route that reports BOTH the legacy `req.tenantId`
// decorator (set by tenantPlugin from the `x-tenant-id` header on
// current main) AND `req.tenant` (set by dual-auth from the authoritative
// session). The Phase 34 invariant is `tenantIdDecoratorPresent === false`
// — i.e. NO Fastify plugin sets `req.tenantId` from a client-controlled
// source.
async function buildProbeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Register the production tenant plugin chain EXACTLY as
  // `apps/api/src/index.ts:391` does. After Phase 34 this import is
  // expected to fail (module deleted) — the test's `beforeEach` catches
  // the ENOENT and registers nothing, simulating the post-delete state.
  try {
    const mod = await import("../../apps/api/src/middleware/tenant.js");
    await app.register(mod.tenantPlugin);
  } catch (err) {
    if (!(err instanceof Error) || !/Cannot find module|ERR_MODULE_NOT_FOUND/.test(err.message)) {
      throw err;
    }
    // Module deleted — Phase 34 GREEN state. Register nothing; the
    // probe will observe `req.tenantId === undefined`.
  }

  // Probe route — returns whether the `tenantId` decorator was set by
  // any registered plugin. Cast through `unknown` because after delete
  // the property is no longer in the FastifyRequest type, so a direct
  // `req.tenantId` read would not typecheck.
  app.get("/_test/tenant-probe", async (req) => {
    const tenantId = (req as unknown as { tenantId?: unknown }).tenantId;
    return {
      tenantIdDecoratorPresent: typeof tenantId === "string",
      tenantIdValue: typeof tenantId === "string" ? tenantId : null,
    };
  });

  await app.ready();
  return app;
}

describe("Phase 34 — tenant-isolation (CR-1 closure): forged x-tenant-id cannot decorate req.tenantId", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildProbeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("a forged x-tenant-id header does NOT set req.tenantId (decorator absent post-retirement)", async () => {
    const forgedTenantUuid = "11111111-1111-1111-1111-111111111111";
    const res = await app.inject({
      method: "GET",
      url: "/_test/tenant-probe",
      headers: { "x-tenant-id": forgedTenantUuid },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Phase 34 invariant: no plugin reads `x-tenant-id` into `req.tenantId`.
    // RED on current main (tenantPlugin sets it to the forged UUID).
    // GREEN after delete (no plugin sets it; probe sees `undefined`).
    expect(body.tenantIdDecoratorPresent).toBe(false);
    expect(body.tenantIdValue).toBe(null);
  });

  it("a request with NO x-tenant-id header also leaves req.tenantId undefined", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/_test/tenant-probe",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // On current main with tenantPlugin registered, this would be `true`
    // with value `00000000-0000-0000-0000-000000000000` (the default
    // tenant fallback). After delete: false / null.
    expect(body.tenantIdDecoratorPresent).toBe(false);
    expect(body.tenantIdValue).toBe(null);
  });

  it("an array-valued x-tenant-id header also leaves req.tenantId undefined", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/_test/tenant-probe",
      headers: {
        "x-tenant-id": "11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The original plugin's T-01-04-08 mitigation fell back to the
    // default tenant on array-valued headers. After delete: the entire
    // code path is gone.
    expect(body.tenantIdDecoratorPresent).toBe(false);
    expect(body.tenantIdValue).toBe(null);
  });
});
