# SPDX-License-Identifier: FSL-1.1-ALv2
# Phase 28 / Plan 28-01 — @cjm-10.* diarization round-trip (G3 closure).
#
# D-12: NO Cucumber `retry:` config anywhere.
# Memory feedback_speaches_diarization_build_from_main: Speaches MUST be
# built from the `main` branch to expose /v1/audio/diarization. The
# compose stack's Phase 08.6 image satisfies this prerequisite.

Feature: Diarization — multi-speaker round-trip

  @cjm-10.1 @after-docker-up @after-speaches-main
  Scenario: Wav round-trip returns the canonical {duration, segments[]} shape (happy path)
    Given a signed-in user
    And a wav fixture is available
    When the user POSTs the wav to /v1/audio/diarization as multipart/form-data
    Then the response status is 200
    And the body has a numeric "duration" field greater than 0
    And the body has a "segments" array with at least 1 item
    And every segment carries numeric start, numeric end, string speaker
    # Multi-speaker assertion (>= 2 distinct labels) is deferred until a
    # 2-speaker fixture is added — single-speaker round-trip is sufficient
    # to prove the wire shape end-to-end against the live Speaches upstream.

  @cjm-10.2
  Scenario: Non-audio payload is rejected with 415 typed envelope (negative twin)
    Given a signed-in user
    When the user POSTs "text/plain" content to /v1/audio/diarization
    Then the response status is 415
    And the body is the typed envelope shape "{ error: { code, message } }"
    And the body MUST NOT contain a Node.js stack trace
