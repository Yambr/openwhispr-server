// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 57 / Track E — api-routes-rest:CR-01 regression.
//
// validateIngressBoot() refuses to start (exit 78 EX_CONFIG, matching
// validateEncryptionBoot / validateAuthBoot) when BOTH INGRESS_BASE_URL
// (preferred) and AUTH_URL are unset. Without this gate
// better-auth-handler.ts:buildRequestUrl falls back to the
// attacker-controlled `req.headers.host` header, letting a forged
// `Host:` bypass Better Auth's CSRF / Origin / redirect-uri validation.

import { describe, expect, it, vi } from "vitest";
import { validateIngressBoot } from "../../src/config/auth.js";

function callValidate(env: NodeJS.ProcessEnv): {
  result?: ReturnType<typeof validateIngressBoot>;
  failure?: string;
} {
  let failure: string | undefined;
  const onFail = vi.fn((message: string): never => {
    failure = message;
    throw new Error("__refuse__");
  }) as unknown as (message: string) => never;
  try {
    const result = validateIngressBoot(env, onFail);
    return { result };
  } catch {
    return { failure };
  }
}

describe("validateIngressBoot", () => {
  it("api-routes-rest:CR-01 — boot exits 78 when both INGRESS_BASE_URL and AUTH_URL unset", () => {
    const { result, failure } = callValidate({ NODE_ENV: "development" });
    expect(result).toBeUndefined();
    expect(failure).toMatch(/INGRESS_BASE_URL/);
    expect(failure).toMatch(/AUTH_URL/);
  });

  it("returns INGRESS_BASE_URL when only it is set", () => {
    const { result } = callValidate({
      NODE_ENV: "development",
      INGRESS_BASE_URL: "https://example.com",
    });
    expect(result).toEqual({ ingressBaseUrl: "https://example.com" });
  });

  it("returns AUTH_URL when only it is set (INGRESS unset)", () => {
    const { result } = callValidate({
      NODE_ENV: "development",
      AUTH_URL: "https://auth.example.com",
    });
    expect(result).toEqual({ ingressBaseUrl: "https://auth.example.com" });
  });

  it("INGRESS_BASE_URL wins when both are set", () => {
    const { result } = callValidate({
      NODE_ENV: "development",
      INGRESS_BASE_URL: "https://ingress.example.com",
      AUTH_URL: "https://auth.example.com",
    });
    expect(result).toEqual({ ingressBaseUrl: "https://ingress.example.com" });
  });

  it("trims surrounding whitespace from the resolved value", () => {
    const { result } = callValidate({
      NODE_ENV: "development",
      INGRESS_BASE_URL: "  https://example.com  ",
    });
    expect(result).toEqual({ ingressBaseUrl: "https://example.com" });
  });

  it("REFUSES non-HTTPS origin under NODE_ENV=production", () => {
    const { result, failure } = callValidate({
      NODE_ENV: "production",
      INGRESS_BASE_URL: "http://example.com",
    });
    expect(result).toBeUndefined();
    expect(failure).toMatch(/HTTPS/);
  });
});
