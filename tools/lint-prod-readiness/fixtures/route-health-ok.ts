// Fixture for tools/lint-prod-readiness.test.ts.
// A Fastify `app.route` for a /api/health URL — `rateLimit: false` is
// permitted only on health-probe URLs, and `schema:` is also waived.
// Expected: no findings.
import type { FastifyInstance } from "fastify";

export const register = (app: FastifyInstance): void => {
  app.route({
    method: "GET",
    url: "/api/health",
    config: { rateLimit: false },
    handler: async () => ({ ok: true }),
  });
};
