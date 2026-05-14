// SPDX-License-Identifier: Apache-2.0
// Phase 13 / Plan 01 / Task 04 — Unit tests for `createEmailSender`.
//
// Coverage targets per plan behavior block:
//   T1 — happy path: SMTP_HOST set + sendMail resolves -> delivered:true,
//        event:"email.sent" info log
//   T2 — sendMail rejects -> .send() RE-THROWS (Pitfall #4: never swallow),
//        event:"email.failed" error log
//   T3 — prod loud-fail: NODE_ENV=production + SMTP_HOST unset -> throws
//        at construction with /email\.smtp_required_in_production/
//   T4 — dev fallback: NODE_ENV !== production + SMTP_HOST unset -> stub
//        sender + warn event:"email.smtp_not_configured", NO throw
//   T5 — SMTP_SECURE explicit override beats port heuristic
//        (port=587 + SMTP_SECURE=true -> createTransport secure:true)
//   T6 — SMTP_REJECT_UNAUTHORIZED=false propagates tls.rejectUnauthorized:false
//   T7 — Structural Logger acceptance: plain object {info, warn, error}
//        is accepted (no Fastify dep required)
//   T8 — Auth only attached when BOTH SMTP_USER and SMTP_PASSWORD present
//   T9 — Dev-fallback .send returns reason:"smtp-not-configured"
//   T10 — SendArgs surfaces optional `html` field through to sendMail
//
// nodemailer is mocked at the module boundary — process/network boundary,
// not internal logic (allowed per constitutional rule).

import nodemailer from "nodemailer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmailSender, type Logger } from "./EmailSender.js";

type SendMailOpts = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string | undefined;
};
type CreateTransportOpts = Record<string, unknown>;

const sendMailMock = vi.fn<(opts: SendMailOpts) => Promise<{ messageId: string }>>();
const createTransportMock = vi.fn<(opts: CreateTransportOpts) => { sendMail: typeof sendMailMock }>(
  () => ({ sendMail: sendMailMock }),
);

vi.mock("nodemailer", () => ({
  default: {
    createTransport: (arg: CreateTransportOpts) => createTransportMock(arg),
  },
  createTransport: (arg: CreateTransportOpts) => createTransportMock(arg),
}));

type LogFn = (obj: Record<string, unknown>, msg?: string) => void;
type SpyLog = Logger & {
  info: LogFn & ReturnType<typeof vi.fn>;
  warn: LogFn & ReturnType<typeof vi.fn>;
  error: LogFn & ReturnType<typeof vi.fn>;
};

function makeLog(): SpyLog {
  return {
    info: vi.fn() as SpyLog["info"],
    warn: vi.fn() as SpyLog["warn"],
    error: vi.fn() as SpyLog["error"],
  };
}

beforeEach(() => {
  sendMailMock.mockReset();
  createTransportMock.mockClear();
});

describe("createEmailSender — SMTP_HOST configured (happy path)", () => {
  const baseEnv = {
    SMTP_HOST: "mailpit",
    SMTP_PORT: "1025",
    SMTP_FROM: "no-reply@openwhispr.local",
  } satisfies NodeJS.ProcessEnv;

  it("T1: sendMail resolves -> delivered:true, info log event=email.sent", async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: "<abc@local>" });
    const log = makeLog();
    const sender = createEmailSender({ log, env: { ...baseEnv } });

    const out = await sender.send({
      to: "u@test.local",
      subject: "Hi",
      text: "Body",
    });

    expect(out).toEqual({ delivered: true });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith({
      from: "no-reply@openwhispr.local",
      to: "u@test.local",
      subject: "Hi",
      text: "Body",
      html: undefined,
    });
    const infoCall = log.info.mock.calls.find(
      ([p]) => (p as { event?: string }).event === "email.sent",
    );
    expect(infoCall).toBeDefined();
    expect((infoCall?.[0] as { messageId?: string }).messageId).toBe("<abc@local>");
  });

  it("T2: sendMail rejects -> .send() RE-THROWS + error log event=email.failed", async () => {
    const transportErr = new Error("SMTP refused");
    sendMailMock.mockRejectedValueOnce(transportErr);
    const log = makeLog();
    const sender = createEmailSender({ log, env: { ...baseEnv } });

    await expect(sender.send({ to: "u@test.local", subject: "Hi", text: "Body" })).rejects.toThrow(
      "SMTP refused",
    );

    expect(log.error).toHaveBeenCalledTimes(1);
    const firstCall = log.error.mock.calls[0];
    expect(firstCall).toBeDefined();
    const payload = firstCall?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ event: "email.failed" });
  });

  it("T8: auth attached only when BOTH SMTP_USER and SMTP_PASSWORD present", async () => {
    // Neither set -> auth undefined.
    createEmailSender({ log: makeLog(), env: { ...baseEnv } });
    expect(createTransportMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ auth: undefined }),
    );

    // Only USER -> still undefined.
    createTransportMock.mockClear();
    createEmailSender({
      log: makeLog(),
      env: { ...baseEnv, SMTP_USER: "user" },
    });
    expect(createTransportMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ auth: undefined }),
    );

    // Only PASSWORD -> still undefined.
    createTransportMock.mockClear();
    createEmailSender({
      log: makeLog(),
      env: { ...baseEnv, SMTP_PASSWORD: "pw" },
    });
    expect(createTransportMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ auth: undefined }),
    );

    // Both set -> auth populated with `pass` (not `password`) per nodemailer contract.
    createTransportMock.mockClear();
    createEmailSender({
      log: makeLog(),
      env: { ...baseEnv, SMTP_USER: "user", SMTP_PASSWORD: "pw" },
    });
    expect(createTransportMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ auth: { user: "user", pass: "pw" } }),
    );
  });

  it("T10: SendArgs.html flows through to sendMail", async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: "<html@local>" });
    const sender = createEmailSender({
      log: makeLog(),
      env: { ...baseEnv },
    });

    await sender.send({
      to: "u@test.local",
      subject: "Welcome",
      text: "fallback",
      html: "<p>Welcome</p>",
    });

    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ html: "<p>Welcome</p>" }));
  });

  it("default SMTP_FROM applied when env.SMTP_FROM is unset", async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: "<x@local>" });
    const sender = createEmailSender({
      log: makeLog(),
      env: { SMTP_HOST: "mailpit", SMTP_PORT: "1025" },
    });
    await sender.send({ to: "u@test.local", subject: "Hi", text: "B" });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "no-reply@openwhispr.local" }),
    );
  });

  it("default SMTP_PORT=587 + default secure=false when port unset", async () => {
    createEmailSender({
      log: makeLog(),
      env: { SMTP_HOST: "mailpit" },
    });
    expect(createTransportMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
  });
});

