// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 5 / Plan 01 — Wire schema for POST /api/agent/web-search.
 *
 * Provider-agnostic request/response shapes. Tavily + Yandex Search adapter
 * implementation lives in apps/api; the wire surface is locked here.
 */
import { z } from "zod";

export const WebSearchRequestSchema = z.object({
  query: z.string().min(1).max(256),
  numResults: z.number().int().min(1).max(10).optional().default(5),
});
export type WebSearchRequest = z.infer<typeof WebSearchRequestSchema>;

export const WebSearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;

export const WebSearchResponseSchema = z.object({
  results: z.array(WebSearchResultSchema),
});
export type WebSearchResponse = z.infer<typeof WebSearchResponseSchema>;
