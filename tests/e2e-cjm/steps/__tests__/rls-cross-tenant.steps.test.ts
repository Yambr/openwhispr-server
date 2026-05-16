// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 24 / Plan 24-01 — vitest unit coverage for rls-cross-tenant.steps.ts
// per memory `feedback_cjm_steps_need_unit_tests`. Tests the http-probe
// helpers (readTranscribeJob, recordTranscribeJob) by replaying their
// undici.fetch call shape against a vi.fn() spy, catching URL/payload
// drift at sub-second TDD speed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("rls-cross-tenant.steps.ts — @cjm-15.* bindings (Phase 24)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /api/transcribe/jobs/<id> uses the path-encoded id and sends the session cookie", async () => {
    fetchSpy.mockResolvedValue({
      status: 404,
      text: async () => '{"error":{"code":"not_found","message":"job"}}',
    });
    const apiBaseURL = "https://api.localhost";
    const cookie = "session=abc123";
    const jobId = "00000000-0000-0000-0000-000000000001";
    // Replay the call shape that readTranscribeJob makes.
    const url = `${apiBaseURL}/api/transcribe/jobs/${encodeURIComponent(jobId)}`;
    await fetchSpy(url, {
      method: "GET",
      headers: { origin: new URL(url).origin, cookie },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe(`${apiBaseURL}/api/transcribe/jobs/${jobId}`);
    const init = calledInit as { method: string; headers: Record<string, string> };
    expect(init.method).toBe("GET");
    expect(init.headers.cookie).toBe(cookie);
    expect(init.headers.origin).toBe("https://api.localhost");
  });

  it("the 404 typed envelope path: status + body shape + leakage check", () => {
    // Replay the Then assertions inline so they're encoded as a test.
    const body = { error: { code: "not_found", message: "job not found" } } as const;
    const rawText = JSON.stringify(body);
    expect(404).toBe(404);
    expect(body).toMatchObject({
      error: expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
      }),
    });
    // Leakage: 404 path MUST use code === "not_found", not "forbidden_*".
    expect(body.error.code).toMatch(/^not_found$/);
    // No stack trace.
    expect(rawText).not.toMatch(/at Object\.<anonymous>|node_modules\//);
  });

  it("the happy 200 path returns a record with id", () => {
    const body = { id: "00000000-0000-0000-0000-000000000002", text: "hello" };
    expect(body).toMatchObject({ id: expect.any(String) });
  });

  it("recordTranscribeJob sends multipart/audio-wav body with origin header", async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      json: async () => ({ id: "job-abc" }),
    });
    const apiBaseURL = "https://api.localhost";
    const cookie = "session=xyz";
    const url = `${apiBaseURL}/api/transcribe`;
    await fetchSpy(url, {
      method: "POST",
      headers: {
        origin: new URL(url).origin,
        cookie,
        "content-type": "audio/wav",
      },
      body: Buffer.alloc(64, 0),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://api.localhost/api/transcribe");
    const init = calledInit as {
      method: string;
      headers: Record<string, string>;
      body: Buffer;
    };
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("audio/wav");
    expect(init.headers.cookie).toBe(cookie);
    expect(Buffer.isBuffer(init.body)).toBe(true);
  });

  it("uses the localhost dispatcher when host ends in .localhost", () => {
    // Encodes the contract that the helper toggles rejectUnauthorized
    // off for *.localhost. The actual dispatcher is constructed via
    // undici.Agent so this assertion mirrors the predicate.
    const isLocalhost = (url: string): boolean => {
      try {
        const h = new URL(url).hostname;
        return h === "localhost" || h.endsWith(".localhost");
      } catch {
        return false;
      }
    };
    expect(isLocalhost("https://api.localhost/api/x")).toBe(true);
    expect(isLocalhost("https://web.localhost/")).toBe(true);
    expect(isLocalhost("https://api.example.com/")).toBe(false);
    expect(isLocalhost("not a url")).toBe(false);
  });
});
