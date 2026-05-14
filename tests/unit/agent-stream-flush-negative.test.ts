// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 04 / Plan 08 / Task 2b — NEGATIVE-CONTROL buffering-injection.
 *
 * Source-of-record: 04-RESEARCH.md §2.7 lines 637-667 + 04-CONTEXT.md D-05.
 *
 * THIS IS THE LOAD-BEARING TEST OF PHASE 4. It pins the methodology of
 * `agent-stream-flush-positive.test.ts` so that test cannot false-negative.
 *
 * Same Fastify harness as the positive test, but the route is wrapped in
 * a `stream.Transform({ highWaterMark: 4096 })` that buffers writes until
 * its internal buffer fills. The fixture emits 10 lines of ~12 bytes each
 * (=120 bytes total) — the buffer NEVER fills, so the transform NEVER
 * flushes mid-stream. Result: the first NDJSON line cannot arrive at the
 * client until the stream ENDS, which happens at t≈900ms (10 lines × 100ms
 * cadence).
 *
 * Assertion: first-line latency > 800ms. If this assertion EVER fails
 * (i.e., first-line arrives < 800ms despite the buffering Transform), it
 * proves the positive test (`agent-stream-flush-positive.test.ts`) is a
 * false negative — the no-buffering chain in production isn't actually
 * being measured by the positive test.
 *
 * NON-SKIPPABLE BY CONTRACT: this file MUST contain no skip variants of
 * test runners and no skip-by-env escape hatches. The plan's acceptance
 * criteria (Plan 08 Task 2 acceptance criterion #3) enforces this via a
 * grep over the test file source; the methodology MUST hold for the
 * lifetime of the project.
 */

import { request as httpRequest } from "node:http";
import { Transform } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: FastifyInstance;
let baseHost: string;
let basePort: number;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

beforeAll(async () => {
  app = Fastify({ logger: false });
  app.post("/test-stream-buffered", async (req, reply) => {
    // Same hijack chain as production AND positive test — ONLY difference
    // is the stream.Transform wrapper that buffers until full.
    reply.raw.setHeader("Content-Type", "application/x-ndjson");
    reply.hijack();
    try {
      reply.raw.flushHeaders();
    } catch {
      /* ignore */
    }
    try {
      req.raw.socket?.setNoDelay(true);
    } catch {
      /* ignore */
    }

    // The buffering injection. The transform ACCUMULATES every chunk in
    // an internal Buffer and only pushes downstream when either (a) the
    // accumulated size reaches the 4096-byte high-water mark or (b) the
    // upstream calls `.end()` (the `flush` callback). For a 10×~12-byte
    // = 120-byte stream the high-water mark is NEVER reached, so the
    // only flush happens at end-of-stream — proving that any future
    // accidental insertion of a buffered transform in the production
    // chain would be caught by the positive sibling's < 200ms assertion.
    //
    // This is the canonical "buffering middleware" surrogate for Node
    // streams: it does not push until the threshold trips. The naive
    // `this.push(chunk)` Transform from RESEARCH §2.7 does NOT actually
    // buffer (push immediately queues in the readable side and pipe()
    // drains it eagerly into reply.raw); the explicit accumulator below
    // is the one that holds chunks back, matching the Traefik/nginx
    // proxy_buffering=on semantics we're guarding against.
    const HIGH_WATER_MARK = 4096;
    const accumulated: Buffer[] = [];
    let accumulatedBytes = 0;
    const buffering = new Transform({
      highWaterMark: HIGH_WATER_MARK,
      transform(chunk, _enc, cb) {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
        accumulated.push(buf);
        accumulatedBytes += buf.length;
        if (accumulatedBytes >= HIGH_WATER_MARK) {
          this.push(Buffer.concat(accumulated));
          accumulated.length = 0;
          accumulatedBytes = 0;
        }
        cb();
      },
      flush(cb) {
        if (accumulatedBytes > 0) {
          this.push(Buffer.concat(accumulated));
          accumulated.length = 0;
          accumulatedBytes = 0;
        }
        cb();
      },
    });
    buffering.pipe(reply.raw);

    for (let i = 0; i < 10; i++) {
      buffering.write(`${JSON.stringify({ i })}\n`);
      // eslint-disable-next-line no-await-in-loop -- intentional cadence
      await sleep(100);
    }
    buffering.end();
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
 * IDENTICAL raw-http harness as the positive sibling test —
 * apples-to-apples timing measurement. The 'data' event fires the
 * moment the kernel hands up the first TCP segment.
 */
function postFirstByte(
  path: string,
): Promise<{ status: number; tFirstByte: number; tStart: number }> {
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

describe("Plan 08 / Task 2b — NEGATIVE-CONTROL: buffered-Transform first-line > 800ms", () => {
  it("MUST observe first-byte > 800ms when a stream.Transform buffer is wrapped around the same hijack chain (methodology pin)", async () => {
    const { status, tStart, tFirstByte } = await postFirstByte("/test-stream-buffered");
    expect(status).toBe(200);
    const firstByteLatency = tFirstByte - tStart;
    // The methodology pin. If this assertion fails, the positive test
    // is broken — fix the positive test FIRST, do not relax this bound.
    expect(firstByteLatency).toBeGreaterThan(800);
  });
});
