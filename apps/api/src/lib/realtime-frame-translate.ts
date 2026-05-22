// SPDX-License-Identifier: FSL-1.1-ALv2
// R31 — OpenAI Realtime Beta↔GA frame translation (pure functions).
//
// Background (debug session r31-realtime-ga-beta-shape):
//   The immutable OpenWhispr desktop client speaks the *Beta* OpenAI
//   Realtime vocabulary — it opens `/v1/realtime?intent=transcription`
//   and waits for a `transcription_session.created` event, and its
//   first outbound frame is `transcription_session.update`. OpenAI
//   retired the Beta API: the GA `/v1/realtime` surface emits
//   `session.created` and consumes `session.update` (with a
//   `session.type: "transcription"` discriminator), and the `?intent=`
//   query param is gone. A transparent payload-opaque WS passthrough
//   cannot bridge that vocabulary gap, so OpenAI replies with
//   `invalid_request_error.beta_api_shape_disabled` and the socket
//   closes 4000.
//
// This module is the FRAME-TRANSLATION half of the fix. It is a set of
// *pure* functions — no sockets, no I/O — so the Beta↔GA mapping can be
// unit-tested exhaustively from a fixture corpus. The frame-aware relay
// in `routes/realtime.ts` calls `translateClientToUpstream` on every
// client→upstream frame and `translateUpstreamToClient` on every
// upstream→client frame.
//
// Translation contract (only the realtime *transcription* path):
//   client → upstream (Beta → GA):
//     * `transcription_session.update` → `session.update`. The frame is
//       renamed AND the `session` PAYLOAD is restructured from the flat
//       Beta shape into the nested GA shape (see `betaToGaSessionPayload`
//       below): GA moved `input_audio_format` / `input_audio_transcription`
//       / `turn_detection` under a nested `audio.input.*` object and
//       turned the audio format from a bare string into an object.
//     * `input_audio_buffer.append` / `.commit` / `.clear` — IDENTICAL in
//       Beta and GA; pass through verbatim.
//     * every other frame passes through verbatim.
//   upstream → client (GA → Beta):
//     * `session.created`  → `transcription_session.created`
//     * `session.updated`  → `transcription_session.updated`, and the
//       `session` payload is restructured from the nested GA shape back
//       into the flat Beta shape so a non-preconfigured client that reads
//       the echoed session config still sees Beta field names.
//     * transcription RESULT events
//       (`conversation.item.input_audio_transcription.delta` / `.completed`)
//       and buffer events (`input_audio_buffer.speech_started` /
//       `.speech_stopped` / `.committed`) are IDENTICAL in Beta and GA;
//       pass through verbatim — the desktop client already speaks those.
//     * every other frame (errors, etc.) passes through verbatim.
//
// DATA-PATH NOTE (R31 third layer — DEFECT 4): the empty-transcript bug
// was NOT an audio-frame or result-frame vocabulary gap (those frames are
// byte-identical Beta↔GA). It was the `session.update` PAYLOAD: GA rejects
// the flat Beta `session` shape with "Invalid type for
// 'session.audio.input.format': expected an object", so the transcription
// session was never configured and GA produced zero transcripts. The fix
// is the flat↔nested payload transform below.
//
// Hardening (T-03-07-07): the relay parses untrusted WS payloads. These
// functions therefore accept a raw string and return a discriminated
// result; malformed JSON, oversized payloads, and non-object frames are
// the caller's responsibility (see `parseRealtimeFrame`). The mappers
// themselves never throw.

/** Maximum byte length of a single realtime WS text frame we will parse. */
export const MAX_REALTIME_FRAME_BYTES = 1 * 1024 * 1024; // 1 MiB

/** A successfully parsed realtime frame: a JSON object with a string `type`. */
export interface RealtimeFrame {
  type: string;
  [key: string]: unknown;
}

/** Result of attempting to parse a raw WS payload into a realtime frame. */
export type ParseResult =
  | { ok: true; frame: RealtimeFrame }
  | { ok: false; reason: "too_large" | "not_json" | "not_object" | "no_type" };

