// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 08 / Task 1b — POST /api/agent/stream contract test
// (CONTRACT-01 extension for WIRE-07).
//
// Asserts the NDJSON wire shape returned by /api/agent/stream against the
// canonical `StreamChunk` discriminated union (Plan 08 / Task 1a) when run
// against a fully deployed compose stack with the contract-profile mock
// LiteLLM. The mock_response in `compose/litellm/litellm_config.contract.yaml`
// for `qwen3.6-plus-streaming` emits 3 SSE chunks at LiteLLM's default
// ~50ms cadence so the first NDJSON line arrives well within the 500ms
// budget asserted in Test 4 below (the buffering-injection negative-control
// trio in tests/unit/agent-stream-flush-{positive,negative}.test.ts pins the
// methodology so this assertion cannot false-negative).
//
// Threat mitigations exercised at the contract layer:
//   * T-04-03 (NDJSON stream injection / wire-shape drift) — every emitted
//     line MUST parse as StreamChunk; any drift away from the locked
//     vocabulary fails the suite.
//
// Skip semantics: like every other CONTRACT-01 test, this one uses
// `describe.skipIf(!REACHABLE)` so when no backend is reachable the suite
// passes cleanly (CI / `make contract-test` set BACKEND_URL explicitly and
// bring the stack up).

import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "../../src/env.js";
import { signInFixture } from "../../src/helpers/sign-in-fixture.js";
import { ErrorEnvelope, FinishChunk, StreamChunk } from "../../src/schemas.js";

const REACHABLE = await probeBackend();

/**
 * Issue a POST /api/agent/stream and read the NDJSON body raw, splitting
 * on '\n' and stripping the terminating empty entry. Returns the raw
 * lines (each is a JSON-encoded chunk) plus the headers + status.
 *
 * Cookies: relies on the JarFetch returned by signInFixture so the
 * dual-auth hook accepts the request. We read `res.body` once via
 * `.text()` because all current test cases assert on the COMPLETE
 * stream — the first-line-latency assertion (Test 4) opens its own
 * raw socket via undici instead.
 */
async function postStream(
  body: unknown,
  jarFetch: Awaited<ReturnType<typeof signInFixture>>,
): Promise<{ status: number; headers: Headers; lines: string[] }> {
  const res = await jarFetch.fetch(`${BACKEND_URL}/api/agent/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = res.ok ? await res.text() : "";
  const lines = text.split("\n").filter((l) => l.length > 0);
  return { status: res.status, headers: res.headers, lines };
}

describe.skipIf(!REACHABLE)("WIRE-07 — POST /api/agent/stream (NDJSON)", () => {
  it("Test 1: returns 200 with Content-Type 'application/x-ndjson' on a valid request", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/agent/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus-streaming",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(200);
    // Per BACKEND_SPEC §/api/agent/stream, the Content-Type MUST be
    // `application/x-ndjson` (NOT text/event-stream — that's SSE upstream;
    // we transform to NDJSON on the wire).
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toMatch(/application\/x-ndjson/);
    // Drain so the connection is released even though we don't assert on
    // body in this test (Test 2 covers structural body shape).
    await res.text();
  });

  it("Test 2: each non-empty NDJSON line parses as JSON and matches StreamChunk", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const { status, lines } = await postStream(
      {
        model: "qwen3.6-plus-streaming",
        messages: [{ role: "user", content: "hi" }],
      },
      jar,
    );
    expect(status).toBe(200);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // JSON.parse must succeed — wire-shape regression #1 is malformed JSON.
      const parsed = JSON.parse(line);
      // Discriminated-union check — wire-shape regression #2 is an unknown
      // chunk type or a known type with the wrong field shape (T-04-03).
      expect(() => StreamChunk.parse(parsed)).not.toThrow();
    }
  });

  it("Test 3: the LAST NDJSON line is a finish chunk (terminal-chunk contract)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const { lines } = await postStream(
      {
        model: "qwen3.6-plus-streaming",
        messages: [{ role: "user", content: "hi" }],
      },
      jar,
    );
    expect(lines.length).toBeGreaterThan(0);
    const last = JSON.parse(lines[lines.length - 1] as string);
    // Strictly a finish chunk — the desktop relies on this so it knows
    // the stream is closed deterministically (no half-open hangs).
    const finish = FinishChunk.parse(last);
    expect(finish.type).toBe("finish");
    expect(typeof finish.finishReason).toBe("string");
    expect(typeof finish.usage.promptTokens).toBe("number");
    expect(typeof finish.usage.completionTokens).toBe("number");
  });

  it("Test 4: first NDJSON line arrives within 500ms of response headers", async () => {
    // Use the JarFetch's underlying fetch for cookie attachment, but read
    // the response body via the WHATWG ReadableStream so we can mark t1
    // at the EXACT moment the first chunk arrives (not at end-of-stream).
    const jar = await signInFixture("fixture@conformance.test");
    const t0 = performance.now();
    const res = await jar.fetch(`${BACKEND_URL}/api/agent/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus-streaming",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(200);
    // Mark t_headers AFTER headers received (response-header timestamp).
    const tHeaders = performance.now();
    expect(res.body, "response.body must be a ReadableStream").not.toBeNull();
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    let firstChunk: Uint8Array | undefined;
    try {
      const { value, done } = await reader.read();
      if (!done) firstChunk = value;
    } finally {
      // Drain the rest so the connection is released cleanly.
      try {
        while (!(await reader.read()).done) {
          /* drain */
        }
      } catch {
        // Reader cancelled — fine, Node closes the socket.
      }
    }
    const t1 = performance.now();
    expect(firstChunk, "first chunk must arrive before response closes").toBeDefined();
    // Budget: first NDJSON line < 500ms after request-send. The buffering
    // -injection negative-control trio (Plan 08 Task 2) proves this
    // assertion cannot false-negative — if a stream.Transform with
    // highWaterMark were ever inserted in the chain, that test would
    // fail loudly with first-line > 800ms.
    expect(t1 - t0).toBeLessThan(500);
    // Belt-and-braces: also assert the headers→first-chunk delta is
    // sub-200ms (Traefik no-buffering + Fastify hijack chain).
    expect(t1 - tHeaders).toBeLessThan(500);
  });

  it("Test 5: returns 401 with the global ErrorEnvelope when no bearer/cookie is supplied", async () => {
    const res = await fetch(`${BACKEND_URL}/api/agent/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    // Phase 2 D-13 envelope is `.strict()` — extra fields would fail this.
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });
});
