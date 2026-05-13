// SPDX-License-Identifier: Apache-2.0
// Phase 10 / Plan 10-01c — RED→GREEN coverage for:
//   1. additionalFields.locale on the Better Auth `user` model (sign-up
//      accepts a `locale` input, get-session round-trips it, defaultValue
//      is 'en' when omitted).
//   2. Optional `enqueueEmail` DI on BuildAuthOptions. When provided, the
//      sendVerificationEmail Better-Auth hook routes through the BullMQ
//      email-delivery queue (template_id="email_verification") instead of
//      calling email.send inline. When omitted, the legacy inline path is
//      preserved for backward-compat with the 8 existing buildAuth call
//      sites that don't pass enqueueEmail.
//
// Mocks are scoped to the process boundary (betterAuth + drizzleAdapter +
// the EmailService transport) so internal logic is exercised end-to-end.

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
vi.mock("../email.js", () => ({
  makeEmailService: () => ({ send: async () => {} }),
}));

const { buildAuth } = await import("../auth.js");

import type { EmailService } from "../email.js";

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
      locale?: {
        type?: unknown;
        required?: boolean;
        defaultValue?: unknown;
        input?: boolean;
      };
    };
  };
}

interface AuthOptionsRuntime {
  user?: UserModelCfg["user"];
  emailAndPassword?: {
    sendVerificationEmail?: (args: {
      user: { email: string; locale?: string };
      url: string;
    }) => Promise<void>;
  };
}

describe("buildAuth — additionalFields.locale (Better Auth user model)", () => {
  it("declares user.additionalFields.locale with string type, default 'en', input:true", () => {
    buildAuth({ db: stubDb, email: { send: async () => {} } as never });
    const cfg = captured.cfg as UserModelCfg;
    const locale = cfg.user?.additionalFields?.locale;
    expect(locale).toBeDefined();
    expect(locale?.type).toBe("string");
    expect(locale?.defaultValue).toBe("en");
    expect(locale?.input).toBe(true);
    // Not required so legacy sign-ups without an Accept-Language header
    // continue to succeed using the column default ('en').
    expect(locale?.required === false || locale?.required === undefined).toBe(true);
  });
});

describe("buildAuth — sendVerificationEmail enqueueEmail DI path", () => {
  it("when opts.enqueueEmail is provided, the hook enqueues a typed payload (template_id='email_verification')", async () => {
    const enqueued: Array<{
      tenant_id: string;
      to: string;
      template_id: string;
      locale: string;
      variables: Record<string, unknown>;
      request_id: string;
    }> = [];
    const enqueueEmail = async (payload: {
      tenant_id: string;
      to: string;
      template_id: string;
      locale: string;
      variables: Record<string, unknown>;
      request_id: string;
    }): Promise<void> => {
      enqueued.push(payload);
    };
    // Inline SMTP transport must NOT be called when enqueueEmail is wired.
    const inlineSends: unknown[] = [];
    const email: EmailService = {
      async send(msg) {
        inlineSends.push(msg);
        return { delivered: true };
      },
    };
    const auth = buildAuth({ db: stubDb, email, enqueueEmail });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const send = opts.emailAndPassword?.sendVerificationEmail;
    expect(typeof send).toBe("function");
    await send?.({
      user: {
        email: "ru@user.test",
        // simulate Better Auth populating `user.locale` from the additionalField
        locale: "ru",
        // and pass a tenant_id forwarded by the Drizzle adapter row
        // (Better Auth includes additionalFields in the user object given to hooks).
        ...({ tenantId: "00000000-0000-0000-0000-000000000123" } as unknown as object),
      } as never,
      url: "https://api.localhost/api/auth/verify?token=abc",
    });
    expect(enqueued).toHaveLength(1);
    expect(inlineSends).toHaveLength(0);
    const payload = enqueued[0]!;
    expect(payload.template_id).toBe("email_verification");
    expect(payload.locale).toBe("ru");
    expect(payload.to).toBe("ru@user.test");
    expect(payload.variables).toEqual({ url: "https://api.localhost/api/auth/verify?token=abc" });
    // request_id is a fresh UUID
    expect(payload.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // tenant_id is a UUID string (zero or the user-provided value)
    expect(typeof payload.tenant_id).toBe("string");
  });

  it("falls back to user.locale='en' when the Better Auth hook payload omits locale", async () => {
    const enqueued: Array<{ locale: string }> = [];
    const enqueueEmail = async (payload: { locale: string }): Promise<void> => {
      enqueued.push(payload as never);
    };
    const auth = buildAuth({
      db: stubDb,
      email: { send: async () => {} } as never,
      enqueueEmail: enqueueEmail as never,
    });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const send = opts.emailAndPassword?.sendVerificationEmail;
    await send?.({
      user: { email: "no-locale@user.test" } as never,
      url: "https://x.test/y",
    });
    expect(enqueued[0]?.locale).toBe("en");
  });

  it("without opts.enqueueEmail, the inline email.send path is preserved (backward compat)", async () => {
    const sent: Array<{ to: string; subject: string }> = [];
    const email: EmailService = {
      async send(msg) {
        sent.push({ to: msg.to, subject: msg.subject });
        return { delivered: true };
      },
    };
    const auth = buildAuth({ db: stubDb, email });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const send = opts.emailAndPassword?.sendVerificationEmail;
    await send?.({
      user: { email: "legacy@user.test" } as never,
      url: "https://api.localhost/verify?t=x",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("legacy@user.test");
  });

  it("propagates enqueueEmail errors (does not swallow queue-add failures)", async () => {
    const enqueueEmail = async (): Promise<void> => {
      throw new Error("REDIS_DOWN");
    };
    const auth = buildAuth({
      db: stubDb,
      email: { send: async () => {} } as never,
      enqueueEmail,
    });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const send = opts.emailAndPassword?.sendVerificationEmail;
    await expect(
      send?.({ user: { email: "x@y.test" } as never, url: "https://x/y" }),
    ).rejects.toThrow(/REDIS_DOWN/);
  });
});
