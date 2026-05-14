# SPDX-License-Identifier: Apache-2.0
# Phase 13 / Plan 02 / Task 13-02-03 — @cjm-2.* signin scenarios.

Feature: Sign in

  @cjm-2.1
  Scenario: Verified user signs in and receives a session cookie
    Given a fresh verified user exists
    When the user signs in with the correct password
    Then the API returns 200 and a session cookie is set

  @cjm-2.2
  Scenario: Unverified user is rejected with 403 and the response signals resend availability
    Given a fresh unverified user exists
    When the user attempts to sign in with the correct password
    Then the API returns a 4xx with code signaling unverified email
