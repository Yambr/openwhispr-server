// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 59 / Track C — R18: sign-in/email Origin gate.
 *
 * A non-browser client (undici `fetch`) sends no `Origin` header on a
 * server-side request. Better Auth's `validateOrigin` middleware throws
 * `403 MISSING_OR_NULL_ORIGIN` BEFORE `trustedOrigins` is consulted, so a
 * `trustedOrigins` predicate cannot rescue a missing/null Origin. The
 * supported, type-clean escape hatch is `advanced.disableOriginCheck`,
 * which `validateOrigin` honours via `shouldSkipOriginCheck`.
 *
 * R18 fix: relax the Origin check ONLY when `OPENWHISPR_TEST_ROUTES`
 * is `"true"` AND the runtime mode is non-production — the SAME
 * double-gate R1/R13 use for seed-tenant. Production never relaxes.
 *
 * Reverts: this test goes RED if `disableOriginCheck` stops being
 * gated on the test-routes double-gate.
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

import { buildAuth } from "../../../src/auth.js";

const stubDb = {} as never;
const stubEmail = { send: async () => {} } as never;

function lastAdvanced(): { disableOriginCheck?: unknown } {
  expect(betterAuthSpy).toHaveBeenCalled();
  const callArg = betterAuthSpy.mock.calls.at(-1)?.[0] as unknown as {
    advanced: { disableOriginCheck?: unknown };
  };
  return callArg.advanced;
}

describe("Phase 59 R18 — null-Origin relaxation for sign-in/email", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    betterAuthSpy.mockClear();
    process.env = { ...originalEnv };
    process.env.OPENWHISPR_API_URL = "https://api.localhost";
    process.env.AUTH_URL = "https://api.localhost";
    process.env.INGRESS_BASE_URL = "https://api.localhost";
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-long-xxxxxxxxx";
    delete process.env.OPENWHISPR_TEST_ROUTES;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("test-routes ON + non-production → disableOriginCheck is true", () => {
    process.env.OPENWHISPR_TEST_ROUTES = "true";
    process.env.NODE_ENV = "development";
    buildAuth({ db: stubDb, email: stubEmail });
    const { disableOriginCheck } = lastAdvanced();
    expect(disableOriginCheck).toBe(true);
  });

  it("test-routes OFF → no Origin relaxation (disableOriginCheck absent)", () => {
    delete process.env.OPENWHISPR_TEST_ROUTES;
    process.env.NODE_ENV = "development";
    buildAuth({ db: stubDb, email: stubEmail });
    const { disableOriginCheck } = lastAdvanced();
    expect(disableOriginCheck).toBeUndefined();
  });

  it("production never relaxes even with test-routes ON", () => {
    process.env.OPENWHISPR_TEST_ROUTES = "true";
    process.env.NODE_ENV = "production";
    buildAuth({ db: stubDb, email: stubEmail });
    const { disableOriginCheck } = lastAdvanced();
    expect(disableOriginCheck).toBeUndefined();
  });

  it("never uses the wildcard trustedOrigins escape", () => {
    process.env.OPENWHISPR_TEST_ROUTES = "true";
    process.env.NODE_ENV = "development";
    buildAuth({ db: stubDb, email: stubEmail });
    const callArg = betterAuthSpy.mock.calls.at(-1)?.[0] as unknown as {
      trustedOrigins: string[];
    };
    expect(callArg.trustedOrigins).not.toContain("*");
  });
});
