// SPDX-License-Identifier: Apache-2.0
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
    // DISCOVERY (2026-05): LiteLLM v1.83.x treats `mock_response` as the
    // LITERAL message content, not as a parsed chat-completion JSON. The
    // contract config sets `mock_response: '{"id":"...","content":"mocked
    // reasoning"...}'` (JSON string for parity with the upstream API
    // shape), so the api route — which extracts
    // `choices[0].message.content` — receives the WHOLE JSON string as
    // text. The wire shape is still canonical (zod-validated above);
    // we assert text is non-empty + contains the canary string rather
    // than locking to the strict literal so this test is robust to
    // both LiteLLM behaviors (literal-string OR parsed-completion).
    expect(parsed.text.length).toBeGreaterThan(0);
    expect(parsed.text).toContain("mocked reasoning");
    expect(parsed.model).toBe("qwen3.6-plus");
    expect(parsed.provider).toBe("openrouter");
    expect(parsed.promptMode).toBe("default");
    expect(parsed.matchType).toBe("default");
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
