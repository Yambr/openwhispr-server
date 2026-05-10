// tests/e2e/transcribe — host-side e2e for POST /api/transcribe.
//
// Round-trips a multipart audio body through Traefik (TLS) → api →
// LiteLLM (mock) → back. Mock LiteLLM (litellm_config.contract.yaml)
// returns a fixed transcription for whisper-large-v3:
//   {"text":"mocked transcript","language":"en","duration":1.0,"segments":[]}
//
// The wire-shape contract test in packages/contract-tests/src/transcribe.test.ts
// covers the same logical endpoint from INSIDE the network. This e2e
// covers the EXTERNAL hop — Traefik TLS termination, cookie scope on
// `Domain=.localhost` (or host-only), the route registration in the
// production-build container, and the LiteLLM client end-to-end.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL, audioMultipartBody } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

const TranscribeResponse = z.object({
  text: z.string(),
  wordsUsed: z.number(),
  wordsRemaining: z.number(),
  plan: z.string(),
  limitReached: z.literal(false),
  sttProvider: z.string(),
  sttModel: z.string(),
  language: z.string().optional(),
  duration: z.number().optional(),
  segments: z.array(z.unknown()).optional(),
});
const ErrorEnvelope = z.object({ error: z.string().min(1) }).strict();

describe("e2e — POST /api/transcribe (hermetic mock LiteLLM)", () => {
  it("returns canonical wire shape via Traefik+TLS", async () => {
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
    expect(parsed.text).toBe("mocked transcript");
    expect(parsed.plan).toBe("unlimited");
    expect(parsed.limitReached).toBe(false);
    expect(parsed.wordsRemaining).toBe(999_999_999);
  });

  it("returns 401 envelope without a session cookie", async () => {
    const { body, contentType } = audioMultipartBody();
    const res = await fetch(`${BACKEND_URL}/api/transcribe`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    expect(res.status).toBe(401);
    expect(() => ErrorEnvelope.parse(await res.json())).not.toThrow();
  });
});
