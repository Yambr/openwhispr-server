// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 07 / Task 1 — hermetic mock-realtime WS server tests.
//
// Test client uses the `ws` library (NOT @fastify/websocket — that's the
// server-side plugin). All tests bind on port 0 (ephemeral) so parallel
// vitest workers do not collide.

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  BETA_SHAPE_REJECT_CODE,
  detectBetaSessionPayload,
  detectBetaShape,
  MOCK_TRANSCRIPT,
  type StopHandle,
  startMockRealtimeServer,
} from "./server.js";

describe("mock-realtime WS server", () => {
  let handle: StopHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = undefined;
    }
  });

  it("emits session.created on connect with sess_-prefixed id", async () => {
    handle = await startMockRealtimeServer({ port: 0, assertGaShape: false });
    const ws = new WebSocket(handle.url);
    const msg = await new Promise<string>((res, rej) => {
      ws.once("message", (data) => res(data.toString()));
      ws.once("error", rej);
    });
    const parsed = JSON.parse(msg);
    expect(parsed.type).toBe("session.created");
    expect(parsed.session.object).toBe("realtime.session");
    expect(typeof parsed.session.id).toBe("string");
    expect(parsed.session.id.startsWith("sess_")).toBe(true);
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("emits response.done on response.create with resp_-prefixed id", async () => {
    handle = await startMockRealtimeServer({ port: 0, assertGaShape: false });
    const ws = new WebSocket(handle.url);
    // Wait for opening session.created to drain.
    await new Promise<void>((res) => ws.once("message", () => res()));
    ws.send(JSON.stringify({ type: "response.create" }));
    const reply = await new Promise<string>((res) => {
      ws.once("message", (data) => res(data.toString()));
    });
    const parsed = JSON.parse(reply);
    expect(parsed.type).toBe("response.done");
    expect(typeof parsed.response.id).toBe("string");
    expect(parsed.response.id.startsWith("resp_")).toBe(true);
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("transparently handles WebSocket ping/pong frames at protocol layer", async () => {
    // The `ws` library auto-replies to incoming ping frames with a pong
    // at the protocol layer (RFC 6455 §5.5.2/5.5.3) — there is no
    // application-layer handler to write. We assert the channel survives
    // a ping by sending one mid-stream and confirming a subsequent JSON
    // request/response round-trip still works. RTT is bounded so a
    // ping-induced disconnect would surface as a timeout.
    handle = await startMockRealtimeServer({ port: 0, assertGaShape: false });
    const ws = new WebSocket(handle.url);
    // Attach 'message' BEFORE awaiting open so we don't lose the
    // immediate session.created frame to a race condition.
    await new Promise<void>((res) => ws.once("message", () => res()));
    const start = Date.now();
    ws.ping(Buffer.from("ping-payload"));
    // Send response.create AFTER ping; if the ping disrupted the channel
    // we would never see a response.done.
    ws.send(JSON.stringify({ type: "response.create" }));
    const reply = await new Promise<string>((res, rej) => {
      ws.once("message", (data) => res(data.toString()));
      ws.once("error", rej);
    });
    const rtt = Date.now() - start;
    expect(JSON.parse(reply).type).toBe("response.done");
    // Loopback round-trip far under 1s; ping did not stall the connection.
    expect(rtt).toBeLessThan(1000);
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("services 10 sequential request/response cycles", async () => {
    handle = await startMockRealtimeServer({ port: 0, assertGaShape: false });
    const ws = new WebSocket(handle.url);
    // Drain session.created.
    await new Promise<void>((res) => ws.once("message", () => res()));
    for (let i = 0; i < 10; i++) {
      ws.send(JSON.stringify({ type: "response.create", n: i }));
      const reply = await new Promise<string>((res) => {
        ws.once("message", (data) => res(data.toString()));
      });
      const parsed = JSON.parse(reply);
      expect(parsed.type).toBe("response.done");
      expect(parsed.response.id.startsWith("resp_")).toBe(true);
    }
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("graceful stop() closes open connections cleanly with code 1000", async () => {
    handle = await startMockRealtimeServer({ port: 0, assertGaShape: false });
    const ws = new WebSocket(handle.url);
    // Attach 'message' BEFORE awaiting open so we don't race the
    // immediate session.created emission. The connection is fully
    // open by the time the first frame arrives.
    await new Promise<void>((res) => ws.once("message", () => res()));
    const closed = new Promise<{ code: number }>((res) => {
      ws.once("close", (code) => res({ code }));
    });
    await handle.stop();
    handle = undefined;
    const result = await closed;
    // Either 1000 (normal) or 1001 (going away) or 1006 (abnormal but
    // server-initiated close on Fastify shutdown can yield 1005/1006 on
    // some Node versions). Per acceptance: clean close — accept 1000-1006.
    expect(result.code).toBeGreaterThanOrEqual(1000);
    expect(result.code).toBeLessThanOrEqual(1006);
  });

  it("binds on a configurable port (port:0 yields an ephemeral bound URL)", async () => {
    handle = await startMockRealtimeServer({ port: 0, assertGaShape: false });
    expect(handle.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/v1\/realtime$/);
    // Extract the bound port; must be a non-zero ephemeral port.
    const m = handle.url.match(/:(\d+)\//);
    expect(m).not.toBeNull();
    const port = Number(m![1]);
    expect(port).toBeGreaterThan(0);
    expect(port).not.toBe(0);
  });

  it("ignores non-JSON garbage frames without crashing the connection", async () => {
    // Coverage: exercise the JSON.parse failure path.
    handle = await startMockRealtimeServer({ port: 0, assertGaShape: false });
    const ws = new WebSocket(handle.url);
    await new Promise<void>((res) => ws.once("message", () => res()));
    // Send garbage that JSON.parse will reject.
    ws.send("this-is-not-json{");
    // Then send a valid response.create — server must still reply.
    ws.send(JSON.stringify({ type: "response.create" }));
    const reply = await new Promise<string>((res) => {
      ws.once("message", (data) => res(data.toString()));
    });
    expect(JSON.parse(reply).type).toBe("response.done");
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("replies to GA session.update with session.updated echoing the session payload", async () => {
    handle = await startMockRealtimeServer({ port: 0, assertGaShape: false });
    const ws = new WebSocket(handle.url);
    await new Promise<void>((res) => ws.once("message", () => res()));
    ws.send(JSON.stringify({ type: "session.update", session: { type: "transcription" } }));
    const reply = await new Promise<string>((res) => {
      ws.once("message", (data) => res(data.toString()));
    });
    const parsed = JSON.parse(reply);
    expect(parsed.type).toBe("session.updated");
    expect(parsed.session.type).toBe("transcription");
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  // ─── R31 — GA-shape assertion (the regression-catching layer) ──────────
  //
  // The mock requires `?intent=transcription` (R31 LIVE-RUN FINDING — GA
  // opens a transcription session ONLY with that param). `GA_URL` appends
  // it so a clean GA transcription upgrade succeeds.
  const gaUrl = () => `${handle?.url}?intent=transcription`;

  it("R31: rejects an upgrade MISSING ?intent=transcription (fifth-layer regression)", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    // A relay that dropped ?intent= would connect without it — GA would
    // open a conversational realtime session. The mock fails it.
    const ws = new WebSocket(handle.url);
    const outcome = await new Promise<{ errorFrame?: unknown; code: number }>((resolve) => {
      let errorFrame: unknown;
      ws.on("message", (d) => {
        errorFrame = JSON.parse(d.toString());
      });
      ws.on("close", (code) => resolve({ errorFrame, code }));
    });
    expect(outcome.code).toBe(BETA_SHAPE_REJECT_CODE);
    expect((outcome.errorFrame as { error?: { code?: string } }).error?.code).toBe(
      "beta_api_shape_disabled",
    );
  });

  it("R31: rejects an upgrade carrying the OpenAI-Beta opt-in header", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(gaUrl(), { headers: { "OpenAI-Beta": "realtime=v1" } });
    const code = await new Promise<number>((resolve) => {
      ws.on("close", (c) => resolve(c));
    });
    expect(code).toBe(BETA_SHAPE_REJECT_CODE);
  });

  it("R31: rejects a Beta transcription_session.update frame on the upstream leg", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(gaUrl());
    await new Promise<void>((res) => ws.once("message", () => res())); // drain session.created
    ws.send(JSON.stringify({ type: "transcription_session.update", session: {} }));
    const outcome = await new Promise<{ errorFrame?: unknown; code: number }>((resolve) => {
      let errorFrame: unknown;
      ws.on("message", (d) => {
        errorFrame = JSON.parse(d.toString());
      });
      ws.on("close", (code) => resolve({ errorFrame, code }));
    });
    expect(outcome.code).toBe(BETA_SHAPE_REJECT_CODE);
    expect((outcome.errorFrame as { error?: { code?: string } }).error?.code).toBe(
      "beta_api_shape_disabled",
    );
  });

  it("R31: accepts a clean GA transcription upgrade (?intent=transcription, no OpenAI-Beta header)", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(gaUrl());
    const first = await new Promise<string>((res, rej) => {
      ws.once("message", (d) => res(d.toString()));
      ws.once("error", rej);
    });
    expect(JSON.parse(first).type).toBe("session.created");
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("R31: assertGaShape:false restores legacy accept-anything behaviour", async () => {
    handle = await startMockRealtimeServer({ port: 0, assertGaShape: false });
    // No ?intent= AND an OpenAI-Beta header — both ignored when the
    // assertion is off.
    const ws = new WebSocket(handle.url, { headers: { "OpenAI-Beta": "realtime=v1" } });
    const first = await new Promise<string>((res, rej) => {
      ws.once("message", (d) => res(d.toString()));
      ws.once("error", rej);
    });
    expect(JSON.parse(first).type).toBe("session.created");
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  // ─── R31 third layer — DATA PATH ───────────────────────────────────────

  it("R31: rejects a flat Beta session.update payload (DEFECT 4)", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(gaUrl());
    await new Promise<void>((res) => ws.once("message", () => res())); // drain session.created
    // GA frame name but flat Beta payload — the exact DEFECT 4 regression.
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: { type: "transcription", input_audio_format: "pcm16" },
      }),
    );
    const outcome = await new Promise<{ errorFrame?: unknown; code: number }>((resolve) => {
      let errorFrame: unknown;
      ws.on("message", (d) => {
        errorFrame = JSON.parse(d.toString());
      });
      ws.on("close", (code) => resolve({ errorFrame, code }));
    });
    expect(outcome.code).toBe(BETA_SHAPE_REJECT_CODE);
    expect((outcome.errorFrame as { error?: { code?: string } }).error?.code).toBe(
      "beta_api_shape_disabled",
    );
  });

  it("R31: accepts a nested GA session.update payload", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(gaUrl());
    await new Promise<void>((res) => ws.once("message", () => res()));
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: { input: { format: { type: "audio/pcm", rate: 24_000 } } },
        },
      }),
    );
    const reply = await new Promise<string>((res) => ws.once("message", (d) => res(d.toString())));
    expect(JSON.parse(reply).type).toBe("session.updated");
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("R31: configured session + append→commit emits committed + transcription delta + completed with a transcript", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(gaUrl());
    await new Promise<void>((res) => ws.once("message", () => res())); // drain session.created
    const frames: Array<{ type?: string; transcript?: string; delta?: string }> = [];
    ws.on("message", (d) => frames.push(JSON.parse(d.toString())));
    // R31 DEFECT 6 — a GA transcription session must be CONFIGURED (a
    // `session.update` received) before a commit yields a transcript.
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: { type: "transcription", audio: { input: { format: { type: "audio/pcm" } } } },
      }),
    );
    ws.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: Buffer.alloc(2_048).toString("base64"),
      }),
    );
    ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    await new Promise<void>((res) => setTimeout(res, 200));
    const types = frames.map((f) => f.type);
    expect(types).toContain("input_audio_buffer.committed");
    expect(types).toContain("conversation.item.input_audio_transcription.delta");
    const completed = frames.find(
      (f) => f.type === "conversation.item.input_audio_transcription.completed",
    );
    expect(completed?.transcript).toBe(MOCK_TRANSCRIPT);
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("R31 DEFECT 6: an UNCONFIGURED session (no session.update) commit yields committed but NO transcript", async () => {
    // Mirrors the live symptom (segments:0, textLength:0) a preconfigured
    // client hits when the relay fails to inject its own session.update.
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(gaUrl());
    await new Promise<void>((res) => ws.once("message", () => res())); // drain session.created
    const frames: Array<{ type?: string }> = [];
    ws.on("message", (d) => frames.push(JSON.parse(d.toString())));
    // NO session.update — the transcription session is never configured.
    ws.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: Buffer.alloc(2_048).toString("base64"),
      }),
    );
    ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    await new Promise<void>((res) => setTimeout(res, 200));
    const types = frames.map((f) => f.type);
    expect(types).toContain("input_audio_buffer.committed");
    expect(types).not.toContain("conversation.item.input_audio_transcription.completed");
    expect(types).not.toContain("conversation.item.input_audio_transcription.delta");
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("R31: commit on an empty buffer emits input_audio_buffer_commit_empty (no transcript)", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(gaUrl());
    await new Promise<void>((res) => ws.once("message", () => res()));
    ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    const reply = await new Promise<string>((res) => ws.once("message", (d) => res(d.toString())));
    const parsed = JSON.parse(reply);
    expect(parsed.type).toBe("error");
    expect(parsed.error.code).toBe("input_audio_buffer_commit_empty");
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("R31: counts binary audio frames toward the commit buffer", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(gaUrl());
    await new Promise<void>((res) => ws.once("message", () => res()));
    const frames: Array<{ type?: string }> = [];
    ws.on("message", (d) => frames.push(JSON.parse(d.toString())));
    // R31 DEFECT 6 — configure the session before committing.
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: { type: "transcription", audio: { input: { format: { type: "audio/pcm" } } } },
      }),
    );
    ws.send(Buffer.alloc(4_096)); // binary audio frame
    ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    await new Promise<void>((res) => setTimeout(res, 200));
    expect(frames.map((f) => f.type)).toContain(
      "conversation.item.input_audio_transcription.completed",
    );
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });
});

