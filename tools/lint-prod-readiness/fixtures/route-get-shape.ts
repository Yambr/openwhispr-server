// Fixture for tools/lint-prod-readiness.test.ts.
// Verb-style `app.get(url, opts, handler)` shape with `rateLimit: false`
// on a NON-health URL. Health-class waiver does not apply.
// Expected finding: LOCKER-04-INVALID-RATELIMIT-FALSE.
import type { FastifyInstance } from "fastify";
import { z } from "zod";

export const register = (app: FastifyInstance): void => {
  app.get(
    "/api/things",
    {
      schema: { querystring: z.object({ q: z.string() }) },
      config: { rateLimit: false },
    },
    async () => ({ ok: true }),
  );
};
