// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 53 / Plan 53-22 — validateAuthBoot tests.
//
// Coverage matrix:
//   - production + https     → accept, useSecureCookies=true
//   - production + http      → REFUSE (MITM hole)
//   - development + http     → accept, useSecureCookies=false
//   - development + https    → accept, useSecureCookies=true
//   - test + http            → accept, useSecureCookies=false
//   - missing AUTH_URL       → REFUSE
//   - non-http/https scheme  → REFUSE
//   - missing/short secret   → REFUSE

import { describe, expect, it, vi } from "vitest";
import { validateAuthBoot } from "../../../src/config/auth.js";

const STRONG_SECRET = "a".repeat(32);

function callValidate(env: NodeJS.ProcessEnv): {
  result?: ReturnType<typeof validateAuthBoot>;
  failure?: string;
} {
  let failure: string | undefined;
  const onFail = vi.fn((message: string): never => {
    failure = message;
    throw new Error("__refuse__");
  }) as unknown as (message: string) => never;
  try {
    const result = validateAuthBoot(env, onFail);
    return { result };
  } catch {
    return { failure };
  }
}

describe("validateAuthBoot", () => {
  it("accepts production HTTPS and enables Secure cookies", () => {
    const { result } = callValidate({
      NODE_ENV: "production",
      AUTH_URL: "https://api.example.com",
      BETTER_AUTH_SECRET: STRONG_SECRET,
    });
    expect(result).toEqual({
      useSecureCookies: true,
      authUrl: "https://api.example.com",
    });
  });

  it("REFUSES production with HTTP AUTH_URL (MITM hole)", () => {
    const { result, failure } = callValidate({
      NODE_ENV: "production",
      AUTH_URL: "http://api.example.com",
      BETTER_AUTH_SECRET: STRONG_SECRET,
    });
    expect(result).toBeUndefined();
    expect(failure).toMatch(/NODE_ENV=production with non-HTTPS AUTH_URL/);
    expect(failure).toMatch(/Refusing to boot/);
  });

  it("accepts development HTTP and disables Secure cookies", () => {
    const { result } = callValidate({
      NODE_ENV: "development",
      AUTH_URL: "http://localhost:4000",
      BETTER_AUTH_SECRET: STRONG_SECRET,
    });
    expect(result).toEqual({
      useSecureCookies: false,
      authUrl: "http://localhost:4000",
    });
  });

  it("accepts development HTTPS and enables Secure cookies", () => {
    const { result } = callValidate({
      NODE_ENV: "development",
      AUTH_URL: "https://api.localhost",
      BETTER_AUTH_SECRET: STRONG_SECRET,
    });
    expect(result?.useSecureCookies).toBe(true);
  });

  it("accepts NODE_ENV=test with HTTP", () => {
    const { result } = callValidate({
      NODE_ENV: "test",
      AUTH_URL: "http://localhost:4000",
      BETTER_AUTH_SECRET: STRONG_SECRET,
    });
    expect(result?.useSecureCookies).toBe(false);
  });

  // Phase 53 / Plan 53-37 — when NODE_ENV=test, the guard is fully
  // permissive: existing buildAuth() unit tests construct the Better
  // Auth instance without populating AUTH_URL or BETTER_AUTH_SECRET,
  // and the production-boot validators must not refuse those harnesses.
  it("accepts NODE_ENV=test with empty config + safe defaults", () => {
    const { result } = callValidate({ NODE_ENV: "test" });
    expect(result).toEqual({
      useSecureCookies: false,
      authUrl: "http://localhost:4000",
    });
  });

  it("REFUSES missing AUTH_URL", () => {
    const { failure } = callValidate({
      NODE_ENV: "development",
      BETTER_AUTH_SECRET: STRONG_SECRET,
    });
    expect(failure).toMatch(/AUTH_URL is required/);
  });

  it("REFUSES non-http/https scheme", () => {
    const { failure } = callValidate({
      NODE_ENV: "development",
      AUTH_URL: "ftp://example.com",
      BETTER_AUTH_SECRET: STRONG_SECRET,
    });
    expect(failure).toMatch(/must start with http:\/\/ or https:\/\//);
  });

  it("REFUSES missing BETTER_AUTH_SECRET", () => {
    const { failure } = callValidate({
      NODE_ENV: "development",
      AUTH_URL: "http://localhost:4000",
    });
    expect(failure).toMatch(/BETTER_AUTH_SECRET must be set and >= 32 chars/);
  });

  it("REFUSES short BETTER_AUTH_SECRET", () => {
    const { failure } = callValidate({
      NODE_ENV: "development",
      AUTH_URL: "http://localhost:4000",
      BETTER_AUTH_SECRET: "short",
    });
    expect(failure).toMatch(/got 5/);
  });
});
