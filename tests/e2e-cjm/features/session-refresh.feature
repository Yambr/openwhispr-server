# SPDX-License-Identifier: FSL-1.1-ALv2
# Phase 27 / Plan 27-01 — @cjm-14.* session refresh / set-auth-token (G7 closure).
#
# D-12: NO Cucumber `retry:` config anywhere.
# Wire surface per BACKEND_SPEC.md §4 (token rotation header).

Feature: Session refresh — set-auth-token rotation

  @cjm-14.1
  Scenario: Authenticated request crosses rotation threshold and gets a fresh token in the response header
    Given a signed-in user with an active bearer token
    When the user issues an authenticated GET to /api/health near the rotation threshold
    Then the response status is 200
    And the response carries a "set-auth-token" header
    And the new bearer token is non-empty and not equal to the inbound token

  @cjm-14.2 @expected-red @after-phase-28-SESSION-EXPIRY
  Scenario: Expired session is rejected with 401 typed envelope, no set-auth-token, cookie cleared (negative twin)
    Given a signed-in user whose session has fully expired
    When the user issues an authenticated GET to /api/health
    Then the response status is 401
    And the response does NOT carry a "set-auth-token" header
    And the response Set-Cookie header clears the session cookie
    And the body is the typed envelope shape "{ error: { code, message } }"
    And the body MUST NOT contain a Node.js stack trace
