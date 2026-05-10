// Phase 02.18 — TDD-RED test for D-01.
//
// Asserts that buildAuth() configures `advanced.ipAddress.ipAddressHeaders`
// to `["x-forwarded-for"]` so Better Auth's own rate-limiter can identify
// the real client IP behind Traefik.
//
// Source-of-record: 02.18-CONTEXT.md § D-01 (locked decision: configure
// advanced.ipAddress.ipAddressHeaders so Better Auth's getRequestIp uses
// the X-Forwarded-For header set by Traefik).
//
// Reverse-patch evidence: removing the `ipAddress: { ipAddressHeaders: [...] }`
// sub-block from `apps/api/src/auth.ts` returns this test to RED with
// `expected undefined to deeply equal [ "x-forwarded-for" ]`.
//
// Production-safety context (D-04): This is NOT a header-spoofing risk
// because Traefik should strip client-supplied X-Forwarded-For at the
// public edge. See 02.18-SUMMARY.md for the production-safety verification.

import { describe, expect, it, vi } from "vitest";

const captured: { cfg: Record<string, unknown> } = { cfg: {} };

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: () => ({ id: "stub-adapter" }),
}));
vi.mock("better-auth", () => ({
  betterAuth: (cfg: Record<string, unknown>) => {
    captured.cfg = cfg;
    return { options: cfg, _cfg: cfg };
  },
}));
vi.mock("better-auth/plugins/bearer", () => ({ bearer: () => ({ id: "bearer" }) }));
vi.mock("better-auth/plugins/generic-oauth", () => ({
  genericOAuth: () => ({ id: "generic-oauth" }),
}));
vi.mock("../email.js", () => ({
  makeEmailService: () => ({ send: async () => {} }),
}));

const { buildAuth } = await import("../auth.js");

describe("buildAuth advanced.ipAddress.ipAddressHeaders (Phase 02.18 / D-01)", () => {
  it("configures ipAddressHeaders=['x-forwarded-for'] so Better Auth's rate-limiter sees the real client IP behind Traefik", () => {
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-long-xxxxxxxxx";
    buildAuth({
      db: {} as never,
      email: { send: async () => {} } as never,
    });
    const advanced = (captured.cfg as { advanced?: { ipAddress?: { ipAddressHeaders?: unknown } } })
      ?.advanced;
    expect(advanced).toBeDefined();
    expect(advanced?.ipAddress).toBeDefined();
    expect(advanced?.ipAddress?.ipAddressHeaders).toEqual(["x-forwarded-for"]);
  });
});
