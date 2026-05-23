// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 27 / Plan 27-01 — @cjm-14.* session refresh / set-auth-token steps.
//
// Closes G7 from `.planning/qa-audit/2026-05-16-cjm-coverage.md`. Asserts
// the Better Auth bearer-rotation contract (apps/api/src/lib/token-rotation.ts):
// any authenticated request crossing the rotation threshold MUST receive a
// fresh bearer in the `set-auth-token` response header.
//
// Per `feedback_cjm_steps_need_unit_tests`: sibling vitest coverage at
// `__tests__/session-refresh.steps.test.ts`.

import { Agent, fetch as undiciFetch } from "undici";

import { expect, freshTenant, Given, signedInAs, Then, When } from "../support/fixtures";

interface ScenarioState {
  cookie?: string;
  inboundToken?: string;
  status?: number;
  headers?: Map<string, string>;
  rawBody?: string;
  body?: unknown;
}

const state = new Map<string, ScenarioState>();

function stateFor(scenarioTenantId: string): ScenarioState {
  let s = state.get(scenarioTenantId);
  if (!s) {
    s = {};
    state.set(scenarioTenantId, s);
  }
  return s;
}

function localhostDispatcher(url: string): Agent | undefined {
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host.endsWith(".localhost")) {
      return new Agent({ connect: { rejectUnauthorized: false } });
    }
  } catch {
    /* unreachable */
  }
  return undefined;
}

/**
 * Issue an authenticated GET against the api and return the headers map +
 * status + body. The Better Auth bearer plugin emits `set-auth-token` on
 * the response when rotation fires; collecting all headers is the only
 * way to verify presence + value.
 */
export async function authenticatedGet(
  apiBaseURL: string,
  path: string,
  cookie: string,
): Promise<{
  status: number;
  headers: Map<string, string>;
  rawBody: string;
  body: unknown;
}> {
  const url = `${apiBaseURL}${path}`;
  const dispatcher = localhostDispatcher(url);
  const res = await undiciFetch(url, {
    method: "GET",
    headers: { origin: new URL(url).origin, cookie },
    ...(dispatcher ? { dispatcher } : {}),
  });
  const headers = new Map<string, string>();
  for (const [k, v] of res.headers) headers.set(k.toLowerCase(), v);
  const rawBody = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = rawBody;
  }
  return { status: res.status, headers, rawBody, body };
}

/** Extract the inbound bearer (if any) from a cookie header. The Better
 *  Auth bearer plugin stores the active token in the `__Secure-better-auth.
 *  session_token` cookie; in dev mode the prefix is `better-auth.session_token`. */
export function extractInboundToken(cookie: string): string | undefined {
  const parts = cookie.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith("better-auth.session_token=")) {
      return p.slice("better-auth.session_token=".length);
    }
    if (p.startsWith("__Secure-better-auth.session_token=")) {
      return p.slice("__Secure-better-auth.session_token=".length);
    }
  }
  return undefined;
}

/** Predicate — does a Set-Cookie value clear the session cookie?
 *  Better Auth's logout / forced-expire path emits Max-Age=0 OR an
 *  Expires timestamp in the past. Both forms are accepted. */
export function isSessionCookieCleared(setCookieValue: string): boolean {
  if (!/better-auth\.session_token=/i.test(setCookieValue)) return false;
  if (/max-age=0\b/i.test(setCookieValue)) return true;
  // Expires=<date in the past> — parse and compare. If unparseable, fall
  // back to false (conservative).
  const m = /expires=([^;]+)/i.exec(setCookieValue);
  if (m) {
    const t = Date.parse(m[1]);
    if (!Number.isNaN(t) && t < Date.now()) return true;
  }
  return false;
}