/**
 * Parse a raw WS text payload into a {@link RealtimeFrame}.
 *
 * Defensive against the new parse attack surface introduced by the
 * frame-aware relay (T-03-07-07):
 *   * payloads above {@link MAX_REALTIME_FRAME_BYTES} are rejected
 *     without invoking `JSON.parse` (DoS bound),
 *   * non-JSON / non-object / typeless frames are rejected.
 *
 * The relay drops rejected frames (does NOT forward them) and keeps the
 * socket alive — a single malformed frame must not tear down a session.
 */
export function parseRealtimeFrame(raw: string): ParseResult {
  // Byte length, not code-unit length — a multi-byte UTF-8 payload could
  // exceed the cap while `raw.length` (UTF-16 units) understates it.
  if (Buffer.byteLength(raw, "utf8") > MAX_REALTIME_FRAME_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "not_object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== "string") {
    return { ok: false, reason: "no_type" };
  }
  return { ok: true, frame: obj as RealtimeFrame };
}

/** PCM sample rate the immutable desktop client streams (24 kHz, 16-bit). */
const REALTIME_PCM_SAMPLE_RATE = 24_000;

/** True for a plain (non-null, non-array) object. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Convert a Beta `input_audio_format` value into the GA `audio.input.format`
 * object.
 *
 * Beta sent a bare string (`"pcm16"` / `"g711_ulaw"` / `"g711_alaw"`); GA
 * requires an object `{ type: "audio/pcm", rate: 24000 }` (rejecting the
 * string with "Invalid type for 'session.audio.input.format': expected an
 * object"). If the client already sent an object (a GA-aware client, or a
 * field we do not recognize) it is passed through unchanged.
 */
function betaAudioFormatToGa(value: unknown): unknown {
  if (isPlainObject(value)) {
    return value; // already GA-shaped (or unknown) — do not second-guess.
  }
  if (typeof value !== "string") {
    return value;
  }
  switch (value) {
    case "pcm16":
      return { type: "audio/pcm", rate: REALTIME_PCM_SAMPLE_RATE };
    case "g711_ulaw":
      return { type: "audio/pcmu" };
    case "g711_alaw":
      return { type: "audio/pcma" };
    default:
      // Unknown string — wrap minimally rather than drop, so an operator
      // sees a definite GA error instead of a silently missing field.
      return { type: value };
  }
}

/** Inverse of {@link betaAudioFormatToGa}: GA format object → Beta string. */
function gaAudioFormatToBeta(value: unknown): unknown {
  if (typeof value === "string") {
    return value; // already Beta-shaped.
  }
  if (!isPlainObject(value)) {
    return value;
  }
  switch (value.type) {
    case "audio/pcm":
      return "pcm16";
    case "audio/pcmu":
      return "g711_ulaw";
    case "audio/pcma":
      return "g711_alaw";
    default:
      return typeof value.type === "string" ? value.type : value;
  }
}

/**
 * Restructure a Beta `transcription_session` payload into the nested GA
 * `session` payload for a `session.update` frame.
 *
 * Beta (flat) → GA (nested):
 *   { input_audio_format: "pcm16",
 *     input_audio_transcription: { model, language? },
 *     turn_detection: {...},
 *     ...rest }
 * becomes
 *   { type: "transcription",
 *     audio: { input: { format: { type:"audio/pcm", rate:24000 },
 *                       transcription: { model, language? },
 *                       turn_detection: {...} } },
 *     ...rest }
 *
 * Fields not part of the Beta audio triplet are preserved at the top
 * level (e.g. `include`). If the client already sent a nested `audio`
 * object (a GA-aware client) it is merged through unchanged. `type` is
 * always forced to `"transcription"` — the relay owns that discriminator.
 */
