// Phase 03 Plan 03 Task 1 — buildLitellmClient tests.
//
// Uses undici's MockAgent so we exercise the real undici call surface
// (no fetch shim, no manual http.request stubbing). Each test asserts
// the wire shape that downstream Plans 04/05/06 depend on.

import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import {
  BUNDLED_MODEL_PROVIDER,
  buildLitellmClient,
  type LitellmClientConfig,
  LitellmUpstreamError,
  MissingProviderKeyError,
  PROVIDER_ENV_VAR,
} from "./index.js";

const BASE = "http://litellm:4000";

function baseConfig(overrides: Partial<LitellmClientConfig> = {}): LitellmClientConfig {
  return {
    baseUrl: BASE,
    masterKey: "sk-master-test",
    providerKeys: {
      openrouter: "sk-or-test",
      groq: "gsk-test",
      pyannote: "hf-test",
    },
    defaultChatModel: "qwen3.6-plus",
    ...overrides,
  };
}

let agent: MockAgent;

beforeEach(() => {
  agent = new MockAgent({ connections: 1 });
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  await agent.close();
  vi.restoreAllMocks();
});

describe("buildLitellmClient — chatCompletions", () => {
  it("injects user/auth/metadata headers and POSTs to /v1/chat/completions", async () => {
    let capturedBody: string | undefined;
    let capturedHeaders: Record<string, string> = {};
    let capturedPath: string | undefined;
    let capturedMethod: string | undefined;
    agent
      .get(BASE)
      .intercept({
        path: "/v1/chat/completions",
        method: "POST",
      })
      .reply((opts) => {
        capturedBody = String(opts.body);
        capturedHeaders = opts.headers as Record<string, string>;
        capturedPath = opts.path;
        capturedMethod = opts.method;
        return { statusCode: 200, data: { ok: true }, responseOptions: {} };
      });

    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    const res = await client.chatCompletions({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);

    expect(capturedPath).toBe("/v1/chat/completions");
    expect(capturedMethod).toBe("POST");

    const body = JSON.parse(capturedBody ?? "{}");
    expect(body.user).toBe("u1"); // D-03
    expect(body.model).toBe("qwen3.6-plus");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);

    expect(capturedHeaders.authorization).toBe("Bearer sk-master-test");
    expect(capturedHeaders["content-type"]).toBe("application/json");
    expect(capturedHeaders["x-litellm-end-user-id"]).toBe("u1");
    const metadata = JSON.parse(capturedHeaders["x-litellm-spend-logs-metadata"] ?? "{}");
    expect(metadata.openwhispr_request_id).toBe("r1");
  });

  it("falls back to defaultChatModel when caller omits model (D-06)", async () => {
    let capturedBody: string | undefined;
    agent
      .get(BASE)
      .intercept({ path: "/v1/chat/completions", method: "POST" })
      .reply((opts) => {
        capturedBody = String(opts.body);
        return { statusCode: 200, data: { ok: true }, responseOptions: {} };
      });

    const client = buildLitellmClient(
      baseConfig({ defaultChatModel: "gemini-3-flash" }),
      { isOverride: false },
    );
    await client.chatCompletions({
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
    });
    expect(JSON.parse(capturedBody ?? "{}").model).toBe("gemini-3-flash");
  });

  it("forwards `extras` (e.g. temperature, max_tokens) into the request body", async () => {
    let capturedBody: string | undefined;
    agent
      .get(BASE)
      .intercept({ path: "/v1/chat/completions", method: "POST" })
      .reply((opts) => {
        capturedBody = String(opts.body);
        return { statusCode: 200, data: { ok: true }, responseOptions: {} };
      });

    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    await client.chatCompletions({
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
      extras: { temperature: 0.2, max_tokens: 100 },
    });
    const body = JSON.parse(capturedBody ?? "{}");
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(100);
    // Critical: `user` must NOT be overridable through extras spread order.
    expect(body.user).toBe("u1");
  });

  it("throws MissingProviderKeyError when bundled model needs a provider whose key is unset", async () => {
    const cfg = baseConfig({
      providerKeys: { openrouter: undefined, groq: "gsk-x", pyannote: "hf-x" },
    });
    const client = buildLitellmClient(cfg, { isOverride: false });
    await expect(
      client.chatCompletions({
        model: "qwen3.6-plus",
        messages: [{ role: "user", content: "hi" }],
        userId: "u1",
        requestId: "r1",
      }),
    ).rejects.toBeInstanceOf(MissingProviderKeyError);
  });

  it("MissingProviderKeyError carries the offending env-var name and model alias", async () => {
    const cfg = baseConfig({
      providerKeys: { openrouter: undefined, groq: "gsk-x", pyannote: "hf-x" },
    });
    const client = buildLitellmClient(cfg, { isOverride: false });
    try {
      await client.chatCompletions({
        model: "gemini-3-flash",
        messages: [{ role: "user", content: "hi" }],
        userId: "u1",
        requestId: "r1",
      });
      throw new Error("should not reach");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingProviderKeyError);
      const e = err as MissingProviderKeyError;
      expect(e.envVar).toBe("OPENROUTER_API_KEY");
      expect(e.model).toBe("gemini-3-flash");
      expect(e.message).toContain("OPENROUTER_API_KEY");
      expect(e.message).toContain("gemini-3-flash");
    }
  });

  it("skips provider-key check when isOverride=true (corporate proxy mode)", async () => {
    const cfg = baseConfig({
      providerKeys: { openrouter: undefined, groq: undefined, pyannote: undefined },
    });
    agent
      .get(BASE)
      .intercept({ path: "/v1/chat/completions", method: "POST" })
      .reply(200, { ok: true });

    const client = buildLitellmClient(cfg, { isOverride: true });
    const res = await client.chatCompletions({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);
  });

  it("does NOT pre-check unknown models (defers to upstream for canonical 4xx)", async () => {
    const cfg = baseConfig({
      providerKeys: { openrouter: undefined, groq: undefined, pyannote: undefined },
    });
    agent
      .get(BASE)
      .intercept({ path: "/v1/chat/completions", method: "POST" })
      .reply(200, { ok: true });

    const client = buildLitellmClient(cfg, { isOverride: false });
    const res = await client.chatCompletions({
      model: "some-unmapped-model",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);
  });

  it("surfaces non-2xx upstream as LitellmUpstreamError with status + body preserved", async () => {
    agent
      .get(BASE)
      .intercept({ path: "/v1/chat/completions", method: "POST" })
      .reply(502, "upstream provider unreachable");

    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    try {
      await client.chatCompletions({
        model: "qwen3.6-plus",
        messages: [{ role: "user", content: "hi" }],
        userId: "u1",
        requestId: "r1",
      });
      throw new Error("should not reach");
    } catch (err) {
      expect(err).toBeInstanceOf(LitellmUpstreamError);
      const e = err as LitellmUpstreamError;
      expect(e.status).toBe(502);
      expect(e.bodyText).toContain("upstream provider unreachable");
      expect(e.message).toContain("502");
    }
  });

  it("LitellmUpstreamError truncates long upstream bodies in default message (T-03-03-01)", async () => {
    const longBody = "x".repeat(5000);
    agent
      .get(BASE)
      .intercept({ path: "/v1/chat/completions", method: "POST" })
      .reply(500, longBody);

    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    try {
      await client.chatCompletions({
        model: "qwen3.6-plus",
        messages: [{ role: "user", content: "hi" }],
        userId: "u1",
        requestId: "r1",
      });
    } catch (err) {
      const e = err as LitellmUpstreamError;
      // Default message slices to 200 chars + "LiteLLM upstream returned 500: " prefix.
      // Full body is preserved on .bodyText for callers that want it.
      expect(e.bodyText.length).toBe(5000);
      expect(e.message.length).toBeLessThan(longBody.length);
    }
  });
});

describe("buildLitellmClient — audioTranscriptions", () => {
  it("forwards a Readable stream + content-type to /v1/audio/transcriptions", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedPath: string | undefined;
    let capturedMethod: string | undefined;
    let capturedBody: unknown;
    agent
      .get(BASE)
      .intercept({ path: "/v1/audio/transcriptions", method: "POST" })
      .reply((opts) => {
        capturedHeaders = opts.headers as Record<string, string>;
        capturedPath = opts.path;
        capturedMethod = opts.method;
        capturedBody = opts.body;
        return { statusCode: 200, data: { text: "ok" }, responseOptions: {} };
      });

    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    const stream = Readable.from([Buffer.from("fake-audio")]);
    const res = await client.audioTranscriptions({
      body: stream,
      contentType: "multipart/form-data; boundary=abc",
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);

    expect(capturedPath).toBe("/v1/audio/transcriptions");
    expect(capturedMethod).toBe("POST");
    expect(capturedHeaders.authorization).toBe("Bearer sk-master-test");
    expect(capturedHeaders["content-type"]).toBe("multipart/form-data; boundary=abc");
    expect(capturedHeaders["x-litellm-end-user-id"]).toBe("u1");
    const metadata = JSON.parse(capturedHeaders["x-litellm-spend-logs-metadata"] ?? "{}");
    expect(metadata.openwhispr_request_id).toBe("r1");
    expect(capturedBody).toBeDefined();
  });

  it("throws MissingProviderKeyError when GROQ_API_KEY is unset (whisper-large-v3 -> groq)", async () => {
    const cfg = baseConfig({
      providerKeys: { openrouter: "sk-or", groq: undefined, pyannote: "hf" },
    });
    const client = buildLitellmClient(cfg, { isOverride: false });
    const stream = Readable.from([Buffer.from("audio")]);
    await expect(
      client.audioTranscriptions({
        body: stream,
        contentType: "multipart/form-data",
        userId: "u1",
        requestId: "r1",
      }),
    ).rejects.toBeInstanceOf(MissingProviderKeyError);
  });

  it("surfaces upstream non-2xx as LitellmUpstreamError", async () => {
    agent
      .get(BASE)
      .intercept({ path: "/v1/audio/transcriptions", method: "POST" })
      .reply(503, "no model available");
    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    const stream = Readable.from([Buffer.from("audio")]);
    await expect(
      client.audioTranscriptions({
        body: stream,
        contentType: "multipart/form-data",
        userId: "u1",
        requestId: "r1",
      }),
    ).rejects.toBeInstanceOf(LitellmUpstreamError);
  });
});

describe("buildLitellmClient — passthrough", () => {
  it("forwards arbitrary path + method (used by Plan 05 diarization)", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedPath: string | undefined;
    let capturedMethod: string | undefined;
    agent
      .get(BASE)
      .intercept({ path: "/v1/audio/diarization", method: "POST" })
      .reply((opts) => {
        capturedHeaders = opts.headers as Record<string, string>;
        capturedPath = opts.path;
        capturedMethod = opts.method;
        return { statusCode: 200, data: { speakers: [] }, responseOptions: {} };
      });

    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    const stream = Readable.from([Buffer.from("audio")]);
    const res = await client.passthrough("/v1/audio/diarization", {
      method: "POST",
      body: stream,
      contentType: "multipart/form-data; boundary=xy",
      userId: "u2",
      requestId: "r2",
    });
    expect(res.statusCode).toBe(200);
    expect(capturedPath).toBe("/v1/audio/diarization");
    expect(capturedMethod).toBe("POST");
    expect(capturedHeaders.authorization).toBe("Bearer sk-master-test");
    expect(capturedHeaders["content-type"]).toBe("multipart/form-data; boundary=xy");
    expect(capturedHeaders["x-litellm-end-user-id"]).toBe("u2");
  });

  it("omits content-type header when not supplied (e.g. GET passthrough)", async () => {
    let capturedHeaders: Record<string, string> = {};
    agent
      .get(BASE)
      .intercept({ path: "/v1/health", method: "GET" })
      .reply((opts) => {
        capturedHeaders = opts.headers as Record<string, string>;
        return { statusCode: 200, data: { ok: true }, responseOptions: {} };
      });
    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    const res = await client.passthrough("/v1/health", {
      method: "GET",
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);
    expect(capturedHeaders["content-type"]).toBeUndefined();
  });

  it("surfaces upstream non-2xx as LitellmUpstreamError", async () => {
    agent
      .get(BASE)
      .intercept({ path: "/v1/audio/diarization", method: "POST" })
      .reply(500, "diarization failed");
    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    await expect(
      client.passthrough("/v1/audio/diarization", {
        method: "POST",
        body: "x",
        contentType: "text/plain",
        userId: "u1",
        requestId: "r1",
      }),
    ).rejects.toBeInstanceOf(LitellmUpstreamError);
  });
});

describe("buildLitellmClient — surface", () => {
  it("exposes baseUrl as a readonly property (Plan 06 wsUpstream needs it)", () => {
    const client = buildLitellmClient(baseConfig({ baseUrl: "http://litellm:4000" }), {
      isOverride: false,
    });
    expect(client.baseUrl).toBe("http://litellm:4000");
  });

  it("BUNDLED_MODEL_PROVIDER mirrors litellm_config.yaml model_list aliases", () => {
    expect(BUNDLED_MODEL_PROVIDER["qwen3.6-plus"]).toBe("openrouter");
    expect(BUNDLED_MODEL_PROVIDER["gemini-3-flash"]).toBe("openrouter");
    expect(BUNDLED_MODEL_PROVIDER["gpt-4o-mini"]).toBe("openrouter");
    expect(BUNDLED_MODEL_PROVIDER["whisper-large-v3"]).toBe("groq");
  });

  it("PROVIDER_ENV_VAR maps every provider key to the documented env var", () => {
    expect(PROVIDER_ENV_VAR.openrouter).toBe("OPENROUTER_API_KEY");
    expect(PROVIDER_ENV_VAR.groq).toBe("GROQ_API_KEY");
    expect(PROVIDER_ENV_VAR.pyannote).toBe("PYANNOTE_API_KEY");
  });

  it("auto-detects override mode from process.env when isOverride option is omitted", async () => {
    // No interceptor: if the implementation tried to actually fire the
    // request we'd get a connect-rejection from MockAgent, so the path
    // we exercise here is the "skip provider check, then upstream call"
    // — set up a pass interceptor.
    const prev = process.env.LITELLM_BASE_URL;
    process.env.LITELLM_BASE_URL = "https://corp.litellm.example.com";
    try {
      agent
        .get(BASE)
        .intercept({ path: "/v1/chat/completions", method: "POST" })
        .reply(200, { ok: true });
      const cfg = baseConfig({
        providerKeys: { openrouter: undefined, groq: undefined, pyannote: undefined },
      });
      // No isOverride option supplied -> derived from process.env.
      const client = buildLitellmClient(cfg);
      const res = await client.chatCompletions({
        model: "qwen3.6-plus",
        messages: [{ role: "user", content: "hi" }],
        userId: "u1",
        requestId: "r1",
      });
      expect(res.statusCode).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.LITELLM_BASE_URL;
      else process.env.LITELLM_BASE_URL = prev;
    }
  });
});
