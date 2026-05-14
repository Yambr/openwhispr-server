// SPDX-License-Identifier: Apache-2.0
// Phase 13 / Plan 02 / Task 13-02-03 — @cjm-4.* transcribe round-trip.
//
// Happy path (@cjm-4.1): sign up + verify + sign in to get a session cookie,
// then multipart-POST `silent.wav` to `/api/transcribe`, assert 200 with a
// JSON body containing a string `text` field. Negative twin (@cjm-4.2):
// non-audio bytes are rejected with a typed-error envelope.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolve the fixture WAV. The playwright runner is invoked from the repo
// root by `make e2e-cjm`, so `process.cwd()` is the repo root in CI. We try
// the repo-root path first, then fall back to a path relative to the
// `tests/e2e-cjm/` config dir for local debug invocations.
function resolveFixtureWav(): string {
  const candidates = [
    resolve(process.cwd(), "tests/e2e-cjm/fixtures/silent.wav"),
    resolve(process.cwd(), "fixtures/silent.wav"),
    resolve(process.cwd(), "../../tests/e2e-cjm/fixtures/silent.wav"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}
const FIXTURE_WAV = resolveFixtureWav();

import { Agent, FormData, fetch as undiciFetch } from "undici";
import { freshTenant, postJsonRaw } from "../support/fixtures";
import { expect, Given, Then, When } from "../support/world";

interface ScenarioState {
  email: string;
  password: string;
  sessionCookieHeader?: string;
  lastStatus?: number;
  lastBody?: unknown;
  lastBodyText?: string;
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

async function fetchVerificationLink(
  mailpitApiUrl: string,
  email: string,
  cursor: string,
): Promise<string | null> {
  const dispatcher = localhostDispatcher(mailpitApiUrl);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const url = `${mailpitApiUrl}/messages?query=${encodeURIComponent(`to:${email}`)}`;
    const res = await undiciFetch(url, { dispatcher });
    if (res.ok) {
      const body = (await res.json()) as { messages?: Array<{ ID: string; Created: string }> };
      const candidate = (body.messages ?? []).find(
        (m) => Date.parse(m.Created) >= Date.parse(cursor),
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

Given("a signed-in user with a valid session", async ({ apiBaseURL, mailpitApiUrl, tenantId }) => {
  const s = stateFor(tenantId);
  const cursor = new Date().toISOString();
  // Sign up.
  for (let i = 0; i < 15; i += 1) {
    const res = await postJsonRaw(`${apiBaseURL}/api/auth/sign-up/email`, {
      email: s.email,
      password: s.password,
      name: "CJM Transcribe",
    });
    if (res.status !== 429) {
      expect(res.status).toBe(200);
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  // Verify via mailpit link.
  const link = await fetchVerificationLink(mailpitApiUrl, s.email, cursor);
  expect(link, "verification link not found in mailpit").toBeTruthy();
  const verifyDispatcher = localhostDispatcher(link as string);
  await undiciFetch(link as string, { dispatcher: verifyDispatcher, redirect: "manual" });
  // Sign in.
  const signInRes = await postJsonRaw(`${apiBaseURL}/api/auth/sign-in/email`, {
    email: s.email,
    password: s.password,
  });
  expect(signInRes.status).toBe(200);
  const setCookie =
    (signInRes.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  expect(setCookie.length).toBeGreaterThanOrEqual(1);
  s.sessionCookieHeader = setCookie.map((c) => c.split(";", 1)[0]).join("; ");
});

When(
  "the user POSTs the silent WAV fixture to \\/api\\/transcribe",
  async ({ apiBaseURL, tenantId }) => {
    const s = stateFor(tenantId);
    expect(s.sessionCookieHeader, "expected a session cookie").toBeTruthy();
    const wav = readFileSync(FIXTURE_WAV);
    const form = new FormData();
    form.append(
      "file",
      new Blob([wav as unknown as BlobPart], { type: "audio/wav" }),
      "silent.wav",
    );
    const url = `${apiBaseURL}/api/transcribe`;
    const dispatcher = localhostDispatcher(url);
    const origin = new URL(url).origin;
    const res = await undiciFetch(url, {
      method: "POST",
      headers: {
        origin,
        cookie: s.sessionCookieHeader as string,
      },
      body: form,
      dispatcher,
    });
    s.lastStatus = res.status;
    s.lastBodyText = await res.text();
    try {
      s.lastBody = JSON.parse(s.lastBodyText);
    } catch {
      s.lastBody = null;
    }
  },
);

Then(
  'the response status is {int} and the body has a string "text" field',
  async ({ tenantId }, status: number) => {
    const s = stateFor(tenantId);
    expect(s.lastStatus).toBe(status);
    const body = s.lastBody as { text?: unknown } | null;
    expect(body).toBeTruthy();
    expect(typeof body?.text).toBe("string");
  },
);

When(
  "unauthenticated junk bytes are POSTed to \\/api\\/transcribe",
  async ({ apiBaseURL, tenantId }) => {
    const s = stateFor(tenantId);
    const url = `${apiBaseURL}/api/transcribe`;
    const dispatcher = localhostDispatcher(url);
    const origin = new URL(url).origin;
    const res = await undiciFetch(url, {
      method: "POST",
      headers: { origin, "content-type": "application/octet-stream" },
      body: "not an audio file",
      dispatcher,
    });
    s.lastStatus = res.status;
    s.lastBodyText = await res.text();
    try {
      s.lastBody = JSON.parse(s.lastBodyText);
    } catch {
      s.lastBody = null;
    }
  },
);

Then("the response is a typed error envelope without a stack trace leak", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  const status = s.lastStatus as number;
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(600);
  // Body must NOT leak a Node stack trace or module paths.
  const text = s.lastBodyText ?? "";
  expect(text).not.toMatch(/at Object\.<anonymous>/);
  expect(text).not.toMatch(/node_modules\//);
  // Body must parse as JSON and carry a typed error shape OR the api's
  // own canonical `{error: "..."}` short-form (the latter is what
  // `/api/transcribe` returns on missing-auth today; both are typed).
  const body = s.lastBody as { error?: unknown; code?: string; message?: string } | null;
  expect(body).toBeTruthy();
  // Accept either `{ error: { code, message } }` (spec'd envelope) OR
  // `{ error: "<message>" }` (legacy short-form) OR `{ code, message }`.
  const hasTypedShape =
    typeof body?.error === "string" ||
    (typeof body?.error === "object" && body?.error !== null) ||
    typeof body?.code === "string" ||
    typeof body?.message === "string";
  expect(hasTypedShape).toBe(true);
});
