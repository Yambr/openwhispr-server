// Phase 08 / Plan 06 — Task 2 RED: transcribe flow tests.
//
// Asserts that the flow:
//   1. POSTs to BASE_URL + /api/transcribe with an Authorization Bearer
//      header derived from user.token.
//   2. Sends a multipart body containing the WAV bytes under field
//      name "file" plus the "model" and "language" string fields.
//   3. Tags the request with endpoint:'transcribe' so http_req_duration
//      is attributable per endpoint in Mimir.
//   4. Rotates the bearer when the response carries `set-auth-token`.
//   5. Does NOT throw on a non-2xx — the flow records failure via
//      the (mocked) k6 `check()` and returns.

import { describe, expect, it, vi } from "vitest";

import type { HttpClient, HttpResponse } from "../utils/http-client.js";
import { createMockAdapter } from "../utils/http-client.js";
import { transcribe } from "./transcribe.js";

const WAV_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0xde, 0xad, 0xbe, 0xef]); // RIFF...

function ok(): HttpResponse {
  return {
    status: 200,
    body: '{"text":"hello"}',
    headers: { "content-type": "application/json" },
    timings: { waiting: 50, duration: 120 },
  };
}

function clientWith(request: HttpClient["request"]): HttpClient {
  return createMockAdapter({ request });
}

describe("transcribe flow", () => {
  it("POSTs to /api/transcribe with Authorization Bearer header from user.token", () => {
    const request = vi.fn().mockReturnValue(ok());
    transcribe({ email: "u@x", token: "tok-1" }, clientWith(request), { wavBytes: WAV_BYTES });
    expect(request).toHaveBeenCalledTimes(1);
    const call = request.mock.calls[0];
    if (!call) throw new Error("expected one call");
    const [method, url, , opts] = call;
    expect(method).toBe("POST");
    expect(url).toBe("https://api.localhost/api/transcribe");
    expect(opts?.headers?.authorization).toBe("Bearer tok-1");
  });

  it("sends a multipart body with file/model/language fields", () => {
    const request = vi.fn().mockReturnValue(ok());
    transcribe({ email: "u@x", token: "tok" }, clientWith(request), { wavBytes: WAV_BYTES });
    const body = request.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(body).toBeDefined();
    expect(body.file).toBeDefined();
    expect(body.model).toBeDefined();
    expect(body.language).toBe("en");
  });

  it("tags the request with endpoint:'transcribe'", () => {
    const request = vi.fn().mockReturnValue(ok());
    transcribe({ email: "u@x", token: "tok" }, clientWith(request), { wavBytes: WAV_BYTES });
    const opts = request.mock.calls[0]?.[3] as { tags?: Record<string, string> };
    expect(opts?.tags?.endpoint).toBe("transcribe");
  });

  it("rotates the bearer when the response carries set-auth-token", () => {
    const request = vi.fn().mockReturnValue({
      ...ok(),
      headers: { "set-auth-token": "rotated-tok" },
    });
    const user = { email: "u@x", token: "tok-old" };
    transcribe(user, clientWith(request), { wavBytes: WAV_BYTES });
    expect(user.token).toBe("rotated-tok");
  });

  it("does not throw on a non-2xx response", () => {
    const request = vi.fn().mockReturnValue({
      ...ok(),
      status: 503,
      body: "upstream busy",
    });
    expect(() =>
      transcribe({ email: "u@x", token: "tok" }, clientWith(request), { wavBytes: WAV_BYTES }),
    ).not.toThrow();
  });
});
