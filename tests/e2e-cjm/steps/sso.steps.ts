// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18 / Plan 01 / Wave 4 — @cjm-sso-1.* keycloak OIDC SSO step bindings.
//
// All six scenarios are tagged @expected-red @after-phase-19 — Phase 19
// (v3) implements the JIT user-provisioning surface. Steps exist so
// undefined-step strictness (D-11) doesn't bail; bodies raise so the
// scenarios stay red until Phase 19.

import { Given, Then, When } from "../support/world";

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

const PENDING = "keycloak SSO ships in Phase 19 — @cjm-sso-1.x stays @expected-red";

Given(
  "Keycloak realm {string} is up and the OIDC env triple is set",
  async ({ tenantId }, _realm: string) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

When(
  "a user signs in via OIDC for the first time with tenant claim {string}",
  async ({ tenantId }, _claim: string) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

Then(
  "a User row is created with tenant {string} and role {string}",
  async ({ tenantId }, _tenant: string, _role: string) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

Then("an audit_log row is emitted with action {string}", async ({ tenantId }, _action: string) => {
  stateFor(tenantId);
  throw new Error(PENDING);
});

Given(
  "a User row already exists for tenant {string} with email {string}",
  async ({ tenantId }, _tenant: string, _email: string) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

When(
  "the user signs in via OIDC with updated name claim {string}",
  async ({ tenantId }, _name: string) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

Then("the User row's name is rewritten to {string}", async ({ tenantId }, _name: string) => {
  stateFor(tenantId);
  throw new Error(PENDING);
});

Given(
  "a User row already exists for tenant {string} with role {string}",
  async ({ tenantId }, _tenant: string, _role: string) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

When(
  "the user signs in via OIDC and the admin group has been removed from claims",
  async ({ tenantId }) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

Then("the User row's role is rewritten to the configured default role", async ({ tenantId }) => {
  stateFor(tenantId);
  throw new Error(PENDING);
});

Given("the OIDC_TENANT_CLAIM env is set to {string}", async ({ tenantId }, _value: string) => {
  stateFor(tenantId);
  throw new Error(PENDING);
});

Given(
  "OIDC_TENANT_MAPPING includes {string} mapped to tenant {string}",
  async ({ tenantId }, _domain: string, _tenant: string) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

When(
  "a user with email {string} signs in via OIDC for the first time",
  async ({ tenantId }, _email: string) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

Then("a User row is created with tenant {string}", async ({ tenantId }, _tenant: string) => {
  stateFor(tenantId);
  throw new Error(PENDING);
});

Given(
  "a User row exists for tenant {string} and another exists for tenant {string}",
  async ({ tenantId }, _tenantA: string, _tenantB: string) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

When(
  "the tenant {string} user issues an authenticated request scoped to tenant {string}",
  async ({ tenantId }, _tenantA: string, _tenantB: string) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

Then(
  "the row-level-security policy rejects the request with a 403 forbidden_tenant_mismatch error",
  async ({ tenantId }) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

Given(
  "the Keycloak fixture is up but the realm import directory is empty",
  async ({ tenantId }) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

When(
  "the api boots with OIDC_ISSUER_URL pointing at a non-existent realm",
  async ({ tenantId }) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);

Then(
  "boot fails loudly with a structured log event {string} and a non-zero exit code",
  async ({ tenantId }, _event: string) => {
    stateFor(tenantId);
    throw new Error(PENDING);
  },
);
