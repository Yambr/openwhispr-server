# SPDX-License-Identifier: Apache-2.0
# Phase 13 / Plan 02 / Task 13-02-03 — @cjm-5.* admin onboarding.

Feature: Admin onboarding

  @cjm-5.1 @expected-red @after-phase-12
  Scenario: /admin reaches a real admin landing page
    Given valid admin basicauth credentials are configured
    When the admin GETs /admin with those credentials
    Then the response is 200 and the body renders an admin page heading

  @cjm-5.2
  Scenario: /admin is gated by Traefik basicauth — no credentials means 401 and a WWW-Authenticate challenge
    When an unauthenticated request hits /admin
    Then the response is 401 with a "WWW-Authenticate: Basic" header

  @cjm-5.3 @expected-red @after-phase-12
  Scenario: First-run setup wizard flips setup_state from pending to completed
    Given the stack has setup_state "pending"
    When the wizard is completed via the /setup route
    Then setup_state is "completed" and the submitter is logged in as admin
