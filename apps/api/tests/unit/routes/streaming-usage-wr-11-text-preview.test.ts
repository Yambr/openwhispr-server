// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 65 / Plan 65-01 — WR-11 regression test.
//
// WR-11 — streaming-usage.ts logs `text_preview` (≤1000 chars of user STT
// output) to pino on every request. The shared redact policy does not cover
// it and Loki retention is 30+ days. The fix drops `text_preview` from the
// structured log; `text_sha256` + `text_length` (a hash + a count, not raw
// content) stay.
//
// Strategy: feed Fastify a capturing logger stream (mirrors
// streaming-usage-observability.test.ts), POST a request with a sentinel
// `text`, and assert the captured "streaming-usage" log entry.

import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { zodTypeProvider } from "../../../src/plugins/zod-type-provider.js";
import { buildStreamingUsageRoutes } from "../../../src/routes/streaming-usage.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "11111111-1111-1111-1111-111111111111";

function makeNoopDb(): Parameters<typeof buildStreamingUsageRoutes>[0]["db"] {
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const parts: string[] = [];
      for (const c of chunks) {
        if (typeof c === "string") parts.push(c);
      }
      if (/SELECT\s+COALESCE\(SUM\(units\)/i.test(parts.join(""))) {
        return { rows: [{ words_used: 0 }] };
      }
      return { rows: [] };
    },
  };
  return {
    async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
}

function buildApp(logs: unknown[]): FastifyInstance {
  const app = Fastify({
    logger: {
      level: "info",
      stream: {
        write: (chunk: string) => {
          for (const line of chunk.split("\n")) {
            if (!line.trim()) continue;
            try {
              logs.push(JSON.parse(line));
            } catch {
              /* skip non-json */
            }
          }
        },
      },
    },
  });
  registerErrorHandler(app);
  app.register(zodTypeProvider);
  app.addHook("onRequest", async (req) => {
    req.user = { id: TEST_USER, email: "fixture@conformance.test" };
    req.tenant = TEST_TENANT;
  });
  app.register(buildStreamingUsageRoutes({ db: makeNoopDb() }));
  return app;
}

function findUsageLog(logs: unknown[]): Record<string, unknown> | undefined {
  return logs.find(
    (l): l is Record<string, unknown> =>
      typeof l === "object" &&
      l != null &&
      (l as Record<string, unknown>).msg === "streaming-usage",
  );
}

describe("streaming-usage — WR-11 text_preview dropped from logs", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("WR-11: text_preview is absent from the structured log; sha256 + length stay", async () => {
    const logs: unknown[] = [];
    app = buildApp(logs);
    const text = "WR11_SENTINEL_user_stt_content";
    const res = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        sessionId: "wr11-1",
        audioDurationSeconds: 30,
        text,
        sendLogs: true,
      }),
    });
    expect(res.statusCode).toBe(200);
    const entry = findUsageLog(logs);
    expect(entry).toBeDefined();
    // The raw STT content preview is dropped.
    expect(entry).not.toHaveProperty("text_preview");
    // The hash + length (non-content) stay.
    expect(entry?.text_sha256).toBe(createHash("sha256").update(text).digest("hex"));
    expect(entry?.text_length).toBe(text.length);
  });

  it("WR-11: the sentinel STT content never appears in any log line", async () => {
    const logs: unknown[] = [];
    app = buildApp(logs);
    const text = "WR11_SENTINEL_canary_must_not_be_logged";
    await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        sessionId: "wr11-2",
        audioDurationSeconds: 30,
        text,
        sendLogs: true,
      }),
    });
    for (const line of logs) {
      expect(JSON.stringify(line)).not.toContain("WR11_SENTINEL_canary");
    }
  });
});
