// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 / Plan 05 / Task 1 — POST /api/reason.
//
// Wire shape: docs/wire-contracts-phase-3.md "POST /api/reason".
//
// Behavior:
//   1. JSON body validated by ReasonRequest (.strict()) — extra fields
//      rejected. Multipart bypassed entirely (this is a JSON endpoint).
//   2. Default model = qwen3.6-plus (D-06) when caller omits `model`.
//      Caller may explicitly select gpt-4o-mini / gemini-3-flash; the
//      bundled-default LiteLLM model_list gates which models actually
//      route. Unknown models return 502 from upstream.
//   3. user param (D-03) — `user: req.user.id` is injected by the shared
//      LiteLLM client via the OpenAI-compatible body field. The route
//      NEVER reads `user` from req.body (T-03-05-01 mitigation: ReasonRequest
//      is .strict() so a body-level `user` field would 400 anyway, but the
//      route is also defensive at the call site).
//   4. usage_ledger row written with kind='reason_tokens' and
//      units=upstream.usage.total_tokens. Idempotent on request_id —
//      ON CONFLICT (request_id) DO NOTHING. The Plan 08 spend-ingest
//      worker will UPSERT the same row from LiteLLM_SpendLogs (DATA-03
//      first-writer-wins).
//   5. Error mapping:
//        - MissingProviderKeyError                 -> 503 envelope using
//          err.message verbatim (Pitfall #8 — NEVER 401).
//        - LitellmUpstreamError                    -> 502 generic envelope.
//          Upstream body NEVER echoed (could leak sk-litellm-master-shaped
//          fragments — T-03-05-04 mitigation pinned by test).
//        - dual-auth failure                       -> 401 (existing hook).
//
// MODEL_PROVIDER table mirrors compose/litellm/litellm_config.yaml
// model_list. Override mode (LITELLM_BASE_URL set to a corporate proxy)
// MAY route through different providers; we surface 'litellm' as the
// generic provider when the model alias is not in our bundled table.

import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import {
  type LitellmClient,
  LitellmUpstreamError,
  MissingProviderKeyError,
} from "@openwhispr/litellm-client";
import { ReasonRequest, type ReasonResponse } from "@openwhispr/wire-schemas";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { AuthError, ServiceUnavailable, UpstreamError } from "../errors.js";

export interface ReasonDeps {
  db: TransactionalDb<ExecutableTx>;
  litellm: LitellmClient;
  /**
   * Optional override for the default chat model. Production picks up the
   * value from litellm-client config (D-06: 'qwen3.6-plus'). Tests may
   * inject another model alias to assert the routing table without
   * mutating env state.
   */
  defaultModel?: string;
}

interface UpstreamChatJson {
  model?: string;
  choices?: Array<{ message?: { role?: string; content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

const DEFAULT_MODEL = "qwen3.6-plus";

/**
 * Static map: bundled-default model alias -> provider name returned in
 * ReasonResponse.provider. Mirrors compose/litellm/litellm_config.yaml
 * model_list. When LITELLM_BASE_URL is overridden to a corporate proxy,
 * the operator's mapping may differ; the `'litellm'` fallback signals
 * "routed through the configured LiteLLM endpoint, provider opaque".
 */
const MODEL_PROVIDER: Record<string, string> = {
  "qwen3.6-plus": "openrouter",
  "gemini-3-flash": "openrouter",
  "gpt-4o-mini": "openrouter",
};

export const buildReasonRoutes = (deps: ReasonDeps) =>
  async function reasonRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/reason",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      // No `schema.body` registered with the type-provider so the
      // centralized error-handler emits the canonical {error} envelope on
      // ZodError rather than Fastify's `validation` shape (which would
      // bypass the .strict() rejection messaging). We parse manually below.
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          // Defensive — dualAuthHook should have thrown.
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }

        // Manual zod parse so .strict() rejection raises ZodError —
        // mapped to 400 by the centralized error handler.
        const body = ReasonRequest.parse(req.body);
        const model = body.model ?? deps.defaultModel ?? DEFAULT_MODEL;

        let upstreamJson: UpstreamChatJson;
        try {
          const upstream = await deps.litellm.chatCompletions({
            model,
            messages: [{ role: "user", content: body.text }],
            // D-03 — per-user attribution via OpenAI-compatible `user`
            // field. The shared client always overrides body.user with
            // req.user.id; T-03-05-01 mitigation belt-and-suspenders.
            userId: req.user.id,
            requestId: req.id,
          });
          upstreamJson = (await upstream.body.json()) as UpstreamChatJson;
        } catch (err) {
          if (err instanceof MissingProviderKeyError) {
            // 503 — operator-actionable config issue. NEVER 401 (Pitfall #8).
            // ServiceUnavailable carries err.message verbatim through the
            // centralized envelope.
            throw new ServiceUnavailable(err.message);
          }
          if (err instanceof LitellmUpstreamError) {
            req.log.warn({ status: err.status }, "litellm upstream error on /api/reason");
            throw new UpstreamError(
              "REASONING_UPSTREAM_FAILED",
              "upstream reasoning provider failure",
            );
          }
          throw err;
        }

        const tokens = upstreamJson.usage?.total_tokens ?? 0;

        // DATA-03 — idempotent ledger insert. Plan 08 spend-ingest worker
        // converges on the same row via the request_id UNIQUE index.
        const tenantId = req.tenant;
        const userId = req.user.id;
        const requestId = req.id;
        await withTenant(deps.db, tenantId, async (tx) => {
          await tx.execute(sql`
            INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
            VALUES (${tenantId}::uuid, ${userId}::uuid, ${requestId}, 'reason_tokens', ${tokens})
            ON CONFLICT (request_id) DO NOTHING
          `);
        });

        const responseModel = upstreamJson.model ?? model;
        const response: ReasonResponse = {
          text: upstreamJson.choices?.[0]?.message?.content ?? "",
          model: responseModel,
          provider: MODEL_PROVIDER[responseModel] ?? MODEL_PROVIDER[model] ?? "litellm",
          promptMode: body.promptMode ?? "default",
          matchType: body.matchType ?? "default",
        };
        return reply.code(200).send(response);
      },
    });
  };

export default buildReasonRoutes;
