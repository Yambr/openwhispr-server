# SPDX-License-Identifier: Apache-2.0
# Phase 13 / Plan 02 / Task 13-02-03 — @cjm-3.* password reset scenarios.

Feature: Password reset

  @cjm-3.1 @expected-red @after-phase-12
  Scenario: Reset link delivered via mailpit; user sets new password and signs in
    Given a fresh verified user exists for reset
    When the user requests a password reset
    Then a password-reset email arrives in mailpit within 30 seconds

  @cjm-3.2
  Scenario: Invalid reset token returns an error envelope, never a 2xx
    When a password reset is attempted with token "garbage-not-a-real-token"
    Then the reset attempt is rejected with an error envelope
