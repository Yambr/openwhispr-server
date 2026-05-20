// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 65 / Plan 65-01 — WR-05 regression test.
//
// WR-05 — the provider→envvar-label mapping must live on the
// `WebSearchProvider` interface (`envVarLabel`), not as a
// `provider.name === "tavily" ? ... : "yandex" ? ...` string fork in the
// route. A new adapter not added to the route fork yields a misleading
// "set <provider env vars>" label.
//
// Pure-unit: imports the adapters + reads the route source.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TavilyAdapter } from "../../../../src/lib/web-search/tavily-adapter.js";
import { YandexAdapter } from "../../../../src/lib/web-search/yandex-adapter.js";

const ROUTE_SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "src",
  "routes",
  "agent",
  "web-search.ts",
);

describe("web-search — WR-05 provider envvar-label on the interface", () => {
  it("WR-05: each adapter exposes envVarLabel with its operator label", () => {
    const tavily = new TavilyAdapter();
    const yandex = new YandexAdapter();
    expect(tavily.envVarLabel).toBe("TAVILY_API_KEY");
    expect(yandex.envVarLabel).toBe("YANDEX_SEARCH_API_KEY + YANDEX_SEARCH_FOLDER_ID");
  });

  it("WR-05: the route no longer hardcodes a provider.name === string fork", () => {
    const src = readFileSync(ROUTE_SRC, "utf8");
    expect(src).not.toMatch(/provider\.name === "tavily"/);
    expect(src).not.toMatch(/provider\.name === "yandex"/);
    // The route reads the label generically off the interface.
    expect(src).toContain("provider.envVarLabel");
  });
});
