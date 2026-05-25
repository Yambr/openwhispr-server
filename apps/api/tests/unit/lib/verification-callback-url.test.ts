// SPDX-License-Identifier: FSL-1.1-ALv2
// R22 — `rewriteVerificationCallbackUrl` unit tests.
//
// Better Auth builds the verification link as
//   `${baseURL}/verify-email?token=<jwt>&callbackURL=<encoded "/">`
// (the slim desktop client sends no `callbackURL` at sign-up). R22's
// `sendVerificationEmail` hook rewrites that `callbackURL` query param
// to the server-fixed verify-email-complete route so the post-verify
// 302 lands there. These tests pin that rewrite.

import { describe, expect, it } from "vitest";
import {
  rewriteVerificationCallbackUrl,
  VERIFY_EMAIL_COMPLETE_PATH,
} from "../../../src/lib/verification-callback-url.js";

const BASE = "https://api.openwhispr.example";

describe("rewriteVerificationCallbackUrl", () => {
  it("replaces the default callbackURL ('/') with the verify-email-complete route", () => {
    const original = `${BASE}/verify-email?token=jwt-abc&callbackURL=%2F`;
    const rewritten = rewriteVerificationCallbackUrl(original);
    const url = new URL(rewritten);
    expect(url.searchParams.get("callbackURL")).toBe(VERIFY_EMAIL_COMPLETE_PATH);
    // Token is preserved verbatim.
    expect(url.searchParams.get("token")).toBe("jwt-abc");
    // Origin + path of the verify-email endpoint are untouched.
    expect(url.origin).toBe(BASE);
    expect(url.pathname).toBe("/verify-email");
  });

  it("overrides any pre-existing callbackURL — the rewrite is total, not appended", () => {
    const original = `${BASE}/verify-email?token=jwt&callbackURL=${encodeURIComponent(
      "https://attacker.example/phish",
    )}`;
    const rewritten = rewriteVerificationCallbackUrl(original);
    const url = new URL(rewritten);
    expect(url.searchParams.get("callbackURL")).toBe(VERIFY_EMAIL_COMPLETE_PATH);
    expect(rewritten).not.toContain("attacker.example");
  });

  it("adds a callbackURL when the link carries none", () => {
    const original = `${BASE}/verify-email?token=only-token`;
    const url = new URL(rewriteVerificationCallbackUrl(original));
    expect(url.searchParams.get("callbackURL")).toBe(VERIFY_EMAIL_COMPLETE_PATH);
    expect(url.searchParams.get("token")).toBe("only-token");
  });

  it("the rewritten callbackURL is a relative path (Better Auth's originCheck admits it)", () => {
    const rewritten = rewriteVerificationCallbackUrl(`${BASE}/verify-email?token=t`);
    const cb = new URL(rewritten).searchParams.get("callbackURL");
    expect(cb?.startsWith("/")).toBe(true);
    // Better Auth's relative-path origin check regex:
    // /^\/(?!\/|\\|%2f|%5c)[\w\-.\+/@]*(?:\?...)?$/
    expect(cb).toMatch(/^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*$/);
  });

  it("returns a malformed input unchanged rather than throwing", () => {
    // Defensive — Better Auth always passes an absolute URL, but the
    // hook must never throw (that would leave the account unverifiable).
    expect(rewriteVerificationCallbackUrl("not a url")).toBe("not a url");
    expect(rewriteVerificationCallbackUrl("")).toBe("");
  });

  it("VERIFY_EMAIL_COMPLETE_PATH is the canonical verify-email-complete route path", () => {
    expect(VERIFY_EMAIL_COMPLETE_PATH).toBe("/api/auth/verify-email-complete");
  });

  // F8 — preserve original callbackURL as `?origin=` state-param so the
  // verify-email-complete route can branch on desktop (loopback bridge)
  // vs web (relative same-origin path) flow.
  describe("F8 — origin preservation for web-flow detection", () => {
    it("preserves a relative non-default callbackURL as &origin= query param", () => {
      const original = `${BASE}/verify-email?token=jwt&callbackURL=${encodeURIComponent(
        "/sign-in?verified=1",
      )}`;
      const rewritten = rewriteVerificationCallbackUrl(original);
      const url = new URL(rewritten);
      // The primary callbackURL still points at the server-controlled
      // verify-email-complete route (Better Auth originCheck admits it).
      expect(url.searchParams.get("callbackURL")).toBe(VERIFY_EMAIL_COMPLETE_PATH);
      // But the original web destination is preserved in `origin` so the
      // route handler can route the post-verify 302 back to the web app.
      expect(url.searchParams.get("origin")).toBe("/sign-in?verified=1");
    });

    it("does not add &origin= when callbackURL is the Better Auth default '/'", () => {
      const original = `${BASE}/verify-email?token=jwt&callbackURL=%2F`;
      const url = new URL(rewriteVerificationCallbackUrl(original));
      // Default `/` means desktop sign-up (no client-supplied callback) —
      // omitting origin preserves R22 desktop-bridge backward-compat.
      expect(url.searchParams.get("origin")).toBeNull();
    });

    it("does not add &origin= when callbackURL is absent", () => {
      const original = `${BASE}/verify-email?token=only-token`;
      const url = new URL(rewriteVerificationCallbackUrl(original));
      expect(url.searchParams.get("origin")).toBeNull();
    });

    it("URL-encodes origin to survive nested query strings", () => {
      // Web app may send a callbackURL carrying its own query params; the
      // round-trip through &origin= must not lose them.
      const inner = "/sign-in?verified=1&redirect=%2Fapp";
      const original = `${BASE}/verify-email?token=jwt&callbackURL=${encodeURIComponent(inner)}`;
      const url = new URL(rewriteVerificationCallbackUrl(original));
      // URL constructor decodes a single layer of percent-encoding on
      // searchParams.get — round-trip must recover the inner value exactly.
      expect(url.searchParams.get("origin")).toBe(inner);
    });

    it("does not echo an absolute-URL callbackURL into origin (Better Auth strips those, but be defensive)", () => {
      // Better Auth's originCheck strips/rejects absolute-URL callbackURLs
      // unless they match the trusted-origins allow-list — so by the time
      // the link reaches sendVerificationEmail, callbackURL should already
      // be either relative or the trusted origin. Belt-and-suspenders:
      // only relative paths get echoed to origin; absolute URLs are dropped
      // so the verify-email-complete route never receives an absolute
      // origin it would have to reject.
      const original = `${BASE}/verify-email?token=jwt&callbackURL=${encodeURIComponent(
        "https://attacker.example/phish",
      )}`;
      const url = new URL(rewriteVerificationCallbackUrl(original));
      // Absolute URLs are NOT echoed — only relative paths are.
      expect(url.searchParams.get("origin")).toBeNull();
      // Primary rewrite is unchanged.
      expect(url.searchParams.get("callbackURL")).toBe(VERIFY_EMAIL_COMPLETE_PATH);
    });

    it("does not echo a protocol-relative `//host` callbackURL into origin", () => {
      // `//attacker.example/path` is technically relative-looking but
      // resolves to a foreign origin in browsers. Treat as absolute and
      // drop.
      const original = `${BASE}/verify-email?token=jwt&callbackURL=${encodeURIComponent(
        "//attacker.example/path",
      )}`;
      const url = new URL(rewriteVerificationCallbackUrl(original));
      expect(url.searchParams.get("origin")).toBeNull();
    });
  });
});
