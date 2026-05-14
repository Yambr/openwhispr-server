// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 02 / Task 13-02-03 — @cjm-7.* OIDC provider step bindings.
//
// @cjm-7.1 (in-phase, GREEN) — against a stack with zero OIDC providers
// wired, the sign-in page renders ZERO OidcButtons. We assert this via
// Playwright's browser context: GET https://api.localhost/sign-in, count
// nodes matching the OidcButtons component's render contract.
//
// @cjm-7.2 (@expected-red @after-phase-12) — one configured provider
// produces exactly one button; Phase 12 wires OIDC_PROVIDERS_JSON to the
// public capabilities surface.

import { expect, Given, Then, When } from "../support/world";

interface ScenarioState {
  buttonCount?: number;
}

const state = new Map<string, ScenarioState>();

function stateFor(tenantId: string): ScenarioState {
  let s = state.get(tenantId);
  if (!s) {
    s = {};
    state.set(tenantId, s);
  }
  return s;
}

Given("the stack has zero OIDC providers configured", async () => {
  // No-op precondition — the default OSS compose ships with zero providers.
  // The CI workflow's .env carries no OIDC_PROVIDERS_JSON entry; the live
  // assertion is performed in the Then step (zero buttons in DOM).
});

When("the sign-in page is loaded", async ({ page, apiBaseURL, tenantId }) => {
  const s = stateFor(tenantId);
  await page.goto(`${apiBaseURL}/sign-in`, { waitUntil: "domcontentloaded" });
  // Wait briefly for client-side hydration. OidcButtons renders inside the
  // SignInForm and uses providers-from-capabilities; on zero providers the
  // component returns null synchronously.
  await page.waitForLoadState("networkidle");
  // The OidcButtons component renders `<button>` elements with an
  // `aria-label` or text starting with "Sign in with" or "Continue with"
  // per shadcn/ui's OAuth-button convention. Count any of:
  const candidates = page.locator(
    'button:has-text("Sign in with"), button:has-text("Continue with"), [data-provider]',
  );
  s.buttonCount = await candidates.count();
});

When("the sign-up page is loaded", async ({ page, apiBaseURL, tenantId }) => {
  const s = stateFor(tenantId);
  await page.goto(`${apiBaseURL}/sign-up`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  const candidates = page.locator(
    'button:has-text("Sign in with"), button:has-text("Continue with"), button:has-text("Sign up with"), [data-provider]',
  );
  s.buttonCount = await candidates.count();
});

Then("zero OIDC social-login buttons are rendered on the sign-in page", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  expect(s.buttonCount).toBe(0);
});

Then("zero OIDC social-login buttons are rendered", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  expect(s.buttonCount).toBe(0);
});

Given("OIDC_PROVIDERS_JSON is set to a single provider config", async () => {
  throw new Error("OIDC_PROVIDERS_JSON wiring ships in Phase 12 — @cjm-7.2 stays @expected-red");
});

Then("exactly one OIDC social-login button is rendered on the sign-in page", async () => {
  throw new Error("OIDC_PROVIDERS_JSON wiring ships in Phase 12 — @cjm-7.2 stays @expected-red");
});
