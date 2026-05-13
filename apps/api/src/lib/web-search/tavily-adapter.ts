// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 03 / Task 2 — Tavily web-search adapter (live).
//
// Source of truth: https://docs.tavily.com/documentation/api-reference/endpoint/search
// + 05-RESEARCH.md § Code Examples / Web-Search Tavily Adapter
// + 05-CONTEXT.md D-03 (Tavily `content` → `snippet`)
// + 05-CONTEXT.md D-05 (numResults capped server-side at 10)
// + 05-CONTEXT.md D-08 (3s connect / 5s total timeout — AbortController)
// + Pitfall #10 (provider URL hardcoded — user input only in JSON body).
//
// Wire shape:
//   POST https://api.tavily.com/search
//   Headers: { content-type: application/json,
//              authorization: Bearer ${TAVILY_API_KEY} }
//   Body:    { query, max_results, search_depth: "basic" }
//   Response: { results: [{ title, url, content, score, ... }] }
//   Normalize: content → snippet, drop score + other fields.
//
// Threat mitigations (per 05-03-PLAN.md <threat_model>):
//   * T-05-01 (SSRF) — URL is hardcoded; user input flows only into the
//     JSON body's `query` field.
//   * T-05-09 (key leakage) — TAVILY_API_KEY appears only in the outbound
//     Authorization header. Error messages never include it.

import { fetch } from "undici";
import {
  MissingProviderKeyError,
  UpstreamError,
  type WebSearchProvider,
} from "./types.js";

const TAVILY_URL = "https://api.tavily.com/search";
const TOTAL_TIMEOUT_MS = 5000;
const MAX_RESULTS_CAP = 10;

interface TavilyResultRow {
  title?: unknown;
  url?: unknown;
  content?: unknown;
}

interface TavilyResponseBody {
  results?: TavilyResultRow[];
}

/**
 * Live Tavily Search adapter. Implements the WebSearchProvider contract
 * against api.tavily.com/search with per-call AbortController gating.
 */
export class TavilyAdapter implements WebSearchProvider {
  readonly name = "tavily";

  isConfigured(): boolean {
    return typeof process.env.TAVILY_API_KEY === "string"
      && process.env.TAVILY_API_KEY.length > 0;
  }

  async search(
    query: string,
    numResults: number,
  ): Promise<{
    results: Array<{ title: string; url: string; snippet: string }>;
  }> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new MissingProviderKeyError(
        "Tavily not configured (set TAVILY_API_KEY in .env)",
      );
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TOTAL_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(TAVILY_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: Math.min(numResults, MAX_RESULTS_CAP),
          search_depth: "basic",
        }),
        signal: ctrl.signal,
      });
    } catch {
      // AbortError, DNS failures, connect refusals → UpstreamError. The
      // route maps this to the generic 502 envelope (D-08).
      clearTimeout(timer);
      throw new UpstreamError("Tavily request failed or timed out");
    }
    clearTimeout(timer);

    if (res.status >= 500 || res.status === 429) {
      throw new UpstreamError(`Tavily upstream returned ${res.status}`);
    }
    if (res.status === 401 || res.status === 403) {
      // The provider rejected the key; treat as misconfigured (D-08).
      throw new MissingProviderKeyError(
        "Tavily not configured (set TAVILY_API_KEY in .env)",
      );
    }
    if (!res.ok) {
      throw new UpstreamError(`Tavily upstream returned ${res.status}`);
    }

    let body: TavilyResponseBody;
    try {
      body = (await res.json()) as TavilyResponseBody;
    } catch {
      throw new UpstreamError("Tavily response was not valid JSON");
    }

    const rawRows = Array.isArray(body.results) ? body.results : [];
    const results = rawRows.map((r) => ({
      title: typeof r.title === "string" ? r.title : "",
      url: typeof r.url === "string" ? r.url : "",
      // D-03 — Tavily's `content` field is the per-result snippet. We
      // drop `score` and any other provider-specific fields to keep the
      // wire response provider-agnostic.
      snippet: typeof r.content === "string" ? r.content : "",
    }));
    return { results };
  }
}