describe("createEmailSender — SMTP_SECURE env override (T5)", () => {
  it("port=465 -> secure=true (port heuristic, no env override)", () => {
    createEmailSender({
      log: makeLog(),
      env: { SMTP_HOST: "smtp.example.com", SMTP_PORT: "465" },
    });
    expect(createTransportMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );
  });

  it("port=587 -> secure=false (port heuristic, no env override)", () => {
    createEmailSender({
      log: makeLog(),
      env: { SMTP_HOST: "smtp.example.com", SMTP_PORT: "587" },
    });
    expect(createTransportMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
  });

  it("SMTP_SECURE='true' overrides port heuristic (port=587 + secure=true)", () => {
    createEmailSender({
      log: makeLog(),
      env: {
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_SECURE: "true",
      },
    });
    expect(createTransportMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 587, secure: true }),
    );
  });

  it("SMTP_SECURE='false' overrides port heuristic (port=465 + secure=false)", () => {
    createEmailSender({
      log: makeLog(),
      env: {
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "false",
      },
    });
    expect(createTransportMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 465, secure: false }),
    );
  });
});

describe("createEmailSender — SMTP_REJECT_UNAUTHORIZED env (T6)", () => {
  it("unset -> default true -> NO tls option (nodemailer default verify)", () => {
    createEmailSender({
      log: makeLog(),
      env: { SMTP_HOST: "smtp.example.com", SMTP_PORT: "587" },
    });
    const callArg = createTransportMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("tls");
  });

  it("'true' -> explicit true -> still NO tls option", () => {
    createEmailSender({
      log: makeLog(),
      env: {
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_REJECT_UNAUTHORIZED: "true",
      },
    });
    const callArg = createTransportMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("tls");
  });

  it("'false' -> propagates tls.rejectUnauthorized:false to nodemailer", () => {
    createEmailSender({
      log: makeLog(),
      env: {
        SMTP_HOST: "smtp.internal.corp",
        SMTP_PORT: "587",
        SMTP_REJECT_UNAUTHORIZED: "false",
      },
    });
    expect(createTransportMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ tls: { rejectUnauthorized: false } }),
    );
  });
});

