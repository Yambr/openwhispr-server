// SPDX-License-Identifier: Apache-2.0
// Phase 08 / Plan 03 / Task 2 — RED tests for the Fastify mock-litellm
// server. Drives buildApp() + the three endpoint contracts in
// PLAN.md `<behavior>` block.
//
// All tests use `app.inject()` (no real network listen) so they run
// fast and hermetic; the only real-time assertion (Test 6) uses
// `performance.now()` over 30 sequential injects with deliberately
// small (mean=100ms, sd=30ms) latencies so total runtime stays under
// 5s on a cold CI runner.

import { describe, expect, it } from "vitest";
import { buildApp, DEFAULT_CONFIG } from "./server.js";

describe("buildApp", () => {
  it("merges a partial config with DEFAULT_CONFIG", () => {
    const app = buildApp({ transcribeMeanMs: 17 });
    // buildApp doesn't expose config directly, but the value should be
    // observable through behaviour. Easier path: re-export the merged
    // config on the app instance. We assert it via the public hook.
    const merged = (app as unknown as { config: typeof DEFAULT_CONFIG }).config;
    expect(merged.transcribeMeanMs).toBe(17);
    expect(merged.chatMeanMs).toBe(DEFAULT_CONFIG.chatMeanMs);
    expect(merged.port).toBe(DEFAULT_CONFIG.port);
    return app.close();
  });
});

