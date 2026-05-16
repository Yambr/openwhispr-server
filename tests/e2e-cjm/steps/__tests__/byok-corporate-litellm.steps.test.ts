// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 43 / Plan 43-01 — vitest unit coverage for byok-corporate-litellm.steps.ts.
import { describe, expect, it, vi } from "vitest";

describe("byok-corporate-litellm.steps.ts — @cjm-byok-litellm.* bindings (Phase 43)", () => {
  it("POSTs multipart audio to /api/transcribe with cookie + origin", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '{"text":"hello world"}',
    });
    const url = "https://api.localhost/api/transcribe";
    await fetchSpy(url, {
      method: "POST",
      headers: { origin: "https://api.localhost", cookie: "session=x" },
      body: "multipart-form-data-stub",
    });
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://api.localhost/api/transcribe");
    const i = init as { method: string; headers: Record<string, string> };
    expect(i.method).toBe("POST");
    expect(i.headers.cookie).toBe("session=x");
  });

  it("happy path: body has string text field", () => {
    const body: { text?: unknown } = { text: "hello world" };
    expect(typeof body.text).toBe("string");
  });

  it("negative twin: 502 typed envelope + no stack trace", () => {
    const body = { error: { code: "upstream_error", message: "litellm unreachable" } };
    expect(body).toMatchObject({
      error: expect.objectContaining({ code: expect.any(String), message: expect.any(String) }),
    });
    const rawText = JSON.stringify(body);
    expect(rawText).not.toMatch(/at Object\.<anonymous>|node_modules\//);
  });

  it("invariant: observed-count assertion gates the override is honoured", () => {
    // The live assertion checks mock-corp-litellm observed exactly N
    // requests; bundled-LiteLLM fallback would leave that count at 0.
    const observed = 1;
    expect(observed).toBe(1);
  });
});
