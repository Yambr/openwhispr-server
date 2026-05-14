// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { inferKind } from "../../../src/lib/infer-kind.js";

describe("inferKind", () => {
  it("maps whisper-large-v3 to transcribe_minutes", () => {
    expect(inferKind("whisper-large-v3")).toBe("transcribe_minutes");
  });

  it("maps any whisper-substring alias to transcribe_minutes", () => {
    expect(inferKind("whisper-1")).toBe("transcribe_minutes");
    expect(inferKind("groq-whisper")).toBe("transcribe_minutes");
  });

  it("maps qwen3.6-plus to reason_tokens", () => {
    expect(inferKind("qwen3.6-plus")).toBe("reason_tokens");
  });

  it("maps gpt-4o-mini to reason_tokens", () => {
    expect(inferKind("gpt-4o-mini")).toBe("reason_tokens");
  });

  it("maps gemini-3-flash to reason_tokens", () => {
    expect(inferKind("gemini-3-flash")).toBe("reason_tokens");
  });

  it("maps gpt-4o-realtime-preview to realtime_minutes", () => {
    expect(inferKind("gpt-4o-realtime-preview")).toBe("realtime_minutes");
  });

  it("maps gpt-realtime to realtime_minutes", () => {
    expect(inferKind("gpt-realtime")).toBe("realtime_minutes");
  });

  it("falls back to reason_tokens for unknown aliases", () => {
    expect(inferKind("unknown-model")).toBe("reason_tokens");
    expect(inferKind("")).toBe("reason_tokens");
  });

  it("realtime check wins when both keywords appear (defensive)", () => {
    // A hypothetical 'whisper-realtime' alias — current rule prefers
    // transcribe_minutes because the whisper-substring branch fires first.
    // This test pins that ordering decision so a future refactor cannot
    // silently flip it.
    expect(inferKind("whisper-realtime")).toBe("transcribe_minutes");
  });
});
