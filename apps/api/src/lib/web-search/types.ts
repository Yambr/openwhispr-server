// Phase 05 / Plan 03 — Web-search provider interface + typed errors.
//
// Source of truth: 05-03-PLAN.md + 05-RESEARCH.md § Pattern 5 (Web-Search
// Registry). The wire response shape is locked in
// `@openwhispr/wire-schemas/web-search.ts` (`WebSearchResponseSchema`);
// every adapter MUST emit `{title, url, snippet}` triples that conform to
// that schema. Per-provider snippet derivation (Tavily's `content` field,
// Yandex's passages join, etc.) is the adapter's responsibility — the
// wire surface stays provider-agnostic (D-01).

/**
 * Common contract every web-search provider adapter implements. The route
 * resolves a single provider at boot via `resolveWebSearchProvider()` and
 * calls `provider.search(query, numResults)` per request.
 *
 * `isConfigured()` is the operator-gating predicate — the route emits the
 * canonical 503 envelope when it returns false, NEVER calling `search()`.
 * Per D-08 / Pitfall #8 a missing key MUST surface as 503 (operator
 * actionable), never 401 (which the desktop interprets as session loss).
 */
export interface WebSearchProvider {
  readonly name: string;
  isConfigured(): boolean;
  search(
    query: string,
    numResults: number,
  ): Promise<{
    results: Array<{ title: string; url: string; snippet: string }>;
  }>;
}

/** 503-mapped: provider env keys not configured. Carries the actionable
 *  "<Provider> not configured (set <ENV_VAR> in .env)" message verbatim
 *  so the centralized setErrorHandler emits the canonical envelope.
 */
export class MissingProviderKeyError extends Error {
  override name = "MissingProviderKeyError" as const;
  code = "MISSING_PROVIDER_KEY" as const;
}

/** 502-mapped: upstream returned 5xx, timed out, or sent a malformed body.
 *  The route translates this into the generic "web-search upstream failed"
 *  envelope — NEVER echoes upstream body (could leak secret-shaped data).
 */
export class UpstreamError extends Error {
  override name = "UpstreamError" as const;
  code = "UPSTREAM_FAILED" as const;
}

/**
 * 503-mapped: the Yandex adapter is a wire-shape placeholder until the
 * reference implementation lands. Separate from `MissingProviderKeyError`
 * so the route handler can emit a distinct, intentionally non-actionable
 * envelope ("yandex provider pending") — the operator should know setting
 * the env vars alone is insufficient, the adapter itself is awaiting the
 * Python reference at `tools/reference/yandex-search-server.py`.
 *
 * Thrown by `YandexAdapter.search()` even when env keys are set, UNLESS
 * the `YANDEX_SEARCH_ENABLED=true` feature flag is also set (which signals
 * the operator has manually wired a reference-compatible implementation).
 */
export class YandexSearchPendingError extends Error {
  override name = "YandexSearchPendingError" as const;
  code = "PROVIDER_UNAVAILABLE" as const;
}
