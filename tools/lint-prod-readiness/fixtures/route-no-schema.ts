// SPDX-License-Identifier: FSL-1.1-ALv2
// Fixture for tools/lint-prod-readiness.test.ts.
// A Fastify `app.route` declaration whose options omit `schema:`.
// Expected finding: LOCKER-04-NO-SCHEMA.
import type { FastifyInstance } from "fastify";

export const register = (app: FastifyInstance): void => {
  app.route({
    method: "POST",
    url: "/api/things",
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });
};
