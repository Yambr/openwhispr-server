// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 5 / Plan 01 — Wire schema for POST /api/agent/web-search.
 *
 * Provider-agnostic request/response shapes. Tavily + Yandex Search adapter
 * implementation lives in apps/api; the wire surface is locked here.
 *
 * Phase 39 — HIGH sweep: `.strict()` on request, URL refinement on result.
 */
import { z } from "zod";

export const WebSearchRequestSchema = z
  .object({
    query: z.string().min(1).max(256),
    numResults: z.number().int().min(1).max(10).optional().default(5),
  })
  .strict();
export type WebSearchRequest = z.infer<typeof WebSearchRequestSchema>;

export const WebSearchResultSchema = z.object({
  title: z.string().min(1).max(1024),
  url: z.string().url().max(2048),
  snippet: z.string().max(8192),
});
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;

export const WebSearchResponseSchema = z.object({
  results: z.array(WebSearchResultSchema).max(50),
});
export type WebSearchResponse = z.infer<typeof WebSearchResponseSchema>;
