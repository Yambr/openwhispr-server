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
});
