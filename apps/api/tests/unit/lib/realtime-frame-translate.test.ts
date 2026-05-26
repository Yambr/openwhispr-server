// SPDX-License-Identifier: FSL-1.1-ALv2
// R31 — unit tests for the pure Beta↔GA realtime frame mappers.
//
// These exercise the frame-translation half of the R31 fix from a
// fixture corpus. The mappers are pure (no sockets, no I/O), so this
// suite is exhaustive and fast. A regression here (Beta vocabulary
// leaking upstream, GA vocabulary leaking to the client) FAILS at the
// unit level — one of the two test layers that close the R31 gap.

import { describe, expect, it } from "vitest";
import { REALTIME_LANGUAGE_WHITELIST } from "../../../src/config/realtime.js";
import {
  buildRelaySessionUpdateFrame,
  MAX_REALTIME_FRAME_BYTES,
  parseRealtimeFrame,
  type RealtimeFrame,
  type RelayTranscriptionConfig,
  translateClientToUpstream,
  translateUpstreamToClient,
} from "../../../src/lib/realtime-frame-translate.js";

/** PCM sample rate the immutable desktop client streams (24 kHz). */
const REALTIME_PCM_SAMPLE_RATE = 24_000;

/**
 * Drive the Beta→GA session-payload transform through the public mapper:
 * wrap `session` in a `transcription_session.update` frame, translate it,
 * and return the resulting GA `session` object. The flat→nested payload
 * restructuring is an internal helper of `translateClientToUpstream`; this
 * exercises it via the public surface (no test-only export needed).
 */
function betaToGaSessionPayload(session: Record<string, unknown>): Record<string, unknown> {
  const ga = translateClientToUpstream({ type: "transcription_session.update", session });
  return ga.session as Record<string, unknown>;
}

describe("parseRealtimeFrame", () => {
  it("parses a well-formed frame with a string type", () => {
    const r = parseRealtimeFrame('{"type":"session.created","session":{"id":"sess_1"}}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.frame.type).toBe("session.created");
      expect(r.frame.session).toEqual({ id: "sess_1" });
    }
  });

  it("rejects non-JSON payloads", () => {
    const r = parseRealtimeFrame("not json at all");
    expect(r).toEqual({ ok: false, reason: "not_json" });
  });

  it("rejects JSON arrays (not an object frame)", () => {
    const r = parseRealtimeFrame('["session.created"]');
    expect(r).toEqual({ ok: false, reason: "not_object" });
  });

  it("rejects JSON null", () => {
    const r = parseRealtimeFrame("null");
    expect(r).toEqual({ ok: false, reason: "not_object" });
  });

  it("rejects a JSON object with no string type", () => {
    expect(parseRealtimeFrame('{"session":{}}')).toEqual({ ok: false, reason: "no_type" });
    expect(parseRealtimeFrame('{"type":42}')).toEqual({ ok: false, reason: "no_type" });
  });

  it("rejects an oversized payload WITHOUT invoking JSON.parse (DoS bound)", () => {
    // A payload one byte over the cap. It is valid JSON shape-wise but
    // must be rejected on size alone.
    const huge = `{"type":"x","blob":"${"a".repeat(MAX_REALTIME_FRAME_BYTES)}"}`;
    expect(Buffer.byteLength(huge, "utf8")).toBeGreaterThan(MAX_REALTIME_FRAME_BYTES);
    expect(parseRealtimeFrame(huge)).toEqual({ ok: false, reason: "too_large" });
  });

  it("accepts a payload exactly at the byte cap", () => {
    // Build a frame whose UTF-8 byte length is exactly the cap.
    const envelope = '{"type":"x","b":""}';
    const pad = MAX_REALTIME_FRAME_BYTES - Buffer.byteLength(envelope, "utf8");
    const exact = `{"type":"x","b":"${"a".repeat(pad)}"}`;
    expect(Buffer.byteLength(exact, "utf8")).toBe(MAX_REALTIME_FRAME_BYTES);
    expect(parseRealtimeFrame(exact).ok).toBe(true);
  });

  it("counts UTF-8 bytes, not UTF-16 code units, for the size bound", () => {
    // A multi-byte char understates length via String.length.
    const r = parseRealtimeFrame('{"type":"emoji","v":"😀"}');
    expect(r.ok).toBe(true);
  });
});

