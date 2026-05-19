// SPDX-License-Identifier: FSL-1.1-ALv2
// Long-form happy-path e2e: a brand-new user signs up via the web UI,
// retrieves the verification email from mailpit, clicks the link, and
// then signs in successfully. Zero browser console errors throughout.
//
// This spec talks to the REAL stack:
//   - apps/web on http://localhost:3000
//   - apps/api on http://localhost:4000
//   - mailpit HTTP API on http://localhost:8025
//
// It is intentionally NOT topology-gated (runs only against `traefik`
// equivalent — direct localhost ports, not slim or ingress). The
// fixtures-based specs in u1..u13 cover slim e2e; this one is the
// long-form acceptance for the dev-stack OOB flow.

import { test as base, expect } from "@playwright/test";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "./support/browser-diagnostics.js";

const WEB_BASE = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000";
const MAILPIT_BASE = process.env.MAILPIT_API_URL ?? "http://localhost:8025/api/v1";

interface MailpitMessage {
  ID: string;
  Created: string;
}

interface MailpitMessageFull {
  HTML?: string;
  Text?: string;
}

async function fetchVerificationLink(
  email: string,
  notBefore: Date,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listUrl = `${MAILPIT_BASE}/messages?query=${encodeURIComponent(`to:${email}`)}`;
    const listRes = await fetch(listUrl);
    if (listRes.ok) {
      const body = (await listRes.json()) as { messages?: MailpitMessage[] };
      const candidate = (body.messages ?? []).find(
        (m) => Date.parse(m.Created) >= notBefore.getTime() - 1000,
      );
      if (candidate) {
        const fullRes = await fetch(`${MAILPIT_BASE}/message/${candidate.ID}`);
        if (fullRes.ok) {
          const msg = (await fullRes.json()) as MailpitMessageFull;
          // Verification link can land in either HTML or Text body.
          // The verify-email URL targets the API directly (Better Auth
          // mints absolute URLs from AUTH_URL), so it carries
          // /api/auth/verify-email or /verify-email depending on the
          // template.
          const pattern =
            /https?:\/\/[^\s"'<>]+\/(?:verify-email|api\/auth\/verify-email)\?[^\s"'<>]*token=[^\s"'<>&]+/i;
          const link = msg.HTML?.match(pattern)?.[0] ?? msg.Text?.match(pattern)?.[0];
          if (link) return link;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No verification email arrived for ${email} within ${timeoutMs}ms`);
}

async function clearMailpit(): Promise<void> {
  try {
    await fetch(`${MAILPIT_BASE}/messages`, { method: "DELETE" });
  } catch {
    /* mailpit may not be reachable in some envs — let the test fail later */
  }
}

const test = base.extend<{ attach: undefined }>({
  attach: [
    async ({ page }, use) => {
      attachBrowserDiagnostics(page);
      await use(undefined);
      expectNoBrowserErrors(page);
    },
    { auto: true },
  ],
});

test.describe("Full sign-up → verify → sign-in flow (dev-stack OOB)", () => {
  test.beforeAll(async () => {
    await clearMailpit();
  });

  test("registers, verifies, signs in, and lands on /app with zero console errors", async ({
    page,
    context,
  }) => {
    // Unique email per run so we never collide with prior runs in the same
    // mailpit DB or postgres volume.
    const uniq = `flow+${Date.now()}@local.test`;
    const password = "correct-horse-battery-staple-9";
    const cursor = new Date();

    // 1. Sign-up via the web UI.
    await page.goto(`${WEB_BASE}/sign-up`);
    await expect(page).toHaveURL(/\/sign-up$/);
    await page.getByLabel(/^Name/i).fill("Flow User");
    await page.getByLabel(/^Email/i).fill(uniq);
    await page.getByLabel(/^Password/i).fill(password);
    // Some forms have a "Confirm password" / "Terms" — handle defensively.
    const confirm = page.getByLabel(/Confirm password/i);
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.fill(password);
    }
    const terms = page.getByRole("checkbox", { name: /terms/i });
    if (await terms.isVisible().catch(() => false)) {
      await terms.check();
    }
    await page.getByRole("button", { name: /sign up|create account|register/i }).click();

    // After sign-up the UI should either show "check your email" copy or
    // redirect to /sign-in with a banner. Wait for either.
    await page.waitForLoadState("networkidle");
    const checkEmailVisible = await page
      .getByText(/check your email|verify|verification/i)
      .first()
      .isVisible()
      .catch(() => false);
    const onSignIn = page.url().endsWith("/sign-in") || page.url().includes("/sign-in?");
    expect(checkEmailVisible || onSignIn).toBe(true);

    // 2. Retrieve the verification link from mailpit.
    const verifyLink = await fetchVerificationLink(uniq, cursor);

    // 3. Visit the verification link — Better Auth flips email_verified=true
    //    and 302s somewhere (root or /sign-in?verified=1).
    const verifyRes = await context.request.get(verifyLink);
    // Playwright follows redirects by default — final status is 200 on
    // happy path. The intermediate 302 is invisible at this layer.
    expect([200, 302, 303]).toContain(verifyRes.status());

    // 4. Sign in via the UI.
    await page.goto(`${WEB_BASE}/sign-in`);
    await page.getByLabel(/^Email/i).fill(uniq);
    await page.getByLabel(/^Password/i).fill(password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    // 5. Land on /app (or /app/account / /app/anything). The exact landing
    //    page depends on whether the user has resources seeded; the test
    //    only asserts the auth boundary cleared.
    await page.waitForURL(/\/app(\/.*)?$/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/app(\/.*)?$/);

    // 6. Sign out cleanly.
    await context.request.post(`${API_BASE}/api/auth/sign-out`, {
      headers: { "content-type": "application/json", origin: WEB_BASE },
      data: {},
    });
    // Hitting /app after sign-out redirects to /sign-in.
    await page.goto(`${WEB_BASE}/app`);
    await page.waitForURL(/\/sign-in(\?|$)/, { timeout: 5_000 });
  });
});