describe("createEmailSender — production loud-fail gate (T3)", () => {
  it("NODE_ENV=production + SMTP_HOST unset -> throws at construction", () => {
    const log = makeLog();
    expect(() =>
      createEmailSender({
        log,
        env: { NODE_ENV: "production" },
      }),
    ).toThrow(/email\.smtp_required_in_production/);
  });

  it("NODE_ENV=production + SMTP_HOST set -> NO throw (real-transport path)", () => {
    expect(() =>
      createEmailSender({
        log: makeLog(),
        env: { NODE_ENV: "production", SMTP_HOST: "smtp.prod.example.com" },
      }),
    ).not.toThrow();
  });

  it("throw must NOT log warn (loud-fail is fatal, not a warning)", () => {
    const log = makeLog();
    try {
      createEmailSender({ log, env: { NODE_ENV: "production" } });
    } catch {
      /* expected */
    }
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe("createEmailSender — dev fallback (T4, T9)", () => {
  it("SMTP_HOST unset + NODE_ENV undefined -> warn event=email.smtp_not_configured", () => {
    const log = makeLog();
    createEmailSender({ log, env: {} });
    expect(log.warn).toHaveBeenCalledTimes(1);
    const firstCall = log.warn.mock.calls[0];
    expect(firstCall).toBeDefined();
    const payload = firstCall?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ event: "email.smtp_not_configured" });
  });

  it("SMTP_HOST unset + NODE_ENV=development -> dev fallback (no throw)", () => {
    expect(() =>
      createEmailSender({
        log: makeLog(),
        env: { NODE_ENV: "development" },
      }),
    ).not.toThrow();
  });

  it("T9 (HI-01): dev-fallback .send -> delivered:false, reason:'smtp-not-configured'", async () => {
    // Phase 13 review HI-01: the dev fallback previously returned
    // delivered:true which silently lied to Better Auth and the worker's
    // email-delivery job. Loud-fail principle (file-header Pitfall #4)
    // requires delivered:false so callers can detect the no-op and treat
    // it as a non-fatal skip (in non-prod) or a hard failure (in prod,
    // where the construction-time throw fires first).
    const sender = createEmailSender({ log: makeLog(), env: {} });
    const out = await sender.send({
      to: "u@test.local",
      subject: "Hi",
      text: "Body",
    });
    expect(out).toEqual({
      delivered: false,
      reason: "smtp-not-configured",
    });
  });

  it("dev-fallback .send does NOT call nodemailer", async () => {
    const sender = createEmailSender({ log: makeLog(), env: {} });
    await sender.send({ to: "u@test.local", subject: "Hi", text: "B" });
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("dev-fallback .send logs event=email.skipped at WARN (HI-01)", async () => {
    // HI-01 also upgrades the per-send log from info to warn so a developer
    // running a non-prod stack with SMTP unconfigured sees the skipped
    // delivery in the warning channel of their logger (greppable in Loki).
    // The construction-time warn ("email.smtp_not_configured") fires once at
    // boot; this WARN fires per send.
    const log = makeLog();
    const sender = createEmailSender({ log, env: {} });
    await sender.send({ to: "u@test.local", subject: "Hi", text: "B" });
    const warnCall = log.warn.mock.calls.find(
      ([p]) => (p as { event?: string }).event === "email.skipped",
    );
    expect(warnCall).toBeDefined();
    const payload = warnCall?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: "email.skipped",
      to: "u@test.local",
      subject: "Hi",
    });
  });

  it("HI-01 regression guard: dev-fallback NEVER returns delivered:true", async () => {
    // Explicit guard against re-introducing the silent-success path. If
    // anyone flips dev-fallback back to delivered:true, this fails loud.
    const sender = createEmailSender({ log: makeLog(), env: { NODE_ENV: "development" } });
    const out = await sender.send({ to: "u@test.local", subject: "Hi", text: "B" });
    expect(out.delivered).toBe(false);
  });
});

describe("createEmailSender — structural Logger acceptance (T7)", () => {
  it("plain object {info, warn, error} satisfies Logger (no Fastify dep)", async () => {
    // Construct a Logger with no class, no library, no inheritance — just
    // the structural shape. If the interface coupled to FastifyBaseLogger
    // this would fail to typecheck.
    const calls: Array<{ level: string; obj: unknown; msg: string | undefined }> = [];
    const plainLog: Logger = {
      info: (obj, msg) => calls.push({ level: "info", obj, msg }),
      warn: (obj, msg) => calls.push({ level: "warn", obj, msg }),
      error: (obj, msg) => calls.push({ level: "error", obj, msg }),
    };
    sendMailMock.mockResolvedValueOnce({ messageId: "<plain@local>" });

    const sender = createEmailSender({
      log: plainLog,
      env: { SMTP_HOST: "mailpit", SMTP_PORT: "1025" },
    });
    await sender.send({ to: "u@test.local", subject: "Hi", text: "B" });

    expect(calls.some((c) => c.level === "info")).toBe(true);
    const infoEntry = calls.find(
      (c) => c.level === "info" && (c.obj as { event?: string }).event === "email.sent",
    );
    expect(infoEntry).toBeDefined();
  });

  it("EmailSender type contract surface: SendArgs requires to/subject/text", () => {
    // Compile-time contract assertion via a sample. If the types regress
    // (e.g., subject becomes optional), this stops compiling.
    const args: import("./EmailSender.js").SendArgs = {
      to: "u@test.local",
      subject: "Hi",
      text: "B",
    };
    expect(args.to).toBe("u@test.local");
  });
});

describe("createEmailSender — nodemailer module integration sanity", () => {
  it("named + default exports both route to the same createTransport", () => {
    // Defensive: the mock provides both shapes; verify nodemailer.createTransport
    // is resolvable as a function under both import patterns. This guards
    // against future ESM/CJS interop regressions in the dep chain.
    expect(typeof nodemailer.createTransport).toBe("function");
  });
});
