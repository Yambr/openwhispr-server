# SPDX-License-Identifier: FSL-1.1-ALv2
# Phase 18 / Plan 01 / Wave 4 — SSO journey scenarios.
#
# Seven scenarios under @phase-18 @sso (scenario 1.5 split into 1.5a + 1.5b
# per D-69-3 — the original conflated two distinct mechanisms):
#   1.  @cjm-sso-1.1  — First-time JIT user creation from OIDC ID token
#   2.  @cjm-sso-1.2  — Returning OIDC user has name/email re-synced from claims
#   3.  @cjm-sso-1.3  — Group-to-role downgrade revokes admin on next sign-in (negative twin)
#   4.  @cjm-sso-1.4  — Tenant assignment derived from email domain claim
#   5a. (sso-1.5a)    — Returning OIDC user with a CHANGED tenant claim is
#                       rejected at sign-in time with 403 forbidden_tenant_mismatch
#                       (negative twin; resolver failure-mode #6 — an auth-layer
#                       rejection, NOT a data read)
#   5b. (sso-1.5b)    — Cross-tenant read in a FAIL-CLOSED app table returns 404
#                       not_found, not leaking the row's existence (negative twin;
#                       a clone of the proven @cjm-15.* RLS-read pattern)
#   6.  @cjm-sso-1.6  — Loud-fail (rejected) when Keycloak provider config references missing realm (negative twin)
#
# All scenarios carry the expected-red tag until Phase 19 (v3) implements
# the JIT provisioning surface. Step defs in tests/e2e-cjm/steps/sso.steps.ts
# throw Error("keycloak SSO ships in Phase 19 — cjm-sso-1.x stays expected-red")
# to prevent spurious GREEN if the expected-red grep-invert filter is removed.

@phase-18 @sso
Feature: Keycloak OIDC SSO with JIT user provisioning

  @cjm-sso-1.1 @expected-red @after-phase-19 @after-keycloak-up
  Scenario: First-time JIT user creation from OIDC ID token
    Given Keycloak realm "acme" is up and the OIDC env triple is set
    When a user signs in via OIDC for the first time with tenant claim "acme"
    Then a User row is created with tenant "acme" and role "member"
    And an audit_log row is emitted with action "sso.jit.user.created"

  @cjm-sso-1.2 @expected-red @after-phase-19 @after-keycloak-up
  Scenario: Returning OIDC user has name and email re-synced from claims
    Given a User row already exists for tenant "acme" with email "alice@acme.example"
    When the user signs in via OIDC with updated name claim "Alice Senior Engineer"
    Then the User row's name is rewritten to "Alice Senior Engineer"
    And an audit_log row is emitted with action "sso.jit.role.updated"

  @cjm-sso-1.3 @expected-red @after-phase-19 @after-keycloak-up
  Scenario: Group-to-role downgrade revokes admin on next sign-in (negative twin)
    Given a User row already exists for tenant "acme" with role "admin"
    When the user signs in via OIDC and the admin group has been removed from claims
    Then the User row's role is rewritten to the configured default role
    And an audit_log row is emitted with action "sso.jit.role.updated"

  @cjm-sso-1.4 @expected-red @after-phase-19 @after-keycloak-up
  Scenario: Tenant assignment derived from email domain claim
    Given the OIDC_TENANT_CLAIM env is set to "email_domain"
    And OIDC_TENANT_MAPPING includes "acme.example" mapped to tenant "acme"
    When a user with email "bob@acme.example" signs in via OIDC for the first time
    Then a User row is created with tenant "acme"

  @cjm-sso-1.5a @expected-red @after-phase-19 @after-keycloak-up
  Scenario: Returning OIDC user with a changed tenant claim is rejected at sign-in (negative twin)
    Given a User row already exists for tenant "acme" with email "carol@acme.example"
    When the returning user signs in via OIDC presenting a changed tenant claim "globex"
    Then sign-in is rejected with a 403 forbidden_tenant_mismatch error
    And an audit_log row is emitted with action "sso.jit.rejected"

  @cjm-sso-1.5b @expected-red @after-phase-19 @after-keycloak-up
  Scenario: Cross-tenant read in a fail-closed table returns 404 not_found (negative twin)
    Given a JIT user is provisioned for tenant "acme" and a transcription row exists for tenant "globex"
    When the tenant "acme" user issues an authenticated read scoped to tenant "globex"'s transcription row
    Then the read returns 404 not_found and the row's existence is not leaked

  @cjm-sso-1.6 @expected-red @after-phase-19 @after-keycloak-up
  Scenario: Loud-fail rejected when Keycloak provider config references missing realm (negative twin)
    Given the Keycloak fixture is up but the realm import directory is empty
    When the api boots with OIDC_ISSUER_URL pointing at a non-existent realm
    Then boot fails loudly with a structured log event "sso.jit.rejected" and a non-zero exit code