describe("betaToGaSessionPayload — DEFECT 4 flat→nested transform", () => {
  it("nests the exact flat Beta payload the immutable client sends", () => {
    // This is verbatim the `session` object from
    // openwhispr/src/helpers/openaiRealtimeStreaming.js handleMessage().
    const ga = betaToGaSessionPayload({
      input_audio_format: "pcm16",
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
      turn_detection: {
        type: "server_vad",
        threshold: 0.6,
        silence_duration_ms: 600,
        prefix_padding_ms: 500,
      },
    });
    expect(ga).toEqual({
      type: "transcription",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: REALTIME_PCM_SAMPLE_RATE },
          transcription: { model: "gpt-4o-mini-transcribe" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.6,
            silence_duration_ms: 600,
            prefix_padding_ms: 500,
          },
        },
      },
    });
  });

  it("maps g711 audio formats to their GA mime types", () => {
    expect(
      (
        betaToGaSessionPayload({ input_audio_format: "g711_ulaw" }).audio as Record<
          string,
          Record<string, unknown>
        >
      ).input.format,
    ).toEqual({ type: "audio/pcmu" });
    expect(
      (
        betaToGaSessionPayload({ input_audio_format: "g711_alaw" }).audio as Record<
          string,
          Record<string, unknown>
        >
      ).input.format,
    ).toEqual({ type: "audio/pcma" });
  });

  it("carries an explicit null turn_detection through (manual-commit mode)", () => {
    const ga = betaToGaSessionPayload({
      input_audio_format: "pcm16",
      turn_detection: null,
    });
    expect((ga.audio as Record<string, Record<string, unknown>>).input.turn_detection).toBeNull();
  });

  it("preserves an already-GA-shaped audio.input.format object unchanged", () => {
    const ga = betaToGaSessionPayload({
      input_audio_format: { type: "audio/pcm", rate: 16_000 },
    });
    expect((ga.audio as Record<string, Record<string, unknown>>).input.format).toEqual({
      type: "audio/pcm",
      rate: 16_000,
    });
  });

  it("preserves non-audio top-level fields (e.g. include)", () => {
    const ga = betaToGaSessionPayload({
      input_audio_format: "pcm16",
      include: ["item.input_audio_transcription.logprobs"],
    });
    expect(ga.include).toEqual(["item.input_audio_transcription.logprobs"]);
  });

  it("merges a client-supplied nested audio object", () => {
    const ga = betaToGaSessionPayload({
      input_audio_transcription: { model: "gpt-4o-transcribe" },
      audio: { output: { voice: "alloy" }, input: { noise_reduction: { type: "near_field" } } },
    });
    const audio = ga.audio as Record<string, Record<string, unknown>>;
    expect(audio.output).toEqual({ voice: "alloy" });
    expect(audio.input.noise_reduction).toEqual({ type: "near_field" });
    expect(audio.input.transcription).toEqual({ model: "gpt-4o-transcribe" });
  });

  it("returns a bare {type:transcription} when the session is empty", () => {
    expect(betaToGaSessionPayload({})).toEqual({ type: "transcription" });
  });
});

