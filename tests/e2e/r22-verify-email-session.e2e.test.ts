// SPDX-License-Identifier: FSL-1.1-ALv2
// R22 — sign-up → verify leaves the desktop client with a working
// session, full-stack e2e.
//
// Gated by `E2E=1`. Boots the real docker-compose stack (Traefik TLS →
// api → Postgres + PgBouncer + Valkey + worker + mailpit) and drives the
// EXACT desktop sign-up → verify journey that R22 fixes:
//
//   1. `POST /api/auth/sign-up/email` over HTTPS — under
//      `requireEmailVerification` this issues NO session.
//   2. The BullMQ worker renders the verification email and delivers it
//      to the bundled `mailpit` SMTP catch-all (HTTP API on
//      `127.0.0.1:8025`). The test polls mailpit, extracts the
//      verification URL, and asserts it carries the R22-rewritten
//      `callbackURL=/api/auth/verify-email-complete`.
//   3. A real `GET /api/auth/verify-email?token=…&callbackURL=…` over
//      HTTPS — exactly the desktop link click. Better Auth verifies the
//      user, creates a session (autoSignInAfterVerification), sets the
//      session cookie, and 302-redirects to the callbackURL.
//   4. Following that 302 (carrying the just-set cookie) hits
//      `GET /api/auth/verify-email-complete`, which 302-redirects to the
//      desktop auth-bridge `http://127.0.0.1:5199/oauth/callback?
//      bearer_token=<token>`.
//   5. The extracted bearer is replayed on `GET /api/usage` over HTTPS →
//      200 — proving the desktop client now holds a WORKING session.
//
// CLAUDE.md `no mocks of internal logic`: real Better Auth sign-up +
// verify-email + session mint, real worker email render + SMTP delivery,
// real verify-email-complete handler, real dual-auth bearer resolution,
// real Postgres. mailpit is the only stand-in (a real SMTP boundary).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BACKEND_URL } from "./compose-helper.js";
import { type Phase6Stack, phase6BringStackUp } from "./helpers/phase6-compose.js";

/** Mailpit HTTP API — bundled in base docker-compose.yml on 127.0.0.1:8025. */
const MAILPIT_API = "http://127.0.0.1:8025/api/v1";

interface MailpitMessageSummary {
  ID: string;
  To: Array<{ Address: string }>;
}

