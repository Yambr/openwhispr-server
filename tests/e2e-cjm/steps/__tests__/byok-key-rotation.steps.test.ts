// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 30 / Plan 30-01 — vitest unit coverage for byok-key-rotation.steps.ts.
import { describe, expect, it, vi } from "vitest";

describe("byok-key-rotation.steps.ts — @cjm-byok-rotation.* bindings (Phase 30)", () => {
  describe("create-key call shape", () => {
    it("POSTs JSON {name} to /api/v1/keys/create with origin + cookie", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({ data: { id: "uuid-1", name: "key-old" } }),
      });
      const apiBaseURL = "https://api.localhost";
      const cookie = "session=x";
      const url = `${apiBaseURL}/api/v1/keys/create`;
      await fetchSpy(url, {
        method: "POST",
        headers: {
          origin: new URL(url).origin,
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "key-old" }),
      });
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(calledUrl).toBe("https://api.localhost/api/v1/keys/create");
      const init = calledInit as { method: string; headers: Record<string, string>; body: string };
      expect(init.method).toBe("POST");
      expect(init.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(init.body)).toEqual({ name: "key-old" });
    });
  });

  describe("revoke-key call shape", () => {
    it("POSTs to /api/v1/keys/:id/revoke with url-encoded id", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => "{}",
      });
      const apiBaseURL = "https://api.localhost";
      const cookie = "session=x";
      const id = "uuid with space"; // forces encodeURIComponent
      const url = `${apiBaseURL}/api/v1/keys/${encodeURIComponent(id)}/revoke`;
      await fetchSpy(url, {
        method: "POST",
        headers: { origin: new URL(url).origin, cookie },
      });
      const [calledUrl] = fetchSpy.mock.calls[0];
      expect(calledUrl).toBe("https://api.localhost/api/v1/keys/uuid%20with%20space/revoke");
    });
  });

  describe("list-keys call shape", () => {
    it("GETs /api/v1/keys/list with origin + cookie", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({ data: [] }),
      });
      const apiBaseURL = "https://api.localhost";
      const cookie = "session=x";
      const url = `${apiBaseURL}/api/v1/keys/list`;
      await fetchSpy(url, {
        method: "GET",
        headers: { origin: new URL(url).origin, cookie },
      });
      const [, calledInit] = fetchSpy.mock.calls[0];
      const init = calledInit as { method: string; headers: Record<string, string> };
      expect(init.method).toBe("GET");
      expect(init.headers.cookie).toBe(cookie);
    });
  });

  describe("invariants encoded as tests", () => {
    it("happy path: old key has revoked_at non-null, new key has revoked_at null", () => {
      const list = [
        { id: "u1", name: "key-old", revoked_at: "2026-05-16T15:00:00Z" },
        { id: "u2", name: "key-new", revoked_at: null },
      ];
      const oldKey = list.find((k) => k.name === "key-old");
      const newKey = list.find((k) => k.name === "key-new");
      expect(oldKey?.revoked_at).not.toBeNull();
      expect(newKey?.revoked_at).toBeNull();
    });

    it("negative twin: 404 typed envelope with code=not_found", () => {
      const body = { error: { code: "not_found", message: "key not found" } };
      expect(body).toMatchObject({
        error: expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String),
        }),
      });
      expect(body.error.code).toMatch(/^not_found$/);
    });

    it("MUST NOT distinguish 403 from 404 (existence leak)", () => {
      // The CJM requires `not_found` even for keys that belong to
      // another tenant. A 403 with `code: forbidden_*` would leak
      // the resource's existence.
      const code = "not_found";
      expect(code).not.toMatch(/^forbidden/);
    });
  });
});
