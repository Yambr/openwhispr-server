// Phase 2 / Plan 04 / Task 1 — mailpit integration test.
//
// Wire-real-SMTP coverage of `makeEmailService`. Skips cleanly when
// mailpit is not reachable (no Docker / dev profile not up). When run in
// CI alongside `docker compose --profile dev up -d mailpit` the test
// hits the real SMTP listener on `mailpit:1025`, then polls
// `http://mailpit:8025/api/v1/messages` until the message lands.
//
// On a contributor laptop without `mailpit:` resolving (no Docker DNS),
// we fall back to `MAILPIT_HOST` (default 127.0.0.1) so `make dev`
// users with port-forwarding can run the suite.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SMTP_HOST = process.env.MAILPIT_SMTP_HOST ?? "mailpit";
const SMTP_PORT = process.env.MAILPIT_SMTP_PORT ?? "1025";
const HTTP_BASE =
  process.env.MAILPIT_HTTP_URL ?? `http://${SMTP_HOST}:8025`;

async function mailpitReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${HTTP_BASE}/api/v1/info`, {
      // 1.5s budget — fail fast in environments without mailpit.
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const REACHABLE = await mailpitReachable();

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

interface MailpitMessagesResponse {
  messages: MailpitMessage[];
}

async function clearMailpit(): Promise<void> {
  await fetch(`${HTTP_BASE}/api/v1/messages`, { method: "DELETE" }).catch(
    () => {
      /* best-effort */
    },
  );
}

async function pollForSubject(
  subject: string,
  budgetMs = 10_000,
): Promise<MailpitMessage | null> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${HTTP_BASE}/api/v1/messages`);
    if (res.ok) {
      const body = (await res.json()) as MailpitMessagesResponse;
      const found = body.messages.find((m) => m.Subject === subject);
      if (found) return found;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

describe.skipIf(!REACHABLE)("makeEmailService — mailpit integration", () => {
  beforeAll(async () => {
    await clearMailpit();
    process.env.SMTP_HOST = SMTP_HOST;
    process.env.SMTP_PORT = SMTP_PORT;
    process.env.SMTP_FROM = "openwhispr@test.local";
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
  });

  afterAll(async () => {
    await clearMailpit();
  });

  it("delivers a message that lands in mailpit's /api/v1/messages", async () => {
    const subject = `Plan04-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Construct a logger noop — mailpit integration is about the
    // transport, not the log surface.
    const log = {
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      trace: () => {},
      debug: () => {},
      silent: () => {},
      level: "info" as const,
      child() {
        return this;
      },
    };
    const { makeEmailService } = await import("../email.js");
    const svc = makeEmailService(log as never);
    const out = await svc.send({
      to: "int@test.local",
      subject,
      text: "body",
    });
    expect(out.delivered).toBe(true);
    const msg = await pollForSubject(subject);
    expect(msg).not.toBeNull();
    expect(msg?.Subject).toBe(subject);
    expect(msg?.To.some((t) => t.Address === "int@test.local")).toBe(true);
  });
});
