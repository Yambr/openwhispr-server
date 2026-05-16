# SPDX-License-Identifier: FSL-1.1-ALv2
# Phase 24 / Plan 24-01 — Cross-tenant RLS regression sentinel (G8 closure).
#
# D-12: NO Cucumber `retry:` config anywhere — retry-on-flake is BANNED.
#
# Companion to @cjm-sso-1.5 (after-phase-19, @expected-red). This file
# covers the bundled email-password path so an RLS regression cannot slip
# past the test suite while SSO ships.

Feature: Cross-tenant isolation for email/password tenants

  Background:
    Given two fresh email-password tenants T_A and T_B exist
    And T_A has a signed-in session
    And T_B has a transcribe job recorded with a known id

  @cjm-15.1
  Scenario: User from T_A cannot read tenant T_B's transcribe job — RLS rejected with 404 (negative twin)
    When T_A requests the transcribe job from T_B by id
    Then the response status is 404
    And the body is the typed envelope shape "{ error: { code, message } }"
    And the body MUST NOT leak the resource's existence
    And the body MUST NOT contain a Node.js stack trace

  @cjm-15.2
  Scenario: User from T_A reads their own transcribe job
    Given T_A also has a transcribe job recorded with a known id
    When T_A requests their own transcribe job by id
    Then the response status is 200
    And the body contains the job record