function betaToGaSessionPayload(session: Record<string, unknown>): Record<string, unknown> {
  const {
    input_audio_format,
    input_audio_transcription,
    turn_detection,
    type: _ignoredType,
    audio: existingAudio,
    ...rest
  } = session;

  const input: Record<string, unknown> =
    isPlainObject(existingAudio) && isPlainObject(existingAudio.input)
      ? { ...(existingAudio.input as Record<string, unknown>) }
      : {};

  if (input_audio_format !== undefined) {
    input.format = betaAudioFormatToGa(input_audio_format);
  }
  if (input_audio_transcription !== undefined) {
    input.transcription = input_audio_transcription;
  }
  // `turn_detection` is nullable in GA (null = manual commit). Carry it
  // through even when explicitly null so a client that disables VAD does.
  if (turn_detection !== undefined) {
    input.turn_detection = turn_detection;
  }

  const audio: Record<string, unknown> = isPlainObject(existingAudio) ? { ...existingAudio } : {};
  if (Object.keys(input).length > 0) {
    audio.input = input;
  }

  const ga: Record<string, unknown> = { ...rest, type: "transcription" };
  if (Object.keys(audio).length > 0) {
    ga.audio = audio;
  }
  return ga;
}

/**
 * Inverse of {@link betaToGaSessionPayload}: restructure a GA `session`
 * payload (as echoed back on `session.updated`) into the flat Beta shape
 * the immutable client's non-preconfigured branch reads.
 *
 * GA (nested) → Beta (flat). Fields the relay does not recognize are
 * preserved at the top level. The GA `type` discriminator is dropped (the
 * Beta frame name `transcription_session.updated` carries that meaning).
 */
function gaToBetaSessionPayload(session: Record<string, unknown>): Record<string, unknown> {
  const { audio, type: _gaType, ...rest } = session;
  const flat: Record<string, unknown> = { ...rest };
  if (isPlainObject(audio) && isPlainObject(audio.input)) {
    const input = audio.input as Record<string, unknown>;
    if (input.format !== undefined) {
      flat.input_audio_format = gaAudioFormatToBeta(input.format);
    }
    if (input.transcription !== undefined) {
      flat.input_audio_transcription = input.transcription;
    }
    if (input.turn_detection !== undefined) {
      flat.turn_detection = input.turn_detection;
    }
  }
  return flat;
}

/**
 * R31 DEFECT 6 — the transcription-session config the relay-originated
 * `session.update` carries. Mirrors `RealtimeTranscriptionConfig` in
 * `config/realtime.ts`; kept as a local interface so this pure module has
 * no dependency on the config layer.
 */
export interface RelayTranscriptionConfig {
  /** GA transcription model name. */
  model: string;
  /** PCM input sample rate (Hz). */
  inputAudioRate: number;
  /** server_vad turn-detection parameters. */
  vadThreshold: number;
  vadSilenceMs: number;
  vadPrefixPaddingMs: number;
}

/**
 * Build the GA `session.update` frame the relay ORIGINATES on upstream
 * open (R31 DEFECT 6).
 *
 * WHY THE RELAY ORIGINATES THIS FRAME
 * ===================================
 * The immutable cloud desktop client runs in PRECONFIGURED mode
 * (`ipcHandlers.js` sets `preconfigured: isCloud`, always true on the
 * cloud path). In that mode it DELIBERATELY never sends a
 * `session.update` — its comment (`openaiRealtimeStreaming.js:135`) reads
 * "Server-side ephemeral token already configured the session; sending an
 * update would strip language and noise-reduction." The client assumes
 * Design A: the server configures the transcription session at
 * ephemeral-token-mint time.
 *
 * We run Design B — a reverse-proxy WS relay, no ephemeral token. With a
 * silent (preconfigured) client, NOBODY configures the GA transcription
 * session: the client won't, and a translate-only relay only ever
 * restructures frames the client actually sends. The session stays
 * unconfigured → GA transcribes nothing → `segments:0, textLength:0`,
 * commit timeout (the exact reported symptom).
 *
 * The fix: in Design B the RELAY is the configuration point. It injects
 * this GA `session.update` itself on upstream open — exactly what Design
 * A's ephemeral-token mint did. The frame is the canonical GA nested
 * shape (the same shape `betaToGaSessionPayload` produces; this builder
 * ORIGINATES it rather than translating a client frame).
 *
 * GA shape produced:
 *   { type: "session.update",
 *     session: { type: "transcription",
 *       audio: { input: {
 *         format: { type: "audio/pcm", rate: <inputAudioRate> },
 *         transcription: { model: <model> },
 *         turn_detection: { type: "server_vad", threshold, ... } } } } }
 */
