// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 04 / Task 3 — AUTH-06 / D-16: x-openwhispr-source
// preserved on every request's structured log child.
//
// The `requestLog` plugin (Plan 03 plugins/request-log.ts) hooks
// `onRequest` and replaces `req.log` with a child carrying
// `openwhisprSource: <header value | null>`. Loki / Grafana queries
// then filter on this canonical field rather than special-casing
// "missing field".
//
// Test strategy: spin up Fastify with a custom pino logger configured
// with a write-to-array stream. Inject a request with the header,
// have the handler emit a log line, and assert the captured JSON
// contains `openwhisprSource: "desktop"`.
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { requestLog } from "../plugins/request-log.js";

interface CapturedLog {
  level: number;
  msg?: string;
  openwhisprSource?: string | null;
  [k: string]: unknown;
}

function captureStream(captured: CapturedLog[]): NodeJS.WritableStream {
  // Minimal write-stream that JSON.parses each line into the array.
  return {
    write(chunk: string | Buffer): boolean {
      const line = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      try {
        captured.push(JSON.parse(line) as CapturedLog);
      } catch {
        /* non-JSON line: ignore */
      }
      return true;
    },
  } as unknown as NodeJS.WritableStream;
}

describe("AUTH-06 — x-openwhispr-source preserved in structured logs", () => {
  it("emits openwhisprSource:'desktop' when header is set", async () => {
    const captured: CapturedLog[] = [];
    const stream = captureStream(captured);
    const app = Fastify({
      logger: { level: "info", stream },
      trustProxy: true,
    });
    await app.register(requestLog);
    app.route({
      method: "GET",
      url: "/api/health",
      handler: async (req) => {
        // Touch req.log so the plugin's child appears in captured.
        req.log.info("health probe");
        return { status: "ok" as const };
      },
    });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { "x-openwhispr-source": "desktop" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();

    const handlerLog = captured.find(
      (l) => l.openwhisprSource === "desktop" && l.msg === "health probe",
    );
    expect(handlerLog).toBeDefined();
  });

  it("emits openwhisprSource:null when header is absent", async () => {
    const captured: CapturedLog[] = [];
    const stream = captureStream(captured);
    const app = Fastify({
      logger: { level: "info", stream },
      trustProxy: true,
    });
    await app.register(requestLog);
    app.route({
      method: "GET",
      url: "/api/health",
      handler: async (req) => {
        req.log.info("health probe");
        return { status: "ok" as const };
      },
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    await app.close();

    const handlerLog = captured.find((l) => l.msg === "health probe");
    expect(handlerLog).toBeDefined();
    // null is the canonical absent-value sentinel (request-log.ts).
    expect(handlerLog?.openwhisprSource).toBeNull();
  });
});
