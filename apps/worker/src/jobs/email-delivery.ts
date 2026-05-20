// SPDX-License-Identifier: FSL-1.1-ALv2
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

// Phase 51 / Plan 51-17 (REVIEW small-pkgs HIGH) — `EmailSender` is now
// re-exported from `@openwhispr/email`, the canonical source. Pre-fix
// this file declared a parallel `interface EmailSender` that could
// drift from the package shape (and did — the package's interface has
// an extra `from?` field).
import type { EmailSender as EmailSenderPkg } from "@openwhispr/email";
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
 * Phase 51 / Plan 51-17 — `EmailSender` re-exported from
 * `@openwhispr/email` (single source of truth). Pre-fix this file
 * declared a parallel interface that had already drifted from the
 * package shape.
 */
export type EmailSender = EmailSenderPkg;

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
  /**
   * Phase 66 / CR-03 — explicit opt-in for the SMTP-not-configured
   * non-fatal carve-out. When the EmailSender returns `{ delivered:false,
   * reason:"smtp-not-configured" }` (the dev no-op path in
   * `@openwhispr/email`) AND this flag is `true`, the handler resolves
   * cleanly instead of throwing — so a fresh `docker compose up` with no
   * SMTP env vars does not burn BullMQ retry attempts.
   *
   * When `false` (the default for any operator who has not explicitly
   * set `EMAIL_FALLBACK_NONFATAL`), an undelivered email FAILS the job so
   * BullMQ retries / DLQs it — no silent green for an unsent email. This
   * flag is resolved in `config/worker-config.ts` from
   * `EMAIL_FALLBACK_NONFATAL`; it is NEVER derived from `NODE_ENV`
   * (CR-03 closed the LOCKER-01 / CLAUDE.md rule-11 violation).
   */
  allowSmtpFallback: boolean;
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
      // Phase 66 / CR-03: SMTP-not-configured carve-out. Only the
      // canonical `smtp-not-configured` reason emitted by
      // @openwhispr/email's no-op sender takes the non-fatal path, and
      // ONLY when the operator explicitly opted in via
      // `EMAIL_FALLBACK_NONFATAL` (threaded as deps.allowSmtpFallback).
      // Every other reason — and `smtp-not-configured` WITHOUT the flag
      // — keeps the retry-throw posture so BullMQ retries / DLQs the
      // undelivered email. No silent green for an unsent email.
      if (result.reason === "smtp-not-configured" && deps.allowSmtpFallback) {
        return;
      }
      throw new Error(
        `email-delivery send did not deliver (template=${data.template_id} reason=${result.reason ?? "unknown"})`,
      );
    }
  });
}
