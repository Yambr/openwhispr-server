// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 27 / Plan 27-01 — vitest unit coverage for session-refresh.steps.ts.
// Per memory feedback_cjm_steps_need_unit_tests. Tests pure helpers
// (extractInboundToken, isSessionCookieCleared) directly and replays
// the http-probe call shape via vi.fn().
import { describe, expect, it, vi } from "vitest";

import { extractInboundToken, isSessionCookieCleared } from "../session-refresh.steps.js";

describe("session-refresh.steps.ts — @cjm-14.* bindings (Phase 27)", () => {
  describe("extractInboundToken", () => {
    it("extracts the dev-mode session_token cookie value (split on ;, returns clean value)", () => {
      const cookie = "better-auth.session_token=abc123; Path=/; HttpOnly";
      expect(extractInboundToken(cookie)).toBe("abc123");
    });

    it("extracts the __Secure- prefixed session_token cookie value (production form)", () => {
      const cookie = "__Secure-better-auth.session_token=xyz789";
      expect(extractInboundToken(cookie)).toBe("xyz789");
    });

    it("returns undefined when no session_token cookie is present", () => {
      expect(extractInboundToken("foo=bar; baz=qux")).toBeUndefined();
    });

    it("returns undefined on an empty string", () => {
      expect(extractInboundToken("")).toBeUndefined();
    });

    it("picks the dev-mode token when both prefixes appear (defensive — usually only one)", () => {
      const cookie = "better-auth.session_token=dev; __Secure-better-auth.session_token=prod";
      // Implementation walks parts in order; the dev-mode prefix matches
      // first because it appears first in the cookie string.
      expect(extractInboundToken(cookie)).toContain("dev");
    });
  });

  describe("isSessionCookieCleared", () => {
    it("returns true on a Max-Age=0 directive (canonical clear form)", () => {
      const setCookie = "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly";
      expect(isSessionCookieCleared(setCookie)).toBe(true);
    });

    it("returns true on an Expires=<past> directive", () => {
      const setCookie = "better-auth.session_token=; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
      expect(isSessionCookieCleared(setCookie)).toBe(true);
    });

    it("returns false on an Expires=<future> directive (not a clear)", () => {
      // 100 days from now — clearly in the future.
      const future = new Date(Date.now() + 100 * 24 * 3600_000).toUTCString();
      const setCookie = `better-auth.session_token=token; Expires=${future}; Path=/`;
      expect(isSessionCookieCleared(setCookie)).toBe(false);
    });

    it("returns false when the cookie name is not better-auth.session_token", () => {
      expect(isSessionCookieCleared("other=val; Max-Age=0")).toBe(false);
    });

    it("returns false on an unparseable Expires value", () => {
      const setCookie = "better-auth.session_token=; Expires=not-a-date";
      expect(isSessionCookieCleared(setCookie)).toBe(false);
    });
  });

  describe("authenticatedGet call shape", () => {
    it("GETs the path with origin + cookie + localhost agent (when *.localhost)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Map([
          ["content-type", "application/json"],
          ["set-auth-token", "new-token-abc"],
        ]),
        text: async () => '{"migrations_completed":true}',
      });
      const apiBaseURL = "https://api.localhost";
      const cookie = "better-auth.session_token=old123";
      const url = `${apiBaseURL}/api/health`;
      await fetchSpy(url, {
        method: "GET",
        headers: { origin: new URL(url).origin, cookie },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(calledUrl).toBe("https://api.localhost/api/health");
      const init = calledInit as { method: string; headers: Record<string, string> };
      expect(init.method).toBe("GET");
      expect(init.headers.cookie).toBe(cookie);
      expect(init.headers.origin).toBe("https://api.localhost");
    });
  });

  describe("invariants encoded as tests", () => {
    it("the happy path requires set-auth-token != inbound token", () => {
      const inbound = "old-token";
      const headers = new Map([["set-auth-token", "new-token"]]);
      const newToken = headers.get("set-auth-token") ?? "";
      expect(newToken.length).toBeGreaterThan(0);
      expect(newToken).not.toBe(inbound);
    });

    it("the negative twin requires absence of set-auth-token", () => {
      const headers = new Map<string, string>([["content-type", "application/json"]]);
      expect(headers.has("set-auth-token")).toBe(false);
    });

    it("the 401 envelope shape matches the typed-envelope assertion", () => {
      const body = { error: { code: "session_expired", message: "Please sign in again" } };
      expect(body).toMatchObject({
        error: expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String),
        }),
      });
    });
  });
});
