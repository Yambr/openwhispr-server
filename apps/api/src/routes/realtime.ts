// SPDX-License-Identifier: FSL-1.1-ALv2
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
//   * T-03-07-05 (client-supplied ?model): D1 — LiteLLM routes
//     `/v1/realtime` on the `?model=` query param. The OpenAI Realtime
//     protocol would otherwise force the immutable desktop client to
//     carry a provider-specific model name (e.g. `gpt-realtime`), which
//     breaks the moment an operator swaps the backend to Speaches. The
//     preHandler forces `?model=<deps.realtimeModel>` server-side,
//     OVERWRITING whatever the client sent (or omitted) — identical
//     tamper-normalization to `?user=`. The realtime model becomes pure
//     operator config: OpenAI→Speaches is a one-line `litellm_config`
//     edit, zero client change.

import fastifyHttpProxy from "@fastify/http-proxy";
import type { LitellmClient } from "@openwhispr/litellm-client";
import type { FastifyInstance } from "fastify";
import { AuthError } from "../errors.js";

/**
 * Build the rewriteRequestHeaders closure consumed by @fastify/http-proxy
 * on the upstream-bound WS upgrade. Exported for direct unit-testing of
 * the master-key swap, spend-logs metadata injection, and the
 * `?user=anonymous` fallback when the upgrade arrives without an
 * authenticated user.id.
 */
export function buildRewriteRequestHeaders(masterKey: string) {
  return (
    headers: Record<string, string | string[] | undefined>,
    request: { id?: string; user?: { id?: string } },
  ): Record<string, string> => {
    const userId = request.user?.id ?? "anonymous";
    const requestId = request.id;
    const next: Record<string, string | string[] | undefined> = {
      ...headers,
    };
    delete next.authorization;
    delete next.Authorization;
    next.authorization = `Bearer ${masterKey}`;
    next["x-litellm-spend-logs-metadata"] = JSON.stringify({
      openwhispr_request_id: requestId,
      openwhispr_user_id: userId,
    });
    return next as Record<string, string>;
  };
}

/**
 * WR-03: Convert an http(s) baseUrl to its ws(s) counterpart.
 *
 * Implemented as two narrow case-insensitive replaces (https before
 * http) instead of a single regex with a `(s?)` capture group: the
 * old form `replace(/^http(s?):/i, "ws$1:")` was sloppy because the
 * `$1` capture preserved the casing of the captured `s` — `HTTPS:`
 * yielded `wsS:` (uppercase trailing S), a malformed scheme. We
 * normalize to lowercase by writing the replacement string fully
 * (`wss:` / `ws:`).
 *
 * Exported for direct unit-testing; the route consumer just calls it.
 */
