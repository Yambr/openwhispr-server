# SPDX-License-Identifier: FSL-1.1-ALv2
# Phase 42 / Plan 42-01 — @cjm-9.* per-tenant STT override (G2 closure).
#
# D-12: NO Cucumber `retry:` anywhere.

Feature: Per-tenant STT/LLM override

  @cjm-9.1 @expected-red @after-phase-51-WIRE-11-PUT
  Scenario: Tenant admin overrides STT model and subsequent GET reflects the override (happy path)
    Given a signed-in admin
    When the admin PUTs /api/stt-config with model "whisper-large-v3-turbo"
    Then the response status is 200
    And subsequent GET /api/stt-config returns model "whisper-large-v3-turbo"

  @cjm-9.2 @expected-red @after-phase-51-WIRE-11-PUT
  Scenario: Unknown STT model rejected with typed envelope (negative twin)
    Given a signed-in admin
    When the admin PUTs /api/stt-config with model "not-a-real-model"
    Then the response status is 400
    And the body is the typed envelope shape "{ error: { code, message } }"
    And the error code matches "validation_error|invalid_model"
