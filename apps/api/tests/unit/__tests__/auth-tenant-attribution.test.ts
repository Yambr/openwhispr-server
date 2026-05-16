// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41.a / Task 1 — RED unit coverage for HIGH-FIX-API-CORE HI-03.
//
// `.planning/review/api-core.md` HI-03 flags that apps/api/src/auth.ts:330
// (sendResetPassword) and apps/api/src/auth.ts:380 (sendVerificationEmail)
// duplicate the literal `"00000000-0000-0000-0000-000000000000"` fallback
// instead of routing through the centralised `resolveDefaultTenantId()`
// helper at apps/api/src/lib/default-tenant.ts. The literal duplication is
// a code-hygiene HIGH because:
//   - any future swap of the helper to a real DB lookup (the helper's
//     header comment explicitly invites this evolution) will silently
//     bypass these two hooks;
//   - the audit-log attribution for password-reset / verification emails
//     drifts from every other tenant-fallback site (dual-auth.ts:164,
//     require-cookie-only.ts:40, auth-callback.ts:152, etc. — all call
//     the helper).
//
// These tests fail on `main @ 906dadd` because the two hooks read the
// literal UUID. They pass when both sites are rewritten to
// `await resolveDefaultTenantId()`.
//
// Mock surface mirrors auth-send-reset-password.test.ts (process-boundary
// only). The `default-tenant` module is mocked so the helper return value
// is observably distinct from the legacy literal — the GREEN assertion
// then proves the source is the helper, not the literal.

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

// The HELPER mock — return a sentinel UUID that differs from the legacy
// literal. If auth.ts:330/380 still hard-code the literal, the captured
// tenant_id will NOT match this sentinel and the test fails.
const SENTINEL_TENANT_UUID = "11111111-2222-3333-4444-555555555555";
vi.mock("../../../src/lib/default-tenant", () => ({
  resolveDefaultTenantId: vi.fn(async () => SENTINEL_TENANT_UUID),
  _resetDefaultTenantCacheForTesting: vi.fn(),
}));

const { buildAuth } = await import("../../../src/auth");

import type { EmailSender as EmailService } from "@openwhispr/email";

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

interface EnqueuePayload {
  tenant_id: string;
  to: string;
  template_id: string;
  locale: string;
  variables: Record<string, unknown>;
  request_id: string;
}

interface AuthOptionsRuntime {
  emailAndPassword?: {
    sendResetPassword?: (
      args: {
        user: { email: string; locale?: string; tenantId?: string; name?: string };
        url: string;
        token: string;
      },
      request?: unknown,
    ) => Promise<void>;
  };
  emailVerification?: {
    sendVerificationEmail?: (
      args: {
        user: { email: string; locale?: string; tenantId?: string };
        url: string;
      },
      request?: unknown,
    ) => Promise<void>;
  };
}

function makeEnqueueCapture(): {
  calls: EnqueuePayload[];
  fn: (payload: EnqueuePayload) => Promise<void>;
} {
  const calls: EnqueuePayload[] = [];
  const fn = async (payload: EnqueuePayload): Promise<void> => {
    calls.push(payload);
  };
  return { calls, fn };
}

const stubEmail: EmailService = {
  async send() {
    return { delivered: true };
  },
};

describe("Phase 41.a / HI-03 — sendResetPassword uses resolveDefaultTenantId fallback", () => {
  it("enqueues with the helper-resolved tenant when user.tenantId is undefined", async () => {
    const { calls, fn: enqueueEmail } = makeEnqueueCapture();
    const auth = buildAuth({ db: stubDb, email: stubEmail, enqueueEmail });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    await opts.emailAndPassword?.sendResetPassword?.(
      {
        user: { email: "noTenant@user.test", name: "User" },
        url: "https://api.localhost/api/auth/reset?token=x",
        token: "x",
      },
      undefined,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tenant_id).toBe(SENTINEL_TENANT_UUID);
  });

  it("forwards user.tenantId verbatim when provided (no helper call)", async () => {
    const { calls, fn: enqueueEmail } = makeEnqueueCapture();
    const auth = buildAuth({ db: stubDb, email: stubEmail, enqueueEmail });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const concreteTenant = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    await opts.emailAndPassword?.sendResetPassword?.(
      {
        user: {
          email: "withTenant@user.test",
          tenantId: concreteTenant,
        },
        url: "https://x/y",
        token: "t",
      },
      undefined,
    );
    expect(calls[0]?.tenant_id).toBe(concreteTenant);
  });
});

describe("Phase 41.a / HI-03 — sendVerificationEmail uses resolveDefaultTenantId fallback", () => {
  it("enqueues with the helper-resolved tenant when user.tenantId is undefined", async () => {
    const { calls, fn: enqueueEmail } = makeEnqueueCapture();
    const auth = buildAuth({ db: stubDb, email: stubEmail, enqueueEmail });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    await opts.emailVerification?.sendVerificationEmail?.(
      {
        user: { email: "verify@user.test" },
        url: "https://api.localhost/api/auth/verify?token=x",
      },
      undefined,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tenant_id).toBe(SENTINEL_TENANT_UUID);
  });

  it("forwards user.tenantId verbatim when provided (no helper call)", async () => {
    const { calls, fn: enqueueEmail } = makeEnqueueCapture();
    const auth = buildAuth({ db: stubDb, email: stubEmail, enqueueEmail });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const concreteTenant = "ffffffff-0000-1111-2222-333333333333";
    await opts.emailVerification?.sendVerificationEmail?.(
      {
        user: { email: "verify-tenant@user.test", tenantId: concreteTenant },
        url: "https://x/y",
      },
      undefined,
    );
    expect(calls[0]?.tenant_id).toBe(concreteTenant);
  });
});
