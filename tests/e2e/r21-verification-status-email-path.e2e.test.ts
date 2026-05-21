// SPDX-License-Identifier: FSL-1.1-ALv2
// R21 — verification-status email-derived auth path, full-stack e2e.
//
// Gated by `E2E=1`. Boots the real docker-compose stack (Traefik TLS →
// api → Postgres + PgBouncer + Valkey) and exercises the exact desktop
// sign-up→verify journey that the cookie-only route made unsatisfiable:
//
//   1. `POST /api/auth/sign-up/email` over HTTPS — under
//      `requireEmailVerification` this issues NO session cookie.
//   2. `GET /api/auth/verification-status?email=<addr>` with NO cookie —
//      the desktop's exact 5s poll shape — must return 200 {verified:false}
//      (pre-R21 this 401'd → client showed "Session expired" forever).
//   3. The verification link is clicked for real — the BullMQ worker
//      renders the verification email and delivers it to the bundled
//      `mailpit` SMTP catch-all (base `docker-compose.yml`, HTTP API on
//      host `127.0.0.1:8025`). The test polls mailpit for the message,
//      extracts the verification URL, and issues a real
//      `GET /api/auth/verify-email?token=…` over HTTPS — exactly what a
//      desktop user's link click does. Better Auth flips ONLY
//      `users.email_verified` (the boolean); it never writes the
//      `email_verified_at` timestamp.
//   4. The SAME poll now returns 200 {verified:true}.
//   5. An unknown email returns 200 {verified:false}, byte-identical to a
//      known-but-unverified poll — no enumeration oracle.
//
// CLAUDE.md `no mocks of internal logic`: real Better Auth sign-up, real
// worker email render + SMTP delivery, real verify-email handler, real
// `buildVerificationStatusRoutes` handler, real `withTenant` SELECT, real
// Postgres. The verification link click is NO LONGER shortcut via a DB
// UPDATE — the prior `UPDATE users SET email_verified, email_verified_at`
// set BOTH columns and masked the R21 bug where the route read the
// never-written `email_verified_at`. mailpit is the only stand-in and it
// is a real SMTP boundary, not internal logic.

import { CookieJar } from "tough-cookie";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BACKEND_URL } from "./compose-helper.js";
import { type Phase6Stack, phase6BringStackUp } from "./helpers/phase6-compose.js";

/** Mailpit HTTP API — bundled in base docker-compose.yml on 127.0.0.1:8025. */
const MAILPIT_API = "http://127.0.0.1:8025/api/v1";

interface MailpitMessageSummary {
  ID: string;
  To: Array<{ Address: string }>;
}

/**
 * Poll mailpit for the verification email addressed to `email`, then
 * extract the verification URL from its body. The worker renders the
 * `email_verification` template which interpolates `{verification_url}`.
 */
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

/**
 * Drive the REAL verify-email click: pull the token from the captured
 * verification URL and GET the production verify-email route over HTTPS.
 */
async function clickVerificationLink(email: string): Promise<void> {
  const verificationUrl = await fetchVerificationUrl(email);
  const token = new URL(verificationUrl).searchParams.get("token");
  if (!token) throw new Error(`verification URL has no ?token= param: ${verificationUrl}`);
  const res = await fetch(
    `${BACKEND_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`,
    { method: "GET", headers: { "x-forwarded-for": nextIp() }, redirect: "manual" },
  );
  // Better Auth's verify-email returns 200 or a 3xx redirect on success.
  expect(res.status, `verify-email must succeed, got ${res.status}`).toBeLessThan(400);
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

interface JarFetch {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

function makeJarFetch(): JarFetch {
  const jar = new CookieJar();
  return {
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers ?? undefined);
      const cookieHeader = await jar.getCookieString(url);
      if (cookieHeader.length > 0) headers.set("cookie", cookieHeader);
      const res = await fetch(url, { ...init, headers, redirect: "manual" });
      const setCookies =
        typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
        "function"
          ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
          : [];
      for (const sc of setCookies) {
        await jar.setCookie(sc, url, { ignoreError: true }).catch(() => undefined);
      }
      return res;
    },
  };
}

async function signUp(email: string): Promise<Response> {
  const jf = makeJarFetch();
  return jf.fetch(`${BACKEND_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: BACKEND_URL,
      "x-forwarded-for": nextIp(),
    },
    body: JSON.stringify({ email, password: "R21!Str0ngPass", name: "R21 E2E" }),
  });
}

/** Poll verification-status with NO session cookie — the desktop shape. */
async function pollStatus(email: string): Promise<Response> {
  return fetch(`${BACKEND_URL}/api/auth/verification-status?email=${encodeURIComponent(email)}`, {
    method: "GET",
    headers: { "x-forwarded-for": nextIp() },
    redirect: "manual",
  });
}

describe("e2e — R21 verification-status email-derived poll (real compose stack)", () => {
  it(
    "sign-up (no session) → poll ?email= → false → verify → poll → true",
    async () => {
      if (!stack) throw new Error("compose stack not up");
      const email = `r21-e2e-${Date.now()}@example.test`;

      const signUpRes = await signUp(email);
      expect([200, 201]).toContain(signUpRes.status);

      // Poll with no cookie — pre-R21 this 401'd; R21 must return 200 false.
      const before = await pollStatus(email);
      expect(before.status).toBe(200);
      expect(await before.json()).toEqual({ verified: false });

      // Click the verification link FOR REAL: the worker delivered the
      // verification email to mailpit; we pull the token and issue the
      // production `GET /api/auth/verify-email` over HTTPS. Better Auth
      // flips ONLY `users.email_verified` — no manual UPDATE, so the R21
      // column-mismatch bug is genuinely exercised.
      await clickVerificationLink(email);

      const after = await pollStatus(email);
      expect(after.status).toBe(200);
      expect(await after.json()).toEqual({ verified: true });
    },
    SUITE_TIMEOUT_MS,
  );

  it(
    "unknown email → 200 {verified:false}, byte-identical to a known-unverified poll",
    async () => {
      if (!stack) throw new Error("compose stack not up");
      const known = `r21-e2e-pending-${Date.now()}@example.test`;
      const unknown = `r21-e2e-ghost-${Date.now()}@nowhere.test`;
      const signUpRes = await signUp(known);
      expect([200, 201]).toContain(signUpRes.status);

      const knownRes = await pollStatus(known);
      const unknownRes = await pollStatus(unknown);
      expect(knownRes.status).toBe(unknownRes.status);
      expect(knownRes.status).toBe(200);
      expect(await knownRes.json()).toEqual(await unknownRes.json());
    },
    SUITE_TIMEOUT_MS,
  );
});
