// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 04 / Task 2 — GET /api/note-recording-config
// contract test (WIRE-12).
//
// Asserts the wire shape of /api/note-recording-config against the
// canonical NoteRecordingConfigResponseSchema from @openwhispr/wire-
// schemas (Plan 01). DB-only route — available in every compose
// profile.

import { NoteRecordingConfigResponseSchema } from "@openwhispr/wire-schemas";
import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "./env.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import { ErrorEnvelope } from "./schemas.js";

const REACHABLE = await probeBackend();

describe.skipIf(!REACHABLE)("WIRE-12 — GET /api/note-recording-config", () => {
  it("returns canonical NoteRecordingConfigResponse for an authenticated user", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/note-recording-config`, {
      method: "GET",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const parsed = NoteRecordingConfigResponseSchema.parse(json);
    expect(parsed.maxDurationSeconds).toBeGreaterThan(0);
    expect(Number.isFinite(parsed.maxDurationSeconds)).toBe(true);
    expect(parsed.sampleRateHz).toBeGreaterThan(0);
    expect(Number.isFinite(parsed.sampleRateHz)).toBe(true);
    expect(Array.isArray(parsed.allowedFormats)).toBe(true);
    expect(parsed.allowedFormats.length).toBeGreaterThan(0);
    for (const fmt of parsed.allowedFormats) {
      expect(typeof fmt).toBe("string");
      expect(fmt.length).toBeGreaterThan(0);
    }
    expect(typeof parsed.diarizationEnabled).toBe("boolean");
  });

  it("returns 401 envelope when called without a session cookie or bearer", async () => {
    const res = await fetch(`${BACKEND_URL}/api/note-recording-config`, {
      method: "GET",
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });
});
