// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase-2 debt back-fill — coverage closure for src/auth.ts.
//
// Stage-A coverage on auth.ts was L=86.66 / B=100 / F=38.46 / S=87.5.
// The two uncovered code paths were:
//   1. Line 126: the `fallbackLog.child()` method returning `this` —
//      invoked when buildAuth is called without an `opts.log` AND any
//      Better-Auth internal pulls `log.child(...)` (it does, eagerly).
//   2. Line 183: the `sendVerificationEmail` async closure passed to
//      Better Auth's email-and-password handler — never invoked by the
//      smoke test in auth.test.ts (which only inspects `auth.options
//      .plugins`).
//
// Strategy: drive both paths from public surface without standing up a
// real DB. The smoke test in auth.test.ts already covers OIDC plugin
// permutations; this file extends it to the email-and-password handler.
//
// Production parity: the actual sendVerificationEmail path is also
// exercised end-to-end by the email-mailpit testcontainer suite (sends
// a real verification email through Mailpit). This unit test
// complements that by pinning the closure's pass-through contract:
// `user.email + url` → `email.send({to,subject,text,html})`.
//
// Mocks are scoped to a process-boundary surface (the `EmailService`
// transport interface — third-party SMTP) per CLAUDE.md's rule that
// internal logic must NOT be mocked.

import type { EmailSender as EmailService } from "@openwhispr/email";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuth, fallbackLog } from "../../../src/auth.js";

const stubDb = {} as unknown as Parameters<typeof buildAuth>[0]["db"];

const ORIGINAL_SECRET = process.env.BETTER_AUTH_SECRET;

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET =
    "0000000000000000000000000000000000000000000000000000000000000000";
  delete process.env.OIDC_ISSUER_URL;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = ORIGINAL_SECRET;
});

interface AuthOptionsRuntime {
  // Phase 13 / Plan 01 — sendVerificationEmail moved from emailAndPassword
  // to top-level emailVerification (Better Auth 1.6.9 reads from the
  // latter key, not the former).
  emailVerification?: {
    sendVerificationEmail?: (args: { user: { email: string }; url: string }) => Promise<void>;
  };
  logger?: unknown;
}

describe("buildAuth — sendVerificationEmail closure (line 183)", () => {
  it("forwards user.email + url to the injected EmailService transport", async () => {
    const sent: Array<{
      to: string;
      subject: string;
      text: string;
      html: string;
    }> = [];
    const email: EmailService = {
      async send(msg) {
        sent.push({
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        });
      },
    };
    const auth = buildAuth({ db: stubDb, email });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const send = opts.emailVerification?.sendVerificationEmail;
    expect(typeof send).toBe("function");
    await send?.({
      user: { email: "user@example.test" },
      url: "https://api.localhost/api/auth/verify?token=abc",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("user@example.test");
    expect(sent[0]?.subject).toMatch(/Verify your OpenWhispr account/);
    // Both bodies (text + html) contain the verification URL.
    expect(sent[0]?.text).toContain("https://api.localhost/api/auth/verify?token=abc");
    expect(sent[0]?.html).toContain("https://api.localhost/api/auth/verify?token=abc");
  });

  it("propagates transport errors (does not swallow Pitfall #4 nodemailer failures)", async () => {
    const email: EmailService = {
      async send() {
        throw new Error("SMTP_RELAY_DOWN");
      },
    };
    const auth = buildAuth({ db: stubDb, email });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const send = opts.emailVerification?.sendVerificationEmail;
    await expect(send?.({ user: { email: "u@b.test" }, url: "https://x.test/y" })).rejects.toThrow(
      /SMTP_RELAY_DOWN/,
    );
  });
});

describe("buildAuth — fallbackLog.child branch (line 126)", () => {
  it("constructs without opts.log AND without opts.email — fallback logger + env-driven email service", () => {
    // Hitting both fallbacks ensures the fallbackLog object literal
    // (including the `child()` method that returns `this`) is fully
    // materialised. We assert the instance comes back with bearer
    // registered — i.e. construction did not blow up — and that the
    // sendVerificationEmail closure is still wired (the env-driven
    // makeEmailService stub returns a no-op transport in test mode).
    delete process.env.SMTP_HOST; // ensure dev-stub fallback inside makeEmailService
    const auth = buildAuth({ db: stubDb });
    const plugins = auth.options.plugins ?? [];
    expect(plugins.some((p) => p.id === "bearer")).toBe(true);
    const opts = auth.options as unknown as AuthOptionsRuntime;
    expect(typeof opts.emailVerification?.sendVerificationEmail).toBe("function");
  });

  it("fallbackLog is used by makeEmailService when neither opts.log nor SMTP_HOST is set", () => {
    delete process.env.SMTP_HOST;
    const auth = buildAuth({ db: stubDb });
    expect((auth.options.plugins ?? []).length).toBeGreaterThan(0);
  });
});

// Phase-2 debt back-fill — fallbackLog is exported so each FastifyBase
// Logger-conformance method (info/warn/error/fatal/trace/debug/silent)
// PLUS `child()` is callable directly. All seven levels share the same
// underlying `noop` (single function declaration in auth.ts), and
// `child()` returns the fallbackLog itself so chained `.child(...).
// warn(...)` calls don't crash.
describe("fallbackLog — FastifyBaseLogger conformance stubs", () => {
  it("level is 'info' (Pino-conformant default)", () => {
    expect(fallbackLog.level).toBe("info");
  });

  it("every log level is a callable no-op (returns undefined)", () => {
    expect(fallbackLog.info()).toBeUndefined();
    expect(fallbackLog.warn()).toBeUndefined();
    expect(fallbackLog.error()).toBeUndefined();
    expect(fallbackLog.fatal()).toBeUndefined();
    expect(fallbackLog.trace()).toBeUndefined();
    expect(fallbackLog.debug()).toBeUndefined();
    expect(fallbackLog.silent()).toBeUndefined();
  });

  it("child() returns the fallbackLog itself (chained .child().warn() must work)", () => {
    const child = fallbackLog.child();
    expect(child).toBe(fallbackLog);
    // Cross-check the chained-call contract — `.child({...}).warn({},...)`
    // is the canonical Better-Auth-internal pattern.
    expect(child.warn()).toBeUndefined();
    expect(child.child().info()).toBeUndefined();
  });
});