describe("translateClientToUpstream — Beta → GA", () => {
  it("rewrites transcription_session.update to session.update with nested GA payload", () => {
    const beta: RealtimeFrame = {
      type: "transcription_session.update",
      session: {
        input_audio_format: "pcm16",
        input_audio_transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
      },
    };
    const ga = translateClientToUpstream(beta);
    expect(ga.type).toBe("session.update");
    expect(ga.session).toEqual({
      type: "transcription",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: REALTIME_PCM_SAMPLE_RATE },
          transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
        },
      },
    });
  });

  it("synthesizes a minimal session object when the client omits session", () => {
    const ga = translateClientToUpstream({ type: "transcription_session.update" });
    expect(ga.type).toBe("session.update");
    expect(ga.session).toEqual({ type: "transcription" });
  });

  it("forces session.type to transcription even if the client sent another type", () => {
    const ga = translateClientToUpstream({
      type: "transcription_session.update",
      session: { type: "realtime", foo: 1 },
    });
    expect((ga.session as Record<string, unknown>).type).toBe("transcription");
    expect((ga.session as Record<string, unknown>).foo).toBe(1);
  });

  it("preserves sibling fields on the frame (event_id etc.)", () => {
    const ga = translateClientToUpstream({
      type: "transcription_session.update",
      event_id: "evt_42",
      session: {},
    });
    expect(ga.event_id).toBe("evt_42");
    expect(ga.type).toBe("session.update");
  });

  it("passes input_audio_buffer.append through unchanged (byte-identical Beta/GA)", () => {
    const audioFrame: RealtimeFrame = {
      type: "input_audio_buffer.append",
      audio: "base64data",
    };
    expect(translateClientToUpstream(audioFrame)).toBe(audioFrame);
  });

  it("passes input_audio_buffer.commit through unchanged (byte-identical Beta/GA)", () => {
    const commit: RealtimeFrame = { type: "input_audio_buffer.commit" };
    expect(translateClientToUpstream(commit)).toBe(commit);
  });

  it("passes input_audio_buffer.clear through unchanged", () => {
    const clear: RealtimeFrame = { type: "input_audio_buffer.clear" };
    expect(translateClientToUpstream(clear)).toBe(clear);
  });

  it("does NOT rewrite a GA session.update the client might already send", () => {
    const gaFrame: RealtimeFrame = { type: "session.update", session: {} };
    expect(translateClientToUpstream(gaFrame)).toBe(gaFrame);
  });
});

describe("translateUpstreamToClient — passthrough (GA→GA per current client contract)", () => {
  it("passes session.created through unchanged", () => {
    const frame: RealtimeFrame = {
      type: "session.created",
      session: { id: "sess_1" },
    };
    const result = translateUpstreamToClient(frame);
    // Same-reference passthrough — the actually-shipping client speaks GA
    // throughout (case "session.created" handler in its switch table).
    expect(result).toBe(frame);
    expect(result.type).toBe("session.created");
  });

  it("passes session.updated through unchanged (no rename, no payload flatten)", () => {
    const frame: RealtimeFrame = { type: "session.updated", session: {} };
    const result = translateUpstreamToClient(frame);
    expect(result).toBe(frame);
    expect(result.type).toBe("session.updated");
  });

  it("passes a session.updated frame with a nested GA payload through unchanged (no GA→Beta flatten)", () => {
    const frame: RealtimeFrame = {
      type: "session.updated",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24_000 },
            transcription: { model: "gpt-4o-mini-transcribe" },
          },
        },
      },
    };
    const result = translateUpstreamToClient(frame);
    // The GA payload is forwarded BYTE-FOR-BYTE — same reference, no
    // nested→flat restructuring. The client now reads the GA shape itself.
    expect(result).toBe(frame);
    expect(result.session).toBe(frame.session);
  });

  it("passes transcription delta result frames through unchanged (byte-identical Beta/GA)", () => {
    const delta: RealtimeFrame = {
      type: "conversation.item.input_audio_transcription.delta",
      delta: "hello",
    };
    expect(translateUpstreamToClient(delta)).toBe(delta);
  });

  it("passes transcription completed result frames through unchanged (byte-identical Beta/GA)", () => {
    const done: RealtimeFrame = {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "The quick brown fox",
    };
    expect(translateUpstreamToClient(done)).toBe(done);
  });

  it("passes input_audio_buffer.committed / speech_* events through unchanged", () => {
    for (const type of [
      "input_audio_buffer.committed",
      "input_audio_buffer.speech_started",
      "input_audio_buffer.speech_stopped",
    ]) {
      const f: RealtimeFrame = { type };
      expect(translateUpstreamToClient(f)).toBe(f);
    }
  });

  it("passes GA error frames through unchanged (client already speaks error)", () => {
    const err: RealtimeFrame = {
      type: "error",
      error: { type: "invalid_request_error", message: "bad" },
    };
    expect(translateUpstreamToClient(err)).toBe(err);
  });

  it("does not double-translate an already-Beta frame", () => {
    const already: RealtimeFrame = { type: "transcription_session.created" };
    expect(translateUpstreamToClient(already)).toBe(already);
  });
});

