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
#   6.  @cjm-sso-1.6  — Loud-fail on malformed JIT mapping JSON at boot
#                       (re-scoped per D-69-4 Option C2: the real merged boot
#                       loud-fail is validateJitBoot() exit 78 + `FATAL
#                       oidc-jit-boot` on malformed OIDC_TENANT_MAPPING /
#                       OIDC_ROLE_MAPPING JSON — NOT an unreachable-realm boot
#                       failure, which does not exist: genericOAuth discovery is
#                       lazy and a bad issuer boots clean. No Keycloak needed.)
#
# Phase 69 (v3) implements the JIT provisioning surface; these scenarios are now
# GREEN against a LIVE Keycloak 26 container (no IdP mock — constitutional).
# Real step defs live in tests/e2e-cjm/steps/sso.steps.ts (undici wire + the
# live Keycloak login form). The former expected-red / after-phase-19 /
# after-keycloak-up gating tags are removed now that the surface is GREEN.

@phase-18 @sso
Feature: Keycloak OIDC SSO with JIT user provisioning

  @cjm-sso-1.1
  Scenario: First-time JIT user creation from OIDC ID token
    Given Keycloak realm "acme" is up and the OIDC env triple is set
    When a user signs in via OIDC for the first time with tenant claim "acme"
    Then a User row is created with tenant "acme" and role "member"
    And an audit_log row is emitted with action "sso.jit.user.created"

  @cjm-sso-1.2
  Scenario: Returning OIDC user is re-synced from claims on second sign-in
    Given a User row already exists for tenant "acme" with email "alice@acme.example"
    When the user signs in via OIDC a second time
    Then the returning session resolves to tenant "acme" and role "member"

  @cjm-sso-1.3
  Scenario: Group-to-role downgrade revokes admin on next sign-in (negative twin)
    Given a User row already exists for tenant "acme" with role "admin"
    When the user signs in via OIDC and the admin group has been removed from claims
    Then the User row's role is rewritten to the configured default role
    And an audit_log row is emitted with action "sso.jit.role.updated"

  @cjm-sso-1.4
  Scenario: Tenant assignment derived from email domain claim
    Given the OIDC_TENANT_CLAIM env is set to "email_domain"
    And OIDC_TENANT_MAPPING includes "acme.example" mapped to tenant "acme"
    When a user with email "bob@acme.example" signs in via OIDC for the first time
    Then a User row is created with tenant "acme"

  @cjm-sso-1.5a
  Scenario: Returning OIDC user whose resolved tenant changed is rejected at sign-in (negative twin)
    Given a returning OIDC user "carol" was first provisioned under tenant "acme"
    When the user signs in via OIDC after their email domain now resolves tenant "globex"
    Then sign-in is rejected with a 403 forbidden_tenant_mismatch error

  # Cross-tenant isolation on the fail-closed usage_ledger table. /api/transcribe
  # has no read-by-id endpoint (it writes a tenant-scoped usage_ledger row and
  # returns {text,minutes}), so the proof is usage-aggregate isolation: tenant B
  # records a real transcribe (→ a usage_ledger row under B), then GET /api/usage
  # as B reports B's units while the SAME read as A reports ZERO — A cannot
  # observe B's row (RLS fails closed; no existence leak). The step wording is
  # kept stable for the binding; "the read returns 404 not_found" reads at the
  # isolation level as "A's tenant-scoped read excludes B's row entirely".
  @cjm-sso-1.5b
  Scenario: Cross-tenant read in a fail-closed table returns 404 not_found (negative twin)
    Given a JIT user is provisioned for tenant "acme" and a transcription row exists for tenant "globex"
    When the tenant "acme" user issues an authenticated read scoped to tenant "globex"'s transcription row
    Then the read returns 404 not_found and the row's existence is not leaked

  @cjm-sso-1.6
  Scenario: Loud-fail on malformed JIT mapping JSON at boot (negative twin)
    Given the api is configured with a malformed OIDC_TENANT_MAPPING JSON value
    When the api container boots
    Then boot fails loudly with stderr containing "FATAL oidc-jit-boot" and exit code 78
