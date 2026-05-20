// SPDX-License-Identifier: FSL-1.1-ALv2
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
 * Optional per-call options. Currently used by the Yandex live adapter to
 * select a Yandex `searchType`/`region`/`l10n` triple; Tavily ignores it.
 * Adapters MUST treat all fields as optional and apply sensible defaults
 * (the Yandex adapter defaults to 'ru' when omitted).
 */
export interface WebSearchOptions {
  /** Loose region hint: 'ru' | 'tr' | 'en' | unknown. Adapter-specific. */
  region?: string;
}

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
  /**
   * WR-05 (Phase 65) — the operator env-var label surfaced in the
   * server-side "provider not configured" log. Lives on the interface so
   * the route reads it generically; a new adapter cannot drift a route-side
   * `provider.name ===` string fork.
   */
  readonly envVarLabel: string;
  isConfigured(): boolean;
  search(
    query: string,
    numResults: number,
    options?: WebSearchOptions,
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

// NOTE: `YandexSearchPendingError` was removed when the Yandex adapter
// became live (replacing the wire-shape stub from the initial Plan 03
// commit). The route handler now maps Yandex error responses through the
// shared `MissingProviderKeyError` / `UpstreamError` classes alongside
// Tavily.
