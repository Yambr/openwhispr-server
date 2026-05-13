// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 02.4 / G5b — AUTH_TRUSTED_ORIGINS_EXTRA env parsing.
 *
 * Source-of-record commit: 5f274e6
 *
 * Reverts: this test goes RED if the parsing collapses back to either:
 *   1. Direct env push without split/trim/filter →
 *      "comma list" assertion fails (single string with commas in it instead of array of 3).
 *   2. No filter on length>0 →
 *      "empty AUTH_TRUSTED_ORIGINS_EXTRA produces no empty entries" assertion fails
 *      (would see [..., ""] in trustedOrigins).
 *   3. No trim →
 *      "whitespace trimmed" assertion fails (would see "  http://a " instead of "http://a").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { betterAuthSpy } = vi.hoisted(() => ({
  betterAuthSpy: vi.fn(() => ({
    options: { plugins: [] },
    handler: async () => new Response("{}"),
    api: {},
  })),
}));

vi.mock("better-auth", () => ({ betterAuth: betterAuthSpy }));
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: () => ({ id: "stub-adapter" }),
}));
vi.mock("better-auth/plugins/bearer", () => ({ bearer: () => ({ id: "bearer" }) }));
vi.mock("better-auth/plugins/generic-oauth", () => ({
  genericOAuth: () => ({ id: "generic-oauth" }),
}));
vi.mock("../email.js", () => ({
  makeEmailService: () => ({ send: async () => {} }),
}));

import { buildAuth } from "../auth.js";

const stubDb = {} as never;

function lastTrustedOrigins(): string[] {
  expect(betterAuthSpy).toHaveBeenCalled();
  const callArg = betterAuthSpy.mock.calls.at(-1)![0] as unknown as {
    trustedOrigins: string[];
  };
  return callArg.trustedOrigins;
}

describe("Phase 02.4 G5b — AUTH_TRUSTED_ORIGINS_EXTRA parsing", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    betterAuthSpy.mockClear();
    process.env = { ...originalEnv };
    process.env.OPENWHISPR_API_URL = "https://api.localhost";
    process.env.AUTH_URL = "https://api.localhost";
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-long-xxxxxxxxx";
    delete process.env.AUTH_TRUSTED_ORIGINS_EXTRA;
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("unset AUTH_TRUSTED_ORIGINS_EXTRA → only known origins, no empty entries", () => {
    buildAuth({ db: stubDb });
    const origins = lastTrustedOrigins();
    expect(origins).toEqual(["https://api.localhost", "https://api.localhost"]);
    expect(origins).not.toContain("");
  });

  it("empty AUTH_TRUSTED_ORIGINS_EXTRA= → no extras, no empty entries", () => {
    process.env.AUTH_TRUSTED_ORIGINS_EXTRA = "";
    buildAuth({ db: stubDb });
    const origins = lastTrustedOrigins();
    expect(origins).not.toContain("");
    expect(origins.filter((o) => o.startsWith("http"))).toHaveLength(2);
  });

  it("single AUTH_TRUSTED_ORIGINS_EXTRA value is added", () => {
    process.env.AUTH_TRUSTED_ORIGINS_EXTRA = "http://api:3000";
    buildAuth({ db: stubDb });
    expect(lastTrustedOrigins()).toContain("http://api:3000");
  });

  it("comma-separated list adds every entry", () => {
    process.env.AUTH_TRUSTED_ORIGINS_EXTRA = "http://a,http://b,http://c";
    buildAuth({ db: stubDb });
    const origins = lastTrustedOrigins();
    expect(origins).toEqual(expect.arrayContaining(["http://a", "http://b", "http://c"]));
  });

  it("whitespace around entries is trimmed", () => {
    process.env.AUTH_TRUSTED_ORIGINS_EXTRA = "  http://a , http://b  ";
    buildAuth({ db: stubDb });
    const origins = lastTrustedOrigins();
    expect(origins).toContain("http://a");
    expect(origins).toContain("http://b");
    expect(origins).not.toContain("  http://a ");
  });

  it("commas with empty fields produce no empty entries", () => {
    process.env.AUTH_TRUSTED_ORIGINS_EXTRA = ",,,";
    buildAuth({ db: stubDb });
    const origins = lastTrustedOrigins();
    expect(origins).not.toContain("");
  });

  it("OPENWHISPR_API_URL unset is filtered from origins (no undefined leak)", () => {
    delete process.env.OPENWHISPR_API_URL;
    buildAuth({ db: stubDb });
    const origins = lastTrustedOrigins();
    expect(origins.every((o) => typeof o === "string" && o.length > 0)).toBe(true);
    expect(origins).toContain("https://api.localhost"); // AUTH_URL still present
  });
});
