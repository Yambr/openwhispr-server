// SPDX-License-Identifier: FSL-1.1-ALv2
// R31 — env-driven realtime-relay backend configuration.
//
// The frame-aware `/v1/realtime` relay (routes/realtime.ts) supports TWO
// upstream backend modes, selected by the `REALTIME_BACKEND` env var:
//
//   * `direct` (default) — the relay connects STRAIGHT to OpenAI's GA
//     `wss://api.openai.com/v1/realtime`, bypassing LiteLLM entirely. The
//     api process controls every upstream header, so no `OpenAI-Beta`
//     header is ever sent — the relay is the GA contract boundary. This
//     mode REQUIRES `OPENAI_API_KEY` to be reachable by the api process
//     (the relay uses it as the upstream `Authorization: Bearer`).
//
//   * `litellm` — the relay connects to the bundled LiteLLM
//     `/v1/realtime`; LiteLLM in turn dials OpenAI. For corporate
//     operators who run an internal LiteLLM that already speaks OpenAI
//     Realtime GA.
//
// WHY `direct` IS THE DEFAULT (R31 — debug session r31-realtime-ga-shape):
//   LiteLLM 1.83.14's OpenAI realtime WS path injects the retired
//   `OpenAI-Beta: realtime=v1` header onto its OpenAI leg from a code path
//   that the documented `OpenAIRealtime._get_additional_headers` override
//   seam does NOT cover (verified live: a container patch dropping the
//   header from that method had no effect; OpenAI still answered
//   `beta_api_shape_disabled`). Until LiteLLM ships a release that does
//   OpenAI Realtime GA cleanly, the bundled `litellm` backend cannot
//   complete a GA realtime session. `direct` mode sidesteps LiteLLM
//   entirely and is verified working end-to-end against OpenAI's GA
//   `/v1/realtime`. Defaulting to `direct` keeps the fresh-clone
//   `docker compose up` quickstart functional. Corporate operators whose
//   internal LiteLLM does GA realtime correctly opt into `litellm`.
//
// LOCKER-01: `config/` is the sanctioned `process.env.*` read boundary.
// `loadRealtimeConfigFromEnv()` is called once at the entrypoint seam
// (apps/api/src/index.ts) and the result is threaded into the realtime
// route deps; the route file itself never touches `process.env`.
//
// LOCKER-03: the OpenAI realtime URL is an env-overridable default
// (`OPENAI_REALTIME_URL`) rather than a hardcoded literal in route code —
// same posture the streaming-token-provider URLs adopted.

/** The two supported relay upstream backends. */
export type RealtimeBackend = "litellm" | "direct";

/**
 * Default backend when `REALTIME_BACKEND` is unset — `direct` (straight to
 * OpenAI's GA /v1/realtime). See the file header for why this is NOT
 * `litellm`: the bundled LiteLLM 1.83.14 cannot do OpenAI Realtime GA.
 */
export const DEFAULT_REALTIME_BACKEND: RealtimeBackend = "direct";

/**
 * Default OpenAI GA realtime WS endpoint used by `direct` mode. The GA
 * URL carries NO `?intent=` and the relay attaches NO `OpenAI-Beta`
 * header. Operators behind an egress proxy / Azure OpenAI override it via
 * `OPENAI_REALTIME_URL`.
 */
export const DEFAULT_OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";

/**
 * Default `?model=` value used by `direct` mode. OpenAI's GA
 * `/v1/realtime` REQUIRES a `?model=` query param (even for a
 * transcription session — it rejects a model-less connect with
 * `missing_model`), and it must be a REAL OpenAI model name (the LiteLLM
 * routing alias `realtime-default` is rejected with `invalid_model`).
 * `gpt-realtime` is OpenAI's current GA realtime model. Operators pin a
 * different one via `OPENAI_REALTIME_MODEL`.
 */
export const DEFAULT_OPENAI_REALTIME_MODEL = "gpt-realtime";

/** Resolved realtime-relay configuration. */
export interface RealtimeConfig {
  /** Selected upstream backend. */
  backend: RealtimeBackend;
  /**
   * `direct`-mode upstream WS URL. Always populated (defaults to
   * {@link DEFAULT_OPENAI_REALTIME_URL}); only consumed when
   * `backend === "direct"`.
   */
  openaiRealtimeUrl: string;
  /**
   * `direct`-mode upstream credential. Populated ONLY when
   * `backend === "direct"` AND `OPENAI_API_KEY` is set — in `litellm`
   * mode the key is never read (LiteLLM owns the provider credential).
   * `undefined` in `litellm` mode, or in `direct` mode with no key
   * configured (the route then surfaces an operator-actionable error).
   */
  openaiApiKey: string | undefined;
  /**
   * `direct`-mode `?model=` value. In `litellm` mode the relay forces the
   * LiteLLM routing alias on `?model=`; in `direct` mode it forces THIS
   * real OpenAI model name (OpenAI's GA `/v1/realtime` rejects a
   * model-less connect with `missing_model` and the LiteLLM alias with
   * `invalid_model`). Defaults to {@link DEFAULT_OPENAI_REALTIME_MODEL};
   * operators override via `OPENAI_REALTIME_MODEL`. Always populated in
   * `direct` mode, `undefined` in `litellm` mode.
   */
  openaiRealtimeModel: string | undefined;
}

/** Error thrown when `REALTIME_BACKEND` carries an unrecognized value. */
export class RealtimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealtimeConfigError";
  }
}

function trim(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  return v && v.length > 0 ? v : undefined;
}

/**
 * Resolve {@link RealtimeConfig} from the environment.
 *
 * @param env Environment snapshot. Defaults to `process.env`; injected in
 *   unit tests to avoid mutating the global.
 * @throws {RealtimeConfigError} when `REALTIME_BACKEND` is set to a value
 *   other than `litellm` or `direct` (boot-fatal — caught at the
 *   entrypoint and turned into an EX_CONFIG exit).
 */
export function loadRealtimeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RealtimeConfig {
  const rawBackend = trim(env.REALTIME_BACKEND)?.toLowerCase();
  let backend: RealtimeBackend;
  if (rawBackend === undefined) {
    backend = DEFAULT_REALTIME_BACKEND;
  } else if (rawBackend === "litellm" || rawBackend === "direct") {
    backend = rawBackend;
  } else {
    throw new RealtimeConfigError(
      `REALTIME_BACKEND="${rawBackend}" is not a recognized realtime backend. ` +
        `Valid values: "litellm" (default — relay via the bundled LiteLLM) or ` +
        `"direct" (relay straight to OpenAI's GA /v1/realtime).`,
    );
  }

  const openaiRealtimeUrl = trim(env.OPENAI_REALTIME_URL) ?? DEFAULT_OPENAI_REALTIME_URL;

  // The OpenAI key is read ONLY in direct mode — in litellm mode LiteLLM
  // owns the provider credential and the api process must not depend on
  // OPENAI_API_KEY being present.
  const openaiApiKey = backend === "direct" ? trim(env.OPENAI_API_KEY) : undefined;
  // Direct-mode `?model=` — a real OpenAI model name (default
  // `gpt-realtime`). Read only in direct mode; litellm mode forces the
  // LiteLLM routing alias instead and never consults this var.
  const openaiRealtimeModel =
    backend === "direct"
      ? (trim(env.OPENAI_REALTIME_MODEL) ?? DEFAULT_OPENAI_REALTIME_MODEL)
      : undefined;

  return { backend, openaiRealtimeUrl, openaiApiKey, openaiRealtimeModel };
}