describe("GET /health/liveliness", () => {
  it("returns 200 with { status: 'ok' }", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/health/liveliness",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});

describe("POST /v1/audio/transcriptions", () => {
  it("returns 200 with a Whisper-shaped JSON body", async () => {
    const app = buildApp({ transcribeMeanMs: 50, transcribeSdMs: 0 });
    const boundary = "----WhisprMockBoundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="audio.wav"',
      "Content-Type: audio/wav",
      "",
      "RIFFmockaudiopayload",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/transcriptions",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as {
      text: string;
      duration: number;
      language: string;
    };
    expect(typeof json.text).toBe("string");
    expect(json.text.length).toBeGreaterThan(0);
    expect(json.duration).toBe(5);
    expect(json.language).toBe("en");
    await app.close();
  });

  it("drains the multipart body before responding (no half-duplex hang)", async () => {
    // If the handler does not iterate `req.parts()`, large multipart
    // bodies stall waiting for the body to be consumed. We assert the
    // handler completes within a generous bound (well under the
    // jitter latency × 4) for a 32KB payload.
    const app = buildApp({ transcribeMeanMs: 50, transcribeSdMs: 0 });
    const boundary = "----WhisprMockBoundary";
    const filler = "A".repeat(32 * 1024);
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="big.wav"',
      "Content-Type: audio/wav",
      "",
      filler,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const start = performance.now();
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/transcriptions",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    const elapsed = performance.now() - start;
    expect(res.statusCode).toBe(200);
    // 50ms jitter floor + multipart drain — must finish well under 2s.
    expect(elapsed).toBeLessThan(2000);
    await app.close();
  });
});

describe("POST /v1/chat/completions (sync)", () => {
  it("returns 200 with the chat.completion envelope when stream is false", async () => {
    const app = buildApp({ chatMeanMs: 50, chatSdMs: 0 });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
        stream: false,
      },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as {
      id: string;
      object: string;
      choices: Array<{
        message: { role: string; content: string };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    expect(json.object).toBe("chat.completion");
    expect(json.id).toMatch(/^chatcmpl-/);
    expect(json.choices.length).toBeGreaterThan(0);
    const choice = json.choices[0];
    expect(choice).toBeDefined();
    if (!choice) throw new Error("unreachable");
    expect(choice.message.role).toBe("assistant");
    expect(typeof choice.message.content).toBe("string");
    expect(choice.message.content.length).toBeGreaterThan(0);
    expect(choice.finish_reason).toBe("stop");
    expect(typeof json.usage.prompt_tokens).toBe("number");
    expect(typeof json.usage.completion_tokens).toBe("number");
    await app.close();
  });
});

describe("POST /v1/chat/completions (streaming)", () => {
  it("returns SSE chunks ending with data: [DONE]", async () => {
    const app = buildApp({
      streamFirstTokenMs: 30,
      streamFirstTokenSdMs: 0,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const body = res.body;
    // At least one chunk with the OpenAI stream-delta shape.
    expect(body).toMatch(/data: \{[^\n]*"choices"[^\n]*\}/);
    expect(body).toMatch(/data: \[DONE\]/);
    await app.close();
  });
});

describe("Statistical latency on /v1/audio/transcriptions", () => {
  it("30 sequential calls have mean elapsed time in [80, 180]ms with mean=100ms", async () => {
    const app = buildApp({ transcribeMeanMs: 100, transcribeSdMs: 30 });
    const boundary = "----WhisprMockBoundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="audio.wav"',
      "Content-Type: audio/wav",
      "",
      "RIFFmock",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const n = 30;
    const samples: number[] = [];
    for (let i = 0; i < n; i++) {
      const start = performance.now();
      const res = await app.inject({
        method: "POST",
        url: "/v1/audio/transcriptions",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
      samples.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
    }
    const mean = samples.reduce((a, b) => a + b, 0) / n;
    // Loose [80, 180]ms band: CI runners can add 20–50ms scheduler
    // jitter on top of the 100ms ± 30ms target.
    expect(mean).toBeGreaterThanOrEqual(80);
    expect(mean).toBeLessThanOrEqual(180);
    await app.close();
  }, 10_000);
});

describe("Unknown routes", () => {
  it("returns 404 for an unknown URL", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /v1/chat/completions defaults branch coverage", () => {
  it("honours an explicit model field on the sync path", async () => {
    const app = buildApp({ chatMeanMs: 50, chatSdMs: 0 });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: { model: "claude-haiku", stream: false },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { model: string };
    expect(json.model).toBe("claude-haiku");
    await app.close();
  });

  it("honours an explicit model field on the streaming path", async () => {
    const app = buildApp({
      streamFirstTokenMs: 20,
      streamFirstTokenSdMs: 0,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: { model: "claude-haiku", stream: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"model":"claude-haiku"');
    await app.close();
  });
});

describe("POST /v1/audio/transcriptions edge cases", () => {
  it("handles a non-multipart POST without crashing", async () => {
    const app = buildApp({ transcribeMeanMs: 50, transcribeSdMs: 0 });
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/transcriptions",
      headers: { "content-type": "application/json" },
      payload: { hello: "world" },
    });
    // Multipart short-circuit branch — handler still resolves.
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("drains a multipart body that contains a non-file field", async () => {
    const app = buildApp({ transcribeMeanMs: 50, transcribeSdMs: 0 });
    const boundary = "----WhisprMockBoundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="language"',
      "",
      "en",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="audio.wav"',
      "Content-Type: audio/wav",
      "",
      "RIFFmock",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/transcriptions",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("POST /v1/chat/completions default model branch", () => {
  it("falls back to gpt-4 when no model field is supplied (sync)", async () => {
    const app = buildApp({ chatMeanMs: 30, chatSdMs: 0 });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: { stream: false },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { model: string };
    expect(json.model).toBe("gpt-4");
    await app.close();
  });

  it("falls back to gpt-4 when no model field is supplied (stream)", async () => {
    const app = buildApp({
      streamFirstTokenMs: 20,
      streamFirstTokenSdMs: 0,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: { stream: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"model":"gpt-4"');
    await app.close();
  });
});

describe("startServer", () => {
  it("binds an ephemeral port and answers /health/liveliness", async () => {
    // Port 0 → OS-assigned ephemeral port.
    const { startServer } = await import("./server.js");
    const app = await startServer({ port: 0, host: "127.0.0.1" });
    try {
      const addr = app.server.address();
      if (!addr || typeof addr === "string") {
        throw new Error("expected address object");
      }
      const res = await fetch(`http://127.0.0.1:${addr.port}/health/liveliness`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    } finally {
      await app.close();
    }
  });
});
