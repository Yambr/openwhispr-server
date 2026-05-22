// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 Plan 03 Task 1 — buildLitellmClient tests.
//
// Uses undici's MockAgent so we exercise the real undici call surface
// (no fetch shim, no manual http.request stubbing). Each test asserts
// the wire shape that downstream Plans 04/05/06 depend on.

import { Readable } from "node:stream";
import {
  type Dispatcher,
  getGlobalDispatcher,
  MockAgent,
  setGlobalDispatcher,
  type request as undiciRequestRef,
} from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUNDLED_MODEL_PROVIDER,
  buildLitellmClient,
  type ChatCompletionsStreamRequest,
  type LitellmClientConfig,
  LitellmUpstreamError,
  MissingProviderKeyError,
  PROVIDER_ENV_VAR,
  SsrfDispatcherNotInstalledError,
} from "../../src/index.js";

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
    defaultSttModel: "whisper-large-v3",
    defaultRealtimeModel: "gpt-realtime",
    // R32 — the timeout posture is now config-sourced. The runtime path
    // reads `config.headersTimeoutMs` / `config.bodyTimeoutMs` /
    // `config.errorDrainTimeoutMs` as the per-call defaults; baseConfig
    // mirrors the prior hardcoded literals so the HI-1 timeout tests stay
    // pinned to 30s / 120s / 15s unless an individual test overrides.
    headersTimeoutMs: 30_000,
    bodyTimeoutMs: 120_000,
    errorDrainTimeoutMs: 15_000,
    ...overrides,
  };
}

let agent: MockAgent;

