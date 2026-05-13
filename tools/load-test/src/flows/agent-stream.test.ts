// SPDX-License-Identifier: Apache-2.0
// Phase 08 / Plan 06 — Task 2 RED: agent-stream flow tests.
//
// Critical: agent-stream MUST record TWO separate metrics so the SLO
// breakdown in plan 07 can attribute TTFB-first-byte latency apart from
// the total request duration (RESEARCH.md §Pitfall 6).

import { describe, expect, it, vi } from "vitest";

import type { HttpClient, HttpResponse } from "../utils/http-client.js";
import { createMockAdapter } from "../utils/http-client.js";
import { agentStream } from "./agent-stream.js";

function ok(): HttpResponse {
  return {
    status: 200,
    body: '{"role":"assistant"}\n{"finishReason":"stop"}\n',
    headers: { "content-type": "application/x-ndjson" },
    timings: { waiting: 100, duration: 500 },
  };
}

function clientWith(request: HttpClient["request"]): HttpClient {
  return createMockAdapter({ request });
}

describe("agent-stream flow", () => {
  it("POSTs to /api/agent/stream with JSON-stringified {messages, stream:true}", () => {
    const request = vi.fn().mockReturnValue(ok());
    const ttfb = vi.fn();
    const total = vi.fn();
    agentStream({ email: "u@x", token: "tok-a" }, clientWith(request), {
      messages: [{ role: "user", content: "hi" }],
      metrics: { ttfb: { add: ttfb }, total: { add: total } },
    });
    const call = request.mock.calls[0];
    if (!call) throw new Error("expected one call");
    const [method, url, body] = call;
    expect(method).toBe("POST");
    expect(url).toBe("https://api.localhost/api/agent/stream");
    expect(typeof body).toBe("string");
    const json = JSON.parse(body as string) as { messages: unknown; stream: boolean };
    expect(json.stream).toBe(true);
    expect(Array.isArray(json.messages)).toBe(true);
  });

  it("sets content-type: application/json so Fastify's body parser fires (08.1-01 Task 2)", () => {
    const request = vi.fn().mockReturnValue(ok());
    agentStream({ email: "u@x", token: "t" }, clientWith(request), {
      messages: [{ role: "user", content: "hi" }],
      metrics: { ttfb: { add: vi.fn() }, total: { add: vi.fn() } },
    });
    const opts = request.mock.calls[0]?.[3] as { headers?: Record<string, string> };
    expect(opts?.headers?.["content-type"]).toBe("application/json");
    expect(opts?.headers?.accept).toBe("application/x-ndjson");
  });

  it("records TTFB and total duration separately", () => {
    const request = vi.fn().mockReturnValue(ok());
    const ttfbAdd = vi.fn();
    const totalAdd = vi.fn();
    agentStream({ email: "u@x", token: "t" }, clientWith(request), {
      messages: [{ role: "user", content: "hi" }],
      metrics: { ttfb: { add: ttfbAdd }, total: { add: totalAdd } },
    });
    expect(ttfbAdd).toHaveBeenCalledWith(100);
    expect(totalAdd).toHaveBeenCalledWith(500);
  });

  it("tags the request with endpoint:'agent-stream'", () => {
    const request = vi.fn().mockReturnValue(ok());
    agentStream({ email: "u@x", token: "t" }, clientWith(request), {
      messages: [{ role: "user", content: "hi" }],
      metrics: { ttfb: { add: vi.fn() }, total: { add: vi.fn() } },
    });
    const opts = request.mock.calls[0]?.[3] as { tags?: Record<string, string> };
    expect(opts?.tags?.endpoint).toBe("agent-stream");
  });
});
