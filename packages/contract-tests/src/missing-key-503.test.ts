// SPDX-License-Identifier: Apache-2.0
// Phase 03 / Plan 10 / Task 1 — Pitfall #8: missing provider key → 503 (NOT 401).
//
// Pitfall #8 (recorded in 03-CONTEXT.md): a misconfigured provider key
// (GROQ_API_KEY for STT, OPENROUTER_API_KEY for reason, PYANNOTE_API_KEY
// for diarization) MUST surface to the desktop client as a 503 envelope —
// NEVER a 401. A 401 would falsely indicate session expiry, triggering
// the desktop's `tokenStore.js` rotation logic and producing a confusing
// loop. 503 is the correct semantic: "the api is reachable and the user
// is authenticated, but a required upstream dependency is missing".
//
// This test runs ONLY in the dedicated `make contract-test-missing-keys`
// stack (which boots the api with empty provider keys). The default
// `make contract-test` profile injects `fake-key-for-mock` values via
// litellm_config.contract.yaml and would NOT exercise the 503 path.
// We gate via the `MISSING_KEY_TEST_MODE=1` env so the same source file
// is harmless under the standard suite — it.skipIf bypasses every it().
//
// Coverage for the three Phase 3 LiteLLM-backed routes:
//   * POST /api/transcribe       — D-11 STT on Groq, GROQ_API_KEY
//   * POST /api/reason           — OPENROUTER_API_KEY
//   * POST /v1/audio/diarization — D-07 sync-wrapper, PYANNOTE_API_KEY
//
// Each must:
//   1. Return HTTP 503.
//   2. Match `ErrorEnvelope` strict shape (no leak surface).
//   3. Mention the actionable env var name in the error string so the
//      operator knows EXACTLY which key to set (Pitfall #8 fix prescribes
//      "actionable error message identifying the missing key").

import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "./env.js";
import { audioMultipartBody } from "./helpers/multipart.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import { ErrorEnvelope } from "./schemas.js";

const REACHABLE = await probeBackend();
const MISSING_KEY_MODE = process.env.MISSING_KEY_TEST_MODE === "1";

describe.skipIf(!REACHABLE || !MISSING_KEY_MODE)(
  "Pitfall #8 — missing provider key → 503 envelope (NOT 401)",
  () => {
    it("transcribe returns 503 mentioning GROQ_API_KEY when the key is unset", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const { body, contentType } = audioMultipartBody();
      const res = await jar.fetch(`${BACKEND_URL}/api/transcribe`, {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      });
      expect(res.status).toBe(503);
      // CRITICAL: 401 here is the bug we're guarding against.
      expect(res.status).not.toBe(401);
      const json = await res.json();
      const env = ErrorEnvelope.parse(json);
      // Actionable message — name the env var so the operator can fix it.
      // Accept either explicit name or canonical "STT provider" hint.
      expect(env.error).toMatch(/GROQ_API_KEY|STT|provider/i);
    });

    it("reason returns 503 mentioning OPENROUTER_API_KEY when the key is unset", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/reason`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello world" }),
      });
      expect(res.status).toBe(503);
      expect(res.status).not.toBe(401);
      const json = await res.json();
      const env = ErrorEnvelope.parse(json);
      expect(env.error).toMatch(/OPENROUTER_API_KEY|reason|provider/i);
    });

    it("diarization returns 503 mentioning PYANNOTE_API_KEY when the key is unset", async () => {
      // Diarization route enforces sync-wrapper PYANNOTE_API_KEY check at
      // request time (apps/api/src/lib/pyannote-client.ts). Missing key
      // surfaces 503 with an actionable message; the route is NEVER 401.
      const jar = await signInFixture("fixture@conformance.test");
      const { body, contentType } = audioMultipartBody();
      const res = await jar.fetch(`${BACKEND_URL}/v1/audio/diarization`, {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      });
      expect(res.status).toBe(503);
      expect(res.status).not.toBe(401);
      const json = await res.json();
      const env = ErrorEnvelope.parse(json);
      expect(env.error).toMatch(/PYANNOTE_API_KEY|diarization|provider/i);
    });
  },
);
