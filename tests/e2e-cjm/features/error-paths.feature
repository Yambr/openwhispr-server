# SPDX-License-Identifier: Apache-2.0
# Phase 13 / Plan 02 / Task 13-02-03 — @cjm-8.* error-path invariants.

Feature: Error paths

  @cjm-8.1
  Scenario: 4xx responses ship the canonical typed error envelope shape
    When an unauthenticated POST to /api/transcribe is issued
    Then the response body is a typed error envelope with "code" and "message"

  @cjm-8.2
  Scenario: 5xx responses never leak a raw Node.js stack trace
    When a malformed POST to /api/transcribe is issued
    Then the response body does not contain "at Object.<anonymous>" or "node_modules/"
