// SPDX-License-Identifier: FSL-1.1-ALv2
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
//     Phase 18.1 V2-SEC-01 hardening: the route also carries
//     `config.authRequired: true` so the IP-tier `onRequest` hook in
//     rate-limit.ts early-returns on anonymous traffic, preventing
//     `owrl:ip:*` bucket creation on pre-auth 401s (anonymous DoS
//     vector closure — paired with T3 in rate-limit-isolation.integration).
//
// Factory pattern matches Phase 2 conventions (see e.g. transcribe.ts):
// the build* function takes its deps and returns a Fastify plugin so
// buildApp can register it after rate-limit is wired.

import type { FastifyInstance } from "fastify";
import { ServiceUnavailable } from "../../errors.js";
import { callProvider } from "./_call-provider.js";
import { parseTtlSeconds } from "./_parse-ttl.js";

/** Default token TTL in seconds when ASSEMBLYAI_TOKEN_TTL is not set. */
const DEFAULT_TTL_SECONDS = 60;

/**
 * Bundled-default AssemblyAI v3 streaming-token endpoint. Stays a literal
 * ONLY as the fallback when no operator-owned `ASSEMBLYAI_TOKEN_URL` is
 * injected (test isolation / a deployment that never set the env var).
 * Production threads the operator value from `index.ts` (the env-reading
 * boundary — LOCKER-01) via the route factory's `tokenUrl` option — no
 * `process.env` read in this route file. The dynamic `expires_in_seconds`
 * query param is appended by the handler regardless of the base URL.
 */
const DEFAULT_TOKEN_URL = "https://streaming.assemblyai.com/v3/token";

/**
 * Route factory options. `tokenUrl` is the operator-owned AssemblyAI
 * token endpoint base URL; omitted in test isolation, where the route
 * falls back to `DEFAULT_TOKEN_URL`. Inlined (not an exported interface)
 * so it does not become a LOCKER-04 dead export.
 */
export const buildAssemblyAITokenRoutes = (opts: { tokenUrl?: string } = {}) =>
  async function assemblyAITokenRoutes(app: FastifyInstance): Promise<void> {
    const tokenUrl = opts.tokenUrl ?? DEFAULT_TOKEN_URL;
    app.route({
      method: "POST",
      url: "/api/streaming-token",
      config: {
        // Phase 18.1 / Plan 02 (V2-SEC-01) — `authRequired: true` opts
        // this authed-only route out of the IP-tier `onRequest` hook in
        // rate-limit.ts so anonymous traffic 401s without populating
        // `owrl:ip:*` buckets. dualAuthHook still gates the request; this
        // tag does NOT replace auth, it only narrows the IP-tier carve-
        // out per the layered model (D-06..D-08).
        authRequired: true,
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
      handler: async (req, reply) => {
        // Plan 51-12tx2 (HI-6) — refuse to send NaN to upstream when
        // ASSEMBLYAI_TOKEN_TTL is set to a non-numeric value. The
        // helper falls back to DEFAULT_TTL_SECONDS and warn-logs the
        // misconfiguration via req.log so operators see it in Loki
        // instead of debugging a misleading 503.
        const ttl = parseTtlSeconds(
          process.env.ASSEMBLYAI_TOKEN_TTL,
          DEFAULT_TTL_SECONDS,
          "ASSEMBLYAI_TOKEN_TTL",
          req.log,
        );
        const r = await callProvider({
          url: `${tokenUrl}?expires_in_seconds=${ttl}`,
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
          // HI-03 (Phase 62): code+literal pair — the upstream failure
          // detail is logged server-side, NOT carried on `.message`. The
          // error handler emits the class-default literal.
          // CallProviderResult is a discriminated union on `status`:
          // the 503 arm carries `message`, the 400 arm `upstreamBody`.
          req.log.warn(
            {
              providerMessage: r.status === 503 ? r.message : r.upstreamBody,
            },
            "AssemblyAI token mint upstream failure",
          );
          throw new ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable");
        }

        const token = (r.json as { token?: unknown }).token;
        if (typeof token !== "string") {
          // HI-03 (Phase 62): code+literal pair for consistency.
          throw new ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable");
        }
        return reply.send({ token });
      },
    });
  };

export default buildAssemblyAITokenRoutes;
