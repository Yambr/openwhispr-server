# SPDX-License-Identifier: FSL-1.1-ALv2
# Phase 25 / Plan 25-01 — @cjm-12.* agent-stream NDJSON wire-shape (G5 closure).
#
# D-12: NO Cucumber `retry:` config anywhere — retry-on-flake is BANNED.

Feature: Agent stream — NDJSON wire shape

  @cjm-12.1
  Scenario: Signed-in user receives NDJSON event sequence ending with finish
    Given a signed-in user
    When the user POSTs to /api/agent/stream with prompt "say hi"
    Then the response Content-Type is "application/x-ndjson"
    And every response line is a valid JSON object with a "type" field
    And the stream contains at least one event of type "text-delta"
    And the stream ends with an event of type "finish"

  @cjm-12.2
  Scenario: Unauthenticated POST to /api/agent/stream is rejected before hijack — typed 401 envelope, no NDJSON body
    When an unauthenticated POST to /api/agent/stream is issued
    Then the response status is 401
    And the response Content-Type is NOT "application/x-ndjson"
    And the body is the typed envelope shape "{ error: { code, message } }"
    And the body MUST NOT contain a Node.js stack trace
