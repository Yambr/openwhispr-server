// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 03 / Task 3 — POST /api/agent/web-search unit tests.
//
// Strategy mirrors streaming-usage.test.ts: hand-rolled fake
// TransactionalDb records executed SQL fragments; a synthetic onRequest
// hook attaches req.user + req.tenant. Provider is injected directly via
// the route's `deps.provider` override so we exercise the route's
// dispatch + envelope mapping without touching env vars (the registry's
// env-var coupling is covered separately in registry.test.ts).
//
// Coverage matrix:
//   * happy path → 200 {results:[...]} + ledger INSERT with kind = "web-search.<name>"
//   * missing key (isConfigured()=false) → 503 actionable envelope
//   * upstream UpstreamError → 502 generic envelope
//   * upstream MissingProviderKeyError (raised by provider mid-call) → 503
//   * upstream UpstreamError from Yandex live adapter → 502 generic envelope
//   * empty query → 400 envelope BEFORE provider.search is called
//   * numResults > 10 → 400 envelope (wire schema caps at 10)
//   * 401 envelope when req.user missing
//   * units=1 and ON CONFLICT (request_id) DO NOTHING in INSERT
//   * ledger insert failure does NOT 5xx the response (success preserved)

import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import {
  MissingProviderKeyError,
  UpstreamError,
  type WebSearchProvider,
} from "../../../../src/lib/web-search/types.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildWebSearchRoutes } from "../../../../src/routes/agent/web-search.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "11111111-1111-1111-1111-111111111111";

interface RecordedQuery {
  sql: string;
  params: readonly unknown[];
}

function makeFakeDb(opts?: { failOnInsert?: boolean }): {
  db: Parameters<typeof buildWebSearchRoutes>[0]["db"];
  recorded: RecordedQuery[];
} {
  const recorded: RecordedQuery[] = [];
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const parts: string[] = [];
      const params: unknown[] = [];
      for (const c of chunks) {
        if (typeof c === "string") {
          parts.push(c);
        } else if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
            parts.push((v as string[]).join(""));
          } else {
            parts.push("?");
            params.push(v);
          }
        } else {
          parts.push(String(c));
        }
      }
      const sqlText = parts.join("");
      recorded.push({ sql: sqlText, params });
      if (opts?.failOnInsert && /INSERT INTO usage_ledger/i.test(sqlText)) {
        throw new Error("simulated ledger failure");
      }
      return { rows: [] };
    },
  };
  const db = {
    async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
  return { db, recorded };
}

function makeFakeProvider(
  name: string,
  behavior: {
    configured?: boolean;
    onSearch?: (
      q: string,
      n: number,
    ) => Promise<{ results: Array<{ title: string; url: string; snippet: string }> }>;
  },
): WebSearchProvider {
  return {
    name,
    isConfigured: () => behavior.configured !== false,
    search:
      behavior.onSearch ??
      (async () => ({
        results: [{ title: "Default", url: "https://example.com/", snippet: "default snippet" }],
      })),
  };
}

async function buildApp(
  deps: Parameters<typeof buildWebSearchRoutes>[0],
  opts?: { authed?: boolean },
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  if (opts?.authed !== false) {
    app.addHook("onRequest", async (req) => {
      req.user = { id: TEST_USER, email: "fixture@conformance.test" };
      req.tenant = TEST_TENANT;
    });
  }
  await app.register(buildWebSearchRoutes(deps));
  await app.ready();
  return app;
}

