// Phase 2 / Plan 04 / Task 1 — `EmailService` (D-26 / PROVIDER-04).
//
// Source of truth: 02-RESEARCH-CONTAINER.md § Pattern 4.
//
// Two paths:
//
//   1. Dev fallback — `SMTP_HOST` is unset. We log a warn at construction
//      with `event:"email.smtp_not_configured"` so operators can grep it
//      and return a stub `.send()` that resolves with
//      `{delivered:true, reason:"smtp-not-configured"}`. Better Auth's
//      `sendVerificationEmail` then completes successfully and (with
//      `requireEmailVerification` paired with our wiring) the account
//      is treated as best-effort verified for the < 5 min OSS first-
//      launch SLO.
//
//   2. Real SMTP — `SMTP_HOST` is set. We construct a nodemailer
//      transport with `secure` auto-derived from the port (465 -> true,
//      else false; CONTAINER Pitfall — never hardcode). `.send()` calls
//      `transport.sendMail` and RE-THROWS on failure (Pitfall #4 — no
//      log-and-swallow), so Better Auth keeps the verification record
//      unverified and operators see the error in logs.
//
// Auth credentials are only attached when BOTH `SMTP_USER` and
// `SMTP_PASSWORD` are present — many internal relays don't require auth
// and passing partial credentials confuses the negotiation.
import nodemailer, { type Transporter } from "nodemailer";
import type { FastifyBaseLogger } from "fastify";

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

export interface EmailService {
  send(args: SendArgs): Promise<SendResult>;
}

export function makeEmailService(log: FastifyBaseLogger): EmailService {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM ?? "no-reply@openwhispr.local";

  // Dev fallback: SMTP_HOST unset -> stub. Logs warn at construction so
  // `event:"email.smtp_not_configured"` is greppable in operator
  // logs/Loki dashboards.
  if (!host) {
    log.warn(
      { event: "email.smtp_not_configured" },
      "SMTP_HOST not set — email delivery is no-op (dev mode). Verification emails will not be sent.",
    );
    return {
      async send({ to, subject }) {
        log.info(
          { to, subject, event: "email.skipped" },
          "email skipped (SMTP not configured)",
        );
        return { delivered: true, reason: "smtp-not-configured" };
      },
    };
  }

  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const auth = user && password ? { user, pass: password } : undefined;

  const transporter: Transporter = nodemailer.createTransport({
    host,
    port,
    // 465 implicit TLS; 587/STARTTLS and mailpit:1025 plaintext.
    secure: port === 465,
    auth,
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
        log.info(
          { to, subject, messageId: info.messageId, event: "email.sent" },
          "email sent",
        );
        return { delivered: true };
      } catch (err) {
        // Pitfall #4: NEVER swallow. Better Auth must see the rejection so
        // the verification record stays unverified.
        log.error({ err, to, subject, event: "email.failed" }, "email send failed");
        throw err;
      }
    },
  };
}
