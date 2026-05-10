// Phase 04 / Plan 03 / Task 2 — POST /api/streaming-token (AssemblyAI v3).
//
// Source of truth: 04-RESEARCH.md §2.5 (AssemblyAI block lines 488–503)
// + 04-CONTEXT.md D-14 (provider URL/auth shape) + D-18 (missing-key
// 503 wording) + D-19 (per-user 30/min rate limit) + D-20 (provider
// timeouts).
//
// Wire shape:
//   * Request:  POST /api/streaming-token (empty body; auth via dual-auth)
//   * Success:  200 { token: <ephemeral string> }
//   * Missing key:  503 { error: "AssemblyAI not configured (set ASSEMBLYAI_API_KEY in .env)" }
//   * Provider 4xx auth: 503 same not-configured envelope (key may be wrong)
//   * Provider 5xx/429: 503 { error: "AssemblyAI token mint upstream error" }
//   * Provider timeout: 503 { error: "AssemblyAI token mint timed out" }
//   * Malformed body:   503 { error: "AssemblyAI token mint malformed response" }
//   * Rate-limit:       429 (canonical envelope from rate-limit plugin)
//
// Threat mitigations:
//   * T-04-01 (key leakage): missing-key gating + 30/min/user rate-limit +
//     5s upstream timeout. Master key never appears in any response body —
//     only the ephemeral mint surfaces.
//   * T-04-04 (cross-user rate-limit bypass): keyGenerator reads
//     req.user.id (populated by dualAuthHook BEFORE rate-limit fires);
//     unauthenticated requests 401 before the bucket is consumed.
//
// Factory pattern matches Phase 2 conventions (see e.g. transcribe.ts):
// the build* function takes its deps and returns a Fastify plugin so
// buildApp can register it after rate-limit is wired.

import type { FastifyInstance } from "fastify";
import { ServiceUnavailable } from "../../errors.js";
import { callProvider } from "./_call-provider.js";

/** Default token TTL in seconds when ASSEMBLYAI_TOKEN_TTL is not set. */
const DEFAULT_TTL_SECONDS = 60;

export const buildAssemblyAITokenRoutes = () =>
  async function assemblyAITokenRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/streaming-token",
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          // D-19 + T-04-04: per-user bucket. dualAuthHook populates
          // req.user.id before rate-limit fires, so the bucket is keyed on
          // the authenticated session — leaked-bearer abuse is bounded
          // per-user, not per-source-ip. Falls back to req.ip purely as
          // defense-in-depth in case auth ordering ever regresses.
          keyGenerator: (req) => req.user?.id ?? req.ip,
        },
      },
      preHandler: async (_req, reply) => {
        // D-18 missing-key gate. Done in preHandler (NOT inside the
        // handler) so the AbortController in callProvider is never armed
        // when the operator hasn't configured the provider — saves an
        // unnecessary fetch attempt.
        if (!process.env.ASSEMBLYAI_API_KEY) {
          return reply.code(503).send({
            error: "AssemblyAI not configured (set ASSEMBLYAI_API_KEY in .env)",
          });
        }
      },
      handler: async (_req, reply) => {
        const ttl = Number(process.env.ASSEMBLYAI_TOKEN_TTL ?? DEFAULT_TTL_SECONDS);
        const r = await callProvider({
          url: `https://streaming.assemblyai.com/v3/token?expires_in_seconds=${ttl}`,
          method: "GET",
          // D-14: AssemblyAI v3 uses the bare API key as the Authorization
          // header value — NO "Bearer " prefix. This is intentional per
          // the AssemblyAI v3 streaming docs and is verified by the
          // assemblyai.test.ts upstream-401 mapping test.
          headers: { authorization: process.env.ASSEMBLYAI_API_KEY as string },
          envVarName: "ASSEMBLYAI_API_KEY",
          providerLabel: "AssemblyAI",
        });

        if (!r.ok) {
          // Throw ServiceUnavailable so the centralized setErrorHandler
          // emits the canonical envelope with r.message verbatim.
          throw new ServiceUnavailable(r.message);
        }

        const token = (r.json as { token?: unknown }).token;
        if (typeof token !== "string") {
          throw new ServiceUnavailable("AssemblyAI token mint malformed response");
        }
        return reply.send({ token });
      },
    });
  };

export default buildAssemblyAITokenRoutes;
