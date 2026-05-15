// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 19.1 / Plan 01 / Task 1 — RED unit coverage for `sendResetPassword`
// hook routing.
//
// Source-of-truth pins (D-01 / D-06):
//   - Better Auth 1.6.9 vendored at
//     node_modules/.pnpm/better-auth@1.6.9_*/node_modules/better-auth/dist/api/routes/password.mjs
//     line 42 reads `ctx.context.options.emailAndPassword?.sendResetPassword`.
//     The hook therefore MUST live under `emailAndPassword.sendResetPassword`,
//     NOT under `emailVerification` and NOT at the top level.
//   - D-02 / D-03: `variables` payload must contain `{ name, reset_url, url,
//     expires_minutes: 60 }` — `url` is a defensive alias mirror of the
//     `verification_url`/`url` precedent at apps/api/src/auth.ts:319 region.
//   - Locale + tenant_id resolution mirrors the existing `sendVerificationEmail`
//     prior-art (apps/api/src/auth.ts:318-351).
//
// Mocks are scoped to the process boundary (better-auth +
// better-auth/adapters/drizzle + @openwhispr/email) so internal hook logic
// is exercised end-to-end. Pattern lifted verbatim from
// auth-locale-and-enqueue.test.ts.

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

interface AuthOptionsRuntime {
  emailAndPassword?: {
    enabled?: boolean;
    sendResetPassword?: (
      args: {
        user: {
          id?: string;
          email: string;
          name?: string;
          locale?: string;
          tenantId?: string;
        };
        url: string;
        token: string;
      },
      request?: unknown,
    ) => Promise<void>;
  };
}

