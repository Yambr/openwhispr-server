// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 1 Plan 04 / D-19 — Fastify `tenantPlugin` exposes `req.tenantId`.
//
// Phase 1 reads the tenant id from the `x-tenant-id` request header. This
// is a deliberate Phase-1-only stop-gap: it lets every downstream handler
// `withTenant(req.tenantId, ...)` without yet depending on Better Auth /
// session resolution. Phase 2 replaces the header read with a
// bearer-token -> sessions.tenant_id lookup; the rest of the surface
// (the `req.tenantId` field on FastifyRequest, the `withTenant` wiring)
// stays put.
//
// Phase 2 / Plan 03 status (WIRE-Q1 resolution):
//   The dual-auth and cookie-only hooks (`./dual-auth.ts`,
//   `./require-cookie-only.ts`) set `req.tenant` (note: `tenant`, NOT
//   `tenantId`) from the resolved session. Authenticated route handlers
//   call `withTenant(db, req.tenant, async (tx) => {...})` directly so
//   the GUC binding lives inside the same DB transaction as the actual
//   query — sidestepping any Fastify preHandler-vs-handler scope
//   ambiguity. This file's `req.tenantId` header-read survives for
//   pre-auth routes (e.g. `/api/check-user`, `/api/health`) and the
//   Phase 1 unit tests; auth'd routes use `req.tenant`.
//
// Threat note (T-01-04-08): trusting a header is acceptable ONLY because
// Phase 2 will replace it. The unit test `tenant.test.ts` proves that an
// array-valued `x-tenant-id` (which Fastify 5 / Node http normalize into
// a comma-joined string for repeated headers — a known header-injection
// bypass shape) falls back to the default tenant rather than honoring
// either value. We enforce that by requiring the header to match a strict
// UUID regex; comma-joined "uuid1,uuid2" fails the regex and falls back.
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string;
  }
}

/**
 * Stable UUID for the seeded `default` tenant row (D-17). Used as the
 * fallback when no x-tenant-id header is present or when its value isn't
 * a single string.
 */
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

const TENANT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Internal plugin body. Wrapped by `fp(...)` below so the `onRequest`
 * hook applies to the parent context's routes — without `fastify-plugin`
 * the hook would be confined to the plugin's encapsulated child scope
 * and routes registered at the app level would never see `req.tenantId`.
 */
async function tenantPluginInner(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req: FastifyRequest) => {
    const headerVal = req.headers["x-tenant-id"];
    // Header must be a single string AND match the canonical UUID
    // shape. Repeated headers (Fastify 5 / Node http normalize them
    // into a comma-joined string "uuid1,uuid2") fail the regex and
    // fall back to the default tenant — closing the array-injection
    // bypass shape (T-01-04-08).
    req.tenantId =
      typeof headerVal === "string" && TENANT_UUID_RE.test(headerVal)
        ? headerVal
        : DEFAULT_TENANT_ID;
  });
}

export const tenantPlugin = fp(tenantPluginInner, {
  name: "tenant-plugin",
  fastify: "5.x",
});
