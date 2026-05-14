// SPDX-License-Identifier: Apache-2.0
// Phase 6 Plan 06-08 — GREEN tests for email-delivery (D-W5).
//
// Real Postgres testcontainer: the handler is withTenantContext-wrapped so
// the test must drive BEGIN/set_config/COMMIT through a real pool. The
// SMTP transport and template renderer are stubs (network boundary —
// permitted by CLAUDE.md).
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Job } from "bullmq";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canRunDocker } from "../lib/can-run-docker.js";
import {
  buildEmailDeliveryHandler,
  type EmailSender,
  emailDeliverySchema,
  type TemplateRenderer,
} from "./email-delivery.js";

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
    const handler = buildEmailDeliveryHandler({ pool: h.pool, sender, renderer });
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
    const handler = buildEmailDeliveryHandler({ pool: h.pool, sender: failingSender, renderer });
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
    const handler = buildEmailDeliveryHandler({ pool: h.pool, sender, renderer });
    await handler(
      fakeJob({
        tenant_id: TENANT,
        to: "a@b.co",
        template_id: "txt",
        request_id: REQ,
      }),
    );
    // biome-ignore lint/suspicious/noExplicitAny: introspection
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
    const handler = buildEmailDeliveryHandler({ pool: h.pool, sender: failingSender, renderer });
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

  it("HI-01: treats reason='smtp-not-configured' as non-fatal skip in non-prod", async () => {
    // Phase 13 review HI-01: when the API's EmailSender dev-fallback returns
    // delivered:false + reason:'smtp-not-configured' (no SMTP_HOST in
    // non-prod), the worker MUST NOT throw — that would burn 5 BullMQ retry
    // attempts on a misconfigured-by-design dev stack and surface as
    // spurious red failures in CI. The handler should resolve cleanly so
    // BullMQ records `completed` and operators see one WARN line per job.
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
      // Explicitly non-prod — dev/test/staging all share the skip path.
      nodeEnv: "development",
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

  it("HI-01: STILL throws on reason='smtp-not-configured' when NODE_ENV=production", async () => {
    // Production must remain loud-fail. The EmailSender's construction-time
    // throw normally fires first in prod (SMTP_HOST is required), but a
    // defence-in-depth pass at the worker layer guards against an injected
    // sender stub or future code path that bypasses the construction check.
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
      nodeEnv: "production",
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

  it("HI-01: still throws on OTHER non-delivery reasons in non-prod (e.g. smtp-unreachable)", async () => {
    // The skip carve-out is keyed strictly on `smtp-not-configured`. Any
    // other failure reason (transport error, refused recipient, etc.)
    // must keep the retry-throw posture so BullMQ retries.
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
      nodeEnv: "development",
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

  it("passes locale + variables through to the renderer", async () => {
    if (!h) throw new Error("harness");
    const rendererSpy = vi.fn().mockReturnValue({ subject: "S", text: "T" });
    const renderer: TemplateRenderer = { render: rendererSpy };
    const { sender } = makeStubs();
    const handler = buildEmailDeliveryHandler({ pool: h.pool, sender, renderer });
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
