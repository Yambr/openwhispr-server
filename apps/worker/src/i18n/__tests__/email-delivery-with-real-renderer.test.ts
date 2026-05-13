// SPDX-License-Identifier: Apache-2.0
// Phase 10 / Plan 10-01b — Integration: email-delivery handler with the
// real WorkerTemplateRenderer (no renderer stub).
//
// The unit suite in apps/worker/src/jobs/email-delivery.test.ts uses a
// stub renderer to lock the handler's contract. This file proves the
// real renderer composes cleanly with the handler: a parsed payload
// flows through buildEmailDeliveryHandler -> WorkerTemplateRenderer ->
// EmailSender, and the SMTP-side stub observes a fully-rendered
// subject/text/html that matches the en/ru bundle.
//
// Postgres testcontainer is required (same as the unit suite) because
// withTenantContext drives a real BEGIN / set_config / COMMIT path.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Job } from "bullmq";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildEmailDeliveryHandler, type EmailSender } from "../../jobs/email-delivery.js";
import { canRunDocker } from "../../lib/can-run-docker.js";
import { createTemplateRenderer } from "../template-renderer.js";

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
    .withDatabase("email_real_renderer")
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
  return { data, queueName: "email-delivery", id: "job-real-renderer" } as unknown as Job;
}

SUITE("email-delivery + real WorkerTemplateRenderer", () => {
  it("renders en email_verification through the full handler pipeline", async () => {
    if (!h) throw new Error("harness");
    const sent: Array<{ subject: string; text: string; html?: string; to: string }> = [];
    const sender: EmailSender = {
      async send(args) {
        sent.push(args);
        return { delivered: true };
      },
    };
    const renderer = createTemplateRenderer();
    const handler = buildEmailDeliveryHandler({ pool: h.pool, sender, renderer });
    await handler(
      fakeJob({
        tenant_id: TENANT,
        to: "user@example.com",
        template_id: "email_verification",
        locale: "en",
        variables: { name: "Alex", verification_url: "https://example.com/verify?t=xyz" },
        request_id: REQ,
      }),
    );
    expect(sent).toHaveLength(1);
    const msg = sent[0];
    if (!msg) throw new Error("no message captured");
    expect(msg.to).toBe("user@example.com");
    expect(msg.subject).toContain("Verify your OpenWhispr email address");
    expect(msg.text).toContain("Hello Alex,");
    expect(msg.text).toContain("https://example.com/verify?t=xyz");
    expect(msg.html ?? "").toContain("https://example.com/verify?t=xyz");
  });

  it("renders ru password_reset through the full handler pipeline", async () => {
    if (!h) throw new Error("harness");
    const sent: Array<{ subject: string; text: string; html?: string; to: string }> = [];
    const sender: EmailSender = {
      async send(args) {
        sent.push(args);
        return { delivered: true };
      },
    };
    const renderer = createTemplateRenderer();
    const handler = buildEmailDeliveryHandler({ pool: h.pool, sender, renderer });
    await handler(
      fakeJob({
        tenant_id: TENANT,
        to: "user@example.com",
        template_id: "password_reset",
        locale: "ru",
        variables: {
          name: "Alex",
          reset_url: "https://example.com/reset?t=xyz",
          expires_minutes: 45,
        },
        request_id: REQ,
      }),
    );
    expect(sent).toHaveLength(1);
    const msg = sent[0];
    if (!msg) throw new Error("no message captured");
    // Cyrillic must be present in subject + text for ru bundle.
    expect(/[Ѐ-ӿ]/.test(msg.subject)).toBe(true);
    expect(/[Ѐ-ӿ]/.test(msg.text)).toBe(true);
    expect(msg.text).toContain("45");
    expect(msg.text).toContain("https://example.com/reset?t=xyz");
  });

  it("surfaces UnknownTemplateError as a job failure (BullMQ retry surface)", async () => {
    if (!h) throw new Error("harness");
    const sender: EmailSender = {
      async send() {
        return { delivered: true };
      },
    };
    const renderer = createTemplateRenderer();
    const handler = buildEmailDeliveryHandler({ pool: h.pool, sender, renderer });
    await expect(
      handler(
        fakeJob({
          tenant_id: TENANT,
          to: "user@example.com",
          template_id: "not_a_template",
          locale: "en",
          variables: {},
          request_id: REQ,
        }),
      ),
    ).rejects.toThrow(/not_a_template/);
  });
});
