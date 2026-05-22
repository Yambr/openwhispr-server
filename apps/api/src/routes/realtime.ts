// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 / Plan 07 / Task 1 — WSS /v1/realtime reverse-proxy mount.
// R31 (debug session r31-realtime-ga-beta-shape) — rebuilt as a
// FRAME-AWARE WS relay supporting two env-switchable upstream backends.
//
// Topology (D-04):
//   desktop ──TLS──> Traefik ──HTTP──> Fastify (this route) ──WS──> upstream
//
// Why a Fastify hop at all (and not Traefik direct → upstream):
//   1. Auth — desktop authenticates with our opaque bearer (Better Auth);
//      the upstream authenticates with a master key (LiteLLM) or the
//      OpenAI API key (direct mode). The hop swaps one for the other so
//      the desktop NEVER sees the upstream credential.
//   2. Per-user attribution — D-03/LITELLM-04: in `litellm` mode we
//      inject the OpenAI-compatible `?user=<userId>` query string so
//      LiteLLM's spend logs carry the openwhispr user id.
//   3. Beta↔GA frame translation (R31) — the immutable desktop client
//      speaks the retired OpenAI Realtime *Beta* vocabulary; OpenAI's GA
//      surface speaks a different vocabulary. The relay bridges the two
//      in-band (see the Beta↔GA translation contract below).
//
// ─── R31: WHY THIS IS NO LONGER A TRANSPARENT PASSTHROUGH ───────────────
// The previous mount used `@fastify/http-proxy` wsUpstream — a transparent,
// payload-opaque WS passthrough (the original T-03-07 posture). That
// architecture CANNOT bridge the Beta↔GA gap because the gap is in-band.
// R31 surfaced FIVE layers, fixed across two debug rounds:
//   * DEFECT 2 — in `litellm` mode, LiteLLM 1.83.14 injects the retired
//     `OpenAI-Beta: realtime=v1` header on its own OpenAI leg from a code
//     path the documented `OpenAIRealtime._get_additional_headers`
//     override seam does NOT cover (verified live — see config/realtime.ts
//     header). This is why `direct` is the default backend: it bypasses
//     LiteLLM entirely and the relay controls every upstream header.
//   * DEFECT 3 — the client waits for `transcription_session.created`
//     (Beta), GA emits `session.created`; the client's first frame is
//     `transcription_session.update` (Beta), GA wants `session.update`.
//   * DEFECT 4 — the `transcription_session.update` PAYLOAD: the client
//     sends the FLAT Beta `session` shape (`input_audio_format` string,
//     `input_audio_transcription`, `turn_detection` directly under
//     `session`); GA requires the NESTED `audio.input.{format,transcription,
//     turn_detection}` shape (`format` an object `{type:"audio/pcm",
//     rate:24000}`). A frame-name-only translation left the session
//     unconfigured → zero transcripts.
//   * DEFECT 5 — `?intent=transcription` is NOT a retired Beta param. GA
//     decides the session TYPE at connect time: WITH `?intent=transcription`
//     it opens a transcription session; WITHOUT it (the earlier wrong
//     "DEFECT 1 — strip intent" fix) GA opens a conversational realtime
//     session that rejects the transcription `session.update` with
//     `invalid_parameter`. The relay therefore FORCES `?intent=transcription`
//     and sends NO conversational `?model=` in direct mode.
//
// ─── Beta↔GA translation contract (R31) ────────────────────────────────
// Implemented as pure functions in lib/realtime-frame-translate.ts:
//   client → upstream:  transcription_session.update → session.update
//                       (frame renamed AND payload restructured flat→nested
//                       GA shape, session re-tagged { type: "transcription"
//                       }); input_audio_buffer.append/.commit pass through
//                       (byte-identical Beta/GA); all other frames pass.
//   upstream → client:  session.created → transcription_session.created;
//                       session.updated → transcription_session.updated
//                       (payload flattened nested→flat back to Beta);
//                       transcription result events
//                       (conversation.item.input_audio_transcription.*)
//                       pass through (byte-identical); all other frames pass.
//
// ─── Two env-switchable upstream backends (R31) ─────────────────────────
//   * `direct` (default) — relay → `wss://api.openai.com/v1/realtime`
//     straight, bypassing LiteLLM. The relay controls every upstream
//     header, so no `OpenAI-Beta` header is ever sent — the relay is the
//     GA contract boundary. Requires `OPENAI_API_KEY`.
//   * `litellm` — relay → bundled/internal LiteLLM `/v1/realtime`. For
//     corporate operators whose LiteLLM speaks OpenAI Realtime GA.
//   Selected by `REALTIME_BACKEND` (config/realtime.ts — LOCKER-01).
//   `direct` is the default because the bundled LiteLLM 1.83.14 cannot
//   complete a GA realtime session (it injects the retired `OpenAI-Beta`
//   header from a code path no documented override seam covers — see the
//   config/realtime.ts header for the full rationale).
//
// ─── Threat model ───────────────────────────────────────────────────────
//   * T-03-07-01 (master-key / api-key leak): the upstream credential is
//     written only into the upstream WS client's `headers` option; it is
//     never echoed to the desktop client.
//   * T-03-07-02 (auth bypass via upgrade smuggling): the global
//     dualAuthHook (`onRequest`) AND this route's `preValidation` run
//     BEFORE @fastify/websocket performs the upgrade — AuthError throws →
//     the upgrade is aborted with the canonical 401 envelope.
//   * T-03-07-04 (?user tampering): in `litellm` mode we set the upstream
//     `?user=` from the server-side `req.user.id` AFTER auth, overwriting
//     any client-supplied value.
//   * T-03-07-05 (client-supplied ?model): D1 — we force
//     `?model=<deps.realtimeModel>` on the upstream URL, overwriting
//     whatever the client sent. The realtime model is pure operator
//     config.
//   * T-03-07-06 (client-supplied OpenAI-Beta opt-in): we never copy ANY
//     client header onto the upstream leg — the upstream header set is
//     constructed from scratch (credential + spend-logs metadata only),
//     so a client `OpenAI-Beta` header cannot reach the upstream.
//   * T-03-07-07 (R31 — frame-parse attack surface): this relay PARSES
//     in-band WS frames (it is no longer payload-opaque — the T-03-07
//     transparent-passthrough posture is DELIBERATELY AMENDED here, and
//     ONLY on the /v1/realtime path). Hardening: every frame is parsed by
//     `parseRealtimeFrame`, which (a) rejects payloads above a 1 MiB byte
//     bound WITHOUT invoking JSON.parse, (b) rejects non-JSON / non-object
//     / typeless frames. Rejected frames are DROPPED (not forwarded) and
//     the socket stays alive — a single malformed frame never tears down
//     a session. Binary frames are forwarded verbatim (audio payloads are
//     not JSON and need no translation). Translation is confined to the
//     two pure mapper functions; the relay holds no per-session parser
//     state beyond the sockets themselves.

