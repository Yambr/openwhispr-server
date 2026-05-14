// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 04 / Task 2 — GET /api/stt-config contract test
// (WIRE-11).
//
// Asserts the wire shape of /api/stt-config against the canonical
// SttConfigResponseSchema from @openwhispr/wire-schemas (Plan 01).
// The route is DB-only (no LiteLLM dependency) so it's available
// in every compose profile.
//
// Skip semantics match the other CONTRACT-01 tests: skipped when
// the backend is unreachable.

import { SttConfigResponseSchema } from "@openwhispr/wire-schemas";
import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "../../src/env.js";
import { signInFixture } from "../../src/helpers/sign-in-fixture.js";
import { ErrorEnvelope } from "../../src/schemas.js";

const REACHABLE = await probeBackend();

describe.skipIf(!REACHABLE)("WIRE-11 — GET /api/stt-config", () => {
  it("returns canonical SttConfigResponse for an authenticated user", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/stt-config`, { method: "GET" });
    expect(res.status).toBe(200);
    const json = await res.json();
    const parsed = SttConfigResponseSchema.parse(json);
    expect(typeof parsed.defaultModel).toBe("string");
    expect(parsed.defaultModel.length).toBeGreaterThan(0);
    expect(typeof parsed.defaultLanguage).toBe("string");
    expect(parsed.defaultLanguage.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.availableProviders)).toBe(true);
    // availableProviders may be empty (no provider keys wired) or
    // contain a subset of {openai,groq,assemblyai,deepgram}. Either
    // shape is acceptable.
    for (const provider of parsed.availableProviders) {
      expect(["openai", "groq", "assemblyai", "deepgram"]).toContain(provider);
    }
  });

  it("returns 401 envelope when called without a session cookie or bearer", async () => {
    const res = await fetch(`${BACKEND_URL}/api/stt-config`, { method: "GET" });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });
});
