// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 68 — loadWebSearchConfigFromEnv tests.
//
// The env-driven web-search config MUST:
//   - return byte-identical defaults when no env var is set
//   - honor TAVILY_SEARCH_URL / TAVILY_TIMEOUT_MS overrides
//   - honor YANDEX_SEARCH_URL / YANDEX_HEADERS_TIMEOUT_MS / YANDEX_BODY_TIMEOUT_MS
//   - fall back to defaults on malformed / non-positive / empty values
//     (a zeroed timeout would abort every web-search request)

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAVILY_SEARCH_URL,
  DEFAULT_TAVILY_TIMEOUT_MS,
  DEFAULT_YANDEX_BODY_TIMEOUT_MS,
  DEFAULT_YANDEX_HEADERS_TIMEOUT_MS,
  DEFAULT_YANDEX_SEARCH_URL,
  loadWebSearchConfigFromEnv,
} from "../../../src/config/web-search.js";

describe("loadWebSearchConfigFromEnv", () => {
  it("returns pre-existing literal defaults when env is empty", () => {
    const cfg = loadWebSearchConfigFromEnv({});
    expect(cfg.tavily.searchUrl).toBe(DEFAULT_TAVILY_SEARCH_URL);
    expect(cfg.tavily.timeoutMs).toBe(DEFAULT_TAVILY_TIMEOUT_MS);
    expect(cfg.yandex.searchUrl).toBe(DEFAULT_YANDEX_SEARCH_URL);
    expect(cfg.yandex.headersTimeoutMs).toBe(DEFAULT_YANDEX_HEADERS_TIMEOUT_MS);
    expect(cfg.yandex.bodyTimeoutMs).toBe(DEFAULT_YANDEX_BODY_TIMEOUT_MS);
  });

  it("matches the historical literal values exactly", () => {
    expect(DEFAULT_TAVILY_SEARCH_URL).toBe("https://api.tavily.com/search");
    expect(DEFAULT_TAVILY_TIMEOUT_MS).toBe(5000);
    expect(DEFAULT_YANDEX_SEARCH_URL).toBe("https://searchapi.api.cloud.yandex.net/v2/web/search");
    expect(DEFAULT_YANDEX_HEADERS_TIMEOUT_MS).toBe(5000);
    expect(DEFAULT_YANDEX_BODY_TIMEOUT_MS).toBe(10000);
  });

  it("honors Tavily env overrides", () => {
    const cfg = loadWebSearchConfigFromEnv({
      TAVILY_SEARCH_URL: "https://proxy.internal/tavily/search",
      TAVILY_TIMEOUT_MS: "8000",
    });
    expect(cfg.tavily.searchUrl).toBe("https://proxy.internal/tavily/search");
    expect(cfg.tavily.timeoutMs).toBe(8000);
  });

  it("honors Yandex env overrides", () => {
    const cfg = loadWebSearchConfigFromEnv({
      YANDEX_SEARCH_URL: "https://yandex-mirror.internal/v2/web/search",
      YANDEX_HEADERS_TIMEOUT_MS: "7000",
      YANDEX_BODY_TIMEOUT_MS: "15000",
    });
    expect(cfg.yandex.searchUrl).toBe("https://yandex-mirror.internal/v2/web/search");
    expect(cfg.yandex.headersTimeoutMs).toBe(7000);
    expect(cfg.yandex.bodyTimeoutMs).toBe(15000);
  });

  it("trims surrounding whitespace from URL overrides", () => {
    const cfg = loadWebSearchConfigFromEnv({
      TAVILY_SEARCH_URL: "  https://t.example/search  ",
    });
    expect(cfg.tavily.searchUrl).toBe("https://t.example/search");
  });

  it("falls back to defaults on malformed / non-positive timeouts", () => {
    for (const bad of ["", "  ", "0", "-1", "abc", "1.5", "NaN"]) {
      const cfg = loadWebSearchConfigFromEnv({
        TAVILY_TIMEOUT_MS: bad,
        YANDEX_HEADERS_TIMEOUT_MS: bad,
        YANDEX_BODY_TIMEOUT_MS: bad,
      });
      expect(cfg.tavily.timeoutMs).toBe(DEFAULT_TAVILY_TIMEOUT_MS);
      expect(cfg.yandex.headersTimeoutMs).toBe(DEFAULT_YANDEX_HEADERS_TIMEOUT_MS);
      expect(cfg.yandex.bodyTimeoutMs).toBe(DEFAULT_YANDEX_BODY_TIMEOUT_MS);
    }
  });

  it("falls back to defaults on empty-string URL overrides", () => {
    const cfg = loadWebSearchConfigFromEnv({
      TAVILY_SEARCH_URL: "   ",
      YANDEX_SEARCH_URL: "",
    });
    expect(cfg.tavily.searchUrl).toBe(DEFAULT_TAVILY_SEARCH_URL);
    expect(cfg.yandex.searchUrl).toBe(DEFAULT_YANDEX_SEARCH_URL);
  });
});