/** Poll mailpit for the verification email and extract its verify URL. */
async function fetchVerificationUrl(email: string): Promise<string> {
  const deadline = Date.now() + 60_000;
  const lower = email.toLowerCase();
  while (Date.now() < deadline) {
    const listRes = await fetch(`${MAILPIT_API}/messages?limit=200`);
    if (listRes.ok) {
      const list = (await listRes.json()) as { messages?: MailpitMessageSummary[] };
      const match = (list.messages ?? []).find((m) =>
        m.To.some((t) => t.Address.toLowerCase() === lower),
      );
      if (match) {
        const msgRes = await fetch(`${MAILPIT_API}/message/${match.ID}`);
        if (msgRes.ok) {
          const msg = (await msgRes.json()) as { HTML?: string; Text?: string };
          const haystack = `${msg.HTML ?? ""} ${msg.Text ?? ""}`;
          const urlMatch = haystack.match(/https?:\/\/[^\s"'<>]+verify-email[^\s"'<>]*/);
          if (urlMatch) return urlMatch[0];
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`no verification email for ${email} arrived in mailpit within 60s`);
}

const SUITE_TIMEOUT_MS = 540_000;

let stack: Phase6Stack | undefined;

beforeAll(async () => {
  stack = await phase6BringStackUp();
}, SUITE_TIMEOUT_MS);

afterAll(async () => {
  await stack?.down();
}, 120_000);

/** Per-call unique X-Forwarded-For so the rate-limiter buckets each test. */
let xff = Math.floor(Math.random() * 0xff_ff_ff);
function nextIp(): string {
  xff = (xff + 1) & 0xff_ff_ff;
  return `10.${(xff >>> 16) & 0xff}.${(xff >>> 8) & 0xff}.${xff & 0xff}`;
}

/** Reduce a response's Set-Cookie headers to a `name=value; …` jar string. */
function setCookieJar(res: Response): string {
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = typeof getSetCookie === "function" ? getSetCookie.call(res.headers) : [];
  return cookies
    .map((c) => c.split(";")[0]?.trim())
    .filter((v): v is string => Boolean(v))
    .join("; ");
}

async function signUp(email: string): Promise<Response> {
  return fetch(`${BACKEND_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: BACKEND_URL,
      "x-forwarded-for": nextIp(),
    },
    body: JSON.stringify({ email, password: "R22!Str0ngPass", name: "R22 E2E" }),
    redirect: "manual",
  });
}

describe("e2e — R22 sign-up → verify yields a working desktop session (real compose stack)", () => {
  it(
    "sign-up → verify-email → verify-email-complete → loopback bearer → /api/usage 200",
    async () => {
      if (!stack) throw new Error("compose stack not up");
      const email = `r22-e2e-${Date.now()}@example.test`;

      // (1) Sign up — no session under requireEmailVerification.
      const signUpRes = await signUp(email);
      expect([200, 201]).toContain(signUpRes.status);

      // (2) Pull the real verification email from mailpit; assert the
      // R22-rewritten callbackURL.
      const verificationUrl = await fetchVerificationUrl(email);
      const parsed = new URL(verificationUrl);
      const token = parsed.searchParams.get("token");
      const callbackURL = parsed.searchParams.get("callbackURL");
      expect(token, "verification URL must carry a token").toBeTruthy();
      expect(callbackURL).toBe("/api/auth/verify-email-complete");

      // (3) Click the verification link FOR REAL over HTTPS. Better Auth
      // verifies the user, mints a session, sets the cookie, and 302s to
      // the callbackURL.
      const verifyRes = await fetch(
        `${BACKEND_URL}/api/auth/verify-email?token=${encodeURIComponent(
          token as string,
        )}&callbackURL=${encodeURIComponent(callbackURL as string)}`,
        { method: "GET", headers: { "x-forwarded-for": nextIp() }, redirect: "manual" },
      );
      expect(verifyRes.status, `verify-email body: ${await verifyRes.clone().text()}`).toBe(302);
      expect(verifyRes.headers.get("location")).toBe("/api/auth/verify-email-complete");
      const sessionJar = setCookieJar(verifyRes);
      expect(sessionJar, "verify-email must set the session cookie").toContain(
        "openwhispr.session_token=",
      );

      // (4) Follow the 302 to verify-email-complete carrying the cookie.
      const completeRes = await fetch(`${BACKEND_URL}/api/auth/verify-email-complete`, {
        method: "GET",
        headers: { cookie: sessionJar, "x-forwarded-for": nextIp() },
        redirect: "manual",
      });
      expect(completeRes.status, `complete body: ${await completeRes.clone().text()}`).toBe(302);
      const finalLocation = completeRes.headers.get("location") ?? "";
      expect(finalLocation).toMatch(
        /^http:\/\/127\.0\.0\.1:5199\/oauth\/callback\?bearer_token=.+$/,
      );
      const bearer = new URL(finalLocation).searchParams.get("bearer_token");
      expect(bearer, "loopback redirect must carry a bearer_token").toBeTruthy();

      // (5) The bridged bearer must be a WORKING session — replay it on a
      // real authenticated route. `GET /api/usage` 200s for an
      // authenticated user (the desktop client's exact next call).
      const usageRes = await fetch(`${BACKEND_URL}/api/usage`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${bearer}`,
          "x-forwarded-for": nextIp(),
        },
        redirect: "manual",
      });
      expect(
        usageRes.status,
        `the bridged bearer must authenticate; /api/usage body: ${await usageRes.clone().text()}`,
      ).toBe(200);
    },
    SUITE_TIMEOUT_MS,
  );

  it(
    "verify-email-complete with no session cookie → clean 401, never 500",
    async () => {
      if (!stack) throw new Error("compose stack not up");
      const res = await fetch(`${BACKEND_URL}/api/auth/verify-email-complete`, {
        method: "GET",
        headers: { "x-forwarded-for": nextIp() },
        redirect: "manual",
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toHaveProperty("error");
    },
    SUITE_TIMEOUT_MS,
  );
});