export function httpToWsScheme(httpUrl: string): string {
  return httpUrl.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
}

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
  /**
   * D1 — the realtime model alias forced onto the upstream-bound
   * `?model=` query string (T-03-07-05). LiteLLM routes `/v1/realtime`
   * on this query param, NOT the in-band `session.update` frame, so
   * injecting it server-side makes the realtime model pure operator
   * config — the desktop client sends no model. Production wires it
   * from `LITELLM_REALTIME_MODEL` (default `"realtime-default"`) in
   * routes/index.ts; injected here (not read from process.env at
   * register time) to mirror the `masterKey` testable-deps pattern.
   */
  realtimeModel: string;
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
    const upstreamWs = httpToWsScheme(upstreamHttp);

    // Phase 53 — `@fastify/http-proxy@11.4.4` narrowed its
    // `wsClientOptions` type to plain `ws.ClientOptions`, which does
    // NOT declare `rewriteRequestHeaders`. The plugin's RUNTIME still
    // honours `wsClientOptions.rewriteRequestHeaders` per the
    // Phase 08.5 e2e proof (verified again post-53-06 with
    // `make e2e-test` boot-up — see commit 3bcc879). The closure-arg
    // shape mirrors the legacy contract: `(headers, request) =>
    // newHeaders`. Until upstream re-adds the field to types (or we
    // migrate to a pre-upgrade hook), encode the legacy field via a
    // typed local extension instead of `@ts-expect-error` so the
    // suppression is localised and reviewable. LOCKER-02 prefers a
    // narrow `as` cast on a *typed* extension to a blanket
    // `@ts-expect-error` on a sprawling plugin-options block.
    type LegacyWsClientOptions = NonNullable<
      Parameters<typeof fastifyHttpProxy>[1]
    >["wsClientOptions"] & {
      rewriteRequestHeaders?: (
        headers: Record<string, string | string[] | undefined>,
        request: { id?: string; user?: { id?: string } },
      ) => Record<string, string>;
    };
    const wsClientOptions: LegacyWsClientOptions = {
      // Strip the desktop's opaque bearer; inject the LiteLLM master
      // key + spend-logs metadata so LiteLLM authenticates us AND tags
      // the resulting spend rows with our request_id + user_id. The
      // closure is built by buildRewriteRequestHeaders so it can be
      // unit-tested in isolation (Stage B back-fill).
      rewriteRequestHeaders: buildRewriteRequestHeaders(deps.masterKey),
      // Phase 04 / Plan 07 / D-27 — 10s handshake ceiling. Without
      // this, a stuck-connecting client (TCP up, WS upgrade never
      // completes) would hold an ingress slot indefinitely on the
      // dedicated :8443 entrypoint (Plan 04-05). 10000ms is generous
      // for healthy upstreams (loopback < 10ms, cross-region < 500ms)
      // and a tight cap for pathological cases (T-04-02 mitigation).
      handshakeTimeout: 10000,
    };
    await app.register(fastifyHttpProxy, {
      upstream: upstreamHttp,
      wsUpstream: upstreamWs,
      prefix: "/v1/realtime",
      rewritePrefix: "/v1/realtime",
      websocket: true,
      // Phase 52 / Plan 52-04b — `@fastify/http-proxy` newer versions
      // narrowed `wsReconnect` from `boolean` to `WebSocketReconnectOptions`
      // (object) and ALSO made it optional. Omitting the field is the
      // canonical "disable reconnect" posture — auto-reconnect is off
      // by default when the property is absent, matching the original
      // T-04-RECONNECT-LOOP intent without forcing a boolean.
      wsClientOptions,
      preHandler: async (req, _reply) => {
        // dualAuthHook is the global onRequest hook and is responsible
        // for populating req.user. Defensive re-check here so we never
        // upgrade for an unauthenticated request — throwing AuthError
        // routes through the centralized error handler which emits the
        // canonical 401 envelope BEFORE the WS upgrade completes.
        const user = req.user;
        if (!user || !user.id) {
          // WR-03 (Phase 65) — two-arg form so code === "UNAUTHORIZED",
          // matching every other route (i18n `errors.UNAUTHORIZED` keying).
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        // D-03 / LITELLM-04: append `?user=<userId>` so LiteLLM tags
        // spend rows by openwhispr user without per-user virtual keys.
        // We mutate `req.raw.url` because @fastify/http-proxy reads the
        // raw IncomingMessage URL when wiring the upstream upgrade.
        //
        // WR-09 (Phase 65) — `"http://internal"` is a sentinel parser base:
        // the WHATWG `URL` constructor requires an absolute base to resolve a
        // relative path; the host is never used (only `u.pathname + u.search`
        // are read back). For a Fastify route the raw IncomingMessage URL is
        // always a relative origin-form path (`/v1/realtime?...`). If it is
        // ever absolute (a proxy-injected / test-harness URL), `new URL` would
        // silently DROP the sentinel base and re-emit the foreign URL's
        // path+query — so we assert relativeness and fail loud instead.
        const rawUrl = req.raw.url ?? req.url;
        if (!rawUrl.startsWith("/")) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const u = new URL(rawUrl, "http://internal");
        u.searchParams.set("user", user.id);
        // D1 / T-03-07-05: force `?model=<deps.realtimeModel>` so LiteLLM
        // routes the realtime WS to the operator-configured upstream.
        // `.set` OVERWRITES any client-supplied `?model=` — identical
        // tamper-normalization to `?user=` above. The desktop client
        // therefore sends no model; OpenAI→Speaches is a one-line
        // `litellm_config` edit with zero client change.
        u.searchParams.set("model", deps.realtimeModel);
        // The user id deliberately enters `req.raw.url` here — the LAST
        // statement of the preHandler — so it is appended only immediately
        // before @fastify/http-proxy wires the upstream upgrade, minimising
        // the window in which an earlier hook could observe the mutated URL.
        req.raw.url = u.pathname + u.search;
      },
    });
  };

export default buildRealtimeRoutes;
