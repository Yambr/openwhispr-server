// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 65 / Plan 65-01 — WR-06 regression test.
//
// WR-06 (security) — the diarization route's Speaches multipart boundary must
// be cryptographically sourced (`crypto.randomBytes`), NOT `Math.random()`.
// The route forwards untrusted user audio; a predictable boundary lets an
// attacker craft an upload that smuggles a forged `name="model"` form field.
//
// Strategy: inject a stub Speaches `fetch` (the documented test seam) that
// captures the outgoing `content-type` header, extract the `boundary=` token,
// and assert it is high-entropy.

import fastifyMultipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import type { RedisLike } from "../../../../src/lib/idempotency-cache.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildDiarizationRoutes } from "../../../../src/routes/diarization.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "11111111-1111-1111-1111-111111111111";

function makeFakeRedis(): RedisLike {
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

function multipartBody(payload: string, boundary = "----diar-test-boundary") {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([head, Buffer.from(payload, "utf8"), tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function extractBoundary(contentType: string | null | undefined): string {
  const m = /boundary=(.+)$/.exec(contentType ?? "");
  if (!m) throw new Error(`no boundary in content-type: ${contentType}`);
  return m[1];
}

function buildSpeachesApp(speachesFetch: typeof fetch): FastifyInstance {
  const a = Fastify({ logger: false });
  registerErrorHandler(a);
  a.register(fastifyMultipart, {
    attachFieldsToBody: false as const,
    limits: { fileSize: 100 * 1024 * 1024 },
  });
  a.register(zodTypeProvider);
  a.addHook("onRequest", async (req) => {
    req.user = { id: TEST_USER, email: "fixture@conformance.test" };
    req.tenant = TEST_TENANT;
  });
  a.register(
    buildDiarizationRoutes({
      redis: makeFakeRedis(),
      speachesDiarizationUrl: "http://speaches.internal.test:8000",
      speachesFetch,
    }),
  );
  return a;
}

describe("diarization — WR-06 cryptographic multipart boundary", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("WR-06: the Speaches multipart boundary is cryptographically sourced (32 hex chars), not Math.random base36", async () => {
    const boundaries: string[] = [];
    const speachesFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const ct =
        (init?.headers as Record<string, string> | undefined)?.["content-type"] ??
        (init?.headers as Record<string, string> | undefined)?.["Content-Type"] ??
        null;
      boundaries.push(extractBoundary(ct));
      return new Response(
        JSON.stringify({ segments: [{ start: 0, end: 1, speaker: "SPEAKER_00" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    app = buildSpeachesApp(speachesFetch as unknown as typeof fetch);
    const { body, contentType } = multipartBody("audio-bytes");
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res1.statusCode).toBe(200);

    const boundary = boundaries[0];
    // The boundary contains a cryptographic 32-hex-char segment
    // (randomBytes(16).toString("hex")). The pre-fix Math.random()
    // base36 segment was only 8 chars from [a-z0-9].
    expect(boundary).toMatch(/[0-9a-f]{32}/);
    // It is NOT the legacy base36 shape: `----owsp-speaches-<b36>-<b36(8)>`.
    expect(boundary).not.toMatch(/^----owsp-speaches-[a-z0-9]+-[a-z0-9]{8}$/);
  });

  it("WR-06: two successive boundaries differ in their cryptographic segment", async () => {
    const boundaries: string[] = [];
    const speachesFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const ct =
        (init?.headers as Record<string, string> | undefined)?.["content-type"] ??
        (init?.headers as Record<string, string> | undefined)?.["Content-Type"] ??
        null;
      boundaries.push(extractBoundary(ct));
      return new Response(
        JSON.stringify({ segments: [{ start: 0, end: 1, speaker: "SPEAKER_00" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    app = buildSpeachesApp(speachesFetch as unknown as typeof fetch);
    for (let i = 0; i < 2; i++) {
      const { body, contentType } = multipartBody(`audio-${i}`);
      const res = await app.inject({
        method: "POST",
        url: "/v1/audio/diarization",
        headers: { "content-type": contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
    }
    expect(boundaries[0]).not.toBe(boundaries[1]);
  });
});
