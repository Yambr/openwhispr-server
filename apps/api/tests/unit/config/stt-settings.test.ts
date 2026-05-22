// SPDX-License-Identifier: FSL-1.1-ALv2
// AUDIT-LIB-02 (LIB-9) — config/stt-settings.ts Zod schema unit tests.
//
// The pre-fix `lib/settings-resolver.ts` read these env vars with raw
// `Number()` casts: `NOTE_RECORDING_SAMPLE_RATE_HZ=abc` produced NaN that
// flowed silently into the wire response. The Zod schema here REJECTS a
// malformed value and falls back to the documented default instead.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTE_RECORDING_MAX_DURATION_SECONDS,
  DEFAULT_NOTE_RECORDING_SAMPLE_RATE_HZ,
  DEFAULT_STT_LANGUAGE,
  DEFAULT_STT_MODEL,
  loadSttSettingsConfigFromEnv,
} from "../../../src/config/stt-settings.js";

const env = (o: Record<string, string> = {}) => o as NodeJS.ProcessEnv;

describe("AUDIT-LIB-02 — loadSttSettingsConfigFromEnv", () => {
  it("returns documented defaults for a fully-empty environment", () => {
    const c = loadSttSettingsConfigFromEnv(env());
    expect(c.sttDefaultModel).toBe(DEFAULT_STT_MODEL);
    expect(c.sttDefaultLanguage).toBe(DEFAULT_STT_LANGUAGE);
    expect(c.noteRecordingMaxDurationSeconds).toBe(DEFAULT_NOTE_RECORDING_MAX_DURATION_SECONDS);
    expect(c.noteRecordingSampleRateHz).toBe(DEFAULT_NOTE_RECORDING_SAMPLE_RATE_HZ);
    expect(c.noteRecordingAllowedFormats).toEqual(["webm", "ogg", "wav", "m4a"]);
    expect(c.noteRecordingDiarizationEnabled).toBe(true);
    expect(c.availableProviders).toEqual([]);
  });

  it("does NOT let a malformed numeric env var become NaN (the LIB-9 bug)", () => {
    const c = loadSttSettingsConfigFromEnv(
      env({
        NOTE_RECORDING_SAMPLE_RATE_HZ: "abc",
        NOTE_RECORDING_MAX_DURATION_SECONDS: "not-a-number",
      }),
    );
    expect(Number.isNaN(c.noteRecordingSampleRateHz)).toBe(false);
    expect(c.noteRecordingSampleRateHz).toBe(DEFAULT_NOTE_RECORDING_SAMPLE_RATE_HZ);
    expect(c.noteRecordingMaxDurationSeconds).toBe(DEFAULT_NOTE_RECORDING_MAX_DURATION_SECONDS);
  });

  it("rejects zero / negative / non-integer numeric values, falling back to default", () => {
    expect(
      loadSttSettingsConfigFromEnv(env({ NOTE_RECORDING_SAMPLE_RATE_HZ: "0" }))
        .noteRecordingSampleRateHz,
    ).toBe(DEFAULT_NOTE_RECORDING_SAMPLE_RATE_HZ);
    expect(
      loadSttSettingsConfigFromEnv(env({ NOTE_RECORDING_SAMPLE_RATE_HZ: "-5" }))
        .noteRecordingSampleRateHz,
    ).toBe(DEFAULT_NOTE_RECORDING_SAMPLE_RATE_HZ);
    expect(
      loadSttSettingsConfigFromEnv(env({ NOTE_RECORDING_SAMPLE_RATE_HZ: "12.5" }))
        .noteRecordingSampleRateHz,
    ).toBe(DEFAULT_NOTE_RECORDING_SAMPLE_RATE_HZ);
  });

  it("accepts a valid positive integer numeric override", () => {
    const c = loadSttSettingsConfigFromEnv(
      env({ NOTE_RECORDING_SAMPLE_RATE_HZ: "44100", NOTE_RECORDING_MAX_DURATION_SECONDS: "120" }),
    );
    expect(c.noteRecordingSampleRateHz).toBe(44100);
    expect(c.noteRecordingMaxDurationSeconds).toBe(120);
  });

  it("applies STT model / language string overrides", () => {
    const c = loadSttSettingsConfigFromEnv(
      env({ STT_DEFAULT_MODEL: "whisper-large-v3", STT_DEFAULT_LANGUAGE: "ru" }),
    );
    expect(c.sttDefaultModel).toBe("whisper-large-v3");
    expect(c.sttDefaultLanguage).toBe("ru");
  });

  it("falls back to default for a blank string override", () => {
    const c = loadSttSettingsConfigFromEnv(env({ STT_DEFAULT_MODEL: "   " }));
    expect(c.sttDefaultModel).toBe(DEFAULT_STT_MODEL);
  });

  it("comma-splits NOTE_RECORDING_ALLOWED_FORMATS, trims, drops blanks", () => {
    const c = loadSttSettingsConfigFromEnv(
      env({ NOTE_RECORDING_ALLOWED_FORMATS: "wav, mp3 ,, flac" }),
    );
    expect(c.noteRecordingAllowedFormats).toEqual(["wav", "mp3", "flac"]);
  });

  it("uses the default format list when NOTE_RECORDING_ALLOWED_FORMATS is empty", () => {
    expect(
      loadSttSettingsConfigFromEnv(env({ NOTE_RECORDING_ALLOWED_FORMATS: "" }))
        .noteRecordingAllowedFormats,
    ).toEqual(["webm", "ogg", "wav", "m4a"]);
  });

  it("disables diarization ONLY for the exact string 'false'", () => {
    expect(
      loadSttSettingsConfigFromEnv(env({ NOTE_RECORDING_DIARIZATION_ENABLED: "false" }))
        .noteRecordingDiarizationEnabled,
    ).toBe(false);
    // Any other value keeps diarization on (pre-existing !== "false" rule).
    for (const v of ["true", "0", "no", "FALSE"]) {
      expect(
        loadSttSettingsConfigFromEnv(env({ NOTE_RECORDING_DIARIZATION_ENABLED: v }))
          .noteRecordingDiarizationEnabled,
      ).toBe(true);
    }
  });

  it("resolves availableProviders from provider-key presence in stable order", () => {
    const c = loadSttSettingsConfigFromEnv(
      env({
        DEEPGRAM_API_KEY: "x",
        OPENAI_API_KEY: "x",
        GROQ_API_KEY: "x",
        ASSEMBLYAI_API_KEY: "x",
      }),
    );
    expect(c.availableProviders).toEqual(["openai", "groq", "assemblyai", "deepgram"]);
  });
});
