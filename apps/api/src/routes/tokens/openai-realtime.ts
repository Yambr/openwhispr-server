// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 04 / Task 1 — POST /api/openai-realtime-token.
//
// Source of truth: 04-RESEARCH.md §2.5 (OpenAI Realtime block lines 526–554)
// + 04-CONTEXT.md D-16 (provider URL/auth + Bearer prefix), D-17 (streams=2
// parallel-mint via Promise.all), D-18 (missing-key 503), D-19 (per-user
// 30/min rate-limit), D-20 (provider timeouts).
//
// Wire shape (BACKEND_SPEC byte-for-byte; matches desktop assertions):
//   * Request:  POST /api/openai-realtime-token  body: {streams?: 1|2, model?: string}
//   * Success:  200 {clientSecret: string, clientSecrets: string[]}
//                 — clientSecret = clientSecrets[0]; clientSecrets length === streams
//                   (always populated even for streams=1, for shape consistency)
//   * Bad streams: 400 {error: "streams must be 1 or 2"}
//   * Missing key: 503 {error: "OpenAI Realtime not configured (set OPENAI_API_KEY in .env)"}
//   * Provider 4xx auth: 503 {error: "OpenAI Realtime not configured (set OPENAI_API_KEY in .env)"}
//   * Provider 5xx/429:  503 {error: "OpenAI Realtime token mint upstream error"}
//   * Provider timeout:  503 {error: "OpenAI Realtime token mint timed out"}
//   * Malformed body:    503 {error: "OpenAI Realtime token mint malformed response"}
//   * Rate-limit:        429 (canonical envelope from rate-limit plugin)
//
// Threat mitigations:
//   * T-04-01 (key leakage): missing-key gating + 30/min/user rate-limit +
//     5s upstream timeout via callProvider. PARTIAL-SUCCESS LEAKAGE: on
//     fail-fast (one of two parallel mints fails) the first successful
//     secret is NEVER written to the wire response — the 503 fires before
//     any body construction. Asserted by the streams=2 fail-fast test.
//   * T-04-04 (cross-user rate-limit bypass): keyGenerator reads
//     req.user.id (populated by dualAuthHook BEFORE rate-limit fires);
//     unauthenticated requests 401 before the bucket is consumed.
//   * T-04-INPUT (streams tampering): explicit allowlist {1,2}; values
//     outside the set return 400 with a structured envelope. Prevents
//     integer-overflow / negative / array attacks expanding the parallel
//     fan-out beyond the intended 2.

import { OpenAIRealtimeTokenRequest } from "@openwhispr/wire-schemas";
import type { FastifyInstance } from "fastify";
import { ServiceUnavailable } from "../../errors.js";
import { callProvider } from "./_call-provider.js";

const DEFAULT_MODEL = "gpt-realtime";
const PROVIDER_LABEL = "OpenAI Realtime";
const ENV_VAR_NAME = "OPENAI_API_KEY";
const UPSTREAM_URL = "https://api.openai.com/v1/realtime/client_secrets";

export const buildOpenAIRealtimeTokenRoutes = () =>
  async function openAIRealtimeTokenRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/openai-realtime-token",
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
        // D-18 missing-key gate. Done in preHandler so neither AbortController
        // nor Promise.all is armed when the operator hasn't configured
        // OPENAI_API_KEY. Note: OPENAI_API_KEY is shared with Phase 3 D-12
        // (realtime WSS proxy); this plan does NOT modify .env.example.
        if (!process.env.OPENAI_API_KEY) {
          return reply.code(503).send({
            error: `${PROVIDER_LABEL} not configured (set ${ENV_VAR_NAME} in .env)`,
          });
        }
      },
      handler: async (req, reply) => {
        // Phase 51 / Plan 51-08 (REVIEW CR-2) — strict zod validation.
        // The pre-fix code used a bare `(req.body ?? {}) as RequestBody`
        // cast, which let multi-MB `model` strings and arbitrary extra
        // keys flow through to an outbound POST to the paid OpenAI
        // realtime token endpoint — authed-user amplification primitive.
        //
        // We safeParse inside the handler (not via `schema:`) because
        // the test harnesses for this route surface do not install the
        // zod-type-provider; safeParse keeps the route portable while
        // still enforcing the contract. The 400 envelope mirrors the
        // pre-fix `streams ∈ {1,2}` rejection so the desktop client
        // observes the same status-code contract.
        const parsed = OpenAIRealtimeTokenRequest.safeParse(req.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({
            error: {
              code: "INVALID_BODY",
              message: parsed.error.message,
              requestId: req.id,
            },
          });
        }
        const streams = parsed.data.streams ?? 1;
        const model = parsed.data.model ?? DEFAULT_MODEL;

        const mintOne = () =>
          callProvider({
            url: UPSTREAM_URL,
            method: "POST",
            // D-16: Bearer prefix is REQUIRED for OpenAI (unlike AssemblyAI's
            // bare-key or Deepgram's "Token <key>"). Pinned by tests.
            headers: {
              authorization: `Bearer ${process.env.OPENAI_API_KEY as string}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ session: { type: "realtime", model } }),
            envVarName: ENV_VAR_NAME,
            providerLabel: PROVIDER_LABEL,
          });

        // D-17: Promise.all is fail-fast (NOT Promise.allSettled). Per
        // RESEARCH.md lines 545-547 partial-success leakage is worse than
        // a clean 503 — desktop reconnects cleanly on 503, but a partial
        // {clientSecret: <leaked>, clientSecrets: [<leaked>, undefined]}
        // would burn the leaked secret AND confuse the client.
        const calls = Array.from({ length: streams }, mintOne);
        const results = await Promise.all(calls);

        // T-04-01 mitigation site: scan for ANY failure and 503 BEFORE
        // touching results.map. The first successful secret is never
        // serialized when any sibling failed.
        const failed = results.find((r) => !r.ok);
        if (failed && !failed.ok) {
          throw new ServiceUnavailable(failed.message);
        }

        // After the find() above, every entry is { ok: true, json }.
        const okResults = results as Array<Extract<(typeof results)[number], { ok: true }>>;
        const secrets = okResults.map((r) => {
          const value = (r.json as { value?: unknown }).value;
          if (typeof value !== "string" || value.length === 0) {
            throw new ServiceUnavailable(`${PROVIDER_LABEL} token mint malformed response`);
          }
          return value;
        });

        return reply.send({
          clientSecret: secrets[0],
          clientSecrets: secrets,
        });
      },
    });
  };

export default buildOpenAIRealtimeTokenRoutes;
