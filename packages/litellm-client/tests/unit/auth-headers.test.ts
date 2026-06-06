// SPDX-License-Identifier: FSL-1.1-ALv2
// Upstream #4 — end-user email attribution: body `user` field + the
// opt-in configurable HTTP header (LITELLM_USER_HEADER_NAME).
//
// These tests drive the PUBLIC client surface with an INJECTED fake
// `request` fn (the sanctioned network-boundary mock — no live LiteLLM,
// no MockAgent). The fake captures the outbound URL, method, headers and
// body so we can assert the exact wire shape each method emits.
//
// Contract under test (D-1 / D-2 / D-3):
//   * body.user prefers `endUser` and falls back to `userId`.
//   * `x-litellm-end-user-id` STAYS the UUID (`userId`) — NOT the email.
//     It is LiteLLM's stable end-user key + spend-logs anchor; emails are
//     mutable.
//   * the configurable header (`config.userHeaderName`) is emitted ONLY
//     when BOTH the header name is configured AND `endUser` is present —
//     it is the only attribution vector for the multipart/opaque methods
//     (audioTranscriptions / passthrough) which have no body `user` slot.
//   * `endUser` is CR/LF-rejected at `authHeaders`, same belt as
//     userId/requestId (T-oc4-02).

import { Readable } from "node:stream";
import type { Dispatcher, request as undiciRequestRef } from "undici";
import { describe, expect, it } from "vitest";
import { buildLitellmClient, type LitellmClientConfig } from "../../src/index.js";

const BASE = "http://litellm:4000";

function baseConfig(overrides: Partial<LitellmClientConfig> = {}): LitellmClientConfig {
  return {
    baseUrl: BASE,
    masterKey: "sk-master-test",
    providerKeys: {
      openrouter: "sk-or-test",
      groq: "gsk-test",
    },
    defaultChatModel: "qwen3.6-plus",
    defaultSttModel: "whisper-large-v3",
    defaultRealtimeModel: "gpt-realtime",
    defaultCleanupModel: "qwen3.6-cleanup",
    modelParams: {},
    headersTimeoutMs: 30_000,
    bodyTimeoutMs: 120_000,
    errorDrainTimeoutMs: 15_000,
    retryMaxAttempts: 1,
    retryBaseMs: 1,
    retryCapMs: 5,
    ...overrides,
  };
}

interface Captured {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string | undefined;
}

/**
 * Build an injected fake `request` fn that records the outbound call and
 * answers a minimal 200 with an empty-object JSON body. Returns the capture
 * sink alongside the fn so tests can assert on it after the await.
 */
