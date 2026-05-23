// SPDX-License-Identifier: FSL-1.1-ALv2
// Fixture for tools/lint-prod-readiness.test.ts.
// A fully-compliant Fastify `app.route` declaration: both `schema:` and
// `config: { rateLimit: ... }` are present, and the URL is non-health.
// Expected: no findings.
import type { FastifyInstance } from "fastify";
import { z } from "zod";

export const register = (app: FastifyInstance): void => {
  app.route({
    method: "POST",
    url: "/api/things",
    schema: { body: z.object({ name: z.string() }) },
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });
};
