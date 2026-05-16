// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 01 / Task 04 — Shared, Fastify-decoupled email-sending
// library. Extracted from apps/api/src/email.ts and hardened with:
//   * Structural `Logger` interface (no @fastify/* coupling — works with
//     pino, Fastify's logger, or a plain `{ info, warn, error }` object).
//   * Production loud-fail gate: throws at construction when
//     `NODE_ENV === "production"` and `SMTP_HOST` is unset. Dev fallback
//     (warn + no-op sender) is retained only for non-production.
//   * Explicit `SMTP_SECURE` env override (defaults to the `port === 465`
//     heuristic when unset).
//   * Explicit `SMTP_REJECT_UNAUTHORIZED` env (defaults to `true`); set to
//     `"false"` to propagate `tls: { rejectUnauthorized: false }` to
//     nodemailer for self-signed corporate relays.
//   * NEVER swallow sendMail errors — Better Auth must see the rejection so
//     the verification record stays unverified (Pitfall #4 from
//     `02-RESEARCH-CONTAINER.md`).
//
// Env-var contract (see README.md for full operator-facing docs):
//   SMTP_HOST                 (required in production; absence triggers
//                              dev-fallback in non-prod, loud-fail in prod)
//   SMTP_PORT                 (default 587)
//   SMTP_SECURE               ("true"/"false"; default derived from port)
//   SMTP_REJECT_UNAUTHORIZED  ("true"/"false"; default "true")
//   SMTP_USER                 (optional; auth attached only with PASSWORD)
//   SMTP_PASSWORD             (optional; auth attached only with USER)
//   SMTP_FROM                 (default "no-reply@openwhispr.local")
//   NODE_ENV                  ("production" enforces SMTP_HOST presence)
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Structural logger contract. Compatible with Fastify's base logger, pino's
 * `Logger`, and a plain object `{ info, warn, error }` shape. The package
 * intentionally does NOT depend on `fastify` — callers wire their own
 * logger through.
 */
export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface SendArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendResult {
  delivered: boolean;
  reason?: string;
}

export interface EmailSender {
  send(args: SendArgs): Promise<SendResult>;
}

export interface CreateEmailSenderOpts {
  log: Logger;
  env: NodeJS.ProcessEnv;
}

// Phase 41.g / HI-03 — accept the common truthy env-flag spellings operators
// write in .env files. Strict `=== "true"` silently rejects `1` / `TRUE` /
// `yes` / `on` and falls back to the port heuristic, which can downgrade
// SMTP to plaintext when the operator believed they had opted into TLS.
function parseBoolEnv(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.toLowerCase().trim());
}

/**
 * Build an `EmailSender` from the given environment. Performs all env
 * validation at construction time so misconfiguration surfaces during boot
 * (not on the first verification email). In production, throws if
 * `SMTP_HOST` is unset — there is no dev fallback path for production.
 */
export function createEmailSender(opts: CreateEmailSenderOpts): EmailSender {
  const { log, env } = opts;
  const host = env.SMTP_HOST;
  const from = env.SMTP_FROM ?? "no-reply@openwhispr.local";

  if (!host) {
    // Production loud-fail (must_have truth #7): refusing to silently
    // swallow verification emails in prod is non-negotiable. Throw at
    // module init so the api/worker boot crashes loudly instead of
    // limping along with a no-op sender.
    if (env.NODE_ENV === "production") {
      throw new Error(
        "SMTP_HOST is required in production (event:email.smtp_required_in_production)",
      );
    }
    // Dev fallback: greppable warn + stub sender. Better Auth then
    // treats verification as best-effort delivered so the OSS first-
    // launch SLO (<5 min) survives a fresh `docker compose up` with
    // no SMTP configured.
    log.warn(
      { event: "email.smtp_not_configured" },
      "SMTP not configured; emails will not be delivered (dev fallback)",
    );
    return {
      async send({ to, subject }) {
        // Phase 13 review HI-01: NEVER swallow. The previous shape returned
        // `delivered:true` which lied to Better Auth and the worker's
        // email-delivery job — silent black hole on any non-prod env that
        // forgot SMTP_HOST (staging, qa, CI without mailpit). Per file-header
        // Pitfall #4 ("NEVER swallow"), the dev-fallback now reports
        // `delivered:false` with a stable `reason` token so callers can
        // distinguish "skipped because SMTP unconfigured" from a real
        // transport failure. Worker treats `smtp-not-configured` as a
        // non-fatal skip in non-prod (see apps/worker/src/jobs/email-delivery.ts).
        log.warn({ to, subject, event: "email.skipped" }, "email skipped (SMTP not configured)");
        return { delivered: false, reason: "smtp-not-configured" };
      },
    };
  }

  const port = Number(env.SMTP_PORT ?? "587");
  const user = env.SMTP_USER;
  const password = env.SMTP_PASSWORD;
  // SMTP_SECURE explicit override beats port heuristic. Heuristic is
  // `port === 465` (implicit TLS); 587/STARTTLS and 1025/mailpit are
  // plaintext-or-STARTTLS, so secure=false by default. Accept the common
  // truthy spellings operators write in .env files (1/true/yes/on, any
  // case, trimmed) — strict `=== "true"` silently downgrades to plaintext.
  const secure = env.SMTP_SECURE !== undefined ? parseBoolEnv(env.SMTP_SECURE) : port === 465;
  // Default to verifying the server cert. Operators set
  // SMTP_REJECT_UNAUTHORIZED=false ONLY when intentionally connecting to
  // a self-signed internal relay (corporate dev environments).
  const rejectUnauthorized = env.SMTP_REJECT_UNAUTHORIZED !== "false";
  const auth = user && password ? { user, pass: password } : undefined;
  const tls = rejectUnauthorized ? undefined : { rejectUnauthorized: false };

  const transporter: Transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth,
    ...(tls ? { tls } : {}),
  });

  return {
    async send({ to, subject, text, html }) {
      try {
        const info = await transporter.sendMail({
          from,
          to,
          subject,
          text,
          html,
        });
        log.info({ to, subject, messageId: info.messageId, event: "email.sent" }, "email sent");
        return { delivered: true };
      } catch (err) {
        // Pitfall #4: NEVER swallow. Better Auth must see the rejection
        // so the verification record stays unverified and operators see
        // the error in logs / Loki.
        log.error({ err, to, subject, event: "email.failed" }, "email send failed");
        throw err;
      }
    },
  };
}
