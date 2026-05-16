# SPDX-License-Identifier: Apache-2.0
# Phase 13 / Plan 01 / Task 13-01-08 — @cjm-1.1 + @cjm-1.2 scenarios.
# D-12: NO Cucumber `retry:` config anywhere — retry-on-flake is BANNED.

Feature: Signup and email verification round-trip

  @cjm-1.1
  Scenario: New user signs up, receives verification email, verifies, signs in
    Given a fresh tenant id is provisioned
    When a new user signs up with email "cjm-1-1@e2e.test" and password "Cjm1Pass!23"
    Then a verification email arrives at "cjm-1-1@e2e.test" within 30 seconds
    And the verification link returns 200
    And the user can now sign in with email "cjm-1-1@e2e.test" and password "Cjm1Pass!23"

  @cjm-1.2
  Scenario: Second signup with the same email is rejected and sends no duplicate verification mail
    Given a user has already signed up with email "cjm-1-2@e2e.test"
    When the same email tries to sign up again with password "Cjm1Pass!23"
    Then the API returns a 422 with code "USER_ALREADY_EXISTS"
    And no second verification email is sent to "cjm-1-2@e2e.test" within 5 seconds

  @cjm-1.3
  Scenario: Password shorter than 8 chars is rejected with a per-field validation error
    When a new user signs up with a 6-char password "Short1"
    Then the signup response is a 4xx validation error mentioning password length

  @cjm-1.4
  Scenario: Locale-scoped error copy renders in Russian under Accept-Language ru
    When an invalid signup is submitted with Accept-Language "ru"
    Then the response error message renders in Russian copy

  @cjm-1.5
  Scenario: Zero providers configured produces zero social-login buttons on the public sign-up page
    Given the stack has zero OIDC providers configured
    When the sign-up page is loaded
    Then zero OIDC social-login buttons are rendered