import type { LitellmClient } from "@openwhispr/litellm-client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type RawData, WebSocket } from "ws";
import type { RealtimeBackend } from "../config/realtime.js";
import { AuthError } from "../errors.js";
import {
  parseRealtimeFrame,
  translateClientToUpstream,
  translateUpstreamToClient,
} from "../lib/realtime-frame-translate.js";

/**
 * WR-03: Convert an http(s) baseUrl to its ws(s) counterpart.
 *
 * Implemented as two narrow case-insensitive replaces (https before
 * http) so `HTTPS:` normalizes to `wss:` (not the malformed `wsS:` the
 * old `(s?)`-capture regex produced). Exported for direct unit-testing.
 */
export function httpToWsScheme(httpUrl: string): string {
  return httpUrl.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
}

export interface RealtimeDeps {
  /**
   * The shared LiteLLM client. Only `client.baseUrl` is consumed — in
   * `litellm` backend mode the relay's upstream WS URL is derived from
   * it. Tests inject a stub with just `baseUrl` set. OPTIONAL: `direct`
   * mode bypasses LiteLLM entirely, so an operator who runs `direct`
   * without a bundled LiteLLM need not supply it. Required at runtime
   * only when `backend === "litellm"`.
   */
  litellm?: LitellmClient;
  /**
   * The LITELLM_MASTER_KEY used as the upstream credential in `litellm`
   * mode. Passed explicitly (not pulled from env at register time) so
   * tests inject a synthetic key. OPTIONAL — unused in `direct` mode.
   */
  masterKey?: string;
  /**
   * D1 — the realtime model alias forced onto the upstream-bound
   * `?model=` query string (T-03-07-05). LiteLLM routes `/v1/realtime`
   * on this query param. Production wires it from `LITELLM_REALTIME_MODEL`
   * in routes/index.ts.
   */
  realtimeModel: string;
  /**
   * R31 — the selected upstream backend. `litellm` (default) relays via
   * the bundled LiteLLM; `direct` relays straight to OpenAI's GA
   * `/v1/realtime`. Resolved from `REALTIME_BACKEND` at the
   * config/entrypoint boundary (LOCKER-01).
   */
  backend: RealtimeBackend;
  /**
   * R31 — `direct`-mode upstream WS URL (default
   * `wss://api.openai.com/v1/realtime`, env-overridable via
   * `OPENAI_REALTIME_URL`). Consumed only when `backend === "direct"`.
   */
  openaiRealtimeUrl: string;
  /**
   * R31 — `direct`-mode upstream credential (`OPENAI_API_KEY`). Present
   * only when `backend === "direct"` AND the key is configured. In
   * `litellm` mode this is `undefined` and the key is never read.
   */
  openaiApiKey?: string;
  /**
   * R31 — `direct`-mode `?model=` value (a real OpenAI model name;
   * default `gpt-realtime`, overridable via `OPENAI_REALTIME_MODEL`).
   * OpenAI's GA `/v1/realtime` requires it. Always set by routes/index.ts
   * in `direct` mode; only optional on the type so hand-constructed test
   * deps for `litellm` mode need not supply it.
   */
  openaiRealtimeModel?: string;
}

