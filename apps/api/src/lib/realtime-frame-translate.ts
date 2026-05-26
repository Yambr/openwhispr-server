// SPDX-License-Identifier: FSL-1.1-ALv2
// R31 — OpenAI Realtime frame translation (pure functions).
//
// Background (corrected 2026-05-26 against actually-shipping client):
//   The original R31 work assumed the immutable OpenWhispr desktop client
//   spoke the *Beta* OpenAI Realtime vocabulary (transcription_session.*
//   events). That read of the client was wrong. The actually-shipping
//   client — upstream OpenWhispr at
//   /Users/nick/openwhispr/src/helpers/openaiRealtimeStreaming.js:132-177
//   AND Yambr fork v1.7.8 (peer-confirmed bundle grep) — speaks OpenAI
//   Realtime GA throughout. Its switch table handles only
//   `case "session.created"` and `case "session.updated"`; it has zero
//   references to `transcription_session.*` events. Its outbound
//   `session.update` frame is already the GA nested shape
//   (`{ type:"session.update", session:{ type:"transcription",
//   audio:{ input:{...} } } }`) — no flat→nested rewrite needed.
//
// This module is the FRAME-TRANSLATION half of the relay. It is a set of
// *pure* functions — no sockets, no I/O — so the mapping can be unit-
// tested exhaustively from a fixture corpus. The frame-aware relay in
// `routes/realtime.ts` calls `translateClientToUpstream` on every
// client→upstream frame and `translateUpstreamToClient` on every
// upstream→client frame.
//
// Translation contract (only the realtime *transcription* path):
//   client → upstream:
//     * `transcription_session.update` → `session.update` with the flat
//       Beta payload restructured into the nested GA shape (see
//       `betaToGaSessionPayload`). This translation is legacy /
//       defence-in-depth: the actually-shipping client emits GA
//       `session.update` directly which falls through the early return
//       below; the rewrite remains because the cost is zero and it keeps
//       the surface backwards-compatible with any future Beta-speaking
//       client.
//     * `input_audio_buffer.append` / `.commit` / `.clear` and everything
//       else passes through verbatim.
//   upstream → client:
//     * FULL PASSTHROUGH. `session.created`, `session.updated`,
//       transcription results, buffer events, errors — every frame is
//       returned unchanged (same object reference). The actually-shipping
//       client speaks GA, so no rename / no payload flatten is required.
//
// DATA-PATH NOTE (2026-05-26 prod incident, peer wd6g78xz reproduced on
// prod k8s with real-mic input): the server's stale Beta-rename of
// upstream `session.created` to `transcription_session.created` landed
// the client's switch table on the default branch, `pendingResolve` was
// never invoked, WSS connection timed out after 15 seconds, zero
// transcription frames were received. The fix is the
// `translateUpstreamToClient` passthrough below.
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
  /**
   * v1.0.9 — optional ISO-639-1 language hint. When set, the builder
   * spreads it into `session.audio.input.transcription.language`;
   * when undefined the field is OMITTED from the wire frame (OpenAI's
   * auto-detect path is used). Mirrors `RealtimeTranscriptionConfig`
   * in `config/realtime.ts` so the route layer can pass either object
   * to the builder unmodified.
   */
  language?: string;
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
          // v1.0.9 — conditional spread on `language`: when undefined
          // the field is OMITTED from the wire frame (the GA validator
          // accepts a missing field as "auto-detect", but rejects a
          // literal `language: null`). The route layer resolves the
          // value per-upgrade from `?language=` query (preferred) or
          // `REALTIME_DEFAULT_LANGUAGE` env (fallback). See
          // `docs/operations.md` §REALTIME_DEFAULT_LANGUAGE.
          transcription: {
            model: config.model,
            ...(config.language ? { language: config.language } : {}),
          },
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
 * Translate a CLIENT→UPSTREAM frame.
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
 * Note: the `transcription_session.update` translation is legacy /
 * defence-in-depth. The actually-shipping desktop client (upstream
 * OpenWhispr + Yambr fork v1.7.8) emits GA `session.update` directly
 * with the nested shape, which falls through the early return below.
 * The translation remains because the cost is zero and it keeps the
 * surface backwards-compatible with any future Beta-speaking client.
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
 * Translate an UPSTREAM→CLIENT frame.
 *
 * Currently a pure passthrough — every upstream frame is returned with
 * the same object reference, no type rewrite, no payload restructuring.
 * The actually-shipping desktop client (upstream OpenWhispr at
 * /Users/nick/openwhispr/src/helpers/openaiRealtimeStreaming.js:132-177
 * AND Yambr fork v1.7.8) speaks OpenAI Realtime GA throughout: its switch
 * table handles `case "session.created"` / `case "session.updated"`
 * directly and has zero references to `transcription_session.*` events.
 *
 * The function is retained as a named export — and `routes/realtime.ts`
 * calls it on every upstream→client frame — so a future divergence (e.g.
 * a future client variant that needs GA→something rewrites) can hook here
 * without touching call sites in the relay.
 *
 * Operational note: the relay self-injects its own GA `session.update`
 * frame on upstream open (DEFECT 6, see {@link buildRelaySessionUpdateFrame}).
 * The upstream's resulting `session.updated` echo is swallowed by the
 * `relaySessionUpdateEchoPending` flag in `bridgeRealtimeSockets` BEFORE
 * this translator is called — the swallow is a quality-of-life filter
 * (no unsolicited update echoes reach the client) rather than a
 * correctness gate.
 */
export function translateUpstreamToClient(frame: RealtimeFrame): RealtimeFrame {
  return frame;
}
