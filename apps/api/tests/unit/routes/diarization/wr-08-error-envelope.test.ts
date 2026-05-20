// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 65 / Plan 65-01 — WR-08 regression test.
//
// WR-08 — the diarization 502 (job failed/cancelled) and 504 (poll-ceiling)
// responses must emit the canonical `{error:<string>}` envelope (Phase 64
// H-4): NO inline `jobId` field, and the 504 copy must be user-facing — no
// operator-speak ("corporate", "LiteLLM", "Speaches").
//
// The 502 path is driven directly via a fake pyannote returning a `failed`
// job. The 504 poll-ceiling path is hard to drive deterministically in a
// unit test (POLL_CEILING_MS = 300_000, no test override) — the existing
// diarization.test.ts ceiling test (504 with fake timers) covers the status
// code; this file asserts the 504 copy at the source level as a guard.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyMultipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import type { RedisLike } from "../../../../src/lib/idempotency-cache.js";
import type { PyannoteClient } from "../../../../src/lib/pyannote-client.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildDiarizationRoutes } from "../../../../src/routes/diarization.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "11111111-1111-1111-1111-111111111111";

const ROUTE_SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "src",
  "routes",
  "diarization.ts",
);

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

function failedJobPyannote(status: "failed" | "cancelled"): PyannoteClient {
  return {
    async createMediaInput() {
      return { url: "https://pyannote-presigned.test/upload/abc", mediaUri: "media://abc" };
    },
    async uploadToPresignedUrl() {
      /* no-op */
    },
    async submitDiarize() {
      return "job-1";
    },
    async pollJob(jobId) {
      return { jobId, status };
    },
  };
}

function buildApp(pyannote: PyannoteClient): FastifyInstance {
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
  a.register(buildDiarizationRoutes({ redis: makeFakeRedis(), pyannoteFactory: () => pyannote }));
  return a;
}

describe("diarization — WR-08 canonical error envelope", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("WR-08: the 502 job-failed envelope is {error:<string>} with no jobId field", async () => {
    app = buildApp(failedJobPyannote("failed"));
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(502);
    const json = res.json() as Record<string, unknown>;
    expect(typeof json.error).toBe("string");
    expect(json.error).toBe("diarization job failed");
    expect(json).not.toHaveProperty("jobId");
  });

  it("WR-08: the 502 job-cancelled envelope is {error:<string>} with no jobId field", async () => {
    app = buildApp(failedJobPyannote("cancelled"));
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(502);
    const json = res.json() as Record<string, unknown>;
    expect(json.error).toBe("diarization job cancelled");
    expect(json).not.toHaveProperty("jobId");
  });

  it("WR-08: the 504 poll-ceiling copy is user-facing — no operator-speak, no jobId", () => {
    // Source-level guard: the 504 send must not carry operator-speak nor a
    // jobId envelope field. The status-code path itself is covered by the
    // fake-timer ceiling test in diarization.test.ts.
    const src = readFileSync(ROUTE_SRC, "utf8");
    // Isolate the 504 send block.
    const m = /reply\.code\(504\)\.send\(\{[\s\S]*?\}\);/.exec(src);
    expect(m).not.toBeNull();
    const block = m?.[0] ?? "";
    expect(block).not.toMatch(/corporate/i);
    expect(block).not.toMatch(/LiteLLM/i);
    expect(block).not.toMatch(/Speaches/i);
    expect(block).not.toMatch(/\bjobId\b/);
  });
});