Given(
  "a signed-in user with an active bearer token",
  async function (
    this,
    {
      apiBaseURL,
      mailpitApiUrl,
      tenantId,
    }: { apiBaseURL: string; mailpitApiUrl: string; tenantId: string },
  ) {
    const s = stateFor(tenantId);
    const id = freshTenant(tenantId);
    s.cookie = await signedInAs(apiBaseURL, mailpitApiUrl, id);
    s.inboundToken = extractInboundToken(s.cookie);
  },
);

Given(
  "a signed-in user whose session has fully expired",
  async function (
    this,
    {
      apiBaseURL,
      mailpitApiUrl,
      tenantId,
    }: { apiBaseURL: string; mailpitApiUrl: string; tenantId: string },
  ) {
    // Phase 27 happy-path lands in this commit; the EXPIRED-session
    // negative twin requires a session-clock-jump fixture not yet wired
    // into the CJM compose stack. We sign in normally and tag the scenario
    // `@expected-red @after-phase-27.next` until a future plan lands a
    // `tools/expire-session.ts` helper that pokes the database directly to
    // age the session record. The step records the precondition so when
    // the helper lands, only this body changes.
    const s = stateFor(tenantId);
    const id = freshTenant(tenantId);
    s.cookie = await signedInAs(apiBaseURL, mailpitApiUrl, id);
  },
);

When(
  "the user issues an authenticated GET to \\/api\\/health near the rotation threshold",
  async function (this, { apiBaseURL, tenantId }: { apiBaseURL: string; tenantId: string }) {
    const s = stateFor(tenantId);
    const res = await authenticatedGet(apiBaseURL, "/api/health", s.cookie ?? "");
    s.status = res.status;
    s.headers = res.headers;
    s.rawBody = res.rawBody;
    s.body = res.body;
  },
);

When(
  "the user issues an authenticated GET to \\/api\\/health",
  async function (this, { apiBaseURL, tenantId }: { apiBaseURL: string; tenantId: string }) {
    const s = stateFor(tenantId);
    const res = await authenticatedGet(apiBaseURL, "/api/health", s.cookie ?? "");
    s.status = res.status;
    s.headers = res.headers;
    s.rawBody = res.rawBody;
    s.body = res.body;
  },
);

Then(
  "the response status is {int}",
  async function (this, { tenantId }: { tenantId: string }, expected: number) {
    expect(stateFor(tenantId).status).toBe(expected);
  },
);

Then(
  'the response carries a "set-auth-token" header',
  async function (this, { tenantId }: { tenantId: string }) {
    const s = stateFor(tenantId);
    expect(s.headers?.has("set-auth-token")).toBe(true);
  },
);

Then(
  "the new bearer token is non-empty and not equal to the inbound token",
  async function (this, { tenantId }: { tenantId: string }) {
    const s = stateFor(tenantId);
    const newToken = s.headers?.get("set-auth-token") ?? "";
    expect(newToken.length).toBeGreaterThan(0);
    if (s.inboundToken) {
      expect(newToken).not.toBe(s.inboundToken);
    }
  },
);

Then(
  'the response does NOT carry a "set-auth-token" header',
  async function (this, { tenantId }: { tenantId: string }) {
    expect(stateFor(tenantId).headers?.has("set-auth-token") ?? false).toBe(false);
  },
);

Then(
  "the response Set-Cookie header clears the session cookie",
  async function (this, { tenantId }: { tenantId: string }) {
    const setCookie = stateFor(tenantId).headers?.get("set-cookie") ?? "";
    expect(isSessionCookieCleared(setCookie)).toBe(true);
  },
);

Then(
  /^the body is the typed envelope shape "\{ error: \{ code, message \} \}"$/,
  async function (this, { tenantId }: { tenantId: string }) {
    const body = stateFor(tenantId).body;
    expect(body).toMatchObject({
      error: expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
      }),
    });
  },
);

Then(
  "the body MUST NOT contain a Node.js stack trace",
  async function (this, { tenantId }: { tenantId: string }) {
    expect(stateFor(tenantId).rawBody ?? "").not.toMatch(/at Object\.<anonymous>|node_modules\//);
  },
);