/**
 * The realtime `?intent=` value that opens an OpenAI GA *transcription*
 * session. GA decides the session TYPE at connect time from this param:
 * `?intent=transcription` → transcription session; its absence → a
 * conversational realtime session (whose `session.update` rejects a
 * `session.type:"transcription"` payload). See R31 LIVE-RUN FINDING:
 * `?intent=` is NOT a retired Beta param — GA still requires it for the
 * transcription surface. The relay therefore FORCES it (the only mode
 * this relay supports is transcription).
 */
const REALTIME_TRANSCRIPTION_INTENT = "transcription";

/**
 * Build the per-upgrade upstream URL.
 *
 * BOTH modes force `?intent=transcription` — GA's `/v1/realtime` opens a
 * *transcription* session only when that param is present (R31 LIVE-RUN
 * FINDING; the earlier "DEFECT 1 — strip intent" diagnosis was wrong: a
 * stripped intent makes GA open a conversational session that rejects the
 * transcription `session.update`).
 *
 * `direct` mode: start from the configured GA URL, force
 * `?intent=transcription`. DO NOT set `?model=` — a GA transcription
 * session takes its model from `session.update.audio.input.transcription.
 * model`, and a conversational `?model=gpt-realtime` would flip GA back
 * to a realtime session. DO NOT inject `?user=` — OpenAI has no
 * spend-attribution param and we must not leak the openwhispr user id.
 *
 * `litellm` mode: derive `ws(s)://<litellm-base>/v1/realtime`, force
 * `?intent=transcription`, `?model=` (the LiteLLM routing alias — LiteLLM
 * routes `/v1/realtime` on this param) and `?user=` (spend attribution).
 *
 * Exported for direct unit-testing of the URL-construction logic.
 */
export function buildUpstreamUrl(deps: RealtimeDeps, rawClientUrl: string, userId: string): string {
  // The client's raw URL is an origin-form path: `/v1/realtime?intent=...`.
  // Pull its query params; the relay owns intent/user/model and overwrites
  // them below, so client-supplied values for those are ignored.
  const clientQuery = new URL(rawClientUrl, "http://internal").searchParams;

  if (deps.backend === "direct") {
    const u = new URL(deps.openaiRealtimeUrl);
    // Carry forward any benign client params; the relay owns
    // intent/user/model.
    for (const [k, v] of clientQuery) {
      if (k !== "intent" && k !== "user" && k !== "model") u.searchParams.set(k, v);
    }
    // FORCE the transcription intent — GA opens a transcription session
    // only with this param. No `?model=`: the GA transcription session
    // model is supplied in-band via `session.update`.
    u.searchParams.set("intent", REALTIME_TRANSCRIPTION_INTENT);
    // No `?user=` — OpenAI has no spend-attribution param and we do not
    // leak the openwhispr user id to a third party.
    return u.toString();
  }

  // litellm mode — derive ws(s)://<litellm-base>/v1/realtime.
  if (!deps.litellm) {
    throw new Error("realtime relay: litellm backend selected but no LiteLLM client configured");
  }
  const base = httpToWsScheme(deps.litellm.baseUrl).replace(/\/+$/, "");
  const u = new URL(`${base}/v1/realtime`);
  for (const [k, v] of clientQuery) {
    if (k !== "intent" && k !== "user" && k !== "model") u.searchParams.set(k, v);
  }
  // FORCE the transcription intent — LiteLLM forwards it to OpenAI's GA
  // `/v1/realtime`, which needs it to open a transcription session.
  u.searchParams.set("intent", REALTIME_TRANSCRIPTION_INTENT);
  // D1 / T-03-07-05 — force the operator-configured model alias (LiteLLM
  // routes `/v1/realtime` on `?model=`).
  u.searchParams.set("model", deps.realtimeModel);
  // D-03 / LITELLM-04 — per-user spend attribution.
  u.searchParams.set("user", userId);
  return u.toString();
}

