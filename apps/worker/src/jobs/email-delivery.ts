// SPDX-License-Identifier: Apache-2.0
// Phase 6 Plan 06-08 — email-delivery BullMQ job.
//
// D-W5 (queue inventory): Tenant context, on-demand from auth/admin routes.
// D-A7 (payload conventions): {tenant_id, to, template_id, locale, variables,
// request_id}. PII (recipient, variables) must NEVER appear in logs — the
// worker process configures pino redact paths via the pino-redact plumbing
// landed in Plan 06-04. Our log lines here only reference `template_id`,
// `tenant_id`, `request_id`.
//
// Templates are rendered by the API package's email service (the same
// nodemailer-backed transport Phase 2 Plan 04 shipped). The worker invokes
// the service by importing the renderer + transporter factory. To keep the
// job's surface testable without booting the whole API package, the
// `sender` collaborator is injected at construction time — production code
// wires `apps/api/src/email.makeEmailService(log)` as the sender; tests pass
// a stub.
//
// Idempotency: BullMQ jobIds default to a random UUID; the API route that
// enqueues an email-delivery job is responsible for passing a jobId
// derived from `request_id` so a duplicate enqueue collapses to one job
// (BullMQ's removeOnComplete plus jobId-de-dupe). This job handler does
// NOT retry-de-dupe at the application layer; SMTP-side dedupe is the
// operator's responsibility.

import type { Pool } from "pg";
import { z } from "zod";
import { withTenantContext } from "../lib/with-tenant-context.js";

/** Locked Zod schema for the email-delivery payload (D-A7). */
export const emailDeliverySchema = z.object({
  tenant_id: z.string().uuid(),
  to: z.string().email(),
  template_id: z.string().min(1),
  locale: z.enum(["en", "ru"]).default("en"),
  variables: z.record(z.string(), z.unknown()).default({}),
  request_id: z.string().uuid(),
});

export type EmailDeliveryPayload = z.infer<typeof emailDeliverySchema>;

/**
 * Minimal interface the email-delivery job needs from the SMTP transport.
 * `apps/api/src/email.ts` exports a compatible `EmailService` shape — the
 * worker can wrap it (or any equivalent) into a `EmailSender`.
 */
export interface EmailSender {
  send(args: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<{ delivered: boolean; reason?: string }>;
}

/** Template renderer — production wires this to apps/api's i18n + template lookup. */
export interface TemplateRenderer {
  render(
    templateId: string,
    locale: "en" | "ru",
    variables: Record<string, unknown>,
  ): { subject: string; text: string; html?: string };
}

export interface EmailDeliveryDeps {
  pool: Pool;
  sender: EmailSender;
  renderer: TemplateRenderer;
}

/**
 * Construct the Tenant-context handler. Wrap with withTenantContext so the
 * SQL pool is bound to `app.tenant_id` (the email template may reference
 * tenant-scoped data via the renderer in future). All collaborators are
 * injected so tests can verify the SMTP boundary without booting nodemailer.
 */
export function buildEmailDeliveryHandler(
  deps: EmailDeliveryDeps,
): (job: import("bullmq").Job) => Promise<void> {
  return withTenantContext(emailDeliverySchema, deps.pool, async (data) => {
    const rendered = deps.renderer.render(data.template_id, data.locale, data.variables);
    const result = await deps.sender.send({
      to: data.to,
      subject: rendered.subject,
      text: rendered.text,
      ...(rendered.html ? { html: rendered.html } : {}),
    });
    if (!result.delivered) {
      // Surface a throw so BullMQ retries on transient send failure.
      throw new Error(
        `email-delivery send did not deliver (template=${data.template_id} reason=${result.reason ?? "unknown"})`,
      );
    }
  });
}
