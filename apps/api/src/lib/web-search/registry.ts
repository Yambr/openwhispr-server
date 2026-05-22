// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 03 / Task 2 — Web-search provider registry.
//
// Source of truth: 05-03-PLAN.md + 05-RESEARCH.md § Pattern 5.
//
// Design (D-01: more providers may be added later — keep this extensible):
//   * `webSearchRegistry`: `Map<string, WebSearchProvider>` keyed by the
//     provider's `name`. Future providers add an entry — no route
//     changes (Pitfall #6: route registers UNCONDITIONALLY).
//   * `resolveWebSearchProvider()`: boot-time selector. Reads
//     `WEB_SEARCH_PROVIDER` (defaults to "tavily"), looks up the registry,
//     and THROWS a fatal Error on miss (D-02 boot-fatal). The route module
//     calls this once at registration, NOT per-request, so an unknown
//     value crashes the process at boot — the Phase 1 no-default-secrets
//     discipline: never silently fall back, never paper over operator typos.

import type { WebSearchConfig } from "../../config/web-search.js";
import { TavilyAdapter } from "./tavily-adapter.js";
import type { WebSearchProvider } from "./types.js";
import { YandexAdapter } from "./yandex-adapter.js";

/**
 * Process-level registry of web-search providers. The Map is module-scoped
 * so test harnesses can install fakes via `webSearchRegistry.set(...)` and
 * tear them down via `.delete(...)` between cases — see registry.test.ts.
 */
export const webSearchRegistry: Map<string, WebSearchProvider> = new Map<string, WebSearchProvider>(
  [
    ["tavily", new TavilyAdapter()],
    ["yandex", new YandexAdapter()],
  ],
);

/** Default provider when `WEB_SEARCH_PROVIDER` is unset. Matches the
 *  .env.example default and the project's OSS-first stance (Tavily is
 *  the lowest-friction provider for fresh deployments). */
const DEFAULT_PROVIDER = "tavily";

/**
 * Build a fresh provider registry whose adapters are constructed with the
 * operator-tuned URL/timeout knobs from `config/web-search.ts`. Phase 68 —
 * the route-assembly seam (apps/api/src/index.ts) resolves the env-driven
 * `WebSearchConfig` and passes it here so the adapters never read
 * `process.env` themselves (LOCKER-01).
 */
export function buildWebSearchRegistry(config: WebSearchConfig): Map<string, WebSearchProvider> {
  return new Map<string, WebSearchProvider>([
    [
      "tavily",
      new TavilyAdapter({
        searchUrl: config.tavily.searchUrl,
        timeoutMs: config.tavily.timeoutMs,
      }),
    ],
    [
      "yandex",
      new YandexAdapter({
        searchUrl: config.yandex.searchUrl,
        headersTimeoutMs: config.yandex.headersTimeoutMs,
        bodyTimeoutMs: config.yandex.bodyTimeoutMs,
      }),
    ],
  ]);
}

/**
 * Resolve the active web-search provider per the `WEB_SEARCH_PROVIDER`
 * env var. Called ONCE at route registration; cached for the life of the
 * process. Throwing here at boot is intentional — it surfaces operator
 * typos immediately rather than at first-request time.
 *
 * @param registry Provider registry to look up. Defaults to the shared
 *   module-level `webSearchRegistry` (literal-default adapters). The
 *   route-assembly seam passes a config-tuned registry built via
 *   `buildWebSearchRegistry()`.
 */
export function resolveWebSearchProvider(
  registry: Map<string, WebSearchProvider> = webSearchRegistry,
): WebSearchProvider {
  const name = process.env.WEB_SEARCH_PROVIDER ?? DEFAULT_PROVIDER;
  const provider = registry.get(name);
  if (!provider) {
    const known = Array.from(registry.keys()).join(", ");
    throw new Error(`Unknown WEB_SEARCH_PROVIDER='${name}'. Known providers: ${known}.`);
  }
  return provider;
}
