// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 68 — env-driven web-search adapter configuration.
//
// The Tavily / Yandex live adapters previously baked their upstream URLs
// and request timeouts as module-level literals. Operators running behind
// an egress proxy, a regional Yandex mirror, or a slow corporate link had
// no way to retune them without a code change.
//
// `loadWebSearchConfigFromEnv()` lifts those knobs into env vars resolved
// HERE — `config/` is the LOCKER-01 allowlist for `process.env.*` reads.
// The route-assembly seam (apps/api/src/index.ts) calls this once at boot
// and threads the result into the adapter constructors; the adapter source
// files under `lib/` never touch `process.env`.
//
// Defaults are byte-identical to the pre-existing literals so an operator
// who sets none of these vars sees no behavior change.

/** Resolved Tavily adapter knobs. */
export interface TavilyConfig {
  /** POST endpoint for Tavily Search. Default: https://api.tavily.com/search */
  searchUrl: string;
  /** Total request timeout in ms (AbortController). Default: 5000. */
  timeoutMs: number;
}

/** Resolved Yandex adapter knobs. */
export interface YandexConfig {
  /** POST endpoint for Yandex Search API v2. */
  searchUrl: string;
  /** undici headers timeout in ms. Default: 5000. */
  headersTimeoutMs: number;
  /** undici body timeout in ms. Default: 10000. */
  bodyTimeoutMs: number;
}

/** Resolved web-search adapter configuration. */
export interface WebSearchConfig {
  tavily: TavilyConfig;
  yandex: YandexConfig;
}

/** Pre-existing literal defaults — kept identical so unset env = no drift. */
export const DEFAULT_TAVILY_SEARCH_URL = "https://api.tavily.com/search";
export const DEFAULT_TAVILY_TIMEOUT_MS = 5_000;
export const DEFAULT_YANDEX_SEARCH_URL = "https://searchapi.api.cloud.yandex.net/v2/web/search";
export const DEFAULT_YANDEX_HEADERS_TIMEOUT_MS = 5_000;
export const DEFAULT_YANDEX_BODY_TIMEOUT_MS = 10_000;

/**
 * Parse a positive-integer env var. Returns `fallback` when the var is
 * unset, empty, or not a finite positive integer — a malformed knob must
 * never silently zero a timeout (which would abort every request).
 */
function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

/** Read a non-empty trimmed string env var, else `fallback`. */
function readUrl(raw: string | undefined, fallback: string): string {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Resolve the web-search adapter configuration from the environment.
 *
 * Env vars:
 *   - TAVILY_SEARCH_URL          (default https://api.tavily.com/search)
 *   - TAVILY_TIMEOUT_MS          (default 5000)
 *   - YANDEX_SEARCH_URL          (default Yandex Cloud searchapi endpoint)
 *   - YANDEX_HEADERS_TIMEOUT_MS  (default 5000)
 *   - YANDEX_BODY_TIMEOUT_MS     (default 10000)
 *
 * @param env Environment snapshot. Defaults to `process.env`; injected in
 *   unit tests to avoid mutating the global.
 */
export function loadWebSearchConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WebSearchConfig {
  return {
    tavily: {
      searchUrl: readUrl(env.TAVILY_SEARCH_URL, DEFAULT_TAVILY_SEARCH_URL),
      timeoutMs: readPositiveInt(env.TAVILY_TIMEOUT_MS, DEFAULT_TAVILY_TIMEOUT_MS),
    },
    yandex: {
      searchUrl: readUrl(env.YANDEX_SEARCH_URL, DEFAULT_YANDEX_SEARCH_URL),
      headersTimeoutMs: readPositiveInt(
        env.YANDEX_HEADERS_TIMEOUT_MS,
        DEFAULT_YANDEX_HEADERS_TIMEOUT_MS,
      ),
      bodyTimeoutMs: readPositiveInt(env.YANDEX_BODY_TIMEOUT_MS, DEFAULT_YANDEX_BODY_TIMEOUT_MS),
    },
  };
}
