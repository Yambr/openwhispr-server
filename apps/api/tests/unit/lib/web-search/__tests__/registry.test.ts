// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 03 / Task 2 — Web-search registry tests.
//
// Validates:
//   * Default resolution (WEB_SEARCH_PROVIDER unset) returns Tavily.
//   * Explicit 'yandex' resolution returns the Yandex adapter.
//   * Unknown provider name THROWS at resolve time (D-02 boot-fatal).
//   * Registry map exposes both 'tavily' and 'yandex' entries.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadWebSearchConfigFromEnv } from "../../../../../src/config/web-search.js";
import {
  buildWebSearchRegistry,
  resolveWebSearchProvider,
  webSearchRegistry,
} from "../../../../../src/lib/web-search/registry.js";

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

  // Phase 68 — config-tuned registry. `buildWebSearchRegistry()` constructs
  // the adapters with the operator's URL/timeout knobs (from
  // `loadWebSearchConfigFromEnv()`), and `resolveWebSearchProvider()` accepts
  // that registry so the env boundary stays in config/ + index.ts.
  it("buildWebSearchRegistry returns both providers from a config", () => {
    const reg = buildWebSearchRegistry(loadWebSearchConfigFromEnv({}));
    expect(reg.get("tavily")?.name).toBe("tavily");
    expect(reg.get("yandex")?.name).toBe("yandex");
  });

  it("resolveWebSearchProvider honors an injected config-tuned registry", () => {
    const reg = buildWebSearchRegistry(loadWebSearchConfigFromEnv({}));
    expect(resolveWebSearchProvider(reg).name).toBe("tavily");
    process.env.WEB_SEARCH_PROVIDER = "yandex";
    expect(resolveWebSearchProvider(reg).name).toBe("yandex");
  });

  it("resolveWebSearchProvider still throws D-02 boot-fatal against a config-tuned registry", () => {
    const reg = buildWebSearchRegistry(loadWebSearchConfigFromEnv({}));
    process.env.WEB_SEARCH_PROVIDER = "does-not-exist";
    expect(() => resolveWebSearchProvider(reg)).toThrow(/Unknown WEB_SEARCH_PROVIDER/);
  });
});
