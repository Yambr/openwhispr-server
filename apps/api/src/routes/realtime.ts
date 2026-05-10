// Phase 03 / Plan 07 / Task 1 — WSS /v1/realtime reverse-proxy mount
// (LITELLM-03, D-04).
//
// Topology (D-04):
//   desktop ──TLS──> Traefik ──HTTP──> Fastify (this route) ──WS──> LiteLLM
//
// Why a Fastify hop at all (and not Traefik direct → LiteLLM):
//   1. Auth — desktop authenticates with our opaque bearer (Better Auth);
//      LiteLLM authenticates with LITELLM_MASTER_KEY. The hop swaps one
//      for the other so the desktop NEVER sees the master key, and the
//      LiteLLM container never receives the desktop's bearer.
//   2. Per-user attribution — D-03/LITELLM-04: we inject the OpenAI-
//      compatible `?user=<userId>` query string so LiteLLM's spend logs
//      carry the openwhispr user id without per-user virtual-key minting.
//   3. Upstream provider key isolation — per D-12, LiteLLM is configured
//      with `mode: realtime` + `api_key: os.environ/OPENAI_API_KEY` so
//      the OPENAI_API_KEY (or whichever realtime provider an operator
//      wires) never leaves the LiteLLM container.
//
// Mount mechanics:
//   `@fastify/http-proxy` v11 wsUpstream — registers a single Fastify
//   plugin that handles BOTH the HTTP route (used for diagnostics/probes)
//   and the WebSocket upgrade. `wsClientOptions.rewriteRequestHeaders`
//   runs on the upstream-bound side of the upgrade so the desktop's
//   `authorization: Bearer <opaque>` is replaced with the master-key
//   headers before any byte hits LiteLLM.
//
// Threat model (cross-references 03-07-PLAN.md <threat_model>):
//   * T-03-07-01 (master-key leak): rewriteRequestHeaders is the only
//     header-writing path; we never echo `authorization` back to the
//     client.
//   * T-03-07-02 (auth bypass via upgrade smuggling): preHandler runs
//     BEFORE the WS upgrade; AuthError throws → centralized handler
//     emits 401 envelope and the upgrade is aborted.
//   * T-03-07-04 (?user tampering): we mutate `req.raw.url` from the
//     server-side `req.user.id` AFTER auth. Caller-supplied `?user=`
//     in the URL is overwritten — any tampering attempt is silently
//     normalized to the authenticated user id.

import fastifyHttpProxy from "@fastify/http-proxy";
import type { FastifyInstance } from "fastify";
import type { LitellmClient } from "@openwhispr/litellm-client";
import { AuthError } from "../errors.js";

export interface RealtimeDeps {
  /**
   * The shared LiteLLM client (constructed in apps/api/src/index.ts via
   * `buildLitellmClient(loadLitellmConfigFromEnv())`). We only consume
   * `client.baseUrl` here — the WS upstream URL is derived from it. Tests
   * inject a stub object with just the baseUrl set.
   */
  litellm: LitellmClient;
  /**
   * The LITELLM_MASTER_KEY that will replace the desktop's bearer on the
   * upstream-bound upgrade headers. Passed explicitly (not pulled from
   * env at register time) so tests can inject a synthetic key without
   * mutating process.env.
   */
  masterKey: string;
}

/**
 * Build the realtime WSS reverse-proxy plugin.
 *
 * Returns a Fastify plugin function (signature consumed by `buildAllRoutes`
 * in routes/index.ts). The plugin registers a single `@fastify/http-proxy`
 * mount on `/v1/realtime` configured for WebSocket pass-through with
 * dual-auth-aware header rewriting.
 */
export const buildRealtimeRoutes = (deps: RealtimeDeps) =>
  async function realtimeRoutes(app: FastifyInstance): Promise<void> {
    const upstreamHttp = deps.litellm.baseUrl;
    // Derive the ws:// URL by replacing the http(s) scheme. The litellm
    // client config validates baseUrl as http or https, so the regex is
    // narrow on purpose — anything else (e.g. an env-misconfigured `tcp://`)
    // would land outside the validated set and we want to fail loud here.
    const upstreamWs = upstreamHttp.replace(/^http(s?):/i, "ws$1:");

    await app.register(fastifyHttpProxy, {
      upstream: upstreamHttp,
      wsUpstream: upstreamWs,
      prefix: "/v1/realtime",
      rewritePrefix: "/v1/realtime",
      websocket: true,
      wsClientOptions: {
        // Strip the desktop's opaque bearer; inject the LiteLLM master
        // key + spend-logs metadata so LiteLLM authenticates us AND tags
        // the resulting spend rows with our request_id + user_id.
        //
        // Header lowercasing: `headers` is the WS upgrade's outgoing
        // header map (an `IncomingHttpHeaders`-shaped object passed by
        // @fastify/http-proxy). We delete the inbound `authorization`
        // BEFORE injecting our own to avoid any case-sensitivity edge
        // (Node's http module normalizes header keys to lower-case on
        // read but accepts mixed-case writes — the deletion is defensive).
        rewriteRequestHeaders: (headers, request) => {
          const userId =
            (request as unknown as { user?: { id?: string } }).user?.id ??
            "anonymous";
          const requestId = request.id;
          const next: Record<string, string | string[] | undefined> = {
            ...headers,
          };
          delete next.authorization;
          delete next.Authorization;
          next.authorization = `Bearer ${deps.masterKey}`;
          next["x-litellm-spend-logs-metadata"] = JSON.stringify({
            openwhispr_request_id: requestId,
            openwhispr_user_id: userId,
          });
          return next as Record<string, string>;
        },
      },
      preHandler: async (req, _reply) => {
        // dualAuthHook is the global onRequest hook and is responsible
        // for populating req.user. Defensive re-check here so we never
        // upgrade for an unauthenticated request — throwing AuthError
        // routes through the centralized error handler which emits the
        // canonical 401 envelope BEFORE the WS upgrade completes.
        const user = (req as unknown as { user?: { id?: string } }).user;
        if (!user || !user.id) {
          throw new AuthError("unauthorized");
        }
        // D-03 / LITELLM-04: append `?user=<userId>` so LiteLLM tags
        // spend rows by openwhispr user without per-user virtual keys.
        // We mutate `req.raw.url` because @fastify/http-proxy reads the
        // raw IncomingMessage URL when wiring the upstream upgrade.
        const rawUrl = req.raw.url ?? req.url;
        const u = new URL(rawUrl, "http://internal");
        u.searchParams.set("user", user.id);
        req.raw.url = u.pathname + u.search;
      },
    });
  };

export default buildRealtimeRoutes;
