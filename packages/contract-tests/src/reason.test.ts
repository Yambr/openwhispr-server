// Phase 03 / Plan 05 / Task 2 — POST /api/reason contract test (WIRE-06).
//
// Asserts the wire shape returned by /api/reason against the canonical
// `ReasonResponse` zod schema (Plan 01) when run against a fully deployed
// compose stack with mock LiteLLM. The mock LiteLLM config
// (compose/litellm/litellm_config.contract.yaml) returns a fixed
// chat-completion payload for qwen3.6-plus so this test is deterministic
// regardless of network conditions or third-party provider availability.
//
// Skip semantics: like the other CONTRACT-01 tests, this one uses
// `describe.skipIf(!REACHABLE)` so when no backend is up the suite passes
// cleanly. CI / `make contract-test` set BACKEND_URL explicitly and bring
// the stack up.

import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "./env.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import { ErrorEnvelope, ReasonResponse } from "./schemas.js";

const REACHABLE = await probeBackend();

describe.skipIf(!REACHABLE)("WIRE-06 — POST /api/reason", () => {
  it("returns canonical ReasonResponse from mock LiteLLM (default qwen3.6-plus)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/reason`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const parsed = ReasonResponse.parse(json);
    // mock_response in compose/litellm/litellm_config.contract.yaml.
    expect(parsed.text).toBe("mocked reasoning");
    expect(parsed.model).toBe("qwen3.6-plus");
    expect(parsed.provider).toBe("openrouter");
    expect(parsed.promptMode).toBe("default");
    expect(parsed.matchType).toBe("default");
  });

  it("returns a 401 envelope when called without a session cookie or bearer", async () => {
    const res = await fetch(`${BACKEND_URL}/api/reason`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });

  it("returns a 400 envelope when the request body has an extra field (.strict())", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/reason`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello", extraField: "y" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });

  it("returns a 400 envelope when text is empty (zod min(1))", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/reason`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });
});
