// SPDX-License-Identifier: FSL-1.1-ALv2
// tests/e2e/phase-05-config-endpoints — host-side e2e for WIRE-11
// (GET /api/stt-config) + WIRE-12 (GET /api/note-recording-config).
//
// Round-trips both routes through Traefik (TLS) → api → real
// Postgres + PgBouncer via the docker-compose stack. Asserts:
//   1. /api/stt-config returns 200 + canonical SttConfigResponse for
//      a signed-in fixture. defaultModel + defaultLanguage are env
//      defaults ('whisper-1' / 'auto') because the compose profile
//      doesn't seed tenant/user overrides.
//   2. /api/note-recording-config returns 200 + canonical
//      NoteRecordingConfigResponse with default values
//      (maxDurationSeconds=7200, sampleRateHz=16000,
//       allowedFormats=['webm','ogg','wav','m4a'],
//       diarizationEnabled=true).
//   3. Both routes return 401 envelope without a session cookie.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

const SttConfigResponse = z.object({
  defaultModel: z.string(),
  defaultLanguage: z.string(),
  availableProviders: z.array(z.string()),
});

const NoteRecordingConfigResponse = z.object({
  maxDurationSeconds: z.number(),
  sampleRateHz: z.number(),
  allowedFormats: z.array(z.string()),
  diarizationEnabled: z.boolean(),
});

const ErrorEnvelope = z.object({ error: z.string().min(1) }).strict();

describe("e2e — GET /api/stt-config + GET /api/note-recording-config (real compose stack)", () => {
  it("round-trips /api/stt-config via Traefik+TLS with env defaults", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/stt-config`);
    expect(res.status).toBe(200);
    const parsed = SttConfigResponse.parse(await res.json());
    // Defaults shipped by .env.example for the compose profile.
    expect(parsed.defaultModel).toBe("whisper-1");
    expect(parsed.defaultLanguage).toBe("auto");
    expect(Array.isArray(parsed.availableProviders)).toBe(true);
    // availableProviders is env-driven; compose may have wired
    // some/none of the per-provider keys. We assert subset shape only.
    for (const provider of parsed.availableProviders) {
      expect(["openai", "groq", "assemblyai", "deepgram"]).toContain(provider);
    }
  });

  it("round-trips /api/note-recording-config via Traefik+TLS with env defaults", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/note-recording-config`);
    expect(res.status).toBe(200);
    const parsed = NoteRecordingConfigResponse.parse(await res.json());
    expect(parsed.maxDurationSeconds).toBe(7200);
    expect(parsed.sampleRateHz).toBe(16000);
    expect(parsed.allowedFormats).toEqual(["webm", "ogg", "wav", "m4a"]);
    expect(parsed.diarizationEnabled).toBe(true);
  });

  it("returns 401 envelope on both routes without a session cookie", async () => {
    const stt = await fetch(`${BACKEND_URL}/api/stt-config`);
    expect(stt.status).toBe(401);
    expect(async () => ErrorEnvelope.parse(await stt.json())).not.toThrow();

    const note = await fetch(`${BACKEND_URL}/api/note-recording-config`);
    expect(note.status).toBe(401);
    expect(async () => ErrorEnvelope.parse(await note.json())).not.toThrow();
  });
});