describe("detectBetaShape — pure GA-shape detector", () => {
  it("flags an OpenAI-Beta header (lowercased by Node)", () => {
    expect(
      detectBetaShape("/v1/realtime?intent=transcription", { "openai-beta": "realtime=v1" }),
    ).toMatch(/OpenAI-Beta/);
  });
  it("flags a missing ?intent=transcription (would open a conversational session)", () => {
    expect(detectBetaShape("/v1/realtime", {})).toMatch(/intent=transcription missing/);
  });
  it("flags a non-transcription ?intent= value", () => {
    expect(detectBetaShape("/v1/realtime?intent=conversation", {})).toMatch(
      /intent=transcription missing/,
    );
  });
  it("returns null for a clean GA transcription request (?intent=transcription, no Beta header)", () => {
    expect(
      detectBetaShape("/v1/realtime?intent=transcription", { authorization: "Bearer k" }),
    ).toBeNull();
  });
  it("flags an undefined raw URL (no ?intent= at all)", () => {
    expect(detectBetaShape(undefined, {})).toMatch(/intent=transcription missing/);
  });
});

describe("detectBetaSessionPayload — pure flat-Beta session-payload detector", () => {
  it("flags a flat input_audio_format field", () => {
    expect(
      detectBetaSessionPayload({ type: "transcription", input_audio_format: "pcm16" }),
    ).toMatch(/input_audio_format/);
  });
  it("flags a flat input_audio_transcription field", () => {
    expect(
      detectBetaSessionPayload({ input_audio_transcription: { model: "gpt-4o-mini-transcribe" } }),
    ).toMatch(/input_audio_transcription/);
  });
  it("flags a turn_detection directly on session", () => {
    expect(detectBetaSessionPayload({ turn_detection: { type: "server_vad" } })).toMatch(
      /turn_detection/,
    );
  });
  it("flags a string GA audio.input.format", () => {
    expect(detectBetaSessionPayload({ audio: { input: { format: "pcm16" } } })).toMatch(
      /not an object/,
    );
  });
  it("returns null for a clean nested GA payload", () => {
    expect(
      detectBetaSessionPayload({
        type: "transcription",
        audio: { input: { format: { type: "audio/pcm", rate: 24_000 } } },
      }),
    ).toBeNull();
  });
  it("returns null for a non-object session", () => {
    expect(detectBetaSessionPayload(null)).toBeNull();
    expect(detectBetaSessionPayload("nope")).toBeNull();
  });
});