export function buildRelaySessionUpdateFrame(config: RelayTranscriptionConfig): RealtimeFrame {
  return {
    type: "session.update",
    session: {
      type: "transcription",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: config.inputAudioRate },
          transcription: { model: config.model },
          turn_detection: {
            type: "server_vad",
            threshold: config.vadThreshold,
            silence_duration_ms: config.vadSilenceMs,
            prefix_padding_ms: config.vadPrefixPaddingMs,
          },
        },
      },
    },
  };
}

/**
 * Translate a CLIENT→UPSTREAM frame from the Beta vocabulary the
 * immutable desktop client speaks into the GA vocabulary OpenAI's
 * (or LiteLLM's) GA `/v1/realtime` surface expects.
 *
 * Only `transcription_session.update` is rewritten:
 *   `{ type: "transcription_session.update", session: <flat Beta> }`
 *     → `{ type: "session.update", session: <nested GA, type:transcription> }`
 *
 * The GA `session.update` frame REQUIRES a `session.type` discriminator
 * AND the nested `audio.input.*` payload shape — the flat Beta shape is
 * rejected with "Invalid type for 'session.audio.input.format': expected
 * an object" (R31 DEFECT 4, the empty-transcript bug). The payload
 * restructuring is delegated to {@link betaToGaSessionPayload}.
 *
 * `input_audio_buffer.append` / `.commit` / `.clear` are byte-identical
 * in Beta and GA and fall through the early return UNCHANGED. Every other
 * frame type is likewise returned unchanged (same object reference).
 */
export function translateClientToUpstream(frame: RealtimeFrame): RealtimeFrame {
  if (frame.type !== "transcription_session.update") {
    return frame;
  }
  const incomingSession = isPlainObject(frame.session) ? frame.session : {};
  const { type: _clientType, session: _clientSession, ...rest } = frame;
  return {
    ...rest,
    type: "session.update",
    session: betaToGaSessionPayload(incomingSession),
  };
}

/**
 * Translate an UPSTREAM→CLIENT frame from the GA vocabulary back into the
 * Beta vocabulary the immutable desktop client waits for.
 *
 *   `session.created` → `transcription_session.created`
 *   `session.updated` → `transcription_session.updated` (the `session`
 *                       payload is also flattened GA→Beta so a
 *                       non-preconfigured client reading the echoed
 *                       config sees Beta field names).
 *
 * The preconfigured client blocks its session-startup state machine on
 * `transcription_session.created`; GA never emits that event, so without
 * this rewrite the client hangs until its own timeout.
 *
 * Transcription RESULT events
 * (`conversation.item.input_audio_transcription.delta` / `.completed`),
 * buffer events (`input_audio_buffer.speech_started` / `.speech_stopped` /
 * `.committed` / `.cleared`), `error`, `response.*` etc. are byte-identical
 * in Beta and GA and are returned UNCHANGED — the desktop client already
 * understands those names and payloads.
 */
export function translateUpstreamToClient(frame: RealtimeFrame): RealtimeFrame {
  if (frame.type === "session.created") {
    return { ...frame, type: "transcription_session.created" };
  }
  if (frame.type === "session.updated") {
    const out: RealtimeFrame = { ...frame, type: "transcription_session.updated" };
    if (isPlainObject(frame.session)) {
      out.session = gaToBetaSessionPayload(frame.session);
    }
    return out;
  }
  return frame;
}
