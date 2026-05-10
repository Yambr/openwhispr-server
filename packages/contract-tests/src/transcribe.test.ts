// Phase 03 / Plan 04 / Task 2 — POST /api/transcribe contract test
// (WIRE-05).
//
// Asserts the wire shape returned by /api/transcribe against the canonical
// `TranscribeResponse` zod schema (Plan 01) when run against a fully
// deployed compose stack with mock LiteLLM. The mock LiteLLM config
// (compose/litellm/litellm_config.contract.yaml) is wired to return a
// fixed transcription for whisper-large-v3 so this test is deterministic
// regardless of network conditions or third-party provider availability.
//
// Skip semantics: like the other CONTRACT-01 tests, this one uses
// `describe.skipIf(!REACHABLE)` so when no backend is up the suite passes
// cleanly. CI / `make contract-test` set BACKEND_URL explicitly and bring
// the stack up.

import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "./env.js";
import { audioMultipartBody } from "./helpers/multipart.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import { ErrorEnvelope, TranscribeResponse } from "./schemas.js";

const REACHABLE = await probeBackend();

describe.skipIf(!REACHABLE)("WIRE-05 — POST /api/transcribe", () => {
  it("returns the canonical wire shape from mock LiteLLM (Groq whisper-large-v3)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const { body, contentType } = audioMultipartBody();
    const res = await jar.fetch(`${BACKEND_URL}/api/transcribe`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const parsed = TranscribeResponse.parse(json);
    expect(parsed.sttProvider).toBe("groq");
    expect(parsed.sttModel).toBe("whisper-large-v3");
    expect(parsed.plan).toBe("unlimited");
    expect(parsed.limitReached).toBe(false);
    // Mock LiteLLM returns a fixed text + duration; wordsUsed = ceil(duration/60).
    expect(typeof parsed.text).toBe("string");
    expect(parsed.text.length).toBeGreaterThan(0);
    expect(parsed.wordsUsed).toBeGreaterThanOrEqual(0);
    // Unlimited sentinel — exact value locked in Plan 01.
    expect(parsed.wordsRemaining).toBe(999_999_999);
  });

  it("returns a 401 envelope when called without a session cookie or bearer", async () => {
    const { body, contentType } = audioMultipartBody();
    const res = await fetch(`${BACKEND_URL}/api/transcribe`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });

  it("returns a 400 envelope when the content-type is not multipart", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ not: "multipart" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });
});
