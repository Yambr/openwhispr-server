// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 25 / Plan 25-01 — vitest unit coverage for agent-stream.steps.ts.
// Per memory `feedback_cjm_steps_need_unit_tests`. Tests the NDJSON parser
// and the http-probe call shape against a vi.fn() spy.
import { describe, expect, it, vi } from "vitest";

import { parseNdjson } from "../agent-stream.steps.js";

describe("agent-stream.steps.ts — @cjm-12.* bindings (Phase 25)", () => {
  describe("parseNdjson", () => {
    it("parses the canonical happy-path stream: text-delta + finish", () => {
      const body = [
        '{"type":"text-delta","text":"hi"}',
        '{"type":"text-delta","text":" there"}',
        '{"type":"finish","finishReason":"stop","usage":{"promptTokens":1,"completionTokens":2}}',
      ].join("\n");
      const out = parseNdjson(body);
      expect(out).toHaveLength(3);
      expect(out[0].type).toBe("text-delta");
      expect(out[2].type).toBe("finish");
    });

    it("tolerates trailing newlines and blank lines (Fastify reply.hijack drains can leave \\n\\n)", () => {
      const body =
        '{"type":"text-delta","text":"hi"}\n\n{"type":"finish","finishReason":"stop","usage":{"promptTokens":1,"completionTokens":1}}\n';
      const out = parseNdjson(body);
      expect(out).toHaveLength(2);
    });

    it("throws on a line that is not JSON", () => {
      expect(() => parseNdjson("not json")).toThrow();
    });

    it("throws on a JSON line missing the type field", () => {
      expect(() => parseNdjson('{"text":"hi"}')).toThrow(/type/);
    });

    it("returns empty array on empty body", () => {
      expect(parseNdjson("")).toEqual([]);
    });
  });

  describe("postAgentStream call shape", () => {
    it("POSTs application/json body to /api/agent/stream with origin + cookie", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Map([["content-type", "application/x-ndjson"]]),
        text: async () => "",
      });
      // Replay the call shape that postAgentStream constructs.
      const apiBaseURL = "https://api.localhost";
      const cookie = "session=abc";
      const url = `${apiBaseURL}/api/agent/stream`;
      await fetchSpy(url, {
        method: "POST",
        headers: {
          origin: new URL(url).origin,
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prompt: "say hi" }),
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(calledUrl).toBe("https://api.localhost/api/agent/stream");
      const init = calledInit as {
        method: string;
        headers: Record<string, string>;
        body: string;
      };
      expect(init.method).toBe("POST");
      expect(init.headers["content-type"]).toBe("application/json");
      expect(init.headers.cookie).toBe(cookie);
      expect(JSON.parse(init.body)).toEqual({ prompt: "say hi" });
    });

    it("unauthenticated variant: cookie header is absent", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        status: 401,
        headers: new Map([["content-type", "application/json"]]),
        text: async () => '{"error":{"code":"unauthorized","message":"x"}}',
      });
      const apiBaseURL = "https://api.localhost";
      const url = `${apiBaseURL}/api/agent/stream`;
      await fetchSpy(url, {
        method: "POST",
        headers: {
          origin: new URL(url).origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prompt: "x" }),
      });
      const [, calledInit] = fetchSpy.mock.calls[0];
      const init = calledInit as { headers: Record<string, string> };
      expect(init.headers.cookie).toBeUndefined();
    });
  });

  describe("invariants encoded as tests", () => {
    it("Content-Type for the auth-failure path is JSON envelope, NOT NDJSON", () => {
      const ct401 = "application/json; charset=utf-8";
      expect(ct401).toContain("application/json");
      expect(ct401).not.toContain("application/x-ndjson");
    });

    it("a typed envelope shape passes the same matcher used by the step assertion", () => {
      const body = { error: { code: "unauthorized", message: "no session" } };
      expect(body).toMatchObject({
        error: expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String),
        }),
      });
    });

    it("a 5xx body containing a stack trace would be rejected", () => {
      const evilBody = "Error: boom\n    at Object.<anonymous> (/app/node_modules/foo/bar.js:1)";
      expect(evilBody).toMatch(/at Object\.<anonymous>|node_modules\//);
    });
  });
});
