// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-01 / Task 5 — role-escalation regression test.
//
// Threat T-12.01-01 (STRIDE: E — Elevation of Privilege): a public client
// POSTs `/api/auth/sign-up/email` with `{ role: 'admin' }` in the body. If
// the Better Auth `additionalFields.role` accepts client input (input:true
// or missing/default), the user is created with `role='admin'` — bypassing
// the wizard claim flow and giving an unauthenticated attacker an admin
// account.
//
// Mitigation: declare `role: { type: "string", required: false,
//   defaultValue: null, input: false }` in `apps/api/src/auth.ts`'s
// `user.additionalFields` block. Better Auth's documented contract for
// `input: false` (RESEARCH §15(e), §2 lines 218-278) is that the field is
// NEVER read from the request body — only set internally by server code
// (e.g., the wizard claim handler in Plan 12-03).
//
// This test asserts the configuration shape (the actual Better-Auth-side
// gate), not the full HTTP flow. The same cfg-capture pattern is used by
// auth-locale-and-enqueue.test.ts for the `locale` additionalField; the
// CLAUDE.md "no internal mocks" rule explicitly allows mocking at the
// process boundary (`better-auth`, `better-auth/adapters/drizzle`, etc.),
// which is what this pattern does. End-to-end coverage of the actual
// HTTP sign-up surface is exercised by Plan 12-03's wizard claim
// integration test once the route lands.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captured: { cfg: Record<string, unknown> } = { cfg: {} };

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: () => ({ id: "stub-adapter" }),
}));
vi.mock("better-auth", () => ({
  betterAuth: (cfg: Record<string, unknown>) => {
    captured.cfg = cfg;
    return { options: cfg };
  },
}));
vi.mock("better-auth/plugins/bearer", () => ({ bearer: () => ({ id: "bearer" }) }));
vi.mock("better-auth/plugins/generic-oauth", () => ({
  genericOAuth: () => ({ id: "generic-oauth" }),
}));
vi.mock("@openwhispr/email", () => ({
  createEmailSender: () => ({ send: async () => {} }),
}));

const { buildAuth } = await import("../auth.js");

const stubDb = {} as unknown as Parameters<typeof buildAuth>[0]["db"];

const ORIGINAL_SECRET = process.env.BETTER_AUTH_SECRET;

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET =
    "0000000000000000000000000000000000000000000000000000000000000000";
  delete process.env.OIDC_ISSUER_URL;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
  captured.cfg = {};
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = ORIGINAL_SECRET;
});

interface UserModelCfg {
  user?: {
    additionalFields?: {
      role?: {
        type?: unknown;
        required?: boolean;
        defaultValue?: unknown;
        input?: boolean;
      };
      locale?: {
        type?: unknown;
        required?: boolean;
        defaultValue?: unknown;
        input?: boolean;
      };
    };
  };
}

describe("buildAuth — additionalFields.role (T-12.01-01 mitigation)", () => {
  it("declares user.additionalFields.role with input: false (blocks public sign-up escalation)", () => {
    buildAuth({ db: stubDb, email: { send: async () => {} } as never });
    const cfg = captured.cfg as UserModelCfg;
    const role = cfg.user?.additionalFields?.role;
    expect(role).toBeDefined();
    // The critical gate: input MUST be exactly false. Anything else (true,
    // undefined, "false" string) lets the body field through Better Auth's
    // additionalFields plumbing into the row.
    expect(role?.input).toBe(false);
    expect(role?.type).toBe("string");
    // Default must be null — NOT the string "admin" or "user" — so a
    // sign-up request that does NOT include `role` lands with users.role IS NULL.
    expect(role?.defaultValue ?? null).toBeNull();
    // Not required — the wizard claim handler (Plan 12-03) writes the value
    // post-sign-up; the column is nullable in the DB (migration 0017).
    expect(role?.required === false || role?.required === undefined).toBe(true);
  });

  it("does NOT regress the locale additionalField (input:true preserved for Plan 10-01c)", () => {
    buildAuth({ db: stubDb, email: { send: async () => {} } as never });
    const cfg = captured.cfg as UserModelCfg;
    const locale = cfg.user?.additionalFields?.locale;
    // Co-existence check: adding `role` to additionalFields must not delete
    // or weaken the existing `locale` entry. This guards against an editor
    // mistake that replaces the whole additionalFields object instead of
    // adding a sibling key.
    expect(locale).toBeDefined();
    expect(locale?.input).toBe(true);
    expect(locale?.defaultValue).toBe("en");
  });
});