beforeEach(() => {
  agent = new MockAgent({ connections: 1 });
  agent.disableNetConnect();
  // Phase 41.f / HI-2 — stamp the SSRF-wrap marker on the MockAgent so the
  // client's first-call assertion does not reject under test. Real production
  // code stamps the same Symbol on the Agent built by `makeSSRFDispatcher`.
  Object.defineProperty(agent, Symbol.for("openwhispr.ssrf-wrapped"), {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
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

    const client = buildLitellmClient(baseConfig({ defaultChatModel: "gemini-3-flash" }), {
      isOverride: false,
    });
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
      // Phase 37 / CR-9: bodyText is now private + non-enumerable +
      // truncated; the default `.message` still carries the (truncated)
      // upstream substring for operator-actionable diagnostics.
      expect(e.message).toContain("upstream provider unreachable");
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
      // Phase 37 / CR-9: bodyText is now private + non-enumerable. The
      // default message slices to 200 chars + "LiteLLM upstream returned
      // 500: " prefix. Neither JSON.stringify(err) nor err.toJSON() may
      // echo the full 5000-char payload.
      expect(e.message.length).toBeLessThan(longBody.length);
      expect(JSON.stringify(err)).not.toContain("x".repeat(201));
      expect(Object.keys(e)).not.toContain("bodyText");
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
      .intercept({
        path: /^\/v1\/audio\/transcriptions(\?.*)?$/,
        method: "POST",
      })
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

    // Phase 19.2 SERVER-ERRORS Entry 11 — model defaults to whisper-large-v3
    // when caller omits it; carried as a query-string param.
    expect(capturedPath).toMatch(/^\/v1\/audio\/transcriptions\?/);
    expect(capturedMethod).toBe("POST");
    expect(capturedHeaders.authorization).toBe("Bearer sk-master-test");
    expect(capturedHeaders["content-type"]).toBe("multipart/form-data; boundary=abc");
    expect(capturedHeaders["x-litellm-end-user-id"]).toBe("u1");
    const metadata = JSON.parse(capturedHeaders["x-litellm-spend-logs-metadata"] ?? "{}");
    expect(metadata.openwhispr_request_id).toBe("r1");
    expect(capturedBody).toBeDefined();
  });

  it("forwards model= as a query-string param on the upstream URL (Phase 19.2 SERVER-ERRORS Entry 11)", async () => {
    // Phase 19.2 / Plan 02 — defect closure: LiteLLM proxy's
    // /v1/audio/transcriptions requires `model` either as a multipart
    // form field or as a query-string param. Prior to this fix the
    // client built the URL with no model and LiteLLM rejected the
    // request with `Invalid model name passed in model=None`,
    // surfacing to the desktop as a 502 envelope.
    let capturedPath: string | undefined;
    agent
      .get(BASE)
      .intercept({
        path: /^\/v1\/audio\/transcriptions(\?.*)?$/,
        method: "POST",
      })
      .reply((opts) => {
        capturedPath = opts.path;
        return { statusCode: 200, data: { text: "ok" }, responseOptions: {} };
      });

    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    const stream = Readable.from([Buffer.from("fake-audio")]);
    const res = await client.audioTranscriptions({
      model: "whisper-large-v3",
      body: stream,
      contentType: "multipart/form-data; boundary=abc",
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);
    expect(capturedPath).toBeDefined();
    // Must be on /v1/audio/transcriptions AND carry model=whisper-large-v3
    // as a query-string param (URL-encoded; the simple alias has no
    // special chars but assert via encodeURIComponent for forward-compat).
    expect(capturedPath).toMatch(/^\/v1\/audio\/transcriptions\?/);
    const qs = new URLSearchParams(capturedPath?.split("?")[1] ?? "");
    expect(qs.get("model")).toBe("whisper-large-v3");
  });

  it('prepends `name="model"` as a synthetic multipart part so LiteLLM proxy parses it (Phase 19.2)', async () => {
    // LiteLLM proxy v1.83.x reads `model` ONLY from form data
    // (proxy_server.py:audio_transcriptions → form_data.get("model")).
    // The query-string param above is forward-compat; this assertion
    // pins the field-injection contract that actually unblocks the
    // round-trip against the canonical proxy.
    // Inject a fake `request` function to capture the exact body the
    // client constructs. Undici MockAgent's reply handler does not
    // expose the body stream after pipe-completion in a way we can
    // drain synchronously, so we bypass it for this assertion.
    const captured: { bytes: Buffer } = { bytes: Buffer.alloc(0) };
    const fakeRequest = async (
      _url: unknown,
      reqOpts: unknown,
    ): Promise<Dispatcher.ResponseData> => {
      const body = (reqOpts as { body: Readable }).body;
      const chunks: Buffer[] = [];
      await new Promise<void>((res, rej) => {
        body.on("data", (c: Buffer | string) =>
          chunks.push(typeof c === "string" ? Buffer.from(c, "utf8") : c),
        );
        body.on("end", () => res());
        body.on("error", (err) => rej(err));
      });
      captured.bytes = Buffer.concat(chunks);
      return {
        statusCode: 200,
        body: {
          async json() {
            return { text: "ok" };
          },
          async text() {
            return "";
          },
        },
      } as unknown as Dispatcher.ResponseData;
    };

    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: fakeRequest as unknown as typeof undiciRequestRef,
    });
    const stream = Readable.from([Buffer.from("FILE_PART_BODY")]);
    const res = await client.audioTranscriptions({
      model: "whisper-large-v3",
      body: stream,
      contentType: "multipart/form-data; boundary=xyz123",
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);
    const capturedStr = captured.bytes.toString("utf8");
    // Prefix MUST carry a synthetic `name="model"` part on the same
    // boundary AND must appear BEFORE the original file payload.
    expect(capturedStr).toMatch(/--xyz123\r\n/);
    expect(capturedStr).toMatch(
      /Content-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n/,
    );
    const modelIdx = capturedStr.indexOf('name="model"');
    const fileIdx = capturedStr.indexOf("FILE_PART_BODY");
    expect(modelIdx).toBeGreaterThanOrEqual(0);
    expect(fileIdx).toBeGreaterThan(modelIdx);
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
      .intercept({
        path: /^\/v1\/audio\/transcriptions(\?.*)?$/,
        method: "POST",
      })
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

  // v2.5-B / CodeQL #19 (js/polynomial-redos) — parseMultipartBoundary's
  // prior `/boundary=("?)([^";]+)\1/i` paired an optional capture with a
  // backreference, backtracking super-linearly on a long `boundary=` run
  // with no closing quote. The alternation rewrite must (a) still extract
  // a quoted boundary and (b) resolve a pathological input in linear time.
  function captureTranscriptionBody(): {
    captured: { bytes: Buffer };
    fakeRequest: (url: unknown, reqOpts: unknown) => Promise<Dispatcher.ResponseData>;
  } {
    const captured: { bytes: Buffer } = { bytes: Buffer.alloc(0) };
    const fakeRequest = async (
      _url: unknown,
      reqOpts: unknown,
    ): Promise<Dispatcher.ResponseData> => {
      const body = (reqOpts as { body: Readable }).body;
      const chunks: Buffer[] = [];
      await new Promise<void>((res, rej) => {
        body.on("data", (c: Buffer | string) =>
          chunks.push(typeof c === "string" ? Buffer.from(c, "utf8") : c),
        );
        body.on("end", () => res());
        body.on("error", (err) => rej(err));
      });
      captured.bytes = Buffer.concat(chunks);
      return {
        statusCode: 200,
        body: {
          async json() {
            return { text: "ok" };
          },
          async text() {
            return "";
          },
        },
      } as unknown as Dispatcher.ResponseData;
    };
    return { captured, fakeRequest };
  }

  it("extracts a QUOTED multipart boundary and injects the model prefix", async () => {
    const { captured, fakeRequest } = captureTranscriptionBody();
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: fakeRequest as unknown as typeof undiciRequestRef,
    });
    const stream = Readable.from([Buffer.from("FILE_PART_BODY")]);
    const res = await client.audioTranscriptions({
      model: "whisper-large-v3",
      body: stream,
      // Quoted boundary form — RFC 2046 permits a quoted-string value.
      contentType: 'multipart/form-data; boundary="quoted-bnd"',
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);
    const sent = captured.bytes.toString("utf8");
    // The UNQUOTED boundary token (not the surrounding quotes) delimits
    // the synthetic `name="model"` prefix part.
    expect(sent).toMatch(/--quoted-bnd\r\n/);
    expect(sent).toMatch(
      /Content-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n/,
    );
  });

  it("resolves a pathological multipart boundary header in linear time", async () => {
    const { fakeRequest } = captureTranscriptionBody();
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: fakeRequest as unknown as typeof undiciRequestRef,
    });
    const stream = Readable.from([Buffer.from("fake-audio")]);
    // `boundary=` followed by a 100k-char run with an unbalanced quote —
    // the prior backreference pattern backtracked quadratically here.
    const pathological = `multipart/form-data; boundary="${"a".repeat(100_000)}`;
    const start = performance.now();
    const res = await client.audioTranscriptions({
      model: "whisper-large-v3",
      body: stream,
      contentType: pathological,
      userId: "u1",
      requestId: "r1",
    });
    expect(performance.now() - start).toBeLessThan(500);
    expect(res.statusCode).toBe(200);
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

// Phase 41.f / HI-1 — timeouts + AbortSignal on 3 methods.
//
// chatCompletions / audioTranscriptions / passthrough must:
//   * default headersTimeout to 30_000 and bodyTimeout to 120_000;
//   * accept per-call overrides for both;
//   * forward AbortSignal when supplied.
//
// D-41f-1 records the rationale. Tests use opts.request injection seam
// because MockAgent doesn't surface bodyTimeout on intercepted descriptors.
// Phase 41.f / HI-2 — SSRF dispatcher boot-time assertion.
//
// When the client is invoked without `opts.request` injected, it relies on
// undici's global dispatcher. That dispatcher MUST be the SSRF-wrapped Agent
// built by makeSSRFDispatcher (apps/api/src/lib/ssrf-dispatcher.ts). The
// client checks for the Symbol.for("openwhispr.ssrf-wrapped") marker on the
// current global dispatcher at first call to any method.
describe("buildLitellmClient — HI-2 SSRF dispatcher assertion", () => {
  it("throws SsrfDispatcherNotInstalledError on first call when dispatcher is unmarked", async () => {
    // The outer beforeEach has stamped the marker on `agent`. To test the
    // failure branch we explicitly replace the global dispatcher with a
    // fresh unmarked MockAgent for this single case.
    const unmarked = new MockAgent({ connections: 1 });
    unmarked.disableNetConnect();
    setGlobalDispatcher(unmarked);
    try {
      const client = buildLitellmClient(baseConfig(), { isOverride: false });
      await expect(
        client.chatCompletions({
          model: "qwen3.6-plus",
          messages: [{ role: "user", content: "hi" }],
          userId: "u1",
          requestId: "r1",
        }),
      ).rejects.toBeInstanceOf(SsrfDispatcherNotInstalledError);
    } finally {
      await unmarked.close();
      // Restore the marked agent so afterEach can close cleanly.
      setGlobalDispatcher(agent);
    }
  });

  it("audioTranscriptions also gates on the SSRF marker", async () => {
    const unmarked = new MockAgent({ connections: 1 });
    unmarked.disableNetConnect();
    setGlobalDispatcher(unmarked);
    try {
      const client = buildLitellmClient(baseConfig(), { isOverride: false });
      const stream = Readable.from([Buffer.from("audio")]);
      await expect(
        client.audioTranscriptions({
          body: stream,
          contentType: "multipart/form-data",
          userId: "u1",
          requestId: "r1",
        }),
      ).rejects.toBeInstanceOf(SsrfDispatcherNotInstalledError);
    } finally {
      await unmarked.close();
      setGlobalDispatcher(agent);
    }
  });

  it("passthrough also gates on the SSRF marker", async () => {
    const unmarked = new MockAgent({ connections: 1 });
    unmarked.disableNetConnect();
    setGlobalDispatcher(unmarked);
    try {
      const client = buildLitellmClient(baseConfig(), { isOverride: false });
      await expect(
        client.passthrough("/v1/health", {
          method: "GET",
          userId: "u1",
          requestId: "r1",
        }),
      ).rejects.toBeInstanceOf(SsrfDispatcherNotInstalledError);
    } finally {
      await unmarked.close();
      setGlobalDispatcher(agent);
    }
  });

  it("chatCompletionsStream also gates on the SSRF marker", async () => {
    const unmarked = new MockAgent({ connections: 1 });
    unmarked.disableNetConnect();
    setGlobalDispatcher(unmarked);
    try {
      const client = buildLitellmClient(baseConfig(), { isOverride: false });
      await expect(
        client.chatCompletionsStream({
          model: "qwen3.6-plus",
          messages: [{ role: "user", content: "hi" }],
          userId: "u1",
          requestId: "r1",
        }),
      ).rejects.toBeInstanceOf(SsrfDispatcherNotInstalledError);
    } finally {
      await unmarked.close();
      setGlobalDispatcher(agent);
    }
  });

  it("does NOT assert when test injects opts.request (bypass the global dispatcher path)", async () => {
    // No marker on the global dispatcher in this test either, but because
    // we inject `request`, the client skips the assertion entirely.
    const unmarked = new MockAgent({ connections: 1 });
    unmarked.disableNetConnect();
    setGlobalDispatcher(unmarked);
    const spy = vi.fn(async () => ({
      statusCode: 200,
      headers: {},
      body: { text: async () => "{}" },
    }));
    try {
      const client = buildLitellmClient(baseConfig(), {
        isOverride: false,
        request: spy as unknown as typeof import("undici").request,
      });
      const res = await client.chatCompletions({
        model: "qwen3.6-plus",
        messages: [{ role: "user", content: "hi" }],
        userId: "u1",
        requestId: "r1",
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await unmarked.close();
      setGlobalDispatcher(agent);
    }
  });

  it("SsrfDispatcherNotInstalledError carries the documented code + name", () => {
    const err = new SsrfDispatcherNotInstalledError();
    expect(err.name).toBe("SsrfDispatcherNotInstalledError");
    expect(err.code).toBe("SSRF_DISPATCHER_NOT_INSTALLED");
    expect(err.message).toContain("SSRF");
  });

  // Sanity check: the marker stamped in beforeEach is detectable.
  it("the SSRF marker on the test agent is discoverable via getGlobalDispatcher", () => {
    const d = getGlobalDispatcher() as unknown as Record<symbol, unknown>;
    expect(d[Symbol.for("openwhispr.ssrf-wrapped")]).toBe(true);
  });
});

describe("buildLitellmClient — HI-1 timeouts + AbortSignal", () => {
  it("chatCompletions defaults to headersTimeout=30000, bodyTimeout=120000", async () => {
    const spy = vi.fn(async () => ({
      statusCode: 200,
      headers: {},
      body: { text: async () => "{}" },
    }));
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: spy as unknown as typeof import("undici").request,
    });
    await client.chatCompletions({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
    });
    const opts = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.headersTimeout).toBe(30_000);
    expect(opts.bodyTimeout).toBe(120_000);
  });

  it("chatCompletions honors per-call headersTimeout + bodyTimeout overrides", async () => {
    const spy = vi.fn(async () => ({
      statusCode: 200,
      headers: {},
      body: { text: async () => "{}" },
    }));
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: spy as unknown as typeof import("undici").request,
    });
    await client.chatCompletions({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
      headersTimeout: 5_000,
      bodyTimeout: 60_000,
    });
    const opts = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.headersTimeout).toBe(5_000);
    expect(opts.bodyTimeout).toBe(60_000);
  });

  it("chatCompletions forwards AbortSignal when supplied", async () => {
    const spy = vi.fn(async () => ({
      statusCode: 200,
      headers: {},
      body: { text: async () => "{}" },
    }));
    const ac = new AbortController();
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: spy as unknown as typeof import("undici").request,
    });
    await client.chatCompletions({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
      signal: ac.signal,
    });
    const opts = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.signal).toBe(ac.signal);
  });

  it("audioTranscriptions defaults headersTimeout/bodyTimeout and forwards signal", async () => {
    const spy = vi.fn(async () => ({
      statusCode: 200,
      headers: {},
      body: { text: async () => "{}" },
    }));
    const ac = new AbortController();
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: spy as unknown as typeof import("undici").request,
    });
    const stream = Readable.from([Buffer.from("audio")]);
    await client.audioTranscriptions({
      model: "whisper-large-v3",
      body: stream,
      contentType: "multipart/form-data; boundary=zzz",
      userId: "u1",
      requestId: "r1",
      signal: ac.signal,
      headersTimeout: 10_000,
    });
    const opts = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.headersTimeout).toBe(10_000);
    expect(opts.bodyTimeout).toBe(120_000); // default retained when override omitted
    expect(opts.signal).toBe(ac.signal);
  });

  // R32 — the per-call defaults now come from `config` (env-tunable via
  // LITELLM_HEADERS_TIMEOUT_MS / LITELLM_BODY_TIMEOUT_MS) rather than a
  // hardcoded literal. A config with non-default timeouts must flow
  // through to undici for chatCompletions, audioTranscriptions AND
  // passthrough — and a per-call override still wins over the config value.
  it("R32: chatCompletions uses config.headersTimeoutMs / bodyTimeoutMs as defaults", async () => {
    const spy = vi.fn(async () => ({
      statusCode: 200,
      headers: {},
      body: { text: async () => "{}" },
    }));
    const client = buildLitellmClient(
      baseConfig({ headersTimeoutMs: 11_000, bodyTimeoutMs: 222_000 }),
      {
        isOverride: false,
        request: spy as unknown as typeof import("undici").request,
      },
    );
    await client.chatCompletions({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
    });
    const opts = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.headersTimeout).toBe(11_000);
    expect(opts.bodyTimeout).toBe(222_000);
  });

  it("R32: a per-call timeout override still wins over config.headersTimeoutMs", async () => {
    const spy = vi.fn(async () => ({
      statusCode: 200,
      headers: {},
      body: { text: async () => "{}" },
    }));
    const client = buildLitellmClient(
      baseConfig({ headersTimeoutMs: 11_000, bodyTimeoutMs: 222_000 }),
      {
        isOverride: false,
        request: spy as unknown as typeof import("undici").request,
      },
    );
    await client.chatCompletions({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
      headersTimeout: 3_000,
    });
    const opts = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.headersTimeout).toBe(3_000);
    // bodyTimeout falls through to the config default (no per-call override).
    expect(opts.bodyTimeout).toBe(222_000);
  });

  it("R32: audioTranscriptions + passthrough use config-sourced timeout defaults", async () => {
    const spy = vi.fn(async () => ({
      statusCode: 200,
      headers: {},
      body: { text: async () => "{}" },
    }));
    const client = buildLitellmClient(
      baseConfig({ headersTimeoutMs: 13_000, bodyTimeoutMs: 130_000 }),
      {
        isOverride: false,
        request: spy as unknown as typeof import("undici").request,
      },
    );
    await client.audioTranscriptions({
      model: "whisper-large-v3",
      body: Readable.from([Buffer.from("audio")]),
      contentType: "multipart/form-data; boundary=zzz",
      userId: "u1",
      requestId: "r1",
    });
    const transcribeOpts = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(transcribeOpts.headersTimeout).toBe(13_000);
    expect(transcribeOpts.bodyTimeout).toBe(130_000);

    await client.passthrough("/v1/health", {
      method: "GET",
      userId: "u1",
      requestId: "r1",
    });
    const passthroughOpts = spy.mock.calls[1][1] as Record<string, unknown>;
    expect(passthroughOpts.headersTimeout).toBe(13_000);
    expect(passthroughOpts.bodyTimeout).toBe(130_000);
  });

  it("passthrough defaults headersTimeout/bodyTimeout and forwards signal", async () => {
    const spy = vi.fn(async () => ({
      statusCode: 200,
      headers: {},
      body: { text: async () => "{}" },
    }));
    const ac = new AbortController();
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: spy as unknown as typeof import("undici").request,
    });
    await client.passthrough("/v1/health", {
      method: "GET",
      userId: "u1",
      requestId: "r1",
      signal: ac.signal,
      bodyTimeout: 7_500,
    });
    const opts = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.headersTimeout).toBe(30_000);
    expect(opts.bodyTimeout).toBe(7_500);
    expect(opts.signal).toBe(ac.signal);
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

  it("Phase 41.f / HI-3 — BUNDLED_MODEL_PROVIDER is derived from the yaml (single source of truth)", async () => {
    // Import the loader directly to confirm the constant IS the derivation,
    // not a hand-maintained mirror. Any drift between this assertion's
    // expectation and the actual constant means the source of truth has
    // forked again.
    const { loadBundledModelProviders } = await import("../../src/model-aliases.js");
    const derived = loadBundledModelProviders();
    // The constant exposed by the index module MUST match the yaml-derived
    // map byte-for-byte (key set + values).
    expect({ ...BUNDLED_MODEL_PROVIDER }).toEqual(derived);
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

// Phase 08.2 Plan 01 — chatCompletionsStream contract.
//
// Strategy: continue to use MockAgent + setGlobalDispatcher for happy/error
// paths (Tests A, B, E, F) so the call shape against undici.request is real.
// For options-shape assertions (Tests C, D, G) we use the `opts.request`
// injection seam to capture the second argument passed to doRequest and make
// strict equality assertions impossible to satisfy through MockAgent
// (MockAgent does not expose bodyTimeout / dispatcher / signal on the
// intercepted call descriptor).
describe("buildLitellmClient — chatCompletionsStream", () => {
  it("Test A — forwards stream:true and stream_options.include_usage:true (merging caller extras.stream_options)", async () => {
    let capturedBody: string | undefined;
    agent
      .get(BASE)
      .intercept({ path: "/v1/chat/completions", method: "POST" })
      .reply((opts) => {
        capturedBody = String(opts.body);
        return {
          statusCode: 200,
          data: 'data: {"id":"chat-1"}\n\ndata: [DONE]\n\n',
          responseOptions: { headers: { "content-type": "text/event-stream" } },
        };
      });

    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    await client.chatCompletionsStream({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
      extras: { temperature: 0.2, stream_options: { custom_flag: true } },
    });

    const body = JSON.parse(capturedBody ?? "{}");
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true, custom_flag: true });
    expect(body.temperature).toBe(0.2);
    expect(body.user).toBe("u1");
    expect(body.model).toBe("qwen3.6-plus");
  });

  it("Test B — applies canonical authHeaders + spend-logs metadata (no extra keys)", async () => {
    let capturedHeaders: Record<string, string> = {};
    agent
      .get(BASE)
      .intercept({ path: "/v1/chat/completions", method: "POST" })
      .reply((opts) => {
        capturedHeaders = opts.headers as Record<string, string>;
        return {
          statusCode: 200,
          data: "data: [DONE]\n\n",
          responseOptions: { headers: { "content-type": "text/event-stream" } },
        };
      });

    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    await client.chatCompletionsStream({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
    });

    expect(capturedHeaders.authorization).toBe("Bearer sk-master-test");
    expect(capturedHeaders["x-litellm-end-user-id"]).toBe("u1");
    expect(capturedHeaders["content-type"]).toBe("application/json");
    const metadata = JSON.parse(capturedHeaders["x-litellm-spend-logs-metadata"] ?? "{}");
    // T-08.2-05: canonical shape is {openwhispr_request_id} ONLY — no
    // openwhispr_user_id (user attribution is already in body.user).
    expect(metadata).toEqual({ openwhispr_request_id: "r1" });
  });

  it("Test C — sets bodyTimeout: 0 on the undici.request call", async () => {
    const spy = vi.fn(async () => ({
      statusCode: 200,
      headers: {},
      body: {
        text: async () => "",
      },
    }));
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: spy as unknown as typeof import("undici").request,
    });
    await client.chatCompletionsStream({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const callArgs = spy.mock.calls[0];
    const opts = callArgs[1] as Record<string, unknown>;
    expect(opts.bodyTimeout).toBe(0);
  });

  it("Test D — forwards AbortSignal to undici.request when provided", async () => {
    const spy = vi.fn(async () => ({
      statusCode: 200,
      headers: {},
      body: { text: async () => "" },
    }));
    const ac = new AbortController();
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: spy as unknown as typeof import("undici").request,
    });
    const stream: ChatCompletionsStreamRequest = {
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
      signal: ac.signal,
    };
    await client.chatCompletionsStream(stream);
    const opts = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.signal).toBe(ac.signal);
    // Aborting flips the signal flag on the SAME reference doRequest received.
    ac.abort();
    expect((opts.signal as AbortSignal).aborted).toBe(true);
  });

  it("Test E — non-2xx upstream throws LitellmUpstreamError with statusCode + bodyText", async () => {
    agent
      .get(BASE)
      .intercept({ path: "/v1/chat/completions", method: "POST" })
      .reply(502, "upstream timed out");

    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    try {
      await client.chatCompletionsStream({
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
      // Phase 37 / CR-9: upstream substring lives on `.message` (truncated);
      // bodyText is now private + non-enumerable.
      expect(e.message).toContain("upstream timed out");
      expect(e.message).toContain("502");
    }
  });

  it("Test F — 2xx upstream returns ResponseData with a Readable body NOT pre-consumed", async () => {
    let bodyTextCalled = false;
    let bodyJsonCalled = false;
    const ssePayload =
      'data: {"id":"chat-1","choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const fakeBody = {
      text: async () => {
        bodyTextCalled = true;
        return ssePayload;
      },
      json: async () => {
        bodyJsonCalled = true;
        return {};
      },
      // Minimal Readable surface for type compat.
      on: () => undefined,
      pipe: () => undefined,
    };
    const spy = vi.fn(async () => ({
      statusCode: 200,
      headers: { "content-type": "text/event-stream" },
      body: fakeBody,
    }));
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: spy as unknown as typeof import("undici").request,
    });
    const res = await client.chatCompletionsStream({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(fakeBody);
    // Critical: 2xx path MUST NOT pre-consume the body — caller streams it.
    expect(bodyTextCalled).toBe(false);
    expect(bodyJsonCalled).toBe(false);
  });

  it("Phase 41.f / HI-4 — caller can opt OUT of include_usage via streamOptions param", async () => {
    let capturedBody: string | undefined;
    agent
      .get(BASE)
      .intercept({ path: "/v1/chat/completions", method: "POST" })
      .reply((opts) => {
        capturedBody = String(opts.body);
        return {
          statusCode: 200,
          data: "data: [DONE]\n\n",
          responseOptions: { headers: { "content-type": "text/event-stream" } },
        };
      });

    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    await client.chatCompletionsStream({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
      streamOptions: { include_usage: false },
    });
    const body = JSON.parse(capturedBody ?? "{}");
    expect(body.stream_options).toEqual({ include_usage: false });
  });

  it("Phase 41.f / HI-4 — explicit streamOptions overrides extras.stream_options", async () => {
    let capturedBody: string | undefined;
    agent
      .get(BASE)
      .intercept({ path: "/v1/chat/completions", method: "POST" })
      .reply((opts) => {
        capturedBody = String(opts.body);
        return {
          statusCode: 200,
          data: "data: [DONE]\n\n",
          responseOptions: { headers: { "content-type": "text/event-stream" } },
        };
      });

    const client = buildLitellmClient(baseConfig(), { isOverride: false });
    await client.chatCompletionsStream({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
      extras: { stream_options: { include_usage: true, custom_flag: 1 } },
      streamOptions: { include_usage: false },
    });
    const body = JSON.parse(capturedBody ?? "{}");
    // streamOptions param wins over extras.stream_options for the same key.
    expect(body.stream_options.include_usage).toBe(false);
    // Unrelated keys from extras still flow through.
    expect(body.stream_options.custom_flag).toBe(1);
  });

  it("Test G — does NOT pass a `dispatcher` key to undici.request (T-08.2-01 mitigation)", async () => {
    const spy = vi.fn(async () => ({
      statusCode: 200,
      headers: {},
      body: { text: async () => "" },
    }));
    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: spy as unknown as typeof import("undici").request,
    });
    await client.chatCompletionsStream({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
    });
    const opts = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.hasOwn(opts, "dispatcher")).toBe(false);
  });
});
