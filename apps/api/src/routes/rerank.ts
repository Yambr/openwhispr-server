// SPDX-License-Identifier: FSL-1.1-ALv2
// quick-260604-u65 / C3 — POST /api/rerank.
//
// Forwards a Cohere-shape rerank request to the operator's in-perimeter
// gateway via the shared litellm-client `passthrough()`, then streams the
// upstream response (status + content-type + body) back to the caller
// VERBATIM. Sibling of embeddings.ts (same forward + error-mapping shape).
//
// Contract — server-or-clean-error, NO fallback:
//   * No model configured (deps.rerankModel unset AND body omits `model`)
//     -> 503 ServiceUnavailable (operator-config). NEVER 401. passthrough is
//        NOT called.
//   * Upstream 4xx/5xx -> `passthrough()` throws LitellmUpstreamError -> 502
//     UpstreamError (client's clean-fail signal; no fallback).
//   * MissingProviderKeyError -> 503 (Pitfall #8 — never 401).
//
// The model is resolved server-side as `body.model ?? deps.rerankModel`, the
// body re-serialized from the VALIDATED object only (T-u65-01).
//
// LOCKER-04: rateLimit configured + manual `RerankRequest.parse()` inside the
// handler IS the body validation (mirrors reason.ts / embeddings.ts).

import {
  type LitellmClient,
  LitellmUpstreamError,
  MissingProviderKeyError,
} from "@openwhispr/litellm-client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, ServiceUnavailable, UpstreamError } from "../errors.js";

/** Generous-but-bounded caps (T-u65-04 DoS mitigation). */
const MAX_QUERY_CHARS = 32 * 1024;
const MAX_DOC_CHARS = 32 * 1024;
const MAX_DOCS = 2048;
const MAX_MODEL_LEN = 128;
const MAX_TOP_N = 2048;

const boundedQuery = z.string().min(1).max(MAX_QUERY_CHARS);
const boundedDoc = z.string().min(1).max(MAX_DOC_CHARS);

/**
 * U65 — JSON body for POST /api/rerank (Cohere rerank shape). `query` is a
 * bounded non-empty string; `documents` a non-empty bounded array of bounded
 * strings; `model` + `top_n` optional. Manual parse inside the handler
 * satisfies the LOCKER-04 body-validation invariant.
 */
const RerankRequest = z.object({
  query: boundedQuery,
  documents: z.array(boundedDoc).min(1).max(MAX_DOCS),
  model: z.string().min(1).max(MAX_MODEL_LEN).optional(),
  top_n: z.number().int().positive().max(MAX_TOP_N).optional(),
});

export interface RerankDeps {
  litellm: LitellmClient;
  /**
   * U65 — operator-owned rerank model alias (env `LITELLM_RERANK_MODEL` →
   * `loadLitellmConfigFromEnv().defaultRerankModel`). When undefined AND the
   * caller omits `model`, the route returns a clean 503 — no literal default,
   * no client-side fallback.
   */
  rerankModel?: string;
}

export const buildRerankRoutes = (deps: RerankDeps) =>
  async function rerankRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/rerank",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          // Defensive — dualAuthHook should have thrown.
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }

        // Manual zod parse → ZodError mapped to the canonical 400 envelope.
        const parsed = RerankRequest.parse(req.body);

        // body.model (caller) wins; else the operator-owned default. When
        // neither is present the server cannot route → clean 503 BEFORE any
        // upstream call (operator-config, never 401, no model name on wire).
        const model = parsed.model ?? deps.rerankModel;
        if (model === undefined) {
          throw new ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable");
        }

        try {
          const upstream = await deps.litellm.passthrough("/v1/rerank", {
            method: "POST",
            // T-u65-01 — re-serialize the VALIDATED object only (query +
            // documents + optional top_n + server-resolved model).
            body: JSON.stringify({ ...parsed, model }),
            contentType: "application/json",
            userId: req.user.id,
            endUser: req.user.email ?? req.user.id,
            requestId: req.id,
          });
          reply.code(upstream.statusCode);
          const ct = upstream.headers["content-type"];
          if (typeof ct === "string") {
            reply.header("content-type", ct);
          }
          // upstream.body is a Node Readable — Fastify streams it through.
          return reply.send(upstream.body);
        } catch (err) {
          if (err instanceof MissingProviderKeyError) {
            // 503 — operator-actionable config issue. NEVER 401 (Pitfall #8).
            req.log.warn({ err }, "missing provider key on /api/rerank");
            throw new ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable");
          }
          if (err instanceof LitellmUpstreamError) {
            // T-u65-02 — log status server-side; the wire envelope carries no
            // upstream body. The resulting non-2xx is the client's clean-fail
            // signal (no fallback).
            req.log.warn({ status: err.status }, "litellm upstream error on /api/rerank");
            throw new UpstreamError("RERANK_UPSTREAM_FAILED", "upstream rerank provider failure");
          }
          throw err;
        }
      },
    });
  };

export default buildRerankRoutes;
