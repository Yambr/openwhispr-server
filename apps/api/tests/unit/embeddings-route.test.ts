// SPDX-License-Identifier: FSL-1.1-ALv2
// quick-260604-u65 / C2 — POST /api/embeddings plugin tests.
//
// Strategy mirrors routes/reason.test.ts: hand-rolled fake LitellmClient
// (network-boundary mock, constitutionally allowed) + dualAuthHook stubbed
// to populate req.user / req.tenant. No DB — the route writes no ledger row.
//
// Coverage matrix:
//   * forward: configured deps.embeddingModel + 200 OpenAI-shape upstream
//     -> 200 body forwarded verbatim; passthrough called with path
//     "/v1/embeddings", method POST, body {input, model}, userId/endUser/
//     requestId set.
//   * caller model wins: body.model overrides deps.embeddingModel.
//   * no model configured: deps.embeddingModel undefined + body has no model
//     -> 503 (operator-config), passthrough NEVER called, no model leak.
//   * upstream 4xx/5xx forwarded: passthrough throws LitellmUpstreamError(404)
//     -> 502 UpstreamError canonical envelope; upstream detail not leaked.
//   * bad body: empty input string / numeric input / {} -> 400.
//   * auth required: req.user absent -> 401 (defensive AuthError).
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
import { buildEmbeddingsRoutes, type EmbeddingsDeps } from "../../src/routes/embeddings.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "11111111-1111-1111-1111-111111111111";
const TEST_EMAIL = "fixture@conformance.test";

interface RecordedPassthrough {
  path: string;
  args: PassthroughRequest;
}

interface FakeLitellmOpts {
  calls: RecordedPassthrough[];
  /** When set, passthrough throws this error instead of returning. */
  throws?: Error;
  /** Override the upstream JSON body (default: OpenAI embeddings shape). */
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
          object: "list",
          data: [{ object: "embedding", embedding: [0.1, 0.2], index: 0 }],
          model: "op-embed-alias",
          usage: { prompt_tokens: 3, total_tokens: 3 },
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

function buildApp(deps: EmbeddingsDeps, opts?: { authed?: boolean }): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.register(zodTypeProvider);
  if (opts?.authed !== false) {
    app.addHook("onRequest", async (req) => {
      req.user = { id: TEST_USER, email: TEST_EMAIL };
      req.tenant = TEST_TENANT;
    });
  }
  app.register(buildEmbeddingsRoutes(deps));
  return app;
}

describe("POST /api/embeddings", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("forwards the upstream OpenAI-shape body verbatim and calls passthrough with the resolved model", async () => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ litellm, embeddingModel: "op-embed-alias" });
    const res = await app.inject({
      method: "POST",
      url: "/api/embeddings",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ input: "hello world" }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const body = res.json() as { object: string; data: unknown[]; model: string };
    expect(body.object).toBe("list");
    expect(body.model).toBe("op-embed-alias");
    expect(body.data).toHaveLength(1);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/v1/embeddings");
    expect(calls[0]?.args.method).toBe("POST");
    expect(calls[0]?.args.contentType).toBe("application/json");
    expect(calls[0]?.args.userId).toBe(TEST_USER);
    expect(calls[0]?.args.endUser).toBe(TEST_EMAIL);
    expect(typeof calls[0]?.args.requestId).toBe("string");
    const sent = JSON.parse(calls[0]?.args.body as string) as { input: string; model: string };
    expect(sent.input).toBe("hello world");
    expect(sent.model).toBe("op-embed-alias");
  });

  it("lets the caller model win over the injected deps.embeddingModel", async () => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ litellm, embeddingModel: "op-embed-alias" });
    const res = await app.inject({
      method: "POST",
      url: "/api/embeddings",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ input: ["a", "b"], model: "caller-alias" }),
    });
    expect(res.statusCode).toBe(200);
    const sent = JSON.parse(calls[0]?.args.body as string) as { model: string; input: string[] };
    expect(sent.model).toBe("caller-alias");
    expect(sent.input).toEqual(["a", "b"]);
  });

  it("returns 503 (no model configured) when deps.embeddingModel is unset and body omits a model", async () => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/embeddings",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ input: "hello" }),
    });
    expect(res.statusCode).toBe(503);
    // Passthrough must NEVER be called when no model is configured.
    expect(calls).toHaveLength(0);
    // No model/secret detail leaks onto the wire envelope.
    expect(res.body).not.toMatch(/op-embed-alias|embeddingModel|sk-/);
  });

  it("maps an upstream LitellmUpstreamError(404) to a clean 502 (no-fallback signal)", async () => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({
      calls,
      throws: new LitellmUpstreamError(404, "model not found: some-internal-detail"),
    });
    app = buildApp({ litellm, embeddingModel: "op-embed-alias" });
    const res = await app.inject({
      method: "POST",
      url: "/api/embeddings",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ input: "hello" }),
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toMatch(/some-internal-detail/);
  });

  it("maps a MissingProviderKeyError to 503 (never 401)", async () => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({
      calls,
      throws: new MissingProviderKeyError("OPENROUTER_API_KEY", "op-embed-alias"),
    });
    app = buildApp({ litellm, embeddingModel: "op-embed-alias" });
    const res = await app.inject({
      method: "POST",
      url: "/api/embeddings",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ input: "hello" }),
    });
    expect(res.statusCode).toBe(503);
  });

  it.each([
    ["empty input string", { input: "" }],
    ["numeric input", { input: 123 }],
    ["empty object", {}],
    ["empty array", { input: [] }],
  ])("returns 400 on a malformed body (%s)", async (_label, payload) => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ litellm, embeddingModel: "op-embed-alias" });
    const res = await app.inject({
      method: "POST",
      url: "/api/embeddings",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("returns 401 (defensive) when the request is unauthenticated", async () => {
    const calls: RecordedPassthrough[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ litellm, embeddingModel: "op-embed-alias" }, { authed: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/embeddings",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ input: "hello" }),
    });
    expect(res.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
