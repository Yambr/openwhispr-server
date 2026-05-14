// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 02 / Task 13-02-03 — @cjm-5.* admin onboarding step bindings.
//
// @cjm-5.1 + @cjm-5.3 are tagged @expected-red @after-phase-12 — the steps
// still need to exist so playwright-bdd's strict-mode (D-11) doesn't bail
// out on undefined steps when `--grep-invert "@expected-red"` is omitted
// for a debug run. They throw assertion failures in their bodies until
// Phase 12 wires the surface.

import { Agent, fetch as undiciFetch } from "undici";

import { expect, Given, Then, When } from "../support/world";

interface ScenarioState {
  basicAuthHeader?: string;
  lastStatus?: number;
  lastHeaders?: Headers;
  lastBodyText?: string;
  setupState?: string;
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

Given("valid admin basicauth credentials are configured", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  const user = process.env.ADMIN_BASIC_AUTH_TEST_USER ?? "admin";
  const password = process.env.ADMIN_BASIC_AUTH_TEST_PASSWORD;
  if (!password) {
    throw new Error(
      "ADMIN_BASIC_AUTH_TEST_PASSWORD must be set for @cjm-5.1 — currently @expected-red @after-phase-12",
    );
  }
  s.basicAuthHeader = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
});

When("the admin GETs \\/admin with those credentials", async ({ apiBaseURL, tenantId }) => {
  const s = stateFor(tenantId);
  const url = `${apiBaseURL}/admin`;
  const dispatcher = localhostDispatcher(url);
  const res = await undiciFetch(url, {
    headers: { authorization: s.basicAuthHeader as string },
    dispatcher,
    redirect: "manual",
  });
  s.lastStatus = res.status;
  s.lastBodyText = await res.text();
});

Then("the response is 200 and the body renders an admin page heading", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  expect(s.lastStatus).toBe(200);
  // Phase 12 ships the real heading text — for now any of {Admin, Setup,
  // Onboarding} is acceptable. Strict-match Phase 12 binding.
  expect(s.lastBodyText ?? "").toMatch(/admin|setup|onboarding/i);
});

When("an unauthenticated request hits \\/admin", async ({ apiBaseURL, tenantId }) => {
  const s = stateFor(tenantId);
  const url = `${apiBaseURL}/admin`;
  const dispatcher = localhostDispatcher(url);
  const res = await undiciFetch(url, { dispatcher, redirect: "manual" });
  s.lastStatus = res.status;
  s.lastHeaders = res.headers as unknown as Headers;
  s.lastBodyText = await res.text();
});

Then('the response is 401 with a "WWW-Authenticate: Basic" header', async ({ tenantId }) => {
  const s = stateFor(tenantId);
  expect(s.lastStatus).toBe(401);
  const challenge = s.lastHeaders?.get("www-authenticate");
  expect(challenge).toBeTruthy();
  expect((challenge ?? "").toLowerCase()).toMatch(/^basic/);
});

Given("the stack has setup_state {string}", async ({ tenantId }, _stateValue: string) => {
  void tenantId;
  // @cjm-5.3 — @expected-red @after-phase-12. The setup_state schema
  // ships with Phase 12; this step intentionally raises until then so the
  // @expected-red filter is the only thing keeping the suite green.
  throw new Error(
    "setup_state is not yet schema-tracked — Phase 12 closes this; @cjm-5.3 stays @expected-red",
  );
});

When("the wizard is completed via the \\/setup route", async () => {
  throw new Error("/setup route ships in Phase 12 — @cjm-5.3 stays @expected-red");
});

Then(
  "setup_state is {string} and the submitter is logged in as admin",
  async ({ tenantId }, _expected: string) => {
    void tenantId;
    throw new Error("@cjm-5.3 stays @expected-red until Phase 12");
  },
);
