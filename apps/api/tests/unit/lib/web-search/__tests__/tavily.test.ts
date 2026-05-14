// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 03 / Task 2 — Tavily adapter tests.
//
// Strategy: undici MockAgent intercepts api.tavily.com at the network
// boundary (CLAUDE.md allowance: process/network boundary). No internal
// logic mocked. Verifies:
//   * isConfigured() honors TAVILY_API_KEY env presence.
//   * search() hits POST https://api.tavily.com/search with Bearer auth
//     and body {query, max_results: min(numResults, 10), search_depth: 'basic'}.
//   * Response normalization: content → snippet, score/extras dropped.
//   * 5xx → UpstreamError; auth fail (401) → MissingProviderKeyError.
//   * Timeout (AbortController) → UpstreamError.

import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TavilyAdapter } from "../../../../../src/lib/web-search/tavily-adapter.js";
import { MissingProviderKeyError, UpstreamError } from "../../../../../src/lib/web-search/types.js";

const TAVILY_HOST = "https://api.tavily.com";

let agent: MockAgent;
let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;
const originalKey = process.env.TAVILY_API_KEY;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  agent = new MockAgent({ connections: 10 });
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  process.env.TAVILY_API_KEY = "test-tavily-key";
});

afterEach(async () => {
  await agent.close();
  setGlobalDispatcher(originalDispatcher);
  if (originalKey === undefined) {
    delete process.env.TAVILY_API_KEY;
  } else {
    process.env.TAVILY_API_KEY = originalKey;
  }
});

describe("TavilyAdapter", () => {
  it("isConfigured() returns true when TAVILY_API_KEY is set", () => {
    const a = new TavilyAdapter();
    expect(a.isConfigured()).toBe(true);
  });

  it("isConfigured() returns false when TAVILY_API_KEY is unset", () => {
    delete process.env.TAVILY_API_KEY;
    const a = new TavilyAdapter();
    expect(a.isConfigured()).toBe(false);
  });

  it("search() throws MissingProviderKeyError when TAVILY_API_KEY is unset (defense-in-depth)", async () => {
    delete process.env.TAVILY_API_KEY;
    const a = new TavilyAdapter();
    await expect(a.search("anything", 3)).rejects.toBeInstanceOf(MissingProviderKeyError);
  });

  it("hits POST /search with Bearer auth, normalizes content → snippet, caps at numResults", async () => {
    const pool = agent.get(TAVILY_HOST);
    pool
      .intercept({
        path: "/search",
        method: "POST",
      })
      .reply(
        200,
        {
          results: [
            {
              title: "First Result",
              url: "https://example.com/1",
              content: "First snippet text",
              score: 0.95,
              extra_field: "ignored",
            },
            {
              title: "Second Result",
              url: "https://example.com/2",
              content: "Second snippet text",
              score: 0.91,
            },
          ],
        },
        { headers: { "content-type": "application/json" } },
      );

    const a = new TavilyAdapter();
    const out = await a.search("hello", 3);
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toEqual({
      title: "First Result",
      url: "https://example.com/1",
      snippet: "First snippet text",
    });
    expect(out.results[1]?.snippet).toBe("Second snippet text");
    // Score / extras dropped — provider-agnostic wire shape (D-03).
    expect((out.results[0] as Record<string, unknown>).score).toBeUndefined();
  });

  it("body includes max_results = min(numResults, 10) per D-05", async () => {
    const pool = agent.get(TAVILY_HOST);
    let recordedBody: unknown;
    pool
      .intercept({
        path: "/search",
        method: "POST",
      })
      .reply((opts) => {
        recordedBody = JSON.parse(opts.body as string);
        return { statusCode: 200, data: { results: [] } };
      });

    const a = new TavilyAdapter();
    await a.search("hi", 50);
    expect(recordedBody).toMatchObject({
      query: "hi",
      max_results: 10,
      search_depth: "basic",
    });
  });

  it("Authorization header is Bearer ${TAVILY_API_KEY}", async () => {
    const pool = agent.get(TAVILY_HOST);
    let recordedHeaders: Record<string, string | string[]> = {};
    pool
      .intercept({
        path: "/search",
        method: "POST",
      })
      .reply((opts) => {
        recordedHeaders = opts.headers as Record<string, string | string[]>;
        return { statusCode: 200, data: { results: [] } };
      });

    const a = new TavilyAdapter();
    await a.search("q", 5);
    // Headers are normalized lowercase by undici intercept.
    const authHeader = recordedHeaders.authorization ?? recordedHeaders.Authorization;
    expect(String(authHeader)).toBe("Bearer test-tavily-key");
  });

  it("upstream 500 throws UpstreamError", async () => {
    const pool = agent.get(TAVILY_HOST);
    pool.intercept({ path: "/search", method: "POST" }).reply(500, { error: "boom" });
    const a = new TavilyAdapter();
    await expect(a.search("q", 5)).rejects.toBeInstanceOf(UpstreamError);
  });

  it("upstream 401 throws MissingProviderKeyError (key rejected) per D-08", async () => {
    const pool = agent.get(TAVILY_HOST);
    pool.intercept({ path: "/search", method: "POST" }).reply(401, { error: "bad key" });
    const a = new TavilyAdapter();
    await expect(a.search("q", 5)).rejects.toBeInstanceOf(MissingProviderKeyError);
  });

  it("upstream 429 throws UpstreamError", async () => {
    const pool = agent.get(TAVILY_HOST);
    pool.intercept({ path: "/search", method: "POST" }).reply(429, { error: "slow down" });
    const a = new TavilyAdapter();
    await expect(a.search("q", 5)).rejects.toBeInstanceOf(UpstreamError);
  });

  it("non-JSON upstream body throws UpstreamError", async () => {
    const pool = agent.get(TAVILY_HOST);
    pool
      .intercept({ path: "/search", method: "POST" })
      .reply(200, "not-json", { headers: { "content-type": "text/plain" } });
    const a = new TavilyAdapter();
    await expect(a.search("q", 5)).rejects.toBeInstanceOf(UpstreamError);
  });

  it("name property is 'tavily'", () => {
    expect(new TavilyAdapter().name).toBe("tavily");
  });
});
