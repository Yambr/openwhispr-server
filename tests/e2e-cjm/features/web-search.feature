# SPDX-License-Identifier: FSL-1.1-ALv2
# Phase 26 / Plan 26-01 — @cjm-13.* web-search CJM (G6 closure).
#
# D-12: NO Cucumber `retry:` config anywhere — retry-on-flake is BANNED.
# Memory feedback_loadtest_cost_discipline: mock provider ONLY; live
# Tavily/Yandex calls gated behind OPENWHISPR_LOADTEST_ALLOW_PAID=1.

Feature: Web search — Tavily/Yandex routing via mock provider

  @cjm-13.1
  Scenario: Authenticated search returns a normalized result list (mock provider, happy path)
    Given a signed-in user
    And WEB_SEARCH_PROVIDER is configured to "mock"
    When the user POSTs to /api/agent/web-search with query "node.js LTS" and numResults 3
    Then the response status is 200
    And the body contains a results array with at least 1 item
    And every result item has the three string fields title, url, snippet

  @cjm-13.2
  Scenario: WEB_SEARCH_PROVIDER set without provider key — 503 typed envelope rejected (negative twin)
    Given a signed-in user
    And WEB_SEARCH_PROVIDER is configured to "tavily" without TAVILY_API_KEY
    When the user POSTs to /api/agent/web-search with query "anything" and numResults 3
    Then the response status is 503
    And the body is the typed envelope shape "{ error: { code, message } }"
    And the error code is "WEB_SEARCH_PROVIDER_KEY_MISSING"
    And the body MUST NOT contain a Node.js stack trace
