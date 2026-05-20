// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-08 — GREEN tests for email-delivery (D-W5).
//
// Real Postgres testcontainer: the handler is withTenantContext-wrapped so
// the test must drive BEGIN/set_config/COMMIT through a real pool. The
// SMTP transport and template renderer are stubs (network boundary —
// permitted by CLAUDE.md).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Job } from "bullmq";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildEmailDeliveryHandler,
  type EmailSender,
  emailDeliverySchema,
  type TemplateRenderer,
} from "../../../src/jobs/email-delivery.js";
import { canRunDocker } from "../../../src/lib/can-run-docker.js";

const SUITE = canRunDocker() ? describe : describe.skip;
const TENANT = "11111111-1111-4111-a111-111111111111";
const REQ = "22222222-2222-4222-a222-222222222222";

interface Harness {
  container: StartedPostgreSqlContainer;
  pool: Pool;
}
let h: Harness | undefined;

beforeAll(async () => {
  if (!canRunDocker()) return;
  const container = await new PostgreSqlContainer("postgres:17-bookworm")
    .withDatabase("email_test")
    .withUsername("postgres_super")
    .withPassword("pw")
    .start();
  const pool = new Pool({ connectionString: container.getConnectionUri(), max: 4 });
  h = { container, pool };
}, 120_000);

afterAll(async () => {
  if (h) {
    await h.pool.end();
    await h.container.stop();
  }
}, 60_000);

function fakeJob(data: unknown): Job {
  return { data, queueName: "email-delivery", id: "job-1" } as unknown as Job;
}

function makeStubs(): { sender: EmailSender; renderer: TemplateRenderer; sent: unknown[] } {
  const sent: unknown[] = [];
  const sender: EmailSender = {
    async send(args) {
      sent.push(args);
      return { delivered: true };
    },
  };
  const renderer: TemplateRenderer = {
    render(_id, _locale, _vars) {
      return { subject: "S", text: "T", html: "<p>T</p>" };
    },
  };
  return { sender, renderer, sent };
}

