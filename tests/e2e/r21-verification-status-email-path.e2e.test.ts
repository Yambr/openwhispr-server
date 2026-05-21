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
//   3. The verification link is clicked — modeled by flipping
//      `email_verified_at` on the user row via `psql` inside the postgres
//      container (no host port; the same real DB the api writes to).
//   4. The SAME poll now returns 200 {verified:true}.
//   5. An unknown email returns 200 {verified:false}, byte-identical to a
//      known-but-unverified poll — no enumeration oracle.
//
// CLAUDE.md `no mocks of internal logic`: real Better Auth sign-up, real
// `buildVerificationStatusRoutes` handler, real `withTenant` SELECT, real
// Postgres. Only the email-link click is shortcut via a direct DB UPDATE
// — the verification email itself rides the BullMQ worker queue and has
// no host-reachable inbox in the hermetic profile.

import { CookieJar } from "tough-cookie";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BACKEND_URL } from "./compose-helper.js";
import { type Phase6Stack, phase6BringStackUp, psqlOwner } from "./helpers/phase6-compose.js";

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

      // Click the verification link — model it by flipping the column the
      // route reads, inside the default tenant scope (FORCE-RLS).
      await psqlOwner(
        stack.postgres,
        "openwhispr",
        `SET app.tenant_id = '00000000-0000-0000-0000-000000000000'; ` +
          `UPDATE users SET email_verified = true, email_verified_at = now() ` +
          `WHERE lower(email) = lower('${email}');`,
      );

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
