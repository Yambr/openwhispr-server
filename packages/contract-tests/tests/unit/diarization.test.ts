// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 / Plan 06 / Task 3 — POST /v1/audio/diarization contract test
// (LITELLM-03, D-07 REVISED).
//
// Asserts the wire shape returned by /v1/audio/diarization against the
// canonical `DiarizationResponse` zod schema (Plan 01) when run against a
// fully deployed compose stack. The contract-test profile sets
// MOCK_DIARIZATION=true so the route short-circuits to a fixture response
// without calling pyannote.ai — `make contract-test` runs hermetically in
// CI regardless of network conditions or PYANNOTE_API_KEY availability.
//
// Skip semantics: like the other CONTRACT-01 tests, this one uses
// `describe.skipIf(!REACHABLE)` so when no backend is up the suite passes
// cleanly. CI / `make contract-test` set BACKEND_URL explicitly and bring
// the stack up.
//
// E2E variant: when RUN_E2E=true is set, the second describe block runs a
// real-pyannote test against a 5-second sample audio fixture. PYANNOTE_API_KEY
// must be present in the API container's .env.e2e for this path. Skipped
// by default to keep CI deterministic.

import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "../../src/env.js";
import { audioMultipartBody } from "../../src/helpers/multipart.js";
import { signInFixture } from "../../src/helpers/sign-in-fixture.js";
import { DiarizationResponse, ErrorEnvelope } from "../../src/schemas.js";

const REACHABLE = await probeBackend();

describe.skipIf(!REACHABLE)(
  "LITELLM-03 — POST /v1/audio/diarization (D-07 REVISED sync-wrapper)",
  () => {
    it("returns canonical DiarizationResponse shape (mock mode, contract-test profile)", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const { body, contentType } = audioMultipartBody();
      const res = await jar.fetch(`${BACKEND_URL}/v1/audio/diarization`, {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      // DiarizationResponse uses .passthrough() — additional fields like
      // `duration` are echoed without validation. The canonical shape is
      // {segments: [{start, end, speaker}, ...]}.
      const parsed = DiarizationResponse.parse(json);
      expect(parsed.segments.length).toBeGreaterThan(0);
      expect(parsed.segments[0]?.speaker).toBeDefined();
      expect(typeof parsed.segments[0]?.start).toBe("number");
      expect(typeof parsed.segments[0]?.end).toBe("number");
    });

    it("returns 401 envelope when called without a session cookie or bearer", async () => {
      const { body, contentType } = audioMultipartBody();
      const res = await fetch(`${BACKEND_URL}/v1/audio/diarization`, {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(() => ErrorEnvelope.parse(json)).not.toThrow();
    });

    it("returns 400 envelope when content-type is not multipart", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/v1/audio/diarization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ not: "multipart" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(() => ErrorEnvelope.parse(json)).not.toThrow();
    });
  },
);

// E2E variant — runs only when RUN_E2E=true is set AND a backend is reachable.
// Skipped by default; CI's `make contract-test` does NOT set this. Operators
// running `make e2e-test` with a real PYANNOTE_API_KEY in .env.e2e flip the
// flag and exercise the live pyannote.ai 4-step async flow against a 5s
// sample WAV (tests/fixtures/audio/sample-1s.wav suffices for plumbing).
describe.skipIf(!REACHABLE || process.env.RUN_E2E !== "true")(
  "LITELLM-03 — E2E real pyannote.ai (sync-wrapper end-to-end)",
  () => {
    it("returns 200 + non-empty segments[] from real pyannote.ai", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const { body, contentType } = audioMultipartBody("sample-1s.wav");
      const res = await jar.fetch(`${BACKEND_URL}/v1/audio/diarization`, {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        segments: Array<{ start: number; end: number; speaker: string }>;
      };
      const parsed = DiarizationResponse.parse(json);
      expect(parsed.segments.length).toBeGreaterThan(0);
    }, 360_000);
  },
);
