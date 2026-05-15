// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 02 / Task 13-02-03 — @cjm-3.* step bindings.
//
// Better Auth ships a `/api/auth/forget-password` endpoint that sends a
// reset email when the email exists. The negative twin uses the
// `/api/auth/reset-password` endpoint with a deliberately garbage token.

import { Agent, fetch as undiciFetch } from "undici";
import { freshTenant, postJsonRaw } from "../support/fixtures";
import { expect, Given, Then, When } from "../support/world";

interface ScenarioState {
  email: string;
  password: string;
  resetCursor?: string;
  lastResetStatus?: number;
  lastResetBody?: unknown;
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
    /* unreachable in tests */
  }
  return undefined;
}

Given("a fresh verified user exists for reset", async ({ apiBaseURL, tenantId }) => {
  const s = stateFor(tenantId);
  // Sign up the user. Better Auth's forget-password endpoint anti-enumerates
  // (always 200) — verification status does NOT need to be flipped for the
  // reset email to land, so we skip the verify-link round-trip here.
  for (let i = 0; i < 15; i += 1) {
    const res = await postJsonRaw(`${apiBaseURL}/api/auth/sign-up/email`, {
      email: s.email,
      password: s.password,
      name: "CJM Reset",
    });
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
});

When("the user requests a password reset", async ({ apiBaseURL, tenantId }) => {
  const s = stateFor(tenantId);
  s.resetCursor = new Date().toISOString();
  // Better Auth 1.6.9 endpoint is `/api/auth/request-password-reset`
  // (verified at node_modules/.pnpm/better-auth@1.6.9_*/dist/api/routes/
  // password.mjs:24 — `createAuthEndpoint("/request-password-reset")`).
  // The `forget-password` alias from earlier BA versions is NOT registered
  // in 1.6.9 and 404s. The hook signature is unchanged ({user, url, token}).
  // No `redirectTo` — Better Auth 1.6.9's `originCheck` rejects URLs that
  // don't match `trustedOrigins` (or `INGRESS_BASE_URL`); we let the hook
  // construct the URL from `ctx.context.baseURL` instead. Phase 19a fix.
  await postJsonRaw(`${apiBaseURL}/api/auth/request-password-reset`, {
    email: s.email,
  });
});

Then(
  "a password-reset email arrives in mailpit within {int} seconds",
  async ({ mailpitApiUrl, tenantId }, withinSeconds: number) => {
    const s = stateFor(tenantId);
    const dispatcher = localhostDispatcher(mailpitApiUrl);
    const deadline = Date.now() + withinSeconds * 1000;
    const cutoff = s.resetCursor ?? new Date(0).toISOString();
    while (Date.now() < deadline) {
      const url = `${mailpitApiUrl}/messages?query=${encodeURIComponent(`to:${s.email}`)}`;
      const res = await undiciFetch(url, { dispatcher });
      if (res.ok) {
        const body = (await res.json()) as {
          messages?: Array<{ ID: string; Created: string; Subject: string }>;
        };
        // Match by Created >= cutoff AND subject containing a reset
        // keyword. Better Auth subjects vary per locale; we match the
        // English keyword AND the equivalent Russian keyword via
        // unicode-escaped Cyrillic (the source MUST stay ASCII-only per
        // CLAUDE.md English-only rule; \u escapes preserve the regex
        // semantics without putting non-ASCII glyphs in the source).
        // The Russian word for "reset" is spelled S-b-r-o-s in
        // transliteration; in the regex below it is encoded as a unicode
        // escape sequence to keep this source file ASCII-only.
        const RESET_KEYWORDS_RE = /reset|\u0421\u0431\u0440\u043e\u0441/i;
        const found = (body.messages ?? []).find(
          (m) =>
            Date.parse(m.Created) >= Date.parse(cutoff) && RESET_KEYWORDS_RE.test(m.Subject ?? ""),
        );
        if (found) return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `no password-reset email for ${s.email} within ${withinSeconds}s (cutoff=${cutoff})`,
    );
  },
);

When(
  "a password reset is attempted with token {string}",
  async ({ apiBaseURL, tenantId }, token: string) => {
    const s = stateFor(tenantId);
    const res = await postJsonRaw(`${apiBaseURL}/api/auth/reset-password`, {
      newPassword: "BrandNewPass!23",
      token,
    });
    s.lastResetStatus = res.status;
    s.lastResetBody = await res
      .clone()
      .json()
      .catch(() => null);
  },
);

Then("the reset attempt is rejected with an error envelope", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  expect(s.lastResetStatus).toBeDefined();
  const status = s.lastResetStatus as number;
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
  // Better Auth returns `{ code, message }` (or `{ error: { code, message } }`
  // depending on version). Accept either shape and assert at least one
  // non-empty error key is present.
  const body = s.lastResetBody as {
    code?: string;
    message?: string;
    error?: { code?: string; message?: string };
  } | null;
  expect(body).toBeTruthy();
  const code = body?.code ?? body?.error?.code ?? "";
  const message = body?.message ?? body?.error?.message ?? "";
  expect((code + message).length).toBeGreaterThan(0);
});
