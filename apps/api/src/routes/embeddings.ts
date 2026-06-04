// SPDX-License-Identifier: FSL-1.1-ALv2
// quick-260604-u65 / C2 — POST /api/embeddings.
//
// Forwards an OpenAI-compatible embeddings request to the operator's
// in-perimeter gateway via the shared litellm-client `passthrough()`, then
// streams the upstream response (status + content-type + body) back to the
// caller VERBATIM. This lets the desktop client send embeddings work to the
// server instead of its (broken, immutable upstream) local onnx worker.
//
// Contract — server-or-clean-error, NO fallback:
//   * No model configured (deps.embeddingModel unset AND body omits `model`)
//     -> 503 ServiceUnavailable (operator-config). NEVER 401. passthrough is
//        NOT called. The 503 lets the client honor its no-fallback contract
//        (it reads capabilities.features.embeddings first).
//   * Upstream 4xx/5xx (e.g. model-not-installed 404) -> `passthrough()`
//     throws LitellmUpstreamError; we map it to 502 UpstreamError. The
//     resulting non-2xx is the client's clean-fail signal (no fallback).
//   * MissingProviderKeyError -> 503 (Pitfall #8 — never 401).
//
// The model is resolved server-side as `body.model ?? deps.embeddingModel`
// and the body re-serialized from the VALIDATED object only (T-u65-01: no
// raw req.body pass-through, no merge of request fields into operator config).
//
// LOCKER-04: the route carries `config.rateLimit` and validates the body via
// the manual `EmbeddingsRequest.parse()` inside the handler (same posture as
// reason.ts — no `schema.body` so ZodError yields the canonical {error}
// envelope rather than Fastify's `validation` shape).

import {
  type LitellmClient,
  LitellmUpstreamError,
  MissingProviderKeyError,
} from "@openwhispr/litellm-client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, ServiceUnavailable, UpstreamError } from "../errors.js";

/** Generous-but-bounded caps (T-u65-04 DoS mitigation). */
const MAX_INPUT_CHARS = 32 * 1024;
const MAX_INPUTS = 2048;
const MAX_MODEL_LEN = 128;

const boundedString = z.string().min(1).max(MAX_INPUT_CHARS);

/**
 * U65 — JSON body for POST /api/embeddings. `input` is a single string or a
 * non-empty bounded array of strings (the OpenAI embeddings shape). `model`
 * is optional; when present it wins over the operator default. Manual parse
 * inside the handler satisfies the LOCKER-04 body-validation invariant.
 */
const EmbeddingsRequest = z.object({
  input: z.union([boundedString, z.array(boundedString).min(1).max(MAX_INPUTS)]),
  model: z.string().min(1).max(MAX_MODEL_LEN).optional(),
});

export interface EmbeddingsDeps {
  litellm: LitellmClient;
  /**
   * U65 — operator-owned embeddings model alias (env `LITELLM_EMBEDDING_MODEL`
   * → `loadLitellmConfigFromEnv().defaultEmbeddingModel`). When undefined AND
   * the caller omits `model`, the route returns a clean 503 — there is NO
   * literal default and NO client-side fallback.
   */
  embeddingModel?: string;
}

export const buildEmbeddingsRoutes = (deps: EmbeddingsDeps) =>
  async function embeddingsRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/embeddings",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          // Defensive — dualAuthHook should have thrown.
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }

        // Manual zod parse → ZodError mapped to the canonical 400 envelope.
        const parsed = EmbeddingsRequest.parse(req.body);

        // body.model (caller) wins; else the operator-owned default. When
        // neither is present the server cannot route → clean 503 BEFORE any
        // upstream call (operator-config, never 401, no model name on wire).
        const model = parsed.model ?? deps.embeddingModel;
        if (model === undefined) {
          throw new ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable");
        }

        try {
          const upstream = await deps.litellm.passthrough("/v1/embeddings", {
            method: "POST",
            // T-u65-01 — re-serialize the VALIDATED object only (input +
            // server-resolved model); never the raw req.body.
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
            req.log.warn({ err }, "missing provider key on /api/embeddings");
            throw new ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable");
          }
          if (err instanceof LitellmUpstreamError) {
            // T-u65-02 — log status server-side; the wire envelope carries no
            // upstream body. The resulting non-2xx is the client's clean-fail
            // signal (no fallback).
            req.log.warn({ status: err.status }, "litellm upstream error on /api/embeddings");
            throw new UpstreamError(
              "EMBEDDINGS_UPSTREAM_FAILED",
              "upstream embeddings provider failure",
            );
          }
          throw err;
        }
      },
    });
  };

export default buildEmbeddingsRoutes;
