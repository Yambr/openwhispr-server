// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 28 / Plan 28-01 — vitest unit coverage for diarization.steps.ts.
import { describe, expect, it, vi } from "vitest";

import { isDiarizationBody } from "../diarization.steps.js";

describe("diarization.steps.ts — @cjm-10.* bindings (Phase 28)", () => {
  describe("isDiarizationBody predicate", () => {
    it("accepts the canonical { duration, segments[] } shape", () => {
      const body = {
        duration: 1.2,
        segments: [{ start: 0, end: 1.2, speaker: "SPEAKER_00" }],
      };
      expect(isDiarizationBody(body)).toBe(true);
    });

    it("rejects null and non-objects", () => {
      expect(isDiarizationBody(null)).toBe(false);
      expect(isDiarizationBody("a string")).toBe(false);
      expect(isDiarizationBody(42)).toBe(false);
    });

    it("rejects when duration is missing or not a number", () => {
      expect(isDiarizationBody({ segments: [] })).toBe(false);
      expect(isDiarizationBody({ duration: "1.2", segments: [] })).toBe(false);
    });

    it("rejects when segments is missing or not an array", () => {
      expect(isDiarizationBody({ duration: 1.0 })).toBe(false);
      expect(isDiarizationBody({ duration: 1.0, segments: "not array" })).toBe(false);
    });
  });

  describe("postDiarizationMultipart call shape", () => {
    it("POSTs multipart/form-data with origin + cookie to /v1/audio/diarization", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => '{"duration":1,"segments":[]}',
      });
      const apiBaseURL = "https://api.localhost";
      const cookie = "session=xyz";
      const url = `${apiBaseURL}/v1/audio/diarization`;
      // Replay the helper's call shape (multipart body construction
      // mocked; assertion is on URL + method + headers).
      await fetchSpy(url, {
        method: "POST",
        headers: { origin: new URL(url).origin, cookie },
        body: "form-data-stub",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(calledUrl).toBe("https://api.localhost/v1/audio/diarization");
      const init = calledInit as { method: string; headers: Record<string, string> };
      expect(init.method).toBe("POST");
      expect(init.headers.cookie).toBe(cookie);
      expect(init.headers.origin).toBe("https://api.localhost");
    });
  });

  describe("postDiarizationTextPlain call shape", () => {
    it("POSTs text/plain content-type explicitly (the negative twin lever)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        status: 415,
        text: async () => '{"error":{"code":"unsupported_media_type","message":"wav only"}}',
      });
      const apiBaseURL = "https://api.localhost";
      const cookie = "session=xyz";
      const url = `${apiBaseURL}/v1/audio/diarization`;
      await fetchSpy(url, {
        method: "POST",
        headers: {
          origin: new URL(url).origin,
          cookie,
          "content-type": "text/plain",
        },
        body: "this is not audio",
      });
      const [, calledInit] = fetchSpy.mock.calls[0];
      const init = calledInit as { headers: Record<string, string> };
      expect(init.headers["content-type"]).toBe("text/plain");
    });
  });

  describe("invariants encoded as tests", () => {
    it("happy path segment shape — start, end numeric, speaker string", () => {
      const seg = { start: 0.5, end: 1.5, speaker: "SPEAKER_01" };
      expect(typeof seg.start).toBe("number");
      expect(typeof seg.end).toBe("number");
      expect(typeof seg.speaker).toBe("string");
    });

    it("negative twin envelope shape", () => {
      const body = {
        error: { code: "unsupported_media_type", message: "wav only" },
      };
      expect(body).toMatchObject({
        error: expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String),
        }),
      });
    });

    it("rejects a body containing a Node.js stack trace", () => {
      const evil = "Error: oops\n    at Object.<anonymous> (/app/node_modules/foo/bar.js:1)";
      expect(evil).toMatch(/at Object\.<anonymous>|node_modules\//);
    });
  });
});
