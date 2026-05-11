// Phase 05 / Plan 03 / Task 2 — Web-search registry tests.
//
// Validates:
//   * Default resolution (WEB_SEARCH_PROVIDER unset) returns Tavily.
//   * Explicit 'yandex' resolution returns the Yandex adapter.
//   * Unknown provider name THROWS at resolve time (D-02 boot-fatal).
//   * Registry map exposes both 'tavily' and 'yandex' entries.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWebSearchProvider, webSearchRegistry } from "../registry.js";

const originalEnv = process.env.WEB_SEARCH_PROVIDER;

describe("web-search registry", () => {
  beforeEach(() => {
    delete process.env.WEB_SEARCH_PROVIDER;
  });
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.WEB_SEARCH_PROVIDER;
    } else {
      process.env.WEB_SEARCH_PROVIDER = originalEnv;
    }
  });

  it("registry contains tavily and yandex entries", () => {
    expect(webSearchRegistry.has("tavily")).toBe(true);
    expect(webSearchRegistry.has("yandex")).toBe(true);
    expect(webSearchRegistry.get("tavily")?.name).toBe("tavily");
    expect(webSearchRegistry.get("yandex")?.name).toBe("yandex");
  });

  it("defaults to tavily when WEB_SEARCH_PROVIDER is unset", () => {
    const provider = resolveWebSearchProvider();
    expect(provider.name).toBe("tavily");
  });

  it("returns the Yandex adapter when WEB_SEARCH_PROVIDER=yandex", () => {
    process.env.WEB_SEARCH_PROVIDER = "yandex";
    const provider = resolveWebSearchProvider();
    expect(provider.name).toBe("yandex");
  });

  it("throws fatal Error with 'Unknown WEB_SEARCH_PROVIDER' when value is not registered (D-02)", () => {
    process.env.WEB_SEARCH_PROVIDER = "does-not-exist";
    expect(() => resolveWebSearchProvider()).toThrow(/Unknown WEB_SEARCH_PROVIDER/);
  });

  it("error message lists the known provider names so the operator can fix the typo", () => {
    process.env.WEB_SEARCH_PROVIDER = "googlesearch";
    expect(() => resolveWebSearchProvider()).toThrow(/tavily/);
    expect(() => resolveWebSearchProvider()).toThrow(/yandex/);
  });
});
