# SPDX-License-Identifier: Apache-2.0
# Phase 13 / Plan 02 / Task 13-02-03 — @cjm-6.* locale switch (E2E-08).

Feature: Locale switch

  @cjm-6.1 @expected-red @after-phase-19.4
  Scenario: Switching locale to ru persists via cookie and renders Russian copy
    Given the user is on the public sign-up page
    When the user switches the locale to "ru"
    Then a NEXT_LOCALE cookie is set to "ru" and the next render serves Russian copy

  @cjm-6.2 @after-docker-up @expected-red
  Scenario: /api/locale routes via api.localhost host split, not via web.localhost
    When a GET to /api/locale on api.localhost is issued
    Then the host-split routing returns 200 and a JSON locale body