/**
 * Build the upstream WS handshake headers.
 *
 * Constructed FROM SCRATCH — no client header is ever copied onto the
 * upstream leg (T-03-07-06). `litellm` mode sends the master key plus
 * spend-logs metadata; `direct` mode sends the OpenAI API key only.
 * The relay NEVER attaches an `OpenAI-Beta` header in either mode.
 *
 * Exported for direct unit-testing.
 */
export function buildUpstreamHeaders(
  deps: RealtimeDeps,
  userId: string,
  requestId: string | undefined,
): Record<string, string> {
  if (deps.backend === "direct") {
    // `direct` mode: only the OpenAI credential. `openaiApiKey` is
    // guaranteed present here — the route refuses the upgrade earlier
    // when `direct` mode has no key configured.
    return { authorization: `Bearer ${deps.openaiApiKey ?? ""}` };
  }
  return {
    authorization: `Bearer ${deps.masterKey ?? ""}`,
    "x-litellm-spend-logs-metadata": JSON.stringify({
      openwhispr_request_id: requestId,
      openwhispr_user_id: userId,
    }),
  };
}

/**
 * Bridge a client WS and an upstream WS with Beta↔GA frame translation.
 *
 * Exported for direct unit-testing with a pair of in-memory `ws` sockets.
 * Wires both directions and the close/error propagation; returns once the
 * listeners are attached (the bridge lives for the socket lifetime).
 */
export function bridgeRealtimeSockets(
  clientSocket: WebSocket,
  upstreamSocket: WebSocket,
  log?: { warn: (obj: unknown, msg: string) => void },
): void {
  // Buffer client frames that arrive before the upstream WS is OPEN —
  // the desktop client may send `transcription_session.update` the
  // instant its socket opens, before our upstream dial completes. Each
  // entry is a [raw, isBinary] tuple so binary-ness survives buffering.
  const pendingTuples: Array<[RawData, boolean]> = [];
  let upstreamOpen = upstreamSocket.readyState === WebSocket.OPEN;

  const forwardClientFrame = (raw: RawData, isBinary: boolean): void => {
    if (isBinary) {
      // Audio payloads — forward verbatim, no translation.
      upstreamSocket.send(raw);
      return;
    }
    const parsed = parseRealtimeFrame(raw.toString());
    if (!parsed.ok) {
      log?.warn(
        { event: "realtime.frame.dropped", direction: "client_to_upstream", reason: parsed.reason },
        "dropped malformed realtime frame (client -> upstream)",
      );
      return;
    }
    const translated = translateClientToUpstream(parsed.frame);
    upstreamSocket.send(JSON.stringify(translated));
  };

  clientSocket.on("message", (raw: RawData, isBinary: boolean) => {
    if (!upstreamOpen) {
      pendingTuples.push([raw, isBinary]);
      return;
    }
    forwardClientFrame(raw, isBinary);
  });

  upstreamSocket.on("open", () => {
    upstreamOpen = true;
    for (const [raw, isBinary] of pendingTuples) {
      forwardClientFrame(raw, isBinary);
    }
    pendingTuples.length = 0;
  });

  upstreamSocket.on("message", (raw: RawData, isBinary: boolean) => {
    if (clientSocket.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      clientSocket.send(raw);
      return;
    }
    const parsed = parseRealtimeFrame(raw.toString());
    if (!parsed.ok) {
      log?.warn(
        { event: "realtime.frame.dropped", direction: "upstream_to_client", reason: parsed.reason },
        "dropped malformed realtime frame (upstream -> client)",
      );
      return;
    }
    const translated = translateUpstreamToClient(parsed.frame);
    clientSocket.send(JSON.stringify(translated));
  });

  // Close propagation — when either side closes, close the other with the
  // same code/reason so neither half lingers.
  const closeBoth = (initiator: "client" | "upstream", code: number, reason: Buffer): void => {
    const peer = initiator === "client" ? upstreamSocket : clientSocket;
    if (peer.readyState === WebSocket.OPEN || peer.readyState === WebSocket.CONNECTING) {
      // WS close codes 1000–1015 + 3000–4999 are valid on the wire;
      // anything else (e.g. 1006 abnormal) is normalized to 1011.
      const safeCode =
        (code >= 3000 && code <= 4999) || (code >= 1000 && code <= 1003) ? code : 1011;
      try {
        peer.close(safeCode, reason.toString().slice(0, 120));
      } catch {
        peer.terminate();
      }
    }
  };
  clientSocket.on("close", (code, reason) => closeBoth("client", code, reason));
  upstreamSocket.on("close", (code, reason) => closeBoth("upstream", code, reason));

  clientSocket.on("error", () => {
    if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.terminate();
  });
  upstreamSocket.on("error", () => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      // Surface the upstream failure in-band before tearing down so the
      // desktop client sees a definitive close rather than a silent drop.
      try {
        clientSocket.close(1011, "realtime upstream error");
      } catch {
        clientSocket.terminate();
      }
    }
  });
}

