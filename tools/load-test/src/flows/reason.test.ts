// Phase 08 / Plan 06 — Task 2 RED: reason flow tests.

import { describe, expect, it, vi } from "vitest";

import type { HttpClient, HttpResponse } from "../utils/http-client.js";
import { createMockAdapter } from "../utils/http-client.js";
import { reason } from "./reason.js";

function ok(): HttpResponse {
  return {
    status: 200,
    body: '{"content":"answer"}',
    headers: {},
    timings: { waiting: 80, duration: 200 },
  };
}

function clientWith(request: HttpClient["request"]): HttpClient {
  return createMockAdapter({ request });
}

const PROMPTS = ["prompt-one", "prompt-two", "prompt-three"];

describe("reason flow", () => {
  it("POSTs to /api/reason with a JSON {model, messages} body", () => {
    const request = vi.fn().mockReturnValue(ok());
    reason({ email: "u@x", token: "tok-r" }, clientWith(request), {
      prompts: PROMPTS,
      iteration: 0,
    });
    const call = request.mock.calls[0];
    if (!call) throw new Error("expected one call");
    const [method, url, body] = call;
    expect(method).toBe("POST");
    expect(url).toBe("https://api.localhost/api/reason");
    const json = body as { model: string; messages: Array<{ role: string; content: string }> };
    expect(typeof json.model).toBe("string");
    expect(Array.isArray(json.messages)).toBe(true);
    expect(json.messages[0]?.role).toBe("user");
    expect(PROMPTS).toContain(json.messages[0]?.content);
  });

  it("picks prompts deterministically by iteration index", () => {
    const request = vi.fn().mockReturnValue(ok());
    reason({ email: "u@x", token: "t" }, clientWith(request), {
      prompts: PROMPTS,
      iteration: 1,
    });
    const body = request.mock.calls[0]?.[2] as { messages: Array<{ content: string }> };
    expect(body.messages[0]?.content).toBe(PROMPTS[1]);
  });

  it("tags the request with endpoint:'reason'", () => {
    const request = vi.fn().mockReturnValue(ok());
    reason({ email: "u@x", token: "t" }, clientWith(request), {
      prompts: PROMPTS,
      iteration: 0,
    });
    const opts = request.mock.calls[0]?.[3] as { tags?: Record<string, string> };
    expect(opts?.tags?.endpoint).toBe("reason");
  });

  it("falls back to an empty prompt when the prompts array is empty", () => {
    const request = vi.fn().mockReturnValue(ok());
    reason({ email: "u@x", token: "t" }, clientWith(request), {
      prompts: [],
      iteration: 0,
    });
    const body = request.mock.calls[0]?.[2] as { messages: Array<{ content: string }> };
    expect(body.messages[0]?.content).toBe("");
  });

  it("sends the bearer token in the Authorization header", () => {
    const request = vi.fn().mockReturnValue(ok());
    reason({ email: "u@x", token: "tok-r" }, clientWith(request), {
      prompts: PROMPTS,
      iteration: 0,
    });
    const opts = request.mock.calls[0]?.[3] as { headers?: Record<string, string> };
    expect(opts?.headers?.authorization).toBe("Bearer tok-r");
  });
});
