// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 01 / Task 1 — RED tests for the cookie-domain resolver.
// Source of truth: 02-RESEARCH-AUTH.md § Cookie Host Scoping (PITFALLS #5).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cookieDomainConfig, findSharedParentDomain } from "./cookie-domain.js";

describe("findSharedParentDomain", () => {
  it("returns the host itself for identical hosts of >=2 labels", () => {
    expect(findSharedParentDomain("api.example.com", "api.example.com")).toBe(
      "api.example.com",
    );
  });

  it("returns the eTLD+1 for siblings under a shared parent", () => {
    expect(findSharedParentDomain("auth.example.com", "api.example.com")).toBe(
      "example.com",
    );
  });

  it("returns null for unrelated hosts", () => {
    expect(findSharedParentDomain("auth.foo.com", "api.bar.com")).toBeNull();
  });

  it("rejects single-label TLDs (e.g. localhost)", () => {
    expect(findSharedParentDomain("a.localhost", "b.localhost")).toBeNull();
  });

  it("returns the deeper shared parent when both share more than 2 labels", () => {
    expect(
      findSharedParentDomain("a.svc.example.com", "b.svc.example.com"),
    ).toBe("svc.example.com");
  });
});

describe("cookieDomainConfig", () => {
  const originalAuth = process.env.AUTH_URL;
  const originalApi = process.env.OPENWHISPR_API_URL;

  beforeEach(() => {
    delete process.env.AUTH_URL;
    delete process.env.OPENWHISPR_API_URL;
  });
  afterEach(() => {
    if (originalAuth === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = originalAuth;
    if (originalApi === undefined) delete process.env.OPENWHISPR_API_URL;
    else process.env.OPENWHISPR_API_URL = originalApi;
  });

  it("returns disabled when AUTH_URL is unset", () => {
    process.env.OPENWHISPR_API_URL = "https://api.example.com";
    expect(cookieDomainConfig()).toEqual({ enabled: false });
  });

  it("returns disabled when OPENWHISPR_API_URL is unset", () => {
    process.env.AUTH_URL = "https://auth.example.com";
    expect(cookieDomainConfig()).toEqual({ enabled: false });
  });

  it("returns disabled (omit domain) for identical hosts", () => {
    process.env.AUTH_URL = "https://api.example.com";
    process.env.OPENWHISPR_API_URL = "https://api.example.com";
    expect(cookieDomainConfig()).toEqual({ enabled: false });
  });

  it("returns enabled with leading-dot eTLD+1 for cross-subdomain", () => {
    process.env.AUTH_URL = "https://auth.example.com";
    process.env.OPENWHISPR_API_URL = "https://api.example.com";
    expect(cookieDomainConfig()).toEqual({
      enabled: true,
      domain: ".example.com",
    });
  });

  it("throws an Error mentioning both hostnames for unrelated hosts", () => {
    process.env.AUTH_URL = "https://auth.foo.com";
    process.env.OPENWHISPR_API_URL = "https://api.bar.com";
    expect(() => cookieDomainConfig()).toThrow(/auth\.foo\.com/);
    expect(() => cookieDomainConfig()).toThrow(/api\.bar\.com/);
  });
});
