// tests/e2e/diarization — host-side e2e for POST /v1/audio/diarization.
//
// Diarization talks to pyannote.ai directly (NOT via LiteLLM) per
// D-07 REVISED — the bundled-default route is a Fastify sync-wrapper
// around the pyannote.ai 4-step async flow.
//
// Hermetic mode: the contract-test profile sets MOCK_DIARIZATION=true
// in the api container's env (apps/api/src/index.ts reads it at boot),
// which short-circuits the route to a fixture response. PYANNOTE_API_KEY
// is therefore not required for `make e2e-hermetic`.
//
// We assert the 200 mock-mode happy path via Traefik+TLS. The
// "without MOCK_DIARIZATION → 503" branch is covered by
// `make contract-test-missing-keys` and the route's unit tests; an
// e2e for it would require a second compose profile that overrides
// the env, which is out of scope for this back-fill (the hermetic
// happy path is the round-trip rule 3 demands).

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL, audioMultipartBody } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

const DiarizationResponse = z
  .object({
    segments: z.array(
      z.object({
        start: z.number(),
        end: z.number(),
        speaker: z.string(),
      }),
    ),
  })
  .passthrough();
const ErrorEnvelope = z.object({ error: z.string().min(1) }).strict();

describe("e2e — POST /v1/audio/diarization (hermetic mock-mode)", () => {
  it("returns canonical DiarizationResponse via Traefik+TLS (MOCK_DIARIZATION=true)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const { body, contentType } = audioMultipartBody();
    const res = await jar.fetch(`${BACKEND_URL}/v1/audio/diarization`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    expect(res.status).toBe(200);
    const parsed = DiarizationResponse.parse(await res.json());
    expect(parsed.segments.length).toBeGreaterThan(0);
    expect(typeof parsed.segments[0]?.start).toBe("number");
    expect(typeof parsed.segments[0]?.end).toBe("number");
    expect(parsed.segments[0]?.speaker).toBeTruthy();
  });

  it("returns 401 envelope without a session cookie", async () => {
    const { body, contentType } = audioMultipartBody();
    const res = await fetch(`${BACKEND_URL}/v1/audio/diarization`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    expect(res.status).toBe(401);
    expect(() => ErrorEnvelope.parse(await res.json())).not.toThrow();
  });
});
