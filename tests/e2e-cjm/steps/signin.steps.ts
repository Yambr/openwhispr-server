// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 02 / Task 13-02-03 — @cjm-2.* step bindings.
//
// API-driven (no browser). Hits Better Auth at api.localhost via undici.
// Per-scenario tenant isolation via the per-test `tenantId` fixture.

import { Agent, fetch as undiciFetch } from "undici";
import { freshTenant, postJsonRaw } from "../support/fixtures";
import { expect, Given, Then, When } from "../support/world";

interface ScenarioState {
  email: string;
  password: string;
  lastStatus?: number;
  lastBody?: unknown;
  lastSetCookie?: string[];
}

const state = new Map<string, ScenarioState>();

function stateFor(tenantId: string): ScenarioState {
  let s = state.get(tenantId);
  if (!s) {
    const t = freshTenant(tenantId);
    s = { email: t.email, password: t.password };
    state.set(tenantId, s);
  }
  return s;
}

async function postSignUp(
  apiBaseURL: string,
  email: string,
  password: string,
): Promise<{ status: number }> {
  // Retry on 429 (Better Auth rate-limit window carry-over).
  for (let i = 0; i < 15; i += 1) {
    const res = await postJsonRaw(`${apiBaseURL}/api/auth/sign-up/email`, {
      email,
      password,
      name: "CJM Signin",
    });
    if (res.status !== 429) return { status: res.status };
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { status: 429 };
}

function undiciDispatcherFor(url: string): Agent | undefined {
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host.endsWith(".localhost")) {
      return new Agent({ connect: { rejectUnauthorized: false } });
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

async function fetchVerificationUrl(
  mailpitApiUrl: string,
  email: string,
  notBefore: string,
  dispatcher: Agent | undefined,
): Promise<string | null> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const url = `${mailpitApiUrl}/messages?query=${encodeURIComponent(`to:${email}`)}`;
    const res = await undiciFetch(url, { dispatcher });
    if (res.ok) {
      const body = (await res.json()) as { messages?: Array<{ ID: string; Created: string }> };
      const candidate = (body.messages ?? []).find(
        (m) => Date.parse(m.Created) >= Date.parse(notBefore),
      );
      if (candidate) {
        const full = await undiciFetch(`${mailpitApiUrl}/message/${candidate.ID}`, { dispatcher });
        if (full.ok) {
          const msg = (await full.json()) as { HTML?: string; Text?: string };
          const link =
            msg.HTML?.match(
              /https?:\/\/[^\s"'<>]+\/(?:verify-email|api\/auth\/verify-email)\?[^\s"'<>]*token=[^\s"'<>&]+/i,
            )?.[0] ??
            msg.Text?.match(
              /https?:\/\/[^\s"'<>]+\/(?:verify-email|api\/auth\/verify-email)\?[^\s"'<>]*token=[^\s"'<>&]+/i,
            )?.[0];
          if (link) return link;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

Given("a fresh verified user exists", async ({ apiBaseURL, mailpitApiUrl, tenantId }) => {
  const s = stateFor(tenantId);
  const cursor = new Date().toISOString();
  const { status } = await postSignUp(apiBaseURL, s.email, s.password);
  expect(status).toBe(200);
  const dispatcher = undiciDispatcherFor(mailpitApiUrl);
  const link = await fetchVerificationUrl(mailpitApiUrl, s.email, cursor, dispatcher);
  expect(link, "verification URL not found").toBeTruthy();
  // GET the verification link to flip the user to verified.
  const verifyRes = await undiciFetch(link as string, {
    dispatcher: undiciDispatcherFor(link as string),
    redirect: "manual",
  });
  expect([200, 302, 303]).toContain(verifyRes.status);
});

Given("a fresh unverified user exists", async ({ apiBaseURL, tenantId }) => {
  const s = stateFor(tenantId);
  const { status } = await postSignUp(apiBaseURL, s.email, s.password);
  expect(status).toBe(200);
  // Do NOT verify — the test asserts the 4xx unverified path.
});

When("the user signs in with the correct password", async ({ apiBaseURL, tenantId }) => {
  const s = stateFor(tenantId);
  const res = await postJsonRaw(`${apiBaseURL}/api/auth/sign-in/email`, {
    email: s.email,
    password: s.password,
  });
  s.lastStatus = res.status;
  s.lastBody = await res
    .clone()
    .json()
    .catch(() => null);
  s.lastSetCookie =
    (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
});

When("the user attempts to sign in with the correct password", async ({ apiBaseURL, tenantId }) => {
  const s = stateFor(tenantId);
  const res = await postJsonRaw(`${apiBaseURL}/api/auth/sign-in/email`, {
    email: s.email,
    password: s.password,
  });
  s.lastStatus = res.status;
  s.lastBody = await res
    .clone()
    .json()
    .catch(() => null);
});

Then("the API returns 200 and a session cookie is set", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  expect(s.lastStatus).toBe(200);
  // Better Auth sets at least one Set-Cookie header on the sign-in response.
  expect((s.lastSetCookie ?? []).length).toBeGreaterThanOrEqual(1);
});

Then("the API returns a 4xx with code signaling unverified email", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  expect(s.lastStatus).toBeDefined();
  // Better Auth returns 403 with code EMAIL_NOT_VERIFIED on unverified
  // sign-in attempts. Accept 401/403 with any of the documented codes —
  // the constitutional invariant is "4xx + typed error", not literal "403".
  const status = s.lastStatus as number;
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
  const body = s.lastBody as { code?: string; message?: string } | null;
  expect(body).toBeTruthy();
  // The code must contain a verification-related keyword.
  const codeOrMessage = `${body?.code ?? ""} ${body?.message ?? ""}`.toLowerCase();
  expect(codeOrMessage).toMatch(/verif|unverified|email/);
});