describe("POST /api/agent/web-search", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 200 + normalized results AND inserts ledger row with kind='web-search.tavily'", async () => {
    const { db, recorded } = makeFakeDb();
    const provider = makeFakeProvider("tavily", {
      onSearch: async (q, n) => {
        expect(q).toBe("openwhispr");
        expect(n).toBe(3);
        return {
          results: [
            { title: "T1", url: "https://u1", snippet: "s1" },
            { title: "T2", url: "https://u2", snippet: "s2" },
          ],
        };
      },
    });
    app = await buildApp({ db, provider });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/web-search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "openwhispr", numResults: 3 }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: unknown[] };
    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toEqual({
      title: "T1",
      url: "https://u1",
      snippet: "s1",
    });

    const insert = recorded.find((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    expect(insert).toBeDefined();
    expect(insert?.sql).toMatch(/ON CONFLICT \(request_id\) DO NOTHING/);
    const whole = insert?.sql + JSON.stringify(insert?.params);
    expect(whole).toContain("web-search.tavily");
    expect(whole).toContain(TEST_TENANT);
    expect(whole).toContain(TEST_USER);
    expect(insert?.sql).toMatch(/1\s*\)\s*ON CONFLICT/);
  });

  it("returns 503 envelope mentioning TAVILY_API_KEY when Tavily isConfigured()=false", async () => {
    const { db } = makeFakeDb();
    const provider = makeFakeProvider("tavily", { configured: false });
    app = await buildApp({ db, provider });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/web-search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "anything" }),
    });
    expect(res.statusCode).toBe(503);
    expect(res.statusCode).not.toBe(401); // Pitfall #8 — NEVER 401.
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toMatch(/TAVILY_API_KEY/);
    expect(env.error).toMatch(/Tavily/);
  });

  it("returns 503 envelope mentioning Yandex env vars when Yandex isConfigured()=false", async () => {
    const { db } = makeFakeDb();
    const provider = makeFakeProvider("yandex", { configured: false });
    app = await buildApp({ db, provider });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/web-search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "anything" }),
    });
    expect(res.statusCode).toBe(503);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toMatch(/Yandex/);
    expect(env.error).toMatch(/YANDEX_SEARCH_API_KEY/);
  });

  it("returns 502 'web-search upstream failed' on UpstreamError", async () => {
    const { db } = makeFakeDb();
    const provider = makeFakeProvider("tavily", {
      onSearch: async () => {
        throw new UpstreamError("Tavily 500");
      },
    });
    app = await buildApp({ db, provider });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/web-search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "x" }),
    });
    expect(res.statusCode).toBe(502);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toBe("web-search upstream failed");
  });

  it("returns 503 with provider's MissingProviderKeyError message verbatim if raised mid-call", async () => {
    const { db } = makeFakeDb();
    const provider = makeFakeProvider("tavily", {
      onSearch: async () => {
        throw new MissingProviderKeyError("Tavily not configured (set TAVILY_API_KEY in .env)");
      },
    });
    app = await buildApp({ db, provider });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/web-search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "x" }),
    });
    expect(res.statusCode).toBe(503);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toBe("Tavily not configured (set TAVILY_API_KEY in .env)");
  });

  it("Yandex live adapter — UpstreamError surfaces as the generic 502 envelope (no stub-pending branch)", async () => {
    const { db } = makeFakeDb();
    const provider = makeFakeProvider("yandex", {
      configured: true,
      onSearch: async () => {
        throw new UpstreamError("Yandex upstream returned 429");
      },
    });
    app = await buildApp({ db, provider });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/web-search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "x" }),
    });
    expect(res.statusCode).toBe(502);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toBe("web-search upstream failed");
  });

  it("returns 400 envelope on empty query (zod min(1))", async () => {
    const { db } = makeFakeDb();
    const searchSpy = vi.fn(async () => ({ results: [] }));
    const provider = makeFakeProvider("tavily", { onSearch: searchSpy });
    app = await buildApp({ db, provider });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/web-search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "" }),
    });
    expect(res.statusCode).toBe(400);
    ErrorEnvelope.parse(res.json());
    expect(searchSpy).not.toHaveBeenCalled(); // gate BEFORE upstream call
  });

  it("returns 400 envelope on numResults > 10 (zod max(10) on wire schema)", async () => {
    const { db } = makeFakeDb();
    const provider = makeFakeProvider("tavily", {});
    app = await buildApp({ db, provider });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/web-search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "x", numResults: 50 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 envelope without auth (req.user absent)", async () => {
    const { db } = makeFakeDb();
    const provider = makeFakeProvider("tavily", {});
    app = await buildApp({ db, provider }, { authed: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/web-search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "x" }),
    });
    expect(res.statusCode).toBe(401);
    ErrorEnvelope.parse(res.json());
  });

  it("ledger insert failure does NOT 5xx — user still receives results", async () => {
    const { db } = makeFakeDb({ failOnInsert: true });
    const provider = makeFakeProvider("tavily", {});
    app = await buildApp({ db, provider });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/web-search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "x" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: unknown[] };
    expect(body.results).toHaveLength(1);
  });

  it("kind label carries the provider's name (regression: web-search.yandex distinct from web-search.tavily)", async () => {
    const { db, recorded } = makeFakeDb();
    const provider = makeFakeProvider("yandex", {
      onSearch: async () => ({
        results: [{ title: "Y", url: "https://yandex", snippet: "y" }],
      }),
    });
    app = await buildApp({ db, provider });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/web-search",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "ru" }),
    });
    expect(res.statusCode).toBe(200);
    const insert = recorded.find((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    const whole = insert?.sql + JSON.stringify(insert?.params);
    expect(whole).toContain("web-search.yandex");
    expect(whole).not.toContain("web-search.tavily");
  });
});
