// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260524-u00 / Task A2 — RED then GREEN.
//
// k8s-mode bypass for the production SMTP_HOST loud-fail.
//
// In Kubernetes deployments operators provision SMTP via Kubernetes
// Secrets bound at chart deploy time. Until that Secret exists,
// `SMTP_HOST` is unset on the api/worker pods and the original
// production-mode throw at EmailSender.ts:107 kills the container on
// boot — preventing Better Auth + worker email-delivery from ever
// starting, even though every other identity flow (sign-up, sign-in,
// session, RLS-scoped queries) works fine without email.
//
// When `OPENWHISPR_DEPLOYMENT_MODE=k8s` is set AND `SMTP_HOST` is
// unset, the sender degrades to a warn-only no-op (mirrors the
// non-prod dev fallback) instead of throwing — sign-up completes,
// email-verification queues silently, and as soon as the operator
// rotates in the SMTP Secret + pod restart, the flow recovers.
//
// Compose-mode (no `OPENWHISPR_DEPLOYMENT_MODE` env) keeps the
// original throw — operators on docker-compose are expected to set
// SMTP_HOST in `.env` before going to production. Regression guard
// pins that contract.
//
// Test mechanics — mirrors EmailSender.test.ts: nodemailer mocked at
// module boundary (process boundary, allowed); structural Logger
// captured for log-event assertions.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmailSender, type Logger } from "../../src/EmailSender.js";

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

describe("createEmailSender — k8s-mode SMTP bypass (Quick-task 260524-u00 / Task A2)", () => {
  it("does NOT throw in production when SMTP_HOST is unset AND OPENWHISPR_DEPLOYMENT_MODE=k8s", () => {
    const log = makeLog();
    expect(() =>
      createEmailSender({
        log,
        env: {
          NODE_ENV: "production",
          OPENWHISPR_DEPLOYMENT_MODE: "k8s",
          // SMTP_HOST intentionally absent — k8s operator has not provisioned
          // the SMTP Secret yet.
        },
      }),
    ).not.toThrow();
  });

  it("emits warn event:'email.smtp_not_configured_k8s_mode' at construction when bypassed", () => {
    const log = makeLog();
    createEmailSender({
      log,
      env: {
        NODE_ENV: "production",
        OPENWHISPR_DEPLOYMENT_MODE: "k8s",
      },
    });

    const warnCall = log.warn.mock.calls.find(
      ([p]) => (p as { event?: string }).event === "email.smtp_not_configured_k8s_mode",
    );
    expect(warnCall).toBeDefined();
  });

  it(".send() on a k8s-bypassed sender resolves with delivered:false reason:'smtp-not-configured-k8s'", async () => {
    const log = makeLog();
    const sender = createEmailSender({
      log,
      env: {
        NODE_ENV: "production",
        OPENWHISPR_DEPLOYMENT_MODE: "k8s",
      },
    });

    const out = await sender.send({
      to: "u@test.local",
      subject: "Verify",
      text: "Click the link",
    });

    expect(out).toEqual({ delivered: false, reason: "smtp-not-configured-k8s" });
    // nodemailer.createTransport was NEVER called (no SMTP env to wire)
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
    // Per-send warn event for visibility in Loki/grafana
    const warnCall = log.warn.mock.calls.find(
      ([p]) => (p as { event?: string }).event === "email.skipped_k8s_mode",
    );
    expect(warnCall).toBeDefined();
  });

  it("k8s-mode + SMTP_HOST configured → real SMTP transport (bypass does NOT apply)", async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: "<k8s-real@local>" });
    const log = makeLog();
    const sender = createEmailSender({
      log,
      env: {
        NODE_ENV: "production",
        OPENWHISPR_DEPLOYMENT_MODE: "k8s",
        SMTP_HOST: "mailpit.k8s.svc",
        SMTP_PORT: "1025",
        SMTP_FROM: "no-reply@openwhispr.local",
      },
    });

    const out = await sender.send({
      to: "u@k8s.local",
      subject: "Verify",
      text: "Body",
    });

    expect(out).toEqual({ delivered: true });
    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("REGRESSION GUARD: production + SMTP_HOST unset WITHOUT k8s mode → STILL throws (compose-mode contract preserved)", () => {
    const log = makeLog();
    expect(() =>
      createEmailSender({
        log,
        env: {
          NODE_ENV: "production",
          // No OPENWHISPR_DEPLOYMENT_MODE — compose default.
        },
      }),
    ).toThrow(/SMTP_HOST is required in production/);
  });

  it("REGRESSION GUARD: production + SMTP_HOST unset + OPENWHISPR_DEPLOYMENT_MODE=compose → STILL throws", () => {
    const log = makeLog();
    expect(() =>
      createEmailSender({
        log,
        env: {
          NODE_ENV: "production",
          OPENWHISPR_DEPLOYMENT_MODE: "compose",
        },
      }),
    ).toThrow(/SMTP_HOST is required in production/);
  });

  it("k8s-mode case-insensitive: 'K8S' also bypasses (matches isK8sDeploymentMode contract)", () => {
    const log = makeLog();
    expect(() =>
      createEmailSender({
        log,
        env: {
          NODE_ENV: "production",
          OPENWHISPR_DEPLOYMENT_MODE: "K8S",
        },
      }),
    ).not.toThrow();
  });
});