describe("round-trip — client emits GA, server passes through both directions", () => {
  it("client transcription_session.update survives as nested GA session.update; upstream session.created passes through unchanged", () => {
    const clientFrame: RealtimeFrame = {
      type: "transcription_session.update",
      session: {
        input_audio_format: "pcm16",
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
        turn_detection: { type: "server_vad" },
      },
    };
    const upstreamSaw = translateClientToUpstream(clientFrame);
    expect(upstreamSaw.type).toBe("session.update");
    // The GA upstream MUST receive the nested object shape — the flat
    // Beta shape is what produced the empty-transcript bug (DEFECT 4).
    const session = upstreamSaw.session as Record<string, Record<string, Record<string, unknown>>>;
    expect(session.type).toBe("transcription");
    expect(session.audio.input.format).toEqual({ type: "audio/pcm", rate: 24_000 });
    expect(session.audio.input.transcription).toEqual({ model: "gpt-4o-mini-transcribe" });

    // Upstream replies with GA session.created. The actually-shipping client
    // handles `case "session.created"` directly — the server passes the
    // frame through with no rename.
    const upstreamReply: RealtimeFrame = { type: "session.created", session: {} };
    const clientGetsBack = translateUpstreamToClient(upstreamReply);
    expect(clientGetsBack).toBe(upstreamReply);
    expect(clientGetsBack.type).toBe("session.created");
  });

  it("a GA transcription result event survives untranslated to the client", () => {
    // The relay must NOT mangle the result events — the empty-transcript
    // symptom would persist if a result frame were dropped or renamed.
    const gaResult: RealtimeFrame = {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "The quick brown fox jumps over the lazy dog",
    };
    const toClient = translateUpstreamToClient(gaResult);
    expect(toClient.type).toBe("conversation.item.input_audio_transcription.completed");
    expect(toClient.transcript).toBe("The quick brown fox jumps over the lazy dog");
  });
});

describe("buildRelaySessionUpdateFrame — R31 DEFECT 6 relay-originated session config", () => {
  const config: RelayTranscriptionConfig = {
    model: "gpt-4o-transcribe-diarize",
    inputAudioRate: 24_000,
    vadThreshold: 0.6,
    vadSilenceMs: 600,
    vadPrefixPaddingMs: 500,
  };

  it("builds a GA session.update frame with the canonical nested transcription shape", () => {
    const frame = buildRelaySessionUpdateFrame(config);
    expect(frame.type).toBe("session.update");
    const session = frame.session as {
      type: string;
      audio: { input: Record<string, unknown> };
    };
    // The GA discriminator — without it GA opens a conversational session.
    expect(session.type).toBe("transcription");
    // The nested GA `audio.input.format` OBJECT (DEFECT 4 shape) — a flat
    // string is rejected by GA.
    expect(session.audio.input.format).toEqual({ type: "audio/pcm", rate: 24_000 });
  });

  it("threads the operator-configured transcription model in-band", () => {
    const frame = buildRelaySessionUpdateFrame({ ...config, model: "internal-asr-alias" });
    const session = frame.session as {
      audio: { input: { transcription: { model: string } } };
    };
    // The GA transcription session takes its model from
    // session.audio.input.transcription.model — operator-controlled.
    expect(session.audio.input.transcription.model).toBe("internal-asr-alias");
  });

  it("threads the operator-configured sample rate and server_vad params", () => {
    const frame = buildRelaySessionUpdateFrame({
      ...config,
      inputAudioRate: 16_000,
      vadThreshold: 0.42,
      vadSilenceMs: 800,
      vadPrefixPaddingMs: 250,
    });
    const input = (
      frame.session as {
        audio: { input: Record<string, Record<string, unknown>> };
      }
    ).audio.input;
    expect(input.format).toEqual({ type: "audio/pcm", rate: 16_000 });
    expect(input.turn_detection).toEqual({
      type: "server_vad",
      threshold: 0.42,
      silence_duration_ms: 800,
      prefix_padding_ms: 250,
    });
  });

  it("produces a frame the GA-shape detector accepts (not flat Beta)", () => {
    // The relay-injected frame must NOT carry the flat Beta triplet —
    // `input_audio_format`/`input_audio_transcription`/`turn_detection`
    // directly under `session`. They live under `audio.input`.
    const session = buildRelaySessionUpdateFrame(config).session as Record<string, unknown>;
    expect(session.input_audio_format).toBeUndefined();
    expect(session.input_audio_transcription).toBeUndefined();
    expect(session.turn_detection).toBeUndefined();
  });
});

