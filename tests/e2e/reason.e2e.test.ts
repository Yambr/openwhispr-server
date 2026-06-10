// SPDX-License-Identifier: FSL-1.1-ALv2
// tests/e2e/reason — host-side e2e for POST /api/reason.
//
// Round-trips `{text:"hello"}` through Traefik (TLS) → api → LiteLLM
// (mock) → back. Mock LiteLLM returns the canonical chat-completion
// shape with content "mocked reasoning" for the default qwen3.6-plus
// model.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

const ReasonResponse = z.object({
  text: z.string(),
  model: z.string(),
  provider: z.string(),
  promptMode: z.string(),
  matchType: z.string(),
});
const ErrorEnvelope = z.object({ error: z.string().min(1) }).strict();

describe("e2e — POST /api/reason (hermetic mock LiteLLM)", () => {
  it("returns canonical wire shape via Traefik+TLS", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/reason`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const parsed = ReasonResponse.parse(json);
    // 260610-nar: POST /api/reason now traverses the internal
    // stream-then-buffer path — the route calls chatCompletionsStream and
    // accumulates the streamed `delta.content` frames before returning a
    // single buffered 200. The contract mock_response for qwen3.6-* is a
    // PLAIN STRING "mocked reasoning": under stream:true LiteLLM chunks it
    // into real SSE deltas + a finish frame + a usage chunk (our client
    // forces include_usage:true), so the accumulator reassembles exactly
    // "mocked reasoning". (An SSE-shaped mock_response would be chunked
    // LITERALLY — verified live 2026-06-10 — yielding the raw `data:` string
    // as text; the plain string is the correct mock.) Wire shape stays
    // byte-identical (zod-validated above). We assert the canary substring
    // rather than a strict literal so the test tolerates LiteLLM's chunk
    // cadence.
    expect(parsed.text.length).toBeGreaterThan(0);
    expect(parsed.text).toContain("mocked reasoning");
    expect(parsed.model).toBe("qwen3.6-plus");
    expect(parsed.provider).toBe("openrouter");
    expect(parsed.promptMode).toBe("default");
    expect(parsed.matchType).toBe("default");

    // 260610-nar — byte-identical wire shape: EXACTLY the canonical five keys
    // reach the client. No `usage`/internal-streaming leakage on the wire.
    expect(Object.keys(json as Record<string, unknown>).sort()).toEqual([
      "matchType",
      "model",
      "promptMode",
      "provider",
      "text",
    ]);

    // SCOPE BOUNDARY (260610-nar): no mid-stream-error e2e here. The
    // hermetic LiteLLM mock cannot deterministically inject an upstream error
    // AFTER the 200 SSE headers open, so the post-200 error/premature-close
    // -> 502 contract is covered exhaustively by the route unit tests
    // (reason.test.ts Test B/C). This e2e proves the happy streamed path
    // through the real Traefik -> api -> LiteLLM chain.
  });

  it("returns 401 envelope without a session cookie", async () => {
    const res = await fetch(`${BACKEND_URL}/api/reason`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });
});
