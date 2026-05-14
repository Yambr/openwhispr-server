// SPDX-License-Identifier: Apache-2.0
// Phase 13 / Plan 02 / Task 13-02-03 — extra @cjm-1.* scenarios that
// extend the Wave-1 signup-verify.feature (1.3 password-too-short,
// 1.4 ru locale-scoped error copy, 1.5 zero-providers gating).

import { Agent, fetch as undiciFetch } from "undici";
import { freshTenant, postJsonRaw } from "../support/fixtures";
import { expect, Then, When } from "../support/world";

interface ScenarioState {
  email: string;
  password: string;
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

When(
  "a new user signs up with a 6-char password {string}",
  async ({ apiBaseURL, tenantId }, password: string) => {
    const s = stateFor(tenantId);
    // Retry on 429.
    for (let i = 0; i < 15; i += 1) {
      const res = await postJsonRaw(`${apiBaseURL}/api/auth/sign-up/email`, {
        email: s.email,
        password,
        name: "CJM Pass6",
      });
      if (res.status !== 429) {
        s.lastStatus = res.status;
        s.lastBodyText = await res.text();
        try {
          s.lastBody = JSON.parse(s.lastBodyText);
        } catch {
          s.lastBody = null;
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  },
);

Then(
  "the signup response is a 4xx validation error mentioning password length",
  async ({ tenantId }) => {
    const s = stateFor(tenantId);
    const status = s.lastStatus as number;
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    // Better Auth returns a structured error referencing password length.
    // Match liberally across body text for "password" + "length"/"short"/"8".
    const text = (s.lastBodyText ?? "").toLowerCase();
    expect(text).toMatch(/password/);
    expect(text).toMatch(/length|short|8|min/);
  },
);

When(
  "an invalid signup is submitted with Accept-Language {string}",
  async ({ apiBaseURL, tenantId }, locale: string) => {
    const s = stateFor(tenantId);
    const url = `${apiBaseURL}/api/auth/sign-up/email`;
    const dispatcher = localhostDispatcher(url);
    const origin = new URL(url).origin;
    // Send a structurally-invalid payload (e.g. missing email) to deliberately
    // trip a 4xx with localized copy. Better Auth's i18n plugin (or our own
    // i18nPlugin) picks the Accept-Language header to choose error copy.
    // Retry on 429.
    for (let i = 0; i < 15; i += 1) {
      const res = await undiciFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          "accept-language": locale,
        },
        body: JSON.stringify({
          email: "not-a-valid-email",
          password: "x",
          name: "CJM Locale",
        }),
        dispatcher,
      });
      if (res.status !== 429) {
        s.lastStatus = res.status;
        s.lastBodyText = await res.text();
        try {
          s.lastBody = JSON.parse(s.lastBodyText);
        } catch {
          s.lastBody = null;
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  },
);

Then("the response error message renders in Russian copy", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  const status = s.lastStatus as number;
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
  const text = s.lastBodyText ?? "";
  // Heuristic: at least one Cyrillic letter is present in the response
  // body. The source MUST stay ASCII-only per CLAUDE.md English-only
  // rule, so the regex range uses unicode escapes:
  //   U+0410..U+044F   Cyrillic A..ya
  //   U+0401 U+0451    Cyrillic Yo (capital + small)
  //
  // The api i18n plugin may not localize Better Auth's internal error
  // envelopes in v1 — if no Cyrillic letters appear, this scenario
  // surfaces an i18n gap as a real product bug. The scenario is tagged
  // @expected-red @after-phase-15 against that gap.
  const hasCyrillic = /[\u0410-\u044f\u0401\u0451]/.test(text);
  expect(hasCyrillic, `expected Russian copy in body; got: ${text.slice(0, 200)}`).toBe(true);
});

// @cjm-1.5 "Given the stack has zero OIDC providers configured", "When the
// sign-up page is loaded", and "Then zero OIDC social-login buttons are
// rendered" share their bindings with @cjm-7.* and live in oidc.steps.ts —
// duplicate definitions would trip playwright-bdd's strict-mode gate.
