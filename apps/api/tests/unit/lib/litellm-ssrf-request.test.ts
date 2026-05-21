// SPDX-License-Identifier: FSL-1.1-ALv2
// R24 — integration test for the explicit SSRF-bound LiteLLM request seam.
//
// This is the test that would have caught the Cloud-mode 500 blocker:
// it builds the LiteLLM client exactly the way index.ts does (explicit
// `request` bound to the SSRF dispatcher), THEN overwrites the global
// undici dispatcher with a plain `new Agent()` — simulating the post-boot
// clobber — and asserts the LiteLLM calls STILL succeed (no
// SsrfDispatcherNotInstalledError). Mock LiteLLM at the HTTP boundary via
// MockAgent bound to the SSRF dispatcher's pool is not feasible (the SSRF
// Agent does real connects), so the upstream is mocked at the `undici`
// network boundary: we point the client at a MockAgent passed AS the
// SSRF-style dispatcher. The clobber is a separate plain Agent installed
// globally — the client must ignore it.

import { Readable } from "node:stream";
import { buildLitellmClient, type LitellmClientConfig } from "@openwhispr/litellm-client";
import { Agent, MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSsrfBoundRequest } from "../../../src/lib/litellm-ssrf-request.js";

const BASE = "http://litellm:4000";

function baseConfig(): LitellmClientConfig {
  return {
    baseUrl: BASE,
    masterKey: "sk-master-test",
    providerKeys: { openrouter: "sk-or-test", groq: "gsk-test", pyannote: "hf-test" },
    defaultChatModel: "qwen3.6-plus",
  };
}

// The "SSRF dispatcher" stand-in: a MockAgent the helper pins as the
// explicit `dispatcher`. We stamp the SSRF marker so it is a faithful
// stand-in for the real `makeSSRFDispatcher` Agent.
let ssrfStandIn: MockAgent;
// The post-boot clobber: a plain Agent with NO marker, installed globally.
let clobber: Agent;

beforeEach(() => {
  ssrfStandIn = new MockAgent({ connections: 1 });
  ssrfStandIn.disableNetConnect();
  Object.defineProperty(ssrfStandIn, Symbol.for("openwhispr.ssrf-wrapped"), {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  // Simulate the clobber: a marker-less global dispatcher.
  clobber = new Agent();
  setGlobalDispatcher(clobber);
});

afterEach(async () => {
  await ssrfStandIn.close();
  await clobber.close();
});

describe("R24 — LiteLLM client bound to an explicit SSRF dispatcher survives a global-dispatcher clobber", () => {
  it("chatCompletions succeeds even though the global dispatcher lacks the SSRF marker", async () => {
    ssrfStandIn
      .get(BASE)
      .intercept({ path: "/v1/chat/completions", method: "POST" })
      .reply(200, { ok: true });

    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: makeSsrfBoundRequest(ssrfStandIn),
    });

    const res = await client.chatCompletions({
      model: "qwen3.6-plus",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);
  });

  it("audioTranscriptions succeeds even though the global dispatcher lacks the SSRF marker", async () => {
    ssrfStandIn
      .get(BASE)
      .intercept({ path: /\/v1\/audio\/transcriptions/, method: "POST" })
      .reply(200, { text: "hello" });

    const client = buildLitellmClient(baseConfig(), {
      isOverride: false,
      request: makeSsrfBoundRequest(ssrfStandIn),
    });

    const res = await client.audioTranscriptions({
      body: Readable.from(["audio"]),
      contentType: "audio/wav",
      userId: "u1",
      requestId: "r1",
    });
    expect(res.statusCode).toBe(200);
  });
});
