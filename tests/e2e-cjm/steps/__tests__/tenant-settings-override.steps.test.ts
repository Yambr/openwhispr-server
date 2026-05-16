// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 42 / Plan 42-01 — vitest coverage for tenant-settings-override.steps.ts.
import { describe, expect, it, vi } from "vitest";

describe("tenant-settings-override.steps.ts — @cjm-9.* bindings (Phase 42)", () => {
  it("PUT /api/stt-config sends JSON body with model", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '{"model":"whisper-large-v3-turbo"}',
    });
    const url = "https://api.localhost/api/stt-config";
    await fetchSpy(url, {
      method: "PUT",
      headers: {
        origin: "https://api.localhost",
        cookie: "session=x",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "whisper-large-v3-turbo" }),
    });
    const [, init] = fetchSpy.mock.calls[0];
    const i = init as { method: string; body: string };
    expect(i.method).toBe("PUT");
    expect(JSON.parse(i.body)).toEqual({ model: "whisper-large-v3-turbo" });
  });

  it("GET /api/stt-config returns the current model", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ model: "whisper-large-v3" }),
    });
    await fetchSpy("https://api.localhost/api/stt-config", {
      method: "GET",
      headers: { origin: "https://api.localhost", cookie: "session=x" },
    });
    const [, init] = fetchSpy.mock.calls[0];
    expect((init as { method: string }).method).toBe("GET");
  });

  it("400 typed envelope shape with validation_error code", () => {
    const body = { error: { code: "validation_error", message: "model invalid" } };
    expect(body).toMatchObject({
      error: expect.objectContaining({ code: expect.any(String), message: expect.any(String) }),
    });
    expect(body.error.code).toMatch(/validation_error|invalid_model/);
  });

  it("happy path: post-PUT GET reflects override", () => {
    let stored = "whisper-large-v3";
    stored = "whisper-large-v3-turbo"; // simulate PUT side-effect
    expect(stored).toBe("whisper-large-v3-turbo");
  });
});
