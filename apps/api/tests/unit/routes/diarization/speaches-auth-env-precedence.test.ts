// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260601-d1a — env-precedence wiring for the Speaches diarization
// Authorization header.
//
// The route handler's header-build branch is covered by the route-level
// tests in tests/unit/routes/__tests__/diarization.test.ts (which inject
// speachesDiarizationApiKey directly). THIS file covers the OTHER half: the
// `buildAllRoutes` env-boundary resolution in src/routes/index.ts —
// `firstNonEmptyEnv(SPEACHES_DIARIZATION_API_KEY, LITELLM_VIRTUAL_KEY,
// LITELLM_MASTER_KEY)` — proving the full env → outbound `Authorization`
// path end-to-end (including the key-SET branch that the open-Speaches
// regression guard in build-app-diarization-wiring.test.ts cannot hit).
//
// We register ONLY the diarization plugin produced by `buildAllRoutes` into
// a bare Fastify with an auth-stamping onRequest hook (so we control
// req.user/req.tenant without the dualAuthHook), and stub `globalThis.fetch`
// — the env path does NOT set the `speachesFetch` test seam, so the handler
// uses the global fetch, which is exactly what production does.

import fastifyMultipart from "@fastify/multipart";
import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import type { RedisLike } from "../../../../src/lib/idempotency-cache.js";
import type { AuthLike } from "../../../../src/middleware/dual-auth.js";
import { buildAllRoutes } from "../../../../src/routes/index.js";

const TEST_USER = { id: "11111111-1111-1111-1111-111111111111", email: "fixture@conformance.test" };
const TEST_TENANT = { id: "00000000-0000-0000-0000-000000000000" };

function fakeRedis(): RedisLike {
  const store = new Map<string, string>();
  return {
    async set(key, value, opts) {
      if (opts?.NX === true && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async get(key) {
      return store.get(key) ?? null;
    },
  };
}

function fakeDb(): TransactionalDb<ExecutableTx> {
  return {
    async transaction<T>(cb: (tx: ExecutableTx) => Promise<T>): Promise<T> {
      return cb({
        async execute() {
          return { rows: [] } as unknown as never;
        },
      } as unknown as ExecutableTx);
    },
  } as unknown as TransactionalDb<ExecutableTx>;
}

function fakeAuth(): AuthLike {
  return {
    api: { getSession: async () => null },
    handler: async () => new Response("{}", { status: 200 }),
  } as unknown as AuthLike;
}

/** Find the diarization plugin among the buildAllRoutes output and register
 * it into a bare Fastify that stamps req.user/req.tenant (no dualAuthHook). */
async function bootDiarizationFromEnv() {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(fastifyMultipart, {
    attachFieldsToBody: false as const,
    limits: { fileSize: 100 * 1024 * 1024 },
  });
  app.addHook("onRequest", async (req) => {
    req.user = TEST_USER;
    req.tenant = TEST_TENANT;
  });
  // buildAllRoutes resolves the Speaches key from env and threads it into the
  // diarization deps. We register ONLY that plugin (identified by its named
  // async function `diarizationRoutes`) — registering the full tree would
  // pull in routes needing the zod type provider + other deps we don't wire
  // here, and would obscure what this test isolates.
  const plugins = buildAllRoutes({ db: fakeDb(), auth: fakeAuth(), redis: fakeRedis() });
  const diarizationPlugin = plugins.find((p) => p.name === "diarizationRoutes");
  if (!diarizationPlugin) {
    throw new Error("diarizationRoutes plugin not found in buildAllRoutes output");
  }
  await app.register(diarizationPlugin);
  await app.ready();
  return app;
}

function multipartBody(audio: string): { body: Buffer; contentType: string } {
  const boundary = "----owsp-test-boundary";
  const CRLF = "\r\n";
  const body = Buffer.from(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="audio.wav"${CRLF}` +
      `Content-Type: audio/wav${CRLF}${CRLF}` +
      `${audio}${CRLF}` +
      `--${boundary}--${CRLF}`,
    "utf8",
  );
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("buildAllRoutes — Speaches diarization Authorization env precedence", () => {
  beforeEach(() => {
    vi.stubEnv("SPEACHES_DIARIZATION_URL", "http://speaches.internal.test:8000");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function captureOutboundAuth(): Promise<string | null> {
    let capturedAuth: string | null = null;
    const stubFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const h = init?.headers as Record<string, string> | undefined;
      capturedAuth = h?.authorization ?? h?.Authorization ?? null;
      return new Response(
        JSON.stringify({ segments: [{ start: 0, end: 1, speaker: "SPEAKER_00" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", stubFetch);
    const app = await bootDiarizationFromEnv();
    try {
      const { body, contentType } = multipartBody("audio-bytes");
      const res = await app.inject({
        method: "POST",
        url: "/v1/audio/diarization",
        headers: { "content-type": contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(stubFetch).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
    return capturedAuth;
  }

  it("SPEACHES_DIARIZATION_API_KEY override wins over the litellm keys", async () => {
    vi.stubEnv("SPEACHES_DIARIZATION_API_KEY", "sk-speaches-override");
    vi.stubEnv("LITELLM_VIRTUAL_KEY", "sk-virtual-should-lose");
    vi.stubEnv("LITELLM_MASTER_KEY", "sk-master-should-lose");
    expect(await captureOutboundAuth()).toBe("Bearer sk-speaches-override");
  });

  it("falls back to LITELLM_VIRTUAL_KEY when no override is set", async () => {
    vi.stubEnv("SPEACHES_DIARIZATION_API_KEY", "");
    vi.stubEnv("LITELLM_VIRTUAL_KEY", "sk-virtual-wins");
    vi.stubEnv("LITELLM_MASTER_KEY", "sk-master-should-lose");
    expect(await captureOutboundAuth()).toBe("Bearer sk-virtual-wins");
  });

  it("falls back to LITELLM_MASTER_KEY when neither override nor virtual key is set (the prod posture)", async () => {
    vi.stubEnv("SPEACHES_DIARIZATION_API_KEY", "");
    vi.stubEnv("LITELLM_VIRTUAL_KEY", "");
    vi.stubEnv("LITELLM_MASTER_KEY", "sk-master-wins");
    expect(await captureOutboundAuth()).toBe("Bearer sk-master-wins");
  });

  it("sends NO Authorization header when no key env is set (bundled open Speaches)", async () => {
    vi.stubEnv("SPEACHES_DIARIZATION_API_KEY", "");
    vi.stubEnv("LITELLM_VIRTUAL_KEY", "");
    vi.stubEnv("LITELLM_MASTER_KEY", "");
    expect(await captureOutboundAuth()).toBeNull();
  });
});
