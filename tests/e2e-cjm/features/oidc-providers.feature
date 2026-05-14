# SPDX-License-Identifier: Apache-2.0
# Phase 13 / Plan 02 / Task 13-02-03 — @cjm-7.* OIDC providers.

Feature: OIDC providers

  @cjm-7.1 @expected-red @after-phase-12
  Scenario: Zero providers configured yields zero OIDC buttons on the sign-in page
    Given the stack has zero OIDC providers configured
    When the sign-in page is loaded
    Then zero OIDC social-login buttons are rendered on the sign-in page

  @cjm-7.2 @expected-red @after-phase-12
  Scenario: One provider configured yields exactly one OIDC button
    Given OIDC_PROVIDERS_JSON is set to a single provider config
    When the sign-in page is loaded
    Then exactly one OIDC social-login button is rendered on the sign-in page
