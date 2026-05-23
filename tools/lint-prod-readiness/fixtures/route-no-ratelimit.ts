// SPDX-License-Identifier: FSL-1.1-ALv2
// Fixture for tools/lint-prod-readiness.test.ts.
// A Fastify `app.route` declaration with `schema:` but no `config.rateLimit`.
// Expected finding: LOCKER-04-NO-RATELIMIT.
import type { FastifyInstance } from "fastify";
import { z } from "zod";

export const register = (app: FastifyInstance): void => {
  app.route({
    method: "POST",
    url: "/api/things",
    schema: { body: z.object({ name: z.string() }) },
    handler: async () => ({ ok: true }),
  });
};
