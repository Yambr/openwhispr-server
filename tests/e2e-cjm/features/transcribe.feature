# SPDX-License-Identifier: Apache-2.0
# Phase 13 / Plan 02 / Task 13-02-03 — @cjm-4.* transcribe round-trip (E2E-06).

Feature: Transcribe round-trip

  @cjm-4.1 @expected-red @after-phase-19.2
  Scenario: Signed-in user POSTs multipart audio and gets a typed response shape
    Given a signed-in user with a valid session
    When the user POSTs the silent WAV fixture to /api/transcribe
    Then the response status is 200 and the body has a string "text" field

  @cjm-4.2
  Scenario: Non-audio bytes are rejected with a typed error envelope, not a 5xx stack
    When unauthenticated junk bytes are POSTed to /api/transcribe
    Then the response is a typed error envelope without a stack trace leak
