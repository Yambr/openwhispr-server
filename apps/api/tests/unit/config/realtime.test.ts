// SPDX-License-Identifier: FSL-1.1-ALv2
// R31 — unit tests for the realtime-relay backend config loader.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENAI_REALTIME_MODEL,
  DEFAULT_OPENAI_REALTIME_URL,
  DEFAULT_REALTIME_BACKEND,
  loadRealtimeConfigFromEnv,
  RealtimeConfigError,
} from "../../../src/config/realtime.js";

describe("loadRealtimeConfigFromEnv", () => {
  it("defaults to the direct backend when REALTIME_BACKEND is unset", () => {
    const c = loadRealtimeConfigFromEnv({});
    expect(c.backend).toBe(DEFAULT_REALTIME_BACKEND);
    expect(c.backend).toBe("direct");
  });

  it("accepts REALTIME_BACKEND=litellm", () => {
    expect(loadRealtimeConfigFromEnv({ REALTIME_BACKEND: "litellm" }).backend).toBe("litellm");
  });

  it("accepts REALTIME_BACKEND=direct", () => {
    expect(loadRealtimeConfigFromEnv({ REALTIME_BACKEND: "direct" }).backend).toBe("direct");
  });

  it("is case-insensitive and trims whitespace on REALTIME_BACKEND", () => {
    expect(loadRealtimeConfigFromEnv({ REALTIME_BACKEND: "  DIRECT  " }).backend).toBe("direct");
  });

  it("throws RealtimeConfigError on an unrecognized REALTIME_BACKEND value", () => {
    expect(() => loadRealtimeConfigFromEnv({ REALTIME_BACKEND: "speaches" })).toThrow(
      RealtimeConfigError,
    );
  });

  it("defaults openaiRealtimeUrl to the OpenAI GA endpoint", () => {
    expect(loadRealtimeConfigFromEnv({}).openaiRealtimeUrl).toBe(DEFAULT_OPENAI_REALTIME_URL);
  });

  it("honors an OPENAI_REALTIME_URL override", () => {
    const c = loadRealtimeConfigFromEnv({ OPENAI_REALTIME_URL: "wss://proxy.example/realtime" });
    expect(c.openaiRealtimeUrl).toBe("wss://proxy.example/realtime");
  });

  it("does NOT read OPENAI_API_KEY in litellm mode (key stays undefined)", () => {
    const c = loadRealtimeConfigFromEnv({
      REALTIME_BACKEND: "litellm",
      OPENAI_API_KEY: "sk-should-be-ignored",
    });
    expect(c.openaiApiKey).toBeUndefined();
  });

  it("reads OPENAI_API_KEY in direct mode", () => {
    const c = loadRealtimeConfigFromEnv({
      REALTIME_BACKEND: "direct",
      OPENAI_API_KEY: "sk-direct-key",
    });
    expect(c.openaiApiKey).toBe("sk-direct-key");
  });

  it("leaves openaiApiKey undefined in direct mode when the key is unset", () => {
    expect(loadRealtimeConfigFromEnv({ REALTIME_BACKEND: "direct" }).openaiApiKey).toBeUndefined();
  });

  it("treats a blank OPENAI_API_KEY in direct mode as unset", () => {
    const c = loadRealtimeConfigFromEnv({ REALTIME_BACKEND: "direct", OPENAI_API_KEY: "   " });
    expect(c.openaiApiKey).toBeUndefined();
  });

  it("defaults openaiRealtimeModel to gpt-realtime in direct mode", () => {
    expect(loadRealtimeConfigFromEnv({ REALTIME_BACKEND: "direct" }).openaiRealtimeModel).toBe(
      DEFAULT_OPENAI_REALTIME_MODEL,
    );
    expect(DEFAULT_OPENAI_REALTIME_MODEL).toBe("gpt-realtime");
  });

  it("honors an OPENAI_REALTIME_MODEL override in direct mode", () => {
    expect(
      loadRealtimeConfigFromEnv({
        REALTIME_BACKEND: "direct",
        OPENAI_REALTIME_MODEL: "gpt-4o-realtime-preview",
      }).openaiRealtimeModel,
    ).toBe("gpt-4o-realtime-preview");
  });

  it("does NOT read OPENAI_REALTIME_MODEL in litellm mode", () => {
    expect(
      loadRealtimeConfigFromEnv({
        REALTIME_BACKEND: "litellm",
        OPENAI_REALTIME_MODEL: "gpt-realtime",
      }).openaiRealtimeModel,
    ).toBeUndefined();
  });
});
