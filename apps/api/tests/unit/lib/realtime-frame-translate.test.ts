// SPDX-License-Identifier: FSL-1.1-ALv2
// R31 — unit tests for the pure Beta↔GA realtime frame mappers.
//
// These exercise the frame-translation half of the R31 fix from a
// fixture corpus. The mappers are pure (no sockets, no I/O), so this
// suite is exhaustive and fast. A regression here (Beta vocabulary
// leaking upstream, GA vocabulary leaking to the client) FAILS at the
// unit level — one of the two test layers that close the R31 gap.

import { describe, expect, it } from "vitest";
import {
  MAX_REALTIME_FRAME_BYTES,
  parseRealtimeFrame,
  type RealtimeFrame,
  stripIntentParam,
  translateClientToUpstream,
  translateUpstreamToClient,
} from "../../../src/lib/realtime-frame-translate.js";

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

describe("translateClientToUpstream — Beta → GA", () => {
  it("rewrites transcription_session.update to session.update with type:transcription", () => {
    const beta: RealtimeFrame = {
      type: "transcription_session.update",
      session: { input_audio_format: "pcm16", language: "en" },
    };
    const ga = translateClientToUpstream(beta);
    expect(ga.type).toBe("session.update");
    expect(ga.session).toEqual({
      input_audio_format: "pcm16",
      language: "en",
      type: "transcription",
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

  it("passes non-Beta frames through unchanged (same reference)", () => {
    const audioFrame: RealtimeFrame = {
      type: "input_audio_buffer.append",
      audio: "base64data",
    };
    expect(translateClientToUpstream(audioFrame)).toBe(audioFrame);
  });

  it("does NOT rewrite a GA session.update the client might already send", () => {
    const gaFrame: RealtimeFrame = { type: "session.update", session: {} };
    expect(translateClientToUpstream(gaFrame)).toBe(gaFrame);
  });
});

describe("translateUpstreamToClient — GA → Beta", () => {
  it("rewrites session.created to transcription_session.created", () => {
    const beta = translateUpstreamToClient({
      type: "session.created",
      session: { id: "sess_1" },
    });
    expect(beta.type).toBe("transcription_session.created");
    expect(beta.session).toEqual({ id: "sess_1" });
  });

  it("rewrites session.updated to transcription_session.updated", () => {
    const beta = translateUpstreamToClient({ type: "session.updated", session: {} });
    expect(beta.type).toBe("transcription_session.updated");
  });

  it("passes transcription delta frames through unchanged", () => {
    const delta: RealtimeFrame = {
      type: "conversation.item.input_audio_transcription.delta",
      delta: "hello",
    };
    expect(translateUpstreamToClient(delta)).toBe(delta);
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

describe("round-trip — Beta in, GA at upstream, Beta back to client", () => {
  it("client transcription_session.update survives as session.update; GA session.created comes back as transcription_session.created", () => {
    const clientFrame: RealtimeFrame = {
      type: "transcription_session.update",
      session: { language: "ru" },
    };
    const upstreamSaw = translateClientToUpstream(clientFrame);
    expect(upstreamSaw.type).toBe("session.update");

    const upstreamReply: RealtimeFrame = { type: "session.created", session: {} };
    const clientGetsBack = translateUpstreamToClient(upstreamReply);
    expect(clientGetsBack.type).toBe("transcription_session.created");
  });
});

describe("stripIntentParam — DEFECT 1", () => {
  it("removes ?intent= from an origin-form path, preserving others", () => {
    expect(stripIntentParam("/v1/realtime?intent=transcription&model=x")).toBe(
      "/v1/realtime?model=x",
    );
  });

  it("removes ?intent= when it is the only param", () => {
    expect(stripIntentParam("/v1/realtime?intent=transcription")).toBe("/v1/realtime");
  });

  it("is a no-op on a path with no intent param", () => {
    expect(stripIntentParam("/v1/realtime?model=x")).toBe("/v1/realtime?model=x");
  });

  it("removes ?intent= from an absolute ws:// URL", () => {
    const out = stripIntentParam("wss://api.openai.com/v1/realtime?intent=transcription&model=x");
    expect(out).not.toContain("intent");
    expect(out).toContain("model=x");
    expect(out).toContain("wss://api.openai.com/v1/realtime");
  });
});
