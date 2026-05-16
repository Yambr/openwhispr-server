# SPDX-License-Identifier: FSL-1.1-ALv2
# Phase 43 / Plan 43-01 — @cjm-byok-litellm.* corporate LITELLM_BASE_URL override.
#
# D-12: NO Cucumber `retry:` anywhere.
# Both scenarios are @expected-red @after-phase-44-MOCK-CORP-LITELLM
# until a second mock-litellm container (different port) lands in
# compose overlays so the api can be booted with the env override
# pointing at it.

Feature: Corporate LITELLM_BASE_URL override

  @cjm-byok-litellm.1 @expected-red @after-phase-44-MOCK-CORP-LITELLM
  Scenario: Transcribe routes through the corporate override and returns the canned transcript (happy path)
    Given the api is booted with LITELLM_BASE_URL pointing at mock-corp-litellm
    And a signed-in user
    When the user POSTs a wav fixture to /api/transcribe
    Then the response status is 200
    And the body has a "text" field
    And mock-corp-litellm observed exactly 1 inbound request

  @cjm-byok-litellm.2 @expected-red @after-phase-44-MOCK-CORP-LITELLM
  Scenario: Unreachable LITELLM_BASE_URL surfaces typed 502, no stack trace (negative twin)
    Given the api is booted with LITELLM_BASE_URL pointing at an unreachable host
    And a signed-in user
    When the user POSTs a wav fixture to /api/transcribe
    Then the response status is 502
    And the body is the typed envelope shape "{ error: { code, message } }"
    And the body MUST NOT contain a Node.js stack trace
