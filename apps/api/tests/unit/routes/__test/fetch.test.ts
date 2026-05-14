// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 / Plan 06-12b — unit tests for the debug-only /__test/fetch route.
//
// Coverage targets:
//   * NODE_ENV='test' + allow-all stub → 200 with upstream status.
//   * NODE_ENV='production' → route NOT registered (404 from setNotFoundHandler).
//   * NODE_ENV='test' + dispatcher throws SSRFBlockedError → 502 via the
//     centralized error handler.
//   * Body validation → 400 on missing/empty url.
//
// The e2e suite (tests/e2e/ssrf-block.test.ts) drives the route against
// the real undici dispatcher; this file pins the routing + envelope
// contract in isolation so a regression cannot reach the compose stack.

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { SSRFBlockedError } from "../../../../src/lib/ssrf-dispatcher.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildDebugFetchRoutes } from "../../../../src/routes/__test/fetch.js";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

async function makeApp(opts: {
  nodeEnv: string;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<FastifyInstance> {
  process.env.NODE_ENV = opts.nodeEnv;
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  await app.register(buildDebugFetchRoutes(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}));
  await app.ready();
  return app;
}

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("POST /__test/fetch (Phase 6 / Plan 06-12b debug fetch)", () => {
  describe("NODE_ENV gate", () => {
    it("returns 404 when NODE_ENV is 'production' (route never registered)", async () => {
      const app = await makeApp({ nodeEnv: "production" });
      try {
        const res = await app.inject({
          method: "POST",
          url: "/__test/fetch",
          payload: { url: "https://example.com" },
        });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: "not found" });
      } finally {
        await app.close();
      }
    });

    it("returns 404 when NODE_ENV is undefined (route never registered)", async () => {
      // Genuinely unset NODE_ENV so the `??` fallback in the registration
      // gate fires (covers the undefined-vs-string branch).  We bypass
      // makeApp's set+restore so process.env stays unset for the call.
      const previous = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      try {
        const app = Fastify({ logger: false });
        registerErrorHandler(app);
        await app.register(zodTypeProvider);
        await app.register(buildDebugFetchRoutes());
        await app.ready();
        try {
          const res = await app.inject({
            method: "POST",
            url: "/__test/fetch",
            payload: { url: "https://example.com" },
          });
          expect(res.statusCode).toBe(404);
        } finally {
          await app.close();
        }
      } finally {
        if (previous !== undefined) process.env.NODE_ENV = previous;
      }
    });

    it("returns 404 when NODE_ENV is 'staging'", async () => {
      const app = await makeApp({ nodeEnv: "staging" });
      try {
        const res = await app.inject({
          method: "POST",
          url: "/__test/fetch",
          payload: { url: "https://example.com" },
        });
        expect(res.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  });

  describe("NODE_ENV='test' (route registered)", () => {
    let allowAllFetch: typeof globalThis.fetch;
    let lastUrlSeen: string | undefined;
    beforeEach(() => {
      lastUrlSeen = undefined;
      allowAllFetch = (async (input: string | URL | Request): Promise<Response> => {
        lastUrlSeen = typeof input === "string" ? input : input.toString();
        return new Response("ok", { status: 200 });
      }) as typeof globalThis.fetch;
    });

    it("returns 200 with upstream status when the dispatcher allows", async () => {
      const app = await makeApp({ nodeEnv: "test", fetchImpl: allowAllFetch });
      try {
        const res = await app.inject({
          method: "POST",
          url: "/__test/fetch",
          payload: { url: "https://example.com/ping" },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 200 });
        expect(lastUrlSeen).toBe("https://example.com/ping");
      } finally {
        await app.close();
      }
    });

    it("returns 502 with canonical envelope when SSRFBlockedError is thrown", async () => {
      const ssrfFetch = (async (): Promise<Response> => {
        throw new SSRFBlockedError("link_local_v4", "169.254.169.254", "169.254.169.254");
      }) as typeof globalThis.fetch;
      const app = await makeApp({ nodeEnv: "test", fetchImpl: ssrfFetch });
      try {
        const res = await app.inject({
          method: "POST",
          url: "/__test/fetch",
          payload: { url: "http://169.254.169.254/latest/meta-data/" },
        });
        expect(res.statusCode).toBe(502);
        expect(res.json()).toEqual({ error: "Upstream blocked by SSRF policy" });
      } finally {
        await app.close();
      }
    });

    it("returns 400 when body.url is missing (schema validation fires)", async () => {
      const app = await makeApp({ nodeEnv: "test", fetchImpl: allowAllFetch });
      try {
        const res = await app.inject({
          method: "POST",
          url: "/__test/fetch",
          payload: {},
        });
        expect(res.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });

    it("returns 400 when body.url is an empty string", async () => {
      const app = await makeApp({ nodeEnv: "test", fetchImpl: allowAllFetch });
      try {
        const res = await app.inject({
          method: "POST",
          url: "/__test/fetch",
          payload: { url: "" },
        });
        expect(res.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });

    it("still returns 200 even when reading the upstream body throws (catch swallows)", async () => {
      // Stub returns a Response whose arrayBuffer() rejects — exercises the
      // `.catch(() => undefined)` arm on the body-drain. The route MUST NOT
      // surface that error to the caller; the upstream status code is the
      // only thing we expose.
      const throwingFetch = (async (): Promise<Response> => {
        const fakeRes = {
          status: 201,
          arrayBuffer: (): Promise<ArrayBuffer> => Promise.reject(new Error("body read failed")),
        };
        return fakeRes as unknown as Response;
      }) as typeof globalThis.fetch;
      const app = await makeApp({ nodeEnv: "test", fetchImpl: throwingFetch });
      try {
        const res = await app.inject({
          method: "POST",
          url: "/__test/fetch",
          payload: { url: "https://example.com" },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 201 });
      } finally {
        await app.close();
      }
    });

    it("echoes only the upstream status code (does NOT echo upstream body)", async () => {
      const bodyEchoFetch = (async (): Promise<Response> => {
        return new Response("SECRET_TOKEN=abcdef", { status: 418 });
      }) as typeof globalThis.fetch;
      const app = await makeApp({ nodeEnv: "test", fetchImpl: bodyEchoFetch });
      try {
        const res = await app.inject({
          method: "POST",
          url: "/__test/fetch",
          payload: { url: "https://example.com" },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 418 });
        expect(res.body).not.toContain("SECRET_TOKEN");
      } finally {
        await app.close();
      }
    });

    it("uses globalThis.fetch when no fetchImpl override is supplied", async () => {
      // The route closes over `fetchImpl` at registration time: substitute
      // globalThis.fetch BEFORE building the app, then make a request and
      // verify our stub was hit. Restore once the assertion completes.
      const originalGlobalFetch = globalThis.fetch;
      let usedGlobalFetch = false;
      const stubGlobalFetch = (async (): Promise<Response> => {
        usedGlobalFetch = true;
        // Use 202 — bodied 2xx statuses are accepted by node:undici's
        // Response constructor (204/205 are reserved for empty bodies).
        return new Response("ok", { status: 202 });
      }) as typeof globalThis.fetch;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).fetch = stubGlobalFetch;
      let app: FastifyInstance | undefined;
      try {
        app = await makeApp({ nodeEnv: "test" });
        const res = await app.inject({
          method: "POST",
          url: "/__test/fetch",
          payload: { url: "https://example.com" },
        });
        expect(usedGlobalFetch).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 202 });
      } finally {
        if (app) await app.close();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).fetch = originalGlobalFetch;
      }
    });
  });
});