interface EnqueuePayload {
  tenant_id: string;
  to: string;
  template_id: string;
  locale: string;
  variables: Record<string, unknown>;
  request_id: string;
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

function makeEmailCapture(): {
  sent: Array<{ to: string; subject: string; text: string; html: string }>;
  email: EmailService;
} {
  const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
  const email: EmailService = {
    async send(msg) {
      sent.push({
        to: msg.to,
        subject: msg.subject ?? "",
        text: msg.text ?? "",
        html: msg.html ?? "",
      });
      return { delivered: true };
    },
  };
  return { sent, email };
}

describe("buildAuth — sendResetPassword hook registration (D-01 / BA 1.6.9 password.mjs:42)", () => {
  it("registers sendResetPassword under emailAndPassword (NOT emailVerification, NOT top-level)", () => {
    const { fn: enqueueEmail } = makeEnqueueCapture();
    const { email } = makeEmailCapture();
    const auth = buildAuth({ db: stubDb, email, enqueueEmail });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    expect(typeof opts.emailAndPassword?.sendResetPassword).toBe("function");
  });
});

describe("buildAuth — sendResetPassword enqueueEmail path", () => {
  it("enqueues template_id='password_reset' with locale='en' and zero tenant when omitted", async () => {
    const { calls, fn: enqueueEmail } = makeEnqueueCapture();
    const { sent, email } = makeEmailCapture();
    const auth = buildAuth({ db: stubDb, email, enqueueEmail });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    await opts.emailAndPassword?.sendResetPassword?.(
      {
        user: { email: "en@user.test", name: "Eve", locale: "en" },
        url: "https://api.localhost/api/auth/reset?token=abc",
        token: "abc",
      },
      undefined,
    );
    expect(sent).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        tenant_id: "00000000-0000-0000-0000-000000000000",
        to: "en@user.test",
        template_id: "password_reset",
        locale: "en",
        variables: expect.objectContaining({
          name: "Eve",
          reset_url: "https://api.localhost/api/auth/reset?token=abc",
          url: "https://api.localhost/api/auth/reset?token=abc",
          expires_minutes: 60,
        }),
      }),
    );
    expect(typeof calls[0]?.request_id).toBe("string");
    expect((calls[0]?.request_id ?? "").length).toBeGreaterThan(0);
  });

  it("forwards locale='ru' when user.locale === 'ru'", async () => {
    const { calls, fn: enqueueEmail } = makeEnqueueCapture();
    const { email } = makeEmailCapture();
    const auth = buildAuth({ db: stubDb, email, enqueueEmail });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    await opts.emailAndPassword?.sendResetPassword?.(
      {
        user: { email: "ru@user.test", name: "Roman", locale: "ru" },
        url: "https://api.localhost/api/auth/reset?token=ru",
        token: "ru",
      },
      undefined,
    );
    expect(calls[0]?.locale).toBe("ru");
  });

  it("defaults locale to 'en' when user.locale is undefined or unrecognized", async () => {
    const { calls, fn: enqueueEmail } = makeEnqueueCapture();
    const { email } = makeEmailCapture();
    const auth = buildAuth({ db: stubDb, email, enqueueEmail });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    await opts.emailAndPassword?.sendResetPassword?.(
      {
        user: { email: "u1@user.test" },
        url: "https://x/y",
        token: "t1",
      },
      undefined,
    );
    await opts.emailAndPassword?.sendResetPassword?.(
      {
        user: { email: "u2@user.test", locale: "fr" },
        url: "https://x/y",
        token: "t2",
      },
      undefined,
    );
    expect(calls[0]?.locale).toBe("en");
    expect(calls[1]?.locale).toBe("en");
  });

  it("forwards user.tenantId as tenant_id when provided", async () => {
    const { calls, fn: enqueueEmail } = makeEnqueueCapture();
    const { email } = makeEmailCapture();
    const auth = buildAuth({ db: stubDb, email, enqueueEmail });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    await opts.emailAndPassword?.sendResetPassword?.(
      {
        user: {
          email: "tenant@user.test",
          tenantId: "00000000-0000-0000-0000-000000000123",
        },
        url: "https://x/y",
        token: "t",
      },
      undefined,
    );
    expect(calls[0]?.tenant_id).toBe("00000000-0000-0000-0000-000000000123");
  });

  it("falls back variables.name to user.email when user.name is undefined", async () => {
    const { calls, fn: enqueueEmail } = makeEnqueueCapture();
    const { email } = makeEmailCapture();
    const auth = buildAuth({ db: stubDb, email, enqueueEmail });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    await opts.emailAndPassword?.sendResetPassword?.(
      {
        user: { email: "noname@user.test" },
        url: "https://x/y",
        token: "t",
      },
      undefined,
    );
    expect(calls[0]?.variables.name).toBe("noname@user.test");
  });

  it("aliases variables.url to the same value as variables.reset_url (D-03)", async () => {
    const { calls, fn: enqueueEmail } = makeEnqueueCapture();
    const { email } = makeEmailCapture();
    const auth = buildAuth({ db: stubDb, email, enqueueEmail });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const url = "https://api.localhost/api/auth/reset?token=alias";
    await opts.emailAndPassword?.sendResetPassword?.(
      { user: { email: "a@b.test" }, url, token: "alias" },
      undefined,
    );
    expect(calls[0]?.variables.reset_url).toBe(url);
    expect(calls[0]?.variables.url).toBe(url);
  });

  it("sets variables.expires_minutes to literal 60 (D-02, BA default resetPasswordTokenExpiresIn=3600s)", async () => {
    const { calls, fn: enqueueEmail } = makeEnqueueCapture();
    const { email } = makeEmailCapture();
    const auth = buildAuth({ db: stubDb, email, enqueueEmail });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    await opts.emailAndPassword?.sendResetPassword?.(
      { user: { email: "x@x.test" }, url: "https://x/y", token: "t" },
      undefined,
    );
    expect(calls[0]?.variables.expires_minutes).toBe(60);
  });
});

describe("buildAuth — sendResetPassword inline fallback (no enqueueEmail)", () => {
  it("calls email.send when opts.enqueueEmail is omitted (backward compat)", async () => {
    const { sent, email } = makeEmailCapture();
    const auth = buildAuth({ db: stubDb, email });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const url = "https://api.localhost/api/auth/reset?token=inline";
    await opts.emailAndPassword?.sendResetPassword?.(
      { user: { email: "inline@user.test" }, url, token: "inline" },
      undefined,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("inline@user.test");
    expect(sent[0]?.subject.length).toBeGreaterThan(0);
    expect(sent[0]?.text).toContain(url);
    expect(sent[0]?.html).toContain(url);
  });
});

describe("buildAuth — sendResetPassword error propagation", () => {
  it("propagates enqueueEmail errors (does not swallow queue-add failures)", async () => {
    const enqueueEmail = async (): Promise<void> => {
      throw new Error("REDIS_DOWN");
    };
    const { email } = makeEmailCapture();
    const auth = buildAuth({
      db: stubDb,
      email,
      enqueueEmail: enqueueEmail as never,
    });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    await expect(
      opts.emailAndPassword?.sendResetPassword?.(
        { user: { email: "x@y.test" }, url: "https://x/y", token: "t" },
        undefined,
      ),
    ).rejects.toThrow(/REDIS_DOWN/);
  });
});
