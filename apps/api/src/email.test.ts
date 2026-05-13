// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 04 / Task 1 — `email.ts` unit tests.
//
// Three branches the factory exposes:
//   1. SMTP_HOST unset -> stub path; .send() resolves with
//      `{delivered:true, reason:"smtp-not-configured"}`; construction
//      logs `event:"email.smtp_not_configured"` warn.
//   2. SMTP_HOST set + transport.sendMail succeeds -> .send() returns
//      `{delivered:true}` and logs `event:"email.sent"`.
//   3. SMTP_HOST set + transport.sendMail throws -> .send() RE-THROWS
//      (Pitfall #4). Better Auth must see the rejection so the
//      verification record stays unverified.
//
// nodemailer is mocked at the module boundary via `vi.mock`. We don't
// need real SMTP wire here — that lives in `__tests__/email-mailpit.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
  },
  createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
}));

interface FakeLog {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function makeLog(): FakeLog {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  sendMailMock.mockReset();
  // Ensure SMTP env keys are clean per test.
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  delete process.env.SMTP_FROM;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("makeEmailService — dev fallback (SMTP_HOST unset)", () => {
  it("logs warn with event=email.smtp_not_configured at construction", async () => {
    const { makeEmailService } = await import("./email.js");
    const log = makeLog();
    makeEmailService(log as never);
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [payload] = log.warn.mock.calls[0] ?? [];
    expect(payload).toMatchObject({ event: "email.smtp_not_configured" });
  });

  it(".send resolves with delivered:true and reason:'smtp-not-configured'", async () => {
    const { makeEmailService } = await import("./email.js");
    const svc = makeEmailService(makeLog() as never);
    const out = await svc.send({
      to: "u@test.local",
      subject: "Hi",
      text: "Body",
    });
    expect(out.delivered).toBe(true);
    expect(out.reason).toBe("smtp-not-configured");
  });

  it(".send does NOT call nodemailer (no transport at all)", async () => {
    const { makeEmailService } = await import("./email.js");
    const svc = makeEmailService(makeLog() as never);
    await svc.send({ to: "u@test.local", subject: "Hi", text: "Body" });
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("makeEmailService — SMTP_HOST set", () => {
  beforeEach(() => {
    process.env.SMTP_HOST = "mailpit";
    process.env.SMTP_PORT = "1025";
    process.env.SMTP_FROM = "no-reply@openwhispr.local";
  });

  it("returns delivered:true when transport.sendMail resolves; logs event=email.sent", async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: "<abc@local>" });
    const { makeEmailService } = await import("./email.js");
    const log = makeLog();
    const svc = makeEmailService(log as never);
    const out = await svc.send({
      to: "u@test.local",
      subject: "Hi",
      text: "Body",
    });
    expect(out.delivered).toBe(true);
    expect(out.reason).toBeUndefined();
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith({
      from: "no-reply@openwhispr.local",
      to: "u@test.local",
      subject: "Hi",
      text: "Body",
      html: undefined,
    });
    // Event field present on info log.
    const infoCall = log.info.mock.calls.find(
      ([p]) => (p as { event?: string }).event === "email.sent",
    );
    expect(infoCall).toBeDefined();
  });

  it(".send RE-THROWS when transport.sendMail throws (Pitfall #4 — no swallow)", async () => {
    const transportErr = new Error("SMTP refused");
    sendMailMock.mockRejectedValueOnce(transportErr);
    const { makeEmailService } = await import("./email.js");
    const log = makeLog();
    const svc = makeEmailService(log as never);
    await expect(
      svc.send({ to: "u@test.local", subject: "Hi", text: "Body" }),
    ).rejects.toThrow("SMTP refused");
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("auto-derives secure flag: port=465 => secure=true; otherwise false", async () => {
    const nodemailer = await import("nodemailer");
    const createTransport = (
      nodemailer.default ?? (nodemailer as unknown as { createTransport: typeof nodemailer.default.createTransport })
    ).createTransport as ReturnType<typeof vi.fn>;
    createTransport.mockClear();

    process.env.SMTP_PORT = "465";
    const { makeEmailService } = await import("./email.js");
    makeEmailService(makeLog() as never);
    expect(createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );

    // Reset module registry so SMTP env re-reads on next import.
    vi.resetModules();
    process.env.SMTP_PORT = "587";
    const reloaded = await import("./email.js");
    reloaded.makeEmailService(makeLog() as never);
    expect(createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
  });

  it("only sets auth when both SMTP_USER and SMTP_PASSWORD present", async () => {
    const nodemailer = await import("nodemailer");
    const createTransport = (
      nodemailer.default ?? (nodemailer as unknown as { createTransport: typeof nodemailer.default.createTransport })
    ).createTransport as ReturnType<typeof vi.fn>;
    createTransport.mockClear();

    // Neither set => auth undefined.
    vi.resetModules();
    const m1 = await import("./email.js");
    m1.makeEmailService(makeLog() as never);
    expect(createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ auth: undefined }),
    );

    // Only USER => still undefined.
    vi.resetModules();
    process.env.SMTP_USER = "user";
    const m2 = await import("./email.js");
    m2.makeEmailService(makeLog() as never);
    expect(createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ auth: undefined }),
    );

    // Both => auth populated.
    vi.resetModules();
    process.env.SMTP_PASSWORD = "pw";
    const m3 = await import("./email.js");
    m3.makeEmailService(makeLog() as never);
    expect(createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ auth: { user: "user", pass: "pw" } }),
    );
  });
});
