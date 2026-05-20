// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 02 / Task 1 — streaming-usage observability tests.
//
// D-11/D-13 — assert the structured log emission shape:
//   * SHA-256(text) + length (WR-11 / Phase 65 — the raw STT-content
//     preview is dropped; only the hash + count reach structured logs)
//   * Telemetry fields (sttProvider, sttModel, sttLanguage, audioSizeBytes,
//     audioFormat, sttProcessingMs, clientType, appVersion, clientVersion,
//     clientTotalMs) attached to the log entry
//   * The body.text is NEVER written to the log object
//
// Strategy: feed Fastify a custom logger stream that captures JSON lines,
// then assert the captured "streaming-usage" log entry's fields directly.

import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildStreamingUsageRoutes } from "../../../../src/routes/streaming-usage.js";

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
      const sqlText = parts.join("");
      if (/SELECT\s+COALESCE\(SUM\(units\)/i.test(sqlText)) {
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

describe("POST /api/streaming-usage — observability (D-11, D-13)", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("emits SHA-256(text) + length, NO text_preview, when sendLogs=false (WR-11)", async () => {
    const logs: unknown[] = [];
    app = buildApp(logs);
    const text = "hello world";
    const res = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        sessionId: "obs-1",
        audioDurationSeconds: 30,
        text,
        sendLogs: false,
      }),
    });
    expect(res.statusCode).toBe(200);
    const entry = findUsageLog(logs);
    expect(entry).toBeDefined();
    expect(entry?.text_sha256).toBe(createHash("sha256").update(text).digest("hex"));
    expect(entry?.text_length).toBe(text.length);
    // WR-11 (Phase 65) — the raw STT-content preview is dropped.
    expect(entry).not.toHaveProperty("text_preview");
    expect(entry?.sendLogs).toBe(false);
  });

  it("long text emits length, NO text_preview, when sendLogs=false (WR-11)", async () => {
    const logs: unknown[] = [];
    app = buildApp(logs);
    const longText = "a".repeat(1500);
    await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        sessionId: "obs-2",
        audioDurationSeconds: 30,
        text: longText,
        sendLogs: false,
      }),
    });
    const entry = findUsageLog(logs);
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("text_preview");
    expect(entry?.text_length).toBe(1500);
  });

  it("long text emits NO text_preview when sendLogs=true (WR-11)", async () => {
    const logs: unknown[] = [];
    app = buildApp(logs);
    const longText = "b".repeat(1500);
    await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        sessionId: "obs-3",
        audioDurationSeconds: 30,
        text: longText,
        sendLogs: true,
      }),
    });
    const entry = findUsageLog(logs);
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("text_preview");
    expect(entry?.text_length).toBe(1500);
  });

  it("D-13 — full plaintext text NEVER appears in any log line when truncated", async () => {
    const logs: unknown[] = [];
    app = buildApp(logs);
    const PII = `SECRET-CANARY-${"x".repeat(2000)}`; // length 2014 -> preview must drop the x's
    await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        sessionId: "obs-pii",
        audioDurationSeconds: 30,
        text: PII,
        sendLogs: false,
      }),
    });
    // No log line may contain the full PII string (length 2014 > 200 cap).
    for (const line of logs) {
      expect(JSON.stringify(line)).not.toContain(PII);
    }
  });

  it("attaches D-11 telemetry fields to the structured log entry", async () => {
    const logs: unknown[] = [];
    app = buildApp(logs);
    await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        sessionId: "obs-fields",
        audioDurationSeconds: 30,
        sttProvider: "deepgram",
        sttModel: "nova-2",
        sttLanguage: "en",
        sttProcessingMs: 1234,
        audioSizeBytes: 65536,
        audioFormat: "webm",
        clientType: "macos",
        appVersion: "1.0.0",
        clientVersion: "openwhispr-desktop",
        clientTotalMs: 1500,
      }),
    });
    const entry = findUsageLog(logs);
    expect(entry).toBeDefined();
    expect(entry?.sttProvider).toBe("deepgram");
    expect(entry?.sttModel).toBe("nova-2");
    expect(entry?.sttLanguage).toBe("en");
    expect(entry?.sttProcessingMs).toBe(1234);
    expect(entry?.audioSizeBytes).toBe(65536);
    expect(entry?.audioFormat).toBe("webm");
    expect(entry?.clientType).toBe("macos");
    expect(entry?.appVersion).toBe("1.0.0");
    expect(entry?.clientVersion).toBe("openwhispr-desktop");
    expect(entry?.clientTotalMs).toBe(1500);
    expect(entry?.sessionId).toBe("obs-fields");
    expect(entry?.units).toBe(30);
  });
});