SUITE("email-delivery (D-W5)", () => {
  it("schema rejects missing tenant_id", () => {
    expect(() =>
      emailDeliverySchema.parse({ to: "a@b.co", template_id: "x", request_id: REQ }),
    ).toThrow();
  });

  it("schema rejects malformed email", () => {
    expect(() =>
      emailDeliverySchema.parse({
        tenant_id: TENANT,
        to: "not-an-email",
        template_id: "x",
        request_id: REQ,
      }),
    ).toThrow();
  });

  it("schema accepts the canonical D-A7 payload", () => {
    const parsed = emailDeliverySchema.parse({
      tenant_id: TENANT,
      to: "a@b.co",
      template_id: "welcome",
      locale: "ru",
      variables: { name: "Sam" },
      request_id: REQ,
    });
    expect(parsed.locale).toBe("ru");
    expect(parsed.variables).toEqual({ name: "Sam" });
  });

  it("schema defaults locale to 'en' and variables to {}", () => {
    const parsed = emailDeliverySchema.parse({
      tenant_id: TENANT,
      to: "a@b.co",
      template_id: "welcome",
      request_id: REQ,
    });
    expect(parsed.locale).toBe("en");
    expect(parsed.variables).toEqual({});
  });

  it("invokes the renderer + sender with the parsed payload (happy path)", async () => {
    if (!h) throw new Error("harness");
    const { sender, renderer, sent } = makeStubs();
    const handler = buildEmailDeliveryHandler({
      pool: h.pool,
      sender,
      renderer,
      allowSmtpFallback: false,
    });
    await handler(
      fakeJob({
        tenant_id: TENANT,
        to: "user@example.com",
        template_id: "welcome",
        locale: "en",
        variables: { name: "Sam" },
        request_id: REQ,
      }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "user@example.com",
      subject: "S",
      text: "T",
      html: "<p>T</p>",
    });
  });

  it("rejects when sender reports not delivered (BullMQ retry surface)", async () => {
    if (!h) throw new Error("harness");
    const failingSender: EmailSender = {
      async send() {
        return { delivered: false, reason: "smtp-unreachable" };
      },
    };
    const { renderer } = makeStubs();
    const handler = buildEmailDeliveryHandler({
      pool: h.pool,
      sender: failingSender,
      renderer,
      allowSmtpFallback: false,
    });
    await expect(
      handler(
        fakeJob({
          tenant_id: TENANT,
          to: "a@b.co",
          template_id: "welcome",
          request_id: REQ,
        }),
      ),
    ).rejects.toThrow(/did not deliver/);
  });

  it("omits html in send when renderer returns text-only", async () => {
    if (!h) throw new Error("harness");
    const sent: unknown[] = [];
    const sender: EmailSender = {
      async send(args) {
        sent.push(args);
        return { delivered: true };
      },
    };
    const renderer: TemplateRenderer = {
      render() {
        return { subject: "S", text: "plain" };
      },
    };
    const handler = buildEmailDeliveryHandler({
      pool: h.pool,
      sender,
      renderer,
      allowSmtpFallback: false,
    });
    await handler(
      fakeJob({
        tenant_id: TENANT,
        to: "a@b.co",
        template_id: "txt",
        request_id: REQ,
      }),
    );
    expect((sent[0] as any).html).toBeUndefined();
  });

  it("formats not-delivered error with 'unknown' reason when sender omits reason", async () => {
    if (!h) throw new Error("harness");
    const failingSender: EmailSender = {
      async send() {
        return { delivered: false };
      },
    };
    const { renderer } = makeStubs();
    const handler = buildEmailDeliveryHandler({
      pool: h.pool,
      sender: failingSender,
      renderer,
      allowSmtpFallback: false,
    });
    await expect(
      handler(
        fakeJob({
          tenant_id: TENANT,
          to: "a@b.co",
          template_id: "welcome",
          request_id: REQ,
        }),
      ),
    ).rejects.toThrow(/reason=unknown/);
  });

  it("CR-03: THROWS on reason='smtp-not-configured' when allowSmtpFallback is false (no false-green)", async () => {
    // Phase 66 / CR-03: the silent-green carve-out is gone. With the
    // opt-in flag OFF (the default — staging / unset NODE_ENV), an
    // smtp-not-configured result MUST fail the job so BullMQ retries /
    // DLQs the undelivered email. Pre-fix the only knob was `nodeEnv`
    // and any non-production env silently returned a green job.
    if (!h) throw new Error("harness");
    const skipSender: EmailSender = {
      async send() {
        return { delivered: false, reason: "smtp-not-configured" };
      },
    };
    const { renderer } = makeStubs();
    const handler = buildEmailDeliveryHandler({
      pool: h.pool,
      sender: skipSender,
      renderer,
      allowSmtpFallback: false,
    });
    await expect(
      handler(
        fakeJob({
          tenant_id: TENANT,
          to: "a@b.co",
          template_id: "welcome",
          request_id: REQ,
        }),
      ),
    ).rejects.toThrow(/did not deliver/);
  });

  it("CR-03: resolves on reason='smtp-not-configured' when allowSmtpFallback is explicitly true", async () => {
    // The dev-compose-up convenience is now an EXPLICIT opt-in
    // (EMAIL_FALLBACK_NONFATAL=1 -> deps.allowSmtpFallback=true), gated
    // on the flag — not on NODE_ENV. With the flag ON the handler
    // resolves cleanly so a fresh `docker compose up` with no SMTP env
    // does not burn BullMQ retries.
    if (!h) throw new Error("harness");
    const skipSender: EmailSender = {
      async send() {
        return { delivered: false, reason: "smtp-not-configured" };
      },
    };
    const { renderer } = makeStubs();
    const handler = buildEmailDeliveryHandler({
      pool: h.pool,
      sender: skipSender,
      renderer,
      allowSmtpFallback: true,
    });
    await expect(
      handler(
        fakeJob({
          tenant_id: TENANT,
          to: "a@b.co",
          template_id: "welcome",
          request_id: REQ,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("CR-03: still throws on OTHER non-delivery reasons even when allowSmtpFallback is true", async () => {
    // The fallback carve-out is keyed strictly on `smtp-not-configured`.
    // Any other failure reason (transport error, refused recipient, etc.)
    // keeps the retry-throw posture even with the opt-in flag ON.
    if (!h) throw new Error("harness");
    const failingSender: EmailSender = {
      async send() {
        return { delivered: false, reason: "smtp-unreachable" };
      },
    };
    const { renderer } = makeStubs();
    const handler = buildEmailDeliveryHandler({
      pool: h.pool,
      sender: failingSender,
      renderer,
      allowSmtpFallback: true,
    });
    await expect(
      handler(
        fakeJob({
          tenant_id: TENANT,
          to: "a@b.co",
          template_id: "welcome",
          request_id: REQ,
        }),
      ),
    ).rejects.toThrow(/did not deliver/);
  });

  it("CR-03: email-delivery.ts source contains no process.env.NODE_ENV read (LOCKER-01)", () => {
    // Constitutional guard — the NODE_ENV env read must live in a
    // boundary file (config/worker-config.ts), never in this job file.
    const src = readFileSync(resolve(__dirname, "../../../src/jobs/email-delivery.ts"), "utf8");
    expect(src).not.toMatch(/process\.env\.NODE_ENV/);
    expect(src).not.toMatch(/process\.env\b/);
  });

  it("passes locale + variables through to the renderer", async () => {
    if (!h) throw new Error("harness");
    const rendererSpy = vi.fn().mockReturnValue({ subject: "S", text: "T" });
    const renderer: TemplateRenderer = { render: rendererSpy };
    const { sender } = makeStubs();
    const handler = buildEmailDeliveryHandler({
      pool: h.pool,
      sender,
      renderer,
      allowSmtpFallback: false,
    });
    await handler(
      fakeJob({
        tenant_id: TENANT,
        to: "a@b.co",
        template_id: "reset",
        locale: "ru",
        variables: { code: 12345 },
        request_id: REQ,
      }),
    );
    expect(rendererSpy).toHaveBeenCalledWith("reset", "ru", { code: 12345 });
  });
});