describe("buildRelaySessionUpdateFrame language injection (v1.0.9)", () => {
  // v1.0.9 — the relay-originated `session.update` carries an optional
  // `language` hint inside `session.audio.input.transcription`. Resolved by
  // the route layer from `?language=` query (per-upgrade) or
  // `REALTIME_DEFAULT_LANGUAGE` env (fallback). When unresolved the field
  // is OMITTED from the frame so OpenAI's auto-detect path is used. The
  // injection is the smallest possible additive: a conditional spread on
  // the `transcription` object. The translator helpers
  // (`translateClientToUpstream` / `translateUpstreamToClient`) stay
  // untouched per the v1.0.8 full-passthrough contract.
  const baseConfig: RelayTranscriptionConfig = {
    model: "gpt-4o-transcribe",
    inputAudioRate: 24_000,
    vadThreshold: 0.6,
    vadSilenceMs: 600,
    vadPrefixPaddingMs: 500,
  };

  it("M1: when config.language is set, the built frame carries transcription.language", () => {
    // The route layer resolves `?language=ru` and writes it into the
    // per-upgrade transcription config; the builder must forward that
    // value into the GA `session.audio.input.transcription.language`
    // field so OpenAI's GA decoder skips its multi-script auto-detect
    // pass on each short VAD segment.
    const frame = buildRelaySessionUpdateFrame({ ...baseConfig, language: "ru" });
    const transcription = (
      frame.session as {
        audio: { input: { transcription: { model: string; language?: string } } };
      }
    ).audio.input.transcription;
    expect(transcription.language).toBe("ru");
    // The model field is unaffected.
    expect(transcription.model).toBe("gpt-4o-transcribe");
  });

  it("M4: when config.language is undefined, the field is OMITTED (not 'undefined')", () => {
    // OpenAI's GA `session.update` validator REJECTS a literal
    // `{ "language": undefined }` payload (it survives JSON.stringify
    // as a missing key, but if the spread emitted `language: undefined`
    // a sibling field-presence assertion would mis-fire). The builder
    // must conditionally spread — `'language' in transcription === false`
    // is the contract.
    const frame = buildRelaySessionUpdateFrame(baseConfig);
    const transcription = (
      frame.session as {
        audio: { input: { transcription: Record<string, unknown> } };
      }
    ).audio.input.transcription;
    expect("language" in transcription).toBe(false);
  });

  it("M6: REALTIME_LANGUAGE_WHITELIST is exported and frozen to ['en','ru'] for v1", () => {
    // The whitelist is a single exported constant — widening it to more
    // languages (`zh`, `ja`, …) is gated on widening the DB
    // `users.locale` CHECK constraint. Documented in
    // docs/operations.md §REALTIME_DEFAULT_LANGUAGE. The route's query
    // validator and the env validator BOTH consult this constant; any
    // drift between them would silently un-validate one of the two
    // paths.
    expect(REALTIME_LANGUAGE_WHITELIST).toEqual(["en", "ru"]);
  });
});
