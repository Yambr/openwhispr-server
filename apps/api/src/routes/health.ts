// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 03 / Task 3 — `GET /api/health` (BACKEND_SPEC.md).
//
// Pre-auth: `config.auth=false` opts the route out of the dual-auth
// hook. Rate-limit-exempt: `config.rateLimit=false` keeps health probes
// from contributing to the per-IP budget (Plan 04 wires the limiter).
//
// Response shape pinned to `HealthResponse` from
// `@openwhispr/contract-tests/schemas` — Plan 06 conformance imports
// the SAME schema and asserts byte-for-byte equality against a real
// deployed backend.
import type { FastifyInstance } from "fastify";
import { HealthResponse } from "@openwhispr/contract-tests/schemas";

export const healthRoutes = async (app: FastifyInstance): Promise<void> => {
  app.route({
    method: "GET",
    url: "/api/health",
    config: { auth: false, rateLimit: false },
    schema: { response: { 200: HealthResponse } },
    handler: async () => ({ status: "ok" as const }),
  });
};

export default healthRoutes;
