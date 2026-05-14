// SPDX-License-Identifier: Apache-2.0
// Phase 13 / Plan 02 / Task 13-02-03 — @cjm-6.* locale switch step bindings.
//
// Both scenarios are tagged @expected-red @after-phase-15 — Phase 15 closes
// TD-15.g (host-split routing) and ships the locale-toggle UI. Steps exist
// so undefined-step strictness (D-11) doesn't bail; bodies raise so the
// scenarios stay red until Phase 15.

import { expect, Given, Then, When } from "../support/world";

interface ScenarioState {
  unused?: string;
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

Given("the user is on the public sign-up page", async ({ tenantId }) => {
  stateFor(tenantId);
  throw new Error("locale UI ships in Phase 15 — @cjm-6.1 stays @expected-red");
});

When("the user switches the locale to {string}", async ({ tenantId }, _locale: string) => {
  void tenantId;
  throw new Error("locale toggle UI ships in Phase 15 — @cjm-6.1 stays @expected-red");
});

Then(
  "a NEXT_LOCALE cookie is set to {string} and the next render serves Russian copy",
  async ({ tenantId }, _value: string) => {
    void tenantId;
    throw new Error("locale toggle UI ships in Phase 15 — @cjm-6.1 stays @expected-red");
  },
);

When("a GET to \\/api\\/locale on api.localhost is issued", async () => {
  throw new Error("/api/locale endpoint ships in Phase 15 — @cjm-6.2 stays @expected-red");
});

Then("the host-split routing returns 200 and a JSON locale body", async () => {
  throw new Error("/api/locale endpoint ships in Phase 15 — @cjm-6.2 stays @expected-red");
});
