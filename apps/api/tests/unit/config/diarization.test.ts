// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 68 — loadDiarizationConfigFromEnv tests.
//
// The env-driven diarization config MUST:
//   - return byte-identical defaults when no env var is set
//   - honor PYANNOTE_BASE_URL / PYANNOTE_POLL_INTERVAL_MS /
//     PYANNOTE_POLL_CEILING_MS / SPEACHES_DIARIZATION_MODEL overrides
//   - fall back to defaults on malformed / non-positive / empty values
//     (a zeroed poll interval or ceiling would break the route's poll loop)

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PYANNOTE_BASE_URL,
  DEFAULT_PYANNOTE_POLL_CEILING_MS,
  DEFAULT_PYANNOTE_POLL_INTERVAL_MS,
  DEFAULT_SPEACHES_DIARIZATION_MODEL,
  loadDiarizationConfigFromEnv,
} from "../../../src/config/diarization.js";

describe("loadDiarizationConfigFromEnv", () => {
  it("returns pre-existing literal defaults when env is empty", () => {
    const cfg = loadDiarizationConfigFromEnv({});
    expect(cfg.pyannoteBaseUrl).toBe(DEFAULT_PYANNOTE_BASE_URL);
    expect(cfg.pollIntervalMs).toBe(DEFAULT_PYANNOTE_POLL_INTERVAL_MS);
    expect(cfg.pollCeilingMs).toBe(DEFAULT_PYANNOTE_POLL_CEILING_MS);
    expect(cfg.speachesModel).toBe(DEFAULT_SPEACHES_DIARIZATION_MODEL);
  });

  it("matches the historical literal values exactly", () => {
    expect(DEFAULT_PYANNOTE_BASE_URL).toBe("https://api.pyannote.ai");
    expect(DEFAULT_PYANNOTE_POLL_INTERVAL_MS).toBe(1500);
    expect(DEFAULT_PYANNOTE_POLL_CEILING_MS).toBe(300000);
    expect(DEFAULT_SPEACHES_DIARIZATION_MODEL).toBe("pyannote/speaker-diarization-community-1");
  });

  it("honors all env overrides", () => {
    const cfg = loadDiarizationConfigFromEnv({
      PYANNOTE_BASE_URL: "https://pyannote-mirror.internal",
      PYANNOTE_POLL_INTERVAL_MS: "2500",
      PYANNOTE_POLL_CEILING_MS: "600000",
      SPEACHES_DIARIZATION_MODEL: "pyannote/speaker-diarization-3.1",
    });
    expect(cfg.pyannoteBaseUrl).toBe("https://pyannote-mirror.internal");
    expect(cfg.pollIntervalMs).toBe(2500);
    expect(cfg.pollCeilingMs).toBe(600000);
    expect(cfg.speachesModel).toBe("pyannote/speaker-diarization-3.1");
  });

  it("trims surrounding whitespace from string overrides", () => {
    const cfg = loadDiarizationConfigFromEnv({
      PYANNOTE_BASE_URL: "  https://p.example  ",
      SPEACHES_DIARIZATION_MODEL: "  custom/model  ",
    });
    expect(cfg.pyannoteBaseUrl).toBe("https://p.example");
    expect(cfg.speachesModel).toBe("custom/model");
  });

  it("falls back to defaults on malformed / non-positive poll values", () => {
    for (const bad of ["", "  ", "0", "-1", "abc", "1.5", "NaN"]) {
      const cfg = loadDiarizationConfigFromEnv({
        PYANNOTE_POLL_INTERVAL_MS: bad,
        PYANNOTE_POLL_CEILING_MS: bad,
      });
      expect(cfg.pollIntervalMs).toBe(DEFAULT_PYANNOTE_POLL_INTERVAL_MS);
      expect(cfg.pollCeilingMs).toBe(DEFAULT_PYANNOTE_POLL_CEILING_MS);
    }
  });

  it("falls back to defaults on empty-string string overrides", () => {
    const cfg = loadDiarizationConfigFromEnv({
      PYANNOTE_BASE_URL: "   ",
      SPEACHES_DIARIZATION_MODEL: "",
    });
    expect(cfg.pyannoteBaseUrl).toBe(DEFAULT_PYANNOTE_BASE_URL);
    expect(cfg.speachesModel).toBe(DEFAULT_SPEACHES_DIARIZATION_MODEL);
  });
});
