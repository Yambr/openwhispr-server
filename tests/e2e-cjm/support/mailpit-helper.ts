// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 01 / Task 13-01-07 — mailpit polling helper for the
// signup-verify CJM scenarios.
//
// Mailpit catches every outbound SMTP message the api emits during signup
// (SMTP_HOST=mailpit in .env routes Better Auth's verification mail to the
// in-cluster mailpit container). The mailpit HTTP API exposes:
//
//   GET  /api/v1/messages?query=to:<addr>            # list summaries
//   GET  /api/v1/message/{id}                         # full message body
//   GET  /api/v1/messages                             # list all (paginated)
//
// Reach (plan OQ-1, Option B BINDING): via Traefik at
// `https://mailpit.localhost/api/v1/...`. The Traefik labels on the mailpit
// service are added to `docker-compose.yml` in Session 5 alongside the
// atomic commit. THIS module's default URL is the canonical Traefik
// hostname; tests / CI can override with the env `MAILPIT_API_URL`.
//
// CLAUDE.md anti-mock rule: we hit the REAL mailpit API. Tests in
// Session 5 use a live mailpit; this Session-4 module only ships the
// helper module, not unit tests against a synthetic mailpit. The unit-test
// budget for harder-to-test I/O modules is documented as deferred per the
// session prompt's constitutional-rule note.

import { Agent, fetch as undiciFetch } from "undici";

export const DEFAULT_MAILPIT_API_URL =
  process.env.MAILPIT_API_URL ?? "https://mailpit.localhost/api/v1";

/** Subset of mailpit message-summary shape used here. */
export interface MailpitMessageSummary {
  ID: string;
  From: { Address: string; Name?: string };
  To: Array<{ Address: string; Name?: string }>;
  Subject: string;
  Created: string;
}

/** Subset of mailpit full-message shape used here. */
export interface MailpitMessage {
  ID: string;
  From: { Address: string; Name?: string };
  To: Array<{ Address: string; Name?: string }>;
  Subject: string;
  HTML: string;
  Text: string;
  Created: string;
}

export interface WaitForEmailOptions {
  /** Override the mailpit base URL. Default = `MAILPIT_API_URL` env or `https://mailpit.localhost/api/v1`. */
  baseUrl?: string;
  /** Total deadline. Default 60_000. */
  timeoutMs?: number;
  /** Poll interval. Default 1_000. */
  intervalMs?: number;
  /** Subject substring filter (case-insensitive). Optional. */
  subjectContains?: string;
  /** Earliest acceptable `Created` timestamp (ISO 8601). Older messages are ignored. */
  notBefore?: string;
  /** DI seam for tests. */
  fetchFn?: typeof undiciFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

function makeLocalhostDispatcher(baseUrl: string): Agent | undefined {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return undefined;
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    return new Agent({ connect: { rejectUnauthorized: false } });
  }
  return undefined;
}

/**
 * Poll the mailpit search endpoint until at least one message addressed
 * to `toAddress` arrives, then fetch the full body and return it. Throws
 * on deadline.
 */
export async function waitForEmail(
  toAddress: string,
  opts: WaitForEmailOptions = {},
): Promise<MailpitMessage> {
  const baseUrl = opts.baseUrl ?? DEFAULT_MAILPIT_API_URL;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const fetchFn = opts.fetchFn ?? undiciFetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const dispatcher = makeLocalhostDispatcher(baseUrl);

  const subjectNeedle = opts.subjectContains?.toLowerCase();
  const notBefore = opts.notBefore ? Date.parse(opts.notBefore) : undefined;
  const started = now();
  let lastErr: unknown;

  while (now() - started < timeoutMs) {
    try {
      const query = encodeURIComponent(`to:${toAddress}`);
      const searchUrl = `${baseUrl}/messages?query=${query}`;
      const res = await fetchFn(searchUrl, { dispatcher });
      if (res.ok) {
        const body = (await res.json()) as {
          messages?: MailpitMessageSummary[];
        };
        const summaries = Array.isArray(body.messages) ? body.messages : [];
        const match = summaries.find((m) => {
          if (subjectNeedle && !m.Subject.toLowerCase().includes(subjectNeedle)) {
            return false;
          }
          if (notBefore !== undefined && Date.parse(m.Created) < notBefore) {
            return false;
          }
          return true;
        });
        if (match) {
          const detailRes = await fetchFn(`${baseUrl}/message/${match.ID}`, {
            dispatcher,
          });
          if (detailRes.ok) {
            return (await detailRes.json()) as MailpitMessage;
          }
          lastErr = new Error(`mailpit GET /message/${match.ID} returned ${detailRes.status}`);
        }
      } else {
        lastErr = new Error(`mailpit search returned ${res.status}`);
      }
    } catch (err) {
      lastErr = err;
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `waitForEmail: no message for ${toAddress} arrived within ${timeoutMs}ms ` +
      `(last_err=${String(lastErr)})`,
  );
}

/**
 * Pull the verification link out of a Better Auth verification email. The
 * upstream templates emit an HTTPS link of the form
 * `https://api.localhost/api/auth/verify-email?token=...` (HTML body) or
 * the same URL in the plain-text body. We prefer the HTML body's first
 * `https://.*verify-email\?token=` URL; fall back to the text body.
 */
export function extractVerificationLink(msg: MailpitMessage): string {
  // Pattern: scheme://host/.../verify-email?token=...; tolerate query order.
  // The path segment "verify-email" is the canonical Better Auth verifier
  // endpoint per BACKEND_SPEC; if a future skin renames it, update this
  // regex AND the corresponding step in `steps/auth.steps.ts`.
  const re = /https?:\/\/[^\s"'<>]+\/verify-email\?[^\s"'<>]*token=[^\s"'<>&]+[^\s"'<>]*/i;
  const fromHtml = msg.HTML?.match(re)?.[0];
  if (fromHtml) return fromHtml;
  const fromText = msg.Text?.match(re)?.[0];
  if (fromText) return fromText;
  throw new Error(
    `extractVerificationLink: no verify-email URL found in message ${msg.ID} ` +
      `(subject="${msg.Subject}")`,
  );
}
