// SPDX-License-Identifier: FSL-1.1-ALv2
// R24 — the explicit `opts.request` injection seam is the sanctioned
// production path for binding an SSRF-wrapped dispatcher at boot.
//
// These cases pin two contracts the R24 fix depends on:
//   1. When `opts.request` is injected, `buildLitellmClient` skips
//      `assertSsrfInstalled` — no `SsrfDispatcherNotInstalledError` even
//      when the process-global dispatcher carries NO SSRF marker. This is
//      the property that makes the Cloud-plane routes survive a stray
//      `setGlobalDispatcher(new Agent())` after boot.
//   2. The injected `request` is the function actually invoked for every
//      method (chatCompletions / chatCompletionsStream / audioTranscriptions
//      / passthrough) — the client never falls back to undici's global
//      `request`.
//
// A no-injection client on a bare global still throws — proving the gate
// is not globally disabled, only bypassed for the injected path.

import { Readable } from "node:stream";
import { MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLitellmClient,
  type LitellmClientConfig,
  SsrfDispatcherNotInstalledError,
} from "../../src/index.js";

const BASE = "http://litellm:4000";

function baseConfig(): LitellmClientConfig {
  return {
    baseUrl: BASE,
    masterKey: "sk-master-test",
    providerKeys: { openrouter: "sk-or-test", groq: "gsk-test" },
    defaultChatModel: "qwen3.6-plus",
    defaultSttModel: "whisper-large-v3",
    defaultRealtimeModel: "gpt-realtime",
    // R32 — timeout posture is config-sourced; mirror the prior literals.
    headersTimeoutMs: 30_000,
    bodyTimeoutMs: 120_000,
    errorDrainTimeoutMs: 15_000,
    // litellm-patterns A4 — single-attempt to keep the seam-test
    // request-count assertions deterministic.
    retryMaxAttempts: 1,
    retryBaseMs: 1,
    retryCapMs: 5,
  };
}

// A bare MockAgent with NO `openwhispr.ssrf-wrapped` marker — simulates the
// process-global dispatcher after a stray `setGlobalDispatcher` clobber.
let bareGlobal: MockAgent;

beforeEach(() => {
  bareGlobal = new MockAgent({ connections: 1 });
  bareGlobal.disableNetConnect();
  setGlobalDispatcher(bareGlobal);
});

afterEach(async () => {
  await bareGlobal.close();
});

function okResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: { text: async () => "{}" },
  };
}

describe("R24 — injected request seam bypasses the global-dispatcher gate", () => {
  it("chatCompletions: injected request invoked, no SsrfDispatcherNotInstalledError on a bare global", async () => {
    const injected = vi.fn(async () => okResponse());
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: injected as unknown as typeof import("undici").request,
    });
    const res = await client.chatCompletions({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);
    expect(injected).toHaveBeenCalledTimes(1);
    expect(injected.mock.calls[0]?.[0]).toBe(`${BASE}/v1/chat/completions`);
  });

  it("audioTranscriptions: injected request invoked on a bare global", async () => {
    const injected = vi.fn(async () => okResponse());
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: injected as unknown as typeof import("undici").request,
    });
    const res = await client.audioTranscriptions({
      body: Readable.from(["audio-bytes"]),
      contentType: "audio/wav",
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);
    expect(injected).toHaveBeenCalledTimes(1);
  });

  it("chatCompletionsStream: injected request invoked on a bare global", async () => {
    const injected = vi.fn(async () => okResponse());
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: injected as unknown as typeof import("undici").request,
    });
    const res = await client.chatCompletionsStream({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);
    expect(injected).toHaveBeenCalledTimes(1);
  });

  it("no-injection client on the SAME bare global still throws SsrfDispatcherNotInstalledError", async () => {
    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    await expect(
      client.chatCompletions({
        model: "qwen3.6-plus",
        messages: [{ role: "user", content: "hi" }],
        userId: "u1",
        requestId: "r1",
      }),
    ).rejects.toBeInstanceOf(SsrfDispatcherNotInstalledError);
  });
});
