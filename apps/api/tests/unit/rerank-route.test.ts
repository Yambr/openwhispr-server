// SPDX-License-Identifier: FSL-1.1-ALv2
// quick-260604-u65 / C3 — POST /api/rerank plugin tests.
//
// Mirrors embeddings-route.test.ts: hand-rolled fake LitellmClient
// (network-boundary mock) + stubbed dualAuthHook. No DB.
//
// Coverage matrix:
//   * forward: configured deps.rerankModel + 200 Cohere-shape upstream
//     -> 200 forwarded verbatim; passthrough called with path "/v1/rerank",
//     body {query, documents, model}, userId/endUser/requestId set.
//   * caller model + top_n pass-through verbatim.
//   * no model configured -> 503; passthrough never called.
//   * upstream LitellmUpstreamError(404) -> 502.
//   * bad body: empty query / empty documents / no documents / no query -> 400.
//   * auth required: req.user absent -> 401.
//
// Generic alias placeholders only — NEVER a concrete corporate model name.

import { Readable } from "node:stream";
import {
  type LitellmClient,
  LitellmUpstreamError,
  MissingProviderKeyError,
  type PassthroughRequest,
} from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../src/error-handler.js";
import { zodTypeProvider } from "../../src/plugins/zod-type-provider.js";
import { buildRerankRoutes, type RerankDeps } from "../../src/routes/rerank.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "11111111-1111-1111-1111-111111111111";
const TEST_EMAIL = "fixture@conformance.test";

interface RecordedPassthrough {
  path: string;
  args: PassthroughRequest;
}

interface FakeLitellmOpts {
  calls: RecordedPassthrough[];
  throws?: Error;
  upstreamJson?: unknown;
  upstreamStatus?: number;
  upstreamContentType?: string;
}

function makeFakeLitellm(opts: FakeLitellmOpts): LitellmClient {
  return {
    baseUrl: "http://litellm.test:4000",
    chatCompletions: () => {
      throw new Error("chatCompletions not used in this test");
    },
    chatCompletionsStream: () => {
      throw new Error("chatCompletionsStream not used in this test");
    },
    audioTranscriptions: () => {
      throw new Error("audioTranscriptions not used in this test");
    },
    async passthrough(path, args) {
      opts.calls.push({ path, args });
      if (opts.throws) throw opts.throws;
      const json =
        opts.upstreamJson ??
        ({
          results: [{ index: 0, relevance_score: 0.9 }],
          model: "op-rerank-alias",
        } as unknown);
      const body = Readable.from([Buffer.from(JSON.stringify(json))]);
      return {
        statusCode: opts.upstreamStatus ?? 200,
        headers: { "content-type": opts.upstreamContentType ?? "application/json" },
        body,
      } as unknown as Awaited<ReturnType<LitellmClient["passthrough"]>>;
    },
  };
}

function buildApp(deps: RerankDeps, opts?: { authed?: boolean }): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.register(zodTypeProvider);
  if (opts?.authed !== false) {
    app.addHook("onRequest", async (req) => {
      req.user = { id: TEST_USER, email: TEST_EMAIL };
      req.tenant = TEST_TENANT;
    });
  }
  app.register(buildRerankRoutes(deps));
  return app;
}

describe("POST /api/rerank", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("forwards the upstream Cohere-shape body verbatim and calls passthrough with the resolved model", async () => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ litellm, rerankModel: "op-rerank-alias" });
    const res = await app.inject({
      method: "POST",
      url: "/api/rerank",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "what is x", documents: ["a", "b", "c"] }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const body = res.json() as { results: unknown[]; model: string };
    expect(body.model).toBe("op-rerank-alias");
    expect(body.results).toHaveLength(1);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/v1/rerank");
    expect(calls[0]?.args.method).toBe("POST");
    expect(calls[0]?.args.contentType).toBe("application/json");
    expect(calls[0]?.args.userId).toBe(TEST_USER);
    expect(calls[0]?.args.endUser).toBe(TEST_EMAIL);
    expect(typeof calls[0]?.args.requestId).toBe("string");
    const sent = JSON.parse(calls[0]?.args.body as string) as {
      query: string;
      documents: string[];
      model: string;
    };
    expect(sent.query).toBe("what is x");
    expect(sent.documents).toEqual(["a", "b", "c"]);
    expect(sent.model).toBe("op-rerank-alias");
  });

  it("lets the caller model win and forwards top_n verbatim", async () => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ litellm, rerankModel: "op-rerank-alias" });
    const res = await app.inject({
      method: "POST",
      url: "/api/rerank",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        query: "q",
        documents: ["a", "b"],
        model: "caller-alias",
        top_n: 2,
      }),
    });
    expect(res.statusCode).toBe(200);
    const sent = JSON.parse(calls[0]?.args.body as string) as { model: string; top_n: number };
    expect(sent.model).toBe("caller-alias");
    expect(sent.top_n).toBe(2);
  });

  it("returns 503 (no model configured) when deps.rerankModel is unset and body omits a model", async () => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/rerank",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "q", documents: ["a"] }),
    });
    expect(res.statusCode).toBe(503);
    expect(calls).toHaveLength(0);
    expect(res.body).not.toMatch(/op-rerank-alias|rerankModel|sk-/);
  });

  it("maps an upstream LitellmUpstreamError(404) to a clean 502 (no-fallback signal)", async () => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({
      calls,
      throws: new LitellmUpstreamError(404, "model not found: some-internal-detail"),
    });
    app = buildApp({ litellm, rerankModel: "op-rerank-alias" });
    const res = await app.inject({
      method: "POST",
      url: "/api/rerank",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "q", documents: ["a"] }),
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toMatch(/some-internal-detail/);
  });

  it("maps a MissingProviderKeyError to 503 (never 401)", async () => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({
      calls,
      throws: new MissingProviderKeyError("OPENROUTER_API_KEY", "op-rerank-alias"),
    });
    app = buildApp({ litellm, rerankModel: "op-rerank-alias" });
    const res = await app.inject({
      method: "POST",
      url: "/api/rerank",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "q", documents: ["a"] }),
    });
    expect(res.statusCode).toBe(503);
  });

  it.each([
    ["empty query", { query: "", documents: ["a"] }],
    ["empty documents array", { query: "q", documents: [] }],
    ["no documents", { query: "q" }],
    ["no query", { documents: ["a"] }],
  ])("returns 400 on a malformed body (%s)", async (_label, payload) => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ litellm, rerankModel: "op-rerank-alias" });
    const res = await app.inject({
      method: "POST",
      url: "/api/rerank",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("returns 401 (defensive) when the request is unauthenticated", async () => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ litellm, rerankModel: "op-rerank-alias" }, { authed: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/rerank",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ query: "q", documents: ["a"] }),
    });
    expect(res.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
