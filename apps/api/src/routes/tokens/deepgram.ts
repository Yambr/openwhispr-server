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
import { parseTtlSeconds } from "./_parse-ttl.js";

/** Default token TTL in seconds when DEEPGRAM_TOKEN_TTL is not set. */
const DEFAULT_TTL_SECONDS = 30;

/**
 * Bundled-default Deepgram Grant Token endpoint. Stays a literal ONLY as
 * the fallback when no operator-owned `DEEPGRAM_TOKEN_URL` is injected
 * (test isolation / a deployment that never set the env var). Production
 * threads the operator value from `index.ts` (the env-reading boundary —
 * LOCKER-01) via the route factory's `tokenUrl` option — no `process.env`
 * read in this route file.
 */
const DEFAULT_TOKEN_URL = "https://api.deepgram.com/v1/auth/grant";

/**
 * Route factory options. `tokenUrl` is the operator-owned Deepgram Grant
 * Token endpoint URL; omitted in test isolation, where the route falls
 * back to `DEFAULT_TOKEN_URL`. Inlined (not an exported interface) so it
 * does not become a LOCKER-04 dead export.
 */
export const buildDeepgramTokenRoutes = (opts: { tokenUrl?: string } = {}) =>
  async function deepgramTokenRoutes(app: FastifyInstance): Promise<void> {
    const tokenUrl = opts.tokenUrl ?? DEFAULT_TOKEN_URL;
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
      handler: async (req, reply) => {
        const ttl = parseTtlSeconds(
          process.env.DEEPGRAM_TOKEN_TTL,
          DEFAULT_TTL_SECONDS,
          "DEEPGRAM_TOKEN_TTL",
          req.log,
        );
        const r = await callProvider({
          url: tokenUrl,
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
          // HI-03 (Phase 62): code+literal pair — the upstream failure
          // detail is logged server-side, NOT carried on `.message`.
          // CallProviderResult is a discriminated union on `status`:
          // the 503 arm carries `message`, the 400 arm `upstreamBody`.
          req.log.warn(
            {
              providerMessage: r.status === 503 ? r.message : r.upstreamBody,
            },
            "Deepgram token mint upstream failure",
          );
          throw new ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable");
        }

        // Wire-spec field rename: upstream Deepgram returns `access_token`;
        // BACKEND_SPEC pins our wire response to `{ token: <string> }` so
        // both AssemblyAI and Deepgram routes look identical to the
        // desktop client.
        const accessToken = (r.json as { access_token?: unknown }).access_token;
        if (typeof accessToken !== "string") {
          // HI-03 (Phase 62): code+literal pair for consistency.
          throw new ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable");
        }
        return reply.send({ token: accessToken });
      },
    });
  };

export default buildDeepgramTokenRoutes;
