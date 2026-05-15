// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 03 / Task 3 — POST /api/deepgram-streaming-token.
//
// Source of truth: 04-RESEARCH.md §2.5 (Deepgram block lines 505–524)
// + 04-CONTEXT.md D-15 (provider URL/auth shape) + D-18/D-19/D-20.
//
// Wire shape mirrors AssemblyAI route. Differences from assemblyai.ts:
//   * URL: https://api.deepgram.com/v1/auth/grant
//   * Method: POST (not GET) with JSON body { ttl_seconds: <number> }
//   * Authorization: "Token <key>" (NOT "Bearer", NOT bare-key per D-15)
//   * Response field rename: upstream `access_token` → wire `token`
//
// Same threat mitigations as assemblyai.ts (T-04-01 + T-04-04). The
// rate-limit + dual-auth ordering and missing-key 503 envelope follow
// identical patterns so a single audit covers both routes.

import type { FastifyInstance } from "fastify";
import { ServiceUnavailable } from "../../errors.js";
import { callProvider } from "./_call-provider.js";

/** Default token TTL in seconds when DEEPGRAM_TOKEN_TTL is not set. */
const DEFAULT_TTL_SECONDS = 30;

export const buildDeepgramTokenRoutes = () =>
  async function deepgramTokenRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/deepgram-streaming-token",
      config: {
        // Phase 18.1 / Plan 02 (V2-SEC-01) — authed-only route; skip
        // IP-tier hook on anon traffic to avoid `owrl:ip:*` pre-auth
        // bucket creation. See rate-limit.ts onRequest hook + 18.1-02
        // (D-06..D-08).
        authRequired: true,
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (req) => req.user?.id ?? req.ip,
        },
      },
      preHandler: async (_req, reply) => {
        if (!process.env.DEEPGRAM_API_KEY) {
          return reply.code(503).send({
            error: "Deepgram not configured (set DEEPGRAM_API_KEY in .env)",
          });
        }
      },
      handler: async (_req, reply) => {
        const ttl = Number(process.env.DEEPGRAM_TOKEN_TTL ?? DEFAULT_TTL_SECONDS);
        const r = await callProvider({
          url: "https://api.deepgram.com/v1/auth/grant",
          method: "POST",
          // D-15: Deepgram Grant Token uses the "Token <key>" auth scheme.
          // NOT "Bearer", NOT bare key. Pinned by deepgram.test.ts header
          // capture assertion.
          headers: {
            authorization: `Token ${process.env.DEEPGRAM_API_KEY as string}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ttl_seconds: ttl }),
          envVarName: "DEEPGRAM_API_KEY",
          providerLabel: "Deepgram",
        });

        if (!r.ok) {
          throw new ServiceUnavailable(r.message);
        }

        // Wire-spec field rename: upstream Deepgram returns `access_token`;
        // BACKEND_SPEC pins our wire response to `{ token: <string> }` so
        // both AssemblyAI and Deepgram routes look identical to the
        // desktop client.
        const accessToken = (r.json as { access_token?: unknown }).access_token;
        if (typeof accessToken !== "string") {
          throw new ServiceUnavailable("Deepgram token mint malformed response");
        }
        return reply.send({ token: accessToken });
      },
    });
  };

export default buildDeepgramTokenRoutes;
