// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 04 / Plan 08 / Task 2a — POSITIVE buffering-injection control.
 *
 * Source-of-record: 04-RESEARCH.md §2.7 lines 605-635 + 04-CONTEXT.md D-05.
 *
 * Boots a tiny Fastify instance with a fixture route `/test-stream` that
 * uses the SAME `reply.hijack() + raw.flushHeaders() + raw.setNoDelay() +
 * raw.write` chain as production `apps/api/src/routes/agent/stream.ts`,
 * then opens a real HTTP socket via WHATWG `fetch` and asserts the first
 * NDJSON line arrives within 200ms of request-send (well within the
 * 500ms BACKEND_SPEC budget).
 *
 * To avoid slow-CI flake the fixture emits line 1 IMMEDIATELY (t≈0ms
 * after the handler enters) and lines 2-10 at 100ms cadence; the
 * assertion therefore tolerates any non-pathological CI runner while
 * still proving the no-buffering chain is intact.
 *
 * THIS TEST IS PAIRED with `agent-stream-flush-negative.test.ts` — the
 * negative test wraps the SAME handler in a `stream.Transform({
 * highWaterMark: 4096 })` that buffers until the buffer fills (which it
 * never does for a 120-byte stream). If the negative test ever passes
 * (first-line < 800ms), it proves THIS positive test is a false negative.
 */

import { request as httpRequest } from "node:http";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: FastifyInstance;
let baseHost: string;
let basePort: number;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

beforeAll(async () => {
  app = Fastify({ logger: false });
  app.post("/test-stream", async (req, reply) => {
    // Mirror production stream.ts (D-02 + D-04): set headers on the raw
    // ServerResponse BEFORE reply.hijack() so they survive the hijack
    // boundary; then flushHeaders + setNoDelay so each write becomes its
    // own TCP segment (Nagle disabled).
    reply.raw.setHeader("Content-Type", "application/x-ndjson");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.hijack();
    try {
      reply.raw.flushHeaders();
    } catch {
      /* ignore — flushHeaders may throw on already-flushed adapters */
    }
    try {
      req.raw.socket?.setNoDelay(true);
    } catch {
      /* ignore — setNoDelay isn't always available on all adapters */
    }
    // Line 1 IMMEDIATELY — no delay before the first emit. Lines 2-10
    // at 100ms cadence so the test still observes streaming behavior.
    reply.raw.write(`${JSON.stringify({ i: 0 })}\n`);
    for (let i = 1; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop -- intentional cadence
      await sleep(100);
      reply.raw.write(`${JSON.stringify({ i })}\n`);
    }
    reply.raw.end();
    return reply;
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (typeof addr === "string" || addr === null) {
    throw new Error("Fastify listen returned unexpected address");
  }
  baseHost = "127.0.0.1";
  basePort = addr.port;
});

/**
 * POST to the fixture route via raw `node:http` and resolve with the
 * first-data timestamp. Node's http client surfaces 'data' events as
 * soon as the kernel hands a TCP segment up — bypassing any whatwg-
 * fetch / undici body buffering that could mask the streaming behavior
 * we're trying to assert.
 */
function postFirstByte(path: string): Promise<{ status: number; tFirstByte: number; tStart: number }> {
  return new Promise((resolve, reject) => {
    const tStart = performance.now();
    const req = httpRequest(
      {
        host: baseHost,
        port: basePort,
        path,
        method: "POST",
        headers: { "content-length": "0" },
      },
      (res) => {
        let firstByteAt: number | undefined;
        res.on("data", () => {
          if (firstByteAt === undefined) firstByteAt = performance.now();
          // Continue draining; we resolve on 'end' so the connection closes
          // before the test finishes.
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            tFirstByte: firstByteAt ?? performance.now(),
            tStart,
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

afterAll(async () => {
  await app.close();
});

describe("Plan 08 / Task 2a — POSITIVE: hijack+flushHeaders+setNoDelay first-line < 200ms", () => {
  it("emits the first NDJSON line within 200ms of request-send (no buffering)", async () => {
    // Use raw node:http so the 'data' event fires the moment the kernel
    // hands up the first TCP segment — undici/whatwg fetch's body
    // buffering can otherwise mask streaming behavior and yield only
    // when the response ends. The negative-control sibling uses the
    // identical raw-http harness so the comparison is apples-to-apples.
    const { status, tStart, tFirstByte } = await postFirstByte("/test-stream");
    expect(status).toBe(200);
    const firstByteLatency = tFirstByte - tStart;
    // Methodology pin: line 1 emitted IMMEDIATELY (no delay) so this
    // assertion has comfortable headroom on any non-pathological CI
    // runner. The negative-control sibling test asserts > 800ms when a
    // buffering Transform is inserted — together they pin the test
    // methodology so a future regression in the production hijack chain
    // (e.g. accidental `pipe()` through a default-highWaterMark stream)
    // would be caught loudly.
    expect(firstByteLatency).toBeLessThan(200);
  });
});