function makeCapturingRequest(): {
  request: typeof undiciRequestRef;
  captured: Captured;
} {
  const captured: Captured = { url: "", method: undefined, headers: {}, body: undefined };
  const request = (async (url: unknown, opts: unknown) => {
    const o = (opts ?? {}) as {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
    captured.url = String(url);
    captured.method = o.method;
    captured.headers = (o.headers ?? {}) as Record<string, string>;
    captured.body = o.body === undefined ? undefined : String(o.body);
    return {
      statusCode: 200,
      headers: {},
      body: {
        text: async () => "{}",
        json: async () => ({}),
      },
    };
  }) as unknown as typeof undiciRequestRef;
  return { request, captured };
}

describe("upstream #4 — body.user + x-litellm-end-user-id (chatCompletions)", () => {
  it("sets body.user to endUser (email) when present; end-user-id stays the UUID", async () => {
    const { request, captured } = makeCapturingRequest();
    const client = buildLitellmClient(baseConfig(), { isOverride: false, request });
    await client.chatCompletions({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "uuid-1",
      requestId: "r1",
      endUser: "a@b.com",
    });
    const body = JSON.parse(captured.body ?? "{}");
    expect(body.user).toBe("a@b.com");
    expect(captured.headers["x-litellm-end-user-id"]).toBe("uuid-1");
  });

  it("falls back body.user to userId when endUser is undefined; no email header", async () => {
    const { request, captured } = makeCapturingRequest();
    const client = buildLitellmClient(baseConfig({ userHeaderName: "X-OpenWhispr-User-Email" }), {
      isOverride: false,
      request,
    });
    await client.chatCompletions({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "uuid-1",
      requestId: "r1",
    });
    const body = JSON.parse(captured.body ?? "{}");
    expect(body.user).toBe("uuid-1");
    expect(captured.headers["X-OpenWhispr-User-Email"]).toBeUndefined();
  });
});

describe("upstream #4 — configurable email header (LITELLM_USER_HEADER_NAME)", () => {
  it("emits the configured header with endUser when both are present", async () => {
    const { request, captured } = makeCapturingRequest();
    const client = buildLitellmClient(baseConfig({ userHeaderName: "X-OpenWhispr-User-Email" }), {
      isOverride: false,
      request,
    });
    await client.chatCompletions({
      messages: [{ role: "user", content: "hi" }],
      userId: "uuid-1",
      requestId: "r1",
      endUser: "a@b.com",
    });
    expect(captured.headers["X-OpenWhispr-User-Email"]).toBe("a@b.com");
  });

  it("omits the email header when userHeaderName set but endUser undefined (system call, D-3)", async () => {
    const { request, captured } = makeCapturingRequest();
    const client = buildLitellmClient(baseConfig({ userHeaderName: "X-OpenWhispr-User-Email" }), {
      isOverride: false,
      request,
    });
    await client.chatCompletions({
      messages: [{ role: "user", content: "hi" }],
      userId: "uuid-1",
      requestId: "r1",
    });
    expect(captured.headers["X-OpenWhispr-User-Email"]).toBeUndefined();
  });

  it("omits the email header when userHeaderName unset but endUser present (header opt-in)", async () => {
    const { request, captured } = makeCapturingRequest();
    const client = buildLitellmClient(baseConfig(), { isOverride: false, request });
    await client.chatCompletions({
      messages: [{ role: "user", content: "hi" }],
      userId: "uuid-1",
      requestId: "r1",
      endUser: "a@b.com",
    });
    // No header configured → no email header regardless of endUser.
    expect(Object.keys(captured.headers)).not.toContain("X-OpenWhispr-User-Email");
  });

  it("audioTranscriptions emits the email header (no body.user slot — header is the only vector)", async () => {
    const { request, captured } = makeCapturingRequest();
    const client = buildLitellmClient(baseConfig({ userHeaderName: "X-OpenWhispr-User-Email" }), {
      isOverride: false,
      request,
    });
    await client.audioTranscriptions({
      body: Readable.from(["bytes"]),
      contentType: "audio/wav",
      userId: "uuid-1",
      requestId: "r1",
      endUser: "a@b.com",
    });
    expect(captured.headers["X-OpenWhispr-User-Email"]).toBe("a@b.com");
    expect(captured.headers["x-litellm-end-user-id"]).toBe("uuid-1");
  });

  it("passthrough emits the email header (opaque body — header is the only vector)", async () => {
    const { request, captured } = makeCapturingRequest();
    const client = buildLitellmClient(baseConfig({ userHeaderName: "X-OpenWhispr-User-Email" }), {
      isOverride: false,
      request,
    });
    await client.passthrough("/v1/diarize", {
      method: "POST",
      body: "{}",
      contentType: "application/json",
      userId: "uuid-1",
      requestId: "r1",
      endUser: "a@b.com",
    });
    expect(captured.headers["X-OpenWhispr-User-Email"]).toBe("a@b.com");
    expect(captured.headers["x-litellm-end-user-id"]).toBe("uuid-1");
  });
});

describe("upstream #4 — endUser CR/LF rejection (T-oc4-02)", () => {
  it("throws when endUser contains CR/LF", async () => {
    const { request } = makeCapturingRequest();
    const client = buildLitellmClient(baseConfig({ userHeaderName: "X-OpenWhispr-User-Email" }), {
      isOverride: false,
      request,
    });
    await expect(
      client.chatCompletions({
        messages: [{ role: "user", content: "hi" }],
        userId: "uuid-1",
        requestId: "r1",
        endUser: "a@b.com\r\nX-Injected: 1",
      }),
    ).rejects.toThrow(/endUser must not contain CR\/LF/);
  });
});
