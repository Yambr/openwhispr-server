// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 54 / Plan 54-01 GREEN — mailpit Playwright support helper.
//
// Single source of truth for pulling verify-email and password-reset
// links out of mailpit during long-form e2e flows. Replaces:
//   * the inline `fetchVerificationLink` in
//     apps/web/tests/e2e/100-fullflow-signup-verify-signin.spec.ts
//     (lines 33-74), and
//   * the undici/TLS-bypass-Agent `fetchVerificationUrl` in
//     tests/e2e-cjm/steps/signin.steps.ts (lines 61-94).
//
// Mailpit is plain HTTP on localhost:8025 → we use the global fetch
// (no undici Agent, no TLS bypass needed). Polling cadence + the
// `since - 1s` slack mirror the original inline helper exactly so the
// existing 100-fullflow spec continues to match the same emails after
// 54-02 migrates it to this module.
//
// NOTE: the mailpit `to:` query is case-insensitive on the local-part
// but case-sensitive on the host. We do NOT lowercase `email`. If a
// future caller passes a mixed-case host the lookup may miss; the
// existing call-sites use lower-cased `@test.local` / `@local.test`.
export interface MailpitFetchOptions {
  /** Lower bound on Created timestamp; messages older than (since - 1s) are skipped. */
  since: Date;
  /** Max wall-clock budget. Default 15_000. */
  timeoutMs?: number;
  /** Poll interval between mailpit list calls. Default 300. */
  pollIntervalMs?: number;
}

export const MAILPIT_BASE: string = process.env.MAILPIT_API_URL ?? "http://localhost:8025/api/v1";

interface MailpitMessage {
  ID: string;
  Created: string;
}

interface MailpitMessageListBody {
  messages?: MailpitMessage[];
}

interface MailpitMessageFullBody {
  HTML?: string;
  Text?: string;
}

// Verify-email link can land in either the HTML or the Text body. The
// regex is BYTE-IDENTICAL to the one in 100-fullflow-signup-verify-
// signin.spec.ts lines 56-58 — diverging here means the migrated spec
// stops matching the same mails.
const VERIFY_LINK_PATTERN =
  /https?:\/\/[^\s"'<>]+\/(?:verify-email|api\/auth\/verify-email)\?[^\s"'<>]*token=[^\s"'<>&]+/i;

// Password-reset link uses the web-UI route; Better Auth's reset
// template embeds an absolute URL pointing at WEB_BASE/reset-password.
const RESET_LINK_PATTERN = /https?:\/\/[^\s"'<>]+\/reset-password\?[^\s"'<>]*token=[^\s"'<>&]+/i;

async function pollForLink(
  email: string,
  opts: MailpitFetchOptions,
  pattern: RegExp,
  notFoundLabel: string,
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 300;
  const sinceFloor = opts.since.getTime() - 1_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const listUrl = `${MAILPIT_BASE}/messages?query=${encodeURIComponent(`to:${email}`)}`;
    const listRes = await fetch(listUrl);
    if (listRes.ok) {
      const body = (await listRes.json()) as MailpitMessageListBody;
      const candidate = (body.messages ?? []).find((m) => Date.parse(m.Created) >= sinceFloor);
      if (candidate) {
        const fullRes = await fetch(`${MAILPIT_BASE}/message/${candidate.ID}`);
        if (fullRes.ok) {
          const msg = (await fullRes.json()) as MailpitMessageFullBody;
          const link = msg.HTML?.match(pattern)?.[0] ?? msg.Text?.match(pattern)?.[0];
          if (link) return link;
        }
      }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`No ${notFoundLabel} arrived for ${email} within ${timeoutMs}ms`);
}

/** Returns the absolute verify-email URL extracted from the latest
 *  matching mailpit message, or throws after `opts.timeoutMs`. Matches
 *  both `/verify-email` (web-UI variant) and `/api/auth/verify-email`
 *  (Better Auth direct-API variant). */
export function fetchVerificationLink(email: string, opts: MailpitFetchOptions): Promise<string> {
  return pollForLink(email, opts, VERIFY_LINK_PATTERN, "verification email");
}

/** Returns the absolute password-reset URL extracted from the latest
 *  matching mailpit message, or throws after `opts.timeoutMs`. */
export function fetchPasswordResetLink(email: string, opts: MailpitFetchOptions): Promise<string> {
  return pollForLink(email, opts, RESET_LINK_PATTERN, "password-reset email");
}

/** Issues DELETE ${MAILPIT_BASE}/messages to purge the mailpit inbox.
 *  Silently swallows network errors — the call-site MUST treat clear
 *  as best-effort and rely on the per-test `since` cursor for ordering
 *  isolation. */
export async function clearMessages(): Promise<void> {
  try {
    await fetch(`${MAILPIT_BASE}/messages`, { method: "DELETE" });
  } catch {
    // Best-effort. Mailpit may not be reachable in some envs; the test
    // will fail later when fetchVerificationLink times out.
  }
}
