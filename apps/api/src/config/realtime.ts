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

// ─── R31 DEFECT 6 — relay-injected transcription session config ─────────
// The immutable cloud client runs PRECONFIGURED (it never sends a
// `session.update` — see openaiRealtimeStreaming.js:135). In our Design B
// reverse-proxy relay there is no ephemeral-token mint, so the RELAY must
// itself inject a GA `session.update` on upstream open to configure the
// transcription session. These defaults are the transcription config that
// the relay-originated `session.update` carries. ALL are env-overridable
// (LOCKER-01: `config/` is the sanctioned env-read boundary; LOCKER-03: no
// hardcoded literals in route code).

/**
 * Default transcription model the relay-injected `session.update` carries
 * in `session.audio.input.transcription.model`.
 *
 * `gpt-4o-transcribe` is the broadly-available GA OpenAI realtime
 * transcription model — every OpenAI org with realtime access can use it
 * (verified live: `gpt-4o-transcribe-diarize` requires a special
 * organization grant and OpenAI answers `invalid_parameter — your
 * organization does not have access to this transcription model`).
 *
 * RETIREMENT CAVEAT: `gpt-4o-transcribe` (2025-03-20) is scheduled to
 * retire ~June 2026. Operators running past that date MUST pin a current
 * model via `REALTIME_TRANSCRIPTION_MODEL` — `gpt-4o-transcribe-diarize`
 * (GA, retirement 2027) if their org has the grant, or whatever the
 * then-current realtime-transcription model is. In `REALTIME_BACKEND=
 * litellm` mode this is instead the internal LiteLLM model alias.
 */
export const DEFAULT_REALTIME_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";

/**
 * Default PCM sample rate (Hz) for the relay-injected
 * `session.audio.input.format` object. The immutable client streams
 * 24 kHz 16-bit PCM. Overridable via `REALTIME_INPUT_AUDIO_RATE`.
 */
export const DEFAULT_REALTIME_INPUT_AUDIO_RATE = 24_000;

/**
 * Default server-VAD turn-detection parameters for the relay-injected
 * `session.audio.input.turn_detection` object. Mirrors the values the
 * non-preconfigured client branch uses (openaiRealtimeStreaming.js).
 * Overridable via `REALTIME_VAD_THRESHOLD`, `REALTIME_VAD_SILENCE_MS`,
 * `REALTIME_VAD_PREFIX_PADDING_MS`.
 */
export const DEFAULT_REALTIME_VAD_THRESHOLD = 0.6;
export const DEFAULT_REALTIME_VAD_SILENCE_MS = 600;
export const DEFAULT_REALTIME_VAD_PREFIX_PADDING_MS = 500;

/**
 * R31 DEFECT 6 — transcription-session config carried by the
 * relay-injected GA `session.update` frame. The relay ORIGINATES this
 * frame on upstream open (the preconfigured cloud client never sends its
 * own `session.update`). All fields are operator-overridable.
 */
export interface RealtimeTranscriptionConfig {
  /** GA transcription model (`session.audio.input.transcription.model`). */
  model: string;
  /** PCM sample rate (Hz) for `session.audio.input.format`. */
  inputAudioRate: number;
  /** server_vad turn-detection parameters for `session.audio.input.turn_detection`. */
  vadThreshold: number;
  vadSilenceMs: number;
  vadPrefixPaddingMs: number;
}

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
  /**
   * R31 DEFECT 6 — transcription-session config the relay injects on
   * upstream open. Always populated (defaults applied) for BOTH backends —
   * the preconfigured client never sends its own `session.update`, so the
   * relay must originate one regardless of backend.
   */
  transcription: RealtimeTranscriptionConfig;
}

/**
 * R31 DEFECT 6 — the all-defaults transcription config. Used as a
 * fallback by `routes/index.ts` when no `realtimeConfig` was threaded
 * (`transcription` is a required `RealtimeDeps` field — the relay must
 * always be able to originate a `session.update`).
 */
export const DEFAULT_REALTIME_TRANSCRIPTION: RealtimeTranscriptionConfig = {
  model: DEFAULT_REALTIME_TRANSCRIPTION_MODEL,
  inputAudioRate: DEFAULT_REALTIME_INPUT_AUDIO_RATE,
  vadThreshold: DEFAULT_REALTIME_VAD_THRESHOLD,
  vadSilenceMs: DEFAULT_REALTIME_VAD_SILENCE_MS,
  vadPrefixPaddingMs: DEFAULT_REALTIME_VAD_PREFIX_PADDING_MS,
};

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
 * Parse a finite, positive number from an env var, falling back to a
 * default. A blank, non-numeric, or non-positive value yields the
 * default (loud-fail is reserved for `REALTIME_BACKEND`; a malformed VAD
 * tuning knob degrades gracefully to the documented default).
 */
function numericEnv(raw: string | undefined, fallback: number): number {
  const v = trim(raw);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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

  // R31 DEFECT 6 — transcription-session config carried by the
  // relay-injected `session.update`. Resolved for BOTH backends (the
  // preconfigured client never sends its own update).
  const transcription: RealtimeTranscriptionConfig = {
    model: trim(env.REALTIME_TRANSCRIPTION_MODEL) ?? DEFAULT_REALTIME_TRANSCRIPTION_MODEL,
    inputAudioRate: numericEnv(env.REALTIME_INPUT_AUDIO_RATE, DEFAULT_REALTIME_INPUT_AUDIO_RATE),
    vadThreshold: numericEnv(env.REALTIME_VAD_THRESHOLD, DEFAULT_REALTIME_VAD_THRESHOLD),
    vadSilenceMs: numericEnv(env.REALTIME_VAD_SILENCE_MS, DEFAULT_REALTIME_VAD_SILENCE_MS),
    vadPrefixPaddingMs: numericEnv(
      env.REALTIME_VAD_PREFIX_PADDING_MS,
      DEFAULT_REALTIME_VAD_PREFIX_PADDING_MS,
    ),
  };

  return { backend, openaiRealtimeUrl, openaiApiKey, openaiRealtimeModel, transcription };
}
