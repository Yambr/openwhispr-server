// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 3 / Plan 02 / Task 3 — guard the Phase-3 zod schemas.
//
// These schemas are the single source of truth wired into both the
// apps/api route handlers (Plans 03/04/05) AND the CONTRACT-01
// conformance suite (Plan 06). Tests here pin the wire shape so a
// drift between docs/wire-contracts-phase-3.md and the schemas trips
// CI loudly instead of leaking through to runtime mismatches.

import { describe, expect, it } from "vitest";
import {
  DiarizationResponse,
  ReasonRequest,
  ReasonResponse,
  TranscribeRequestFields,
  TranscribeResponse,
} from "../../../src/schemas.js";

describe("TranscribeRequestFields", () => {
  it("accepts file + optional language/model/response_format", () => {
    const result = TranscribeRequestFields.safeParse({
      file: Buffer.from("fake"),
      language: "en",
      model: "whisper-large-v3",
      response_format: "json",
    });
    expect(result.success).toBe(true);
  });

  it("accepts file alone (all other fields optional)", () => {
    const result = TranscribeRequestFields.safeParse({
      file: Buffer.from("fake"),
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields (.strict)", () => {
    const result = TranscribeRequestFields.safeParse({
      file: Buffer.from("fake"),
      bogus: "extra",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid response_format enum", () => {
    const result = TranscribeRequestFields.safeParse({
      file: Buffer.from("fake"),
      response_format: "xml",
    });
    expect(result.success).toBe(false);
  });
});

describe("TranscribeResponse", () => {
  const valid = {
    text: "hello world",
    wordsUsed: 2,
    wordsRemaining: 999,
    plan: "unlimited",
    limitReached: false,
    sttProvider: "groq",
    sttModel: "whisper-large-v3",
  };

  it("accepts the canonical wire shape", () => {
    expect(TranscribeResponse.safeParse(valid).success).toBe(true);
  });

  it("accepts optional language/duration/segments", () => {
    const result = TranscribeResponse.safeParse({
      ...valid,
      language: "en",
      duration: 1.5,
      segments: [{ id: 0, text: "hello" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects limitReached: true (literal false in v1 per WIRE-05)", () => {
    expect(TranscribeResponse.safeParse({ ...valid, limitReached: true }).success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const { text: _omit, ...missing } = valid;
    expect(TranscribeResponse.safeParse(missing).success).toBe(false);
  });

  it("response is forward-compat (extra fields allowed — no .strict)", () => {
    const result = TranscribeResponse.safeParse({
      ...valid,
      auditTrace: "abc-123",
    });
    expect(result.success).toBe(true);
  });
});

describe("ReasonRequest", () => {
  it("accepts text alone", () => {
    expect(ReasonRequest.safeParse({ text: "hi" }).success).toBe(true);
  });

  it("accepts text + all optional fields", () => {
    // Plan 51-07 (REVIEW wire-schemas HIGH) — promptMode / matchType /
    // provider are now bound to documented enum values; pre-fix the
    // route echoed arbitrary client strings back into the response.
    const result = ReasonRequest.safeParse({
      text: "rewrite this email",
      model: "qwen3.6-plus",
      provider: "openrouter",
      promptMode: "cleanup",
      matchType: "cleanup",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty text", () => {
    expect(ReasonRequest.safeParse({ text: "" }).success).toBe(false);
  });

  it("rejects unknown fields (.strict)", () => {
    expect(ReasonRequest.safeParse({ text: "hi", surprise: 1 }).success).toBe(false);
  });
});

describe("ReasonResponse", () => {
  const valid = {
    text: "rewritten",
    model: "qwen3.6-plus",
    provider: "openrouter",
    promptMode: "polish",
    matchType: "stylistic",
  };

  it("accepts the canonical wire shape", () => {
    expect(ReasonResponse.safeParse(valid).success).toBe(true);
  });

  it("rejects missing model field", () => {
    const { model: _omit, ...missing } = valid;
    expect(ReasonResponse.safeParse(missing).success).toBe(false);
  });

  it("response is forward-compat (extra fields allowed — no .strict)", () => {
    expect(ReasonResponse.safeParse({ ...valid, requestId: "abc" }).success).toBe(true);
  });
});

describe("DiarizationResponse", () => {
  it("accepts segments array with start/end/speaker", () => {
    const result = DiarizationResponse.safeParse({
      segments: [
        { start: 0, end: 1.2, speaker: "SPEAKER_00" },
        { start: 1.2, end: 3.5, speaker: "SPEAKER_01" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing speaker on a segment", () => {
    const result = DiarizationResponse.safeParse({
      segments: [{ start: 0, end: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("strict — rejects upstream pyannote extras (Plan 51-07 dropped .passthrough())", () => {
    // Plan 51-07 (REVIEW wire-schemas HIGH) — .passthrough() removed.
    // Extra keys (durationSec, diarizationModel, etc.) are now refused
    // at the wire boundary so a malformed upstream cannot smuggle
    // arbitrary fields into the client.
    const result = DiarizationResponse.safeParse({
      segments: [{ start: 0, end: 1, speaker: "SPEAKER_00" }],
      diarizationModel: "pyannote/speaker-diarization-3.1",
      durationSec: 1.0,
    });
    expect(result.success).toBe(false);
  });
});