/**
 * Build the realtime WSS frame-aware relay plugin.
 *
 * Returns a Fastify plugin (signature consumed by `buildAllRoutes`).
 * Registers `@fastify/websocket` and a single `/v1/realtime` WS route.
 * The global `dualAuthHook` (`onRequest`) plus this route's
 * `preValidation` enforce auth BEFORE @fastify/websocket performs the
 * upgrade.
 */
export const buildRealtimeRoutes = (deps: RealtimeDeps) =>
  async function realtimeRoutes(app: FastifyInstance): Promise<void> {
    // @fastify/websocket — registered scoped to this plugin. It hooks the
    // server `upgrade` event and runs the full Fastify request lifecycle
    // (onRequest -> preValidation -> handler) on the upgrade request, so
    // the global dual-auth onRequest hook fires before the upgrade
    // completes. The upstream-leg handshake ceiling (Phase 04 / D-27)
    // moves onto the upstream `ws` client below — `@fastify/websocket`'s
    // `options` is the server-side `ws.ServerOptions`, which has no
    // client-handshake-timeout knob.
    const websocketPlugin = (await import("@fastify/websocket")).default;
    await app.register(websocketPlugin);

    app.get(
      "/v1/realtime",
      {
        websocket: true,
        // preValidation runs after the global dual-auth onRequest hook
        // populated req.user; defensive re-check so we never upgrade an
        // unauthenticated request. Throwing AuthError aborts the upgrade
        // with the canonical 401 envelope.
        preValidation: async (req: FastifyRequest) => {
          const user = req.user;
          if (!user || !user.id) {
            throw new AuthError("UNAUTHORIZED", "unauthorized");
          }
          // R31 — `direct` mode requires OPENAI_API_KEY. Refuse the
          // upgrade loudly here (503) rather than dialing OpenAI with an
          // empty bearer and surfacing an opaque upstream 401.
          if (deps.backend === "direct" && !deps.openaiApiKey) {
            throw new AuthError("UNAUTHORIZED", "unauthorized");
          }
        },
      },
      (clientSocket: WebSocket, req: FastifyRequest) => {
        const userId = req.user?.id ?? "anonymous";
        const rawUrl = req.raw.url ?? req.url;
        const upstreamUrl = buildUpstreamUrl(deps, rawUrl, userId);
        const headers = buildUpstreamHeaders(deps, userId, req.id);

        // Phase 04 / Plan 07 / D-27 — 10s upstream handshake ceiling.
        // Without it a stuck-connecting upstream (TCP up, WS upgrade never
        // completes) would hold the desktop client's session open
        // indefinitely.
        const upstreamSocket = new WebSocket(upstreamUrl, {
          headers,
          handshakeTimeout: 10_000,
        });
        bridgeRealtimeSockets(clientSocket, upstreamSocket, req.log);
      },
    );
  };

export default buildRealtimeRoutes;
