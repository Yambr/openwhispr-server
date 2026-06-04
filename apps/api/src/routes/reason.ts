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
import {
  resolveLocale,
  selectMessages,
  selectModelAndExtras,
} from "../lib/reason-prompt-select.js";

export interface ReasonDeps {
  db: TransactionalDb<ExecutableTx>;
  litellm: LitellmClient;
  /**
   * D3a — operator-owned default chat model. Production threads this from
   * `loadLitellmConfigFromEnv().defaultChatModel` (env
   * `LITELLM_DEFAULT_CHAT_MODEL`, bundled default `DEFAULT_CHAT_MODEL`).
   * Tests inject another alias to assert the routing table without
   * mutating env state. When omitted, the route falls back to the
   * imported `DEFAULT_CHAT_MODEL` env-default constant — no
   * `qwen3.6-plus` literal is baked into this route file.
   */
  defaultModel?: string;
  /**
   * R33 — operator-owned fast cleanup-class model. Production threads
   * this from `loadLitellmConfigFromEnv().defaultCleanupModel` (env
   * `REASONING_CLEANUP_MODEL`, bundled default `DEFAULT_CLEANUP_MODEL`).
   * The route routes the cleanup class to this alias with thinking
   * disabled — either by the explicit `requestKind:"cleanup"` PRIMARY
   * marker or, for clients that send no `requestKind`, by the fallback
   * shape heuristic (no systemPrompt, empty/absent model). When omitted,
   * `selectModelAndExtras()` falls back to the bundled `DEFAULT_CHAT_MODEL`
   * — no `qwen3.6-cleanup` literal is baked into this route file.
   */
  cleanupModel?: string;
  /**
   * #18 — per-model chat-completion param bag (litellm-style), keyed by the
   * resolved model alias. Production threads this from
   * `loadLitellmConfigFromEnv().modelParams` (env `REASONING_MODEL_PARAMS`).
   * When an entry exists for the resolved alias it becomes the upstream
   * request `extras`, overriding the cleanup thinking-off default; absent →
   * backward-compat behaviour. The bag is OPERATOR config only — never
   * merged with request-body fields (anti-injection; see
   * `reason-prompt-select.ts`).
   */
  modelParams?: Record<string, Record<string, unknown>>;
}

interface UpstreamChatJson {
  model?: string;
  choices?: Array<{ message?: { role?: string; content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * D3b — DISPLAY-ONLY, BEST-EFFORT hint. This map exists solely to
 * populate the `provider` field of `ReasonResponse` (billing-echo /
 * desktop display); it is NOT a routing decision — LiteLLM's catalog
 * owns provider routing. It is intentionally NOT exhaustive and NOT
 * env-driven (env-driving a whole map would be config sprawl). A
 * corporate operator's catalog model that is absent here resolves to
 * the `'litellm'` fallback below, which correctly signals "routed
 * through the configured LiteLLM endpoint, provider opaque". This is a
 * different class of literal from the D2/D3a/D4 model defaults — those
 * gate behaviour and ARE env-driven; this is a cosmetic echo.
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
      // ZodError rather than Fastify's `validation` shape. We parse
      // manually below. R23: ReasonRequest is `.passthrough()` — it
      // tolerates unmodeled keys but still validates `text` + the typed
      // documented fields, raising ZodError -> 400 on a malformed body.
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          // Defensive — dualAuthHook should have thrown.
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }

        // Manual zod parse so .strict() rejection raises ZodError —
        // mapped to 400 by the centralized error handler.
        const body = ReasonRequest.parse(req.body);
        // R33 — prompt + model selection is keyed on the request SHAPE.
        // The cleanup shape (no agentName, no systemPrompt, empty/absent
        // model) gets the localized cleanup persona + a fast cleanup-class
        // model with reasoning/thinking disabled; the agent shape keeps
        // the conversational behaviour. See lib/reason-prompt-select.ts.
        // The cleanup prompt is a localized i18n resource — its locale is
        // resolved from body.language/locale, then the request's
        // Accept-Language-driven `req.language`, then "en".
        const locale = resolveLocale(body, req.language);
        const messages = selectMessages(body, locale);
        // D3a — explicit `body.model` (caller) wins; else for the cleanup
        // shape the operator-owned `deps.cleanupModel`, for the agent
        // shape `deps.defaultModel` (LITELLM_DEFAULT_CHAT_MODEL); else the
        // bundled `DEFAULT_CHAT_MODEL`. R28: `body.model` may arrive
        // explicitly `null` — treated like absent.
        const { model, extras } = selectModelAndExtras(body, {
          ...(deps.cleanupModel !== undefined ? { cleanupModel: deps.cleanupModel } : {}),
          ...(deps.defaultModel !== undefined ? { defaultModel: deps.defaultModel } : {}),
          ...(deps.modelParams !== undefined ? { modelParams: deps.modelParams } : {}),
        });

        let upstreamJson: UpstreamChatJson;
        try {
          const upstream = await deps.litellm.chatCompletions({
            model,
            messages,
            // R33 — for the cleanup shape `extras` carries the Qwen3
            // thinking-OFF chat-template kwarg
            // (extra_body.chat_template_kwargs.enable_thinking:false); the
            // litellm-client spreads it top-level into the request body
            // and LiteLLM forwards it to the upstream. The agent shape
            // receives no `extras` (thinking left as-is).
            ...(extras !== undefined ? { extras } : {}),
            // D-03 — per-user attribution via OpenAI-compatible `user`
            // field. The shared client always overrides body.user with
            // req.user.id; T-03-05-01 mitigation belt-and-suspenders.
            userId: req.user.id,
            // Upstream #4 (D-2) — operator-facing end-user attribution: the
            // authenticated EMAIL flows into body.user (preferred over the
            // UUID) and, when LITELLM_USER_HEADER_NAME is configured, into
            // that header. `userId` (the UUID) stays the stable
            // x-litellm-end-user-id key (D-1). Falls back to the UUID if
            // email is somehow absent on the session.
            endUser: req.user.email ?? req.user.id,
            requestId: req.id,
          });
          upstreamJson = (await upstream.body.json()) as UpstreamChatJson;
        } catch (err) {
          if (err instanceof MissingProviderKeyError) {
            // 503 — operator-actionable config issue. NEVER 401 (Pitfall #8).
            // HI-03 (Phase 62): code+literal pair — the missing-key detail
            // is logged server-side, NOT carried on `.message`.
            req.log.warn({ err }, "missing provider key on /api/reason");
            throw new ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable");
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
          // R23: `promptMode` / `matchType` are RESPONSE-shape fields and
          // were removed from `ReasonRequest` — the immutable client
          // never sent them. The echo is the constant documented default.
          promptMode: "default",
          matchType: "default",
        };
        return reply.code(200).send(response);
      },
    });
  };

export default buildReasonRoutes;
