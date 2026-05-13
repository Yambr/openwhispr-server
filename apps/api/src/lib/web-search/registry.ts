// SPDX-License-Identifier: Apache-2.0
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
 * Resolve the active web-search provider per the `WEB_SEARCH_PROVIDER`
 * env var. Called ONCE at route registration; cached for the life of the
 * process. Throwing here at boot is intentional — it surfaces operator
 * typos immediately rather than at first-request time.
 */
export function resolveWebSearchProvider(): WebSearchProvider {
  const name = process.env.WEB_SEARCH_PROVIDER ?? DEFAULT_PROVIDER;
  const provider = webSearchRegistry.get(name);
  if (!provider) {
    const known = Array.from(webSearchRegistry.keys()).join(", ");
    throw new Error(`Unknown WEB_SEARCH_PROVIDER='${name}'. Known providers: ${known}.`);
  }
  return provider;
}
