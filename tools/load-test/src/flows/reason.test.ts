// SPDX-License-Identifier: FSL-1.1-ALv2
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
  it("POSTs to /api/reason with a JSON {text} body matching ReasonRequest schema (08.1-01 Task 2)", () => {
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
    // Body is a JSON STRING (k6 won't form-urlencode a string body even
    // without an explicit content-type header) so the api receives the
    // exact bytes expected.
    expect(typeof body).toBe("string");
    const parsed = JSON.parse(body as string) as {
      text: string;
      model?: unknown;
      messages?: unknown;
    };
    expect(typeof parsed.text).toBe("string");
    expect(PROMPTS).toContain(parsed.text);
    // ReasonRequest is .strict() — must NOT carry messages / model.
    expect(parsed.messages).toBeUndefined();
    expect(parsed.model).toBeUndefined();
  });

  it("sets content-type: application/json so Fastify's JSON parser fires (08.1-01 Task 2)", () => {
    const request = vi.fn().mockReturnValue(ok());
    reason({ email: "u@x", token: "t" }, clientWith(request), {
      prompts: PROMPTS,
      iteration: 0,
    });
    const opts = request.mock.calls[0]?.[3] as { headers?: Record<string, string> };
    expect(opts?.headers?.["content-type"]).toBe("application/json");
  });

  it("picks prompts deterministically by iteration index", () => {
    const request = vi.fn().mockReturnValue(ok());
    reason({ email: "u@x", token: "t" }, clientWith(request), {
      prompts: PROMPTS,
      iteration: 1,
    });
    const parsed = JSON.parse(request.mock.calls[0]?.[2] as string) as { text: string };
    expect(parsed.text).toBe(PROMPTS[1]);
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
    const parsed = JSON.parse(request.mock.calls[0]?.[2] as string) as { text: string };
    expect(parsed.text).toBe("");
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
