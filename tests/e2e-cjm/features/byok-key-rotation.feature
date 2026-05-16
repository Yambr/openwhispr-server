# SPDX-License-Identifier: FSL-1.1-ALv2
# Phase 30 / Plan 30-01 — @cjm-byok-rotation.* api key rotation (G1).
#
# D-12: NO Cucumber `retry:` anywhere.
# Rotation = composed sequence (create new + revoke old). No dedicated
# /rotate endpoint exists; the CJM pins the operational pattern.

Feature: API key rotation — create new + revoke old

  @cjm-byok-rotation.1
  Scenario: Composed rotation revokes the old key while the new one stays active (happy path)
    Given a signed-in user
    When the user creates an api key named "key-old"
    And the user creates a second api key named "key-new"
    And the user revokes the first key
    Then the response status for the revoke is 200
    And listing keys shows the new key with revoked_at null
    And listing keys shows the old key with revoked_at non-null

  @cjm-byok-rotation.2
  Scenario: Revoking a non-existent key id is rejected with 404 typed envelope, no existence leak (negative twin)
    Given a signed-in user
    When the user POSTs /api/v1/keys/:id/revoke with an unknown uuid
    Then the response status is 404
    And the body is the typed envelope shape "{ error: { code, message } }"
    And the error code matches "not_found"
    And the body MUST NOT contain a Node.js stack trace
