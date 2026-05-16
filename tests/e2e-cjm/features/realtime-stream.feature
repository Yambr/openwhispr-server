# SPDX-License-Identifier: FSL-1.1-ALv2
# Phase 29 / Plan 29-01 — @cjm-11.* realtime WSS round-trip (G4 closure).
#
# D-12: NO Cucumber `retry:` config anywhere.
# Phase 08.4 wired the :8443 websecure-realtime entrypoint; Phase 08.5
# proved live Speaches WSS upstream. This CJM exercises the end-user
# round-trip plus the auth-rejection negative twin.

Feature: Realtime WSS user journey

  @cjm-11.1 @after-docker-up
  Scenario: Authenticated WSS opens, server sends an opening frame, client closes cleanly (happy path)
    Given a signed-in user
    When the user opens wss://api.localhost:8443/v1/realtime with the session cookie
    Then the server sends at least one frame within 5 seconds
    And the client closes the session
    And the close code is 1000 or 1005

  @cjm-11.2
  Scenario: Unauthenticated WSS handshake is rejected at the auth gate, no frames leaked (negative twin)
    When wss://api.localhost:8443/v1/realtime is opened WITHOUT any bearer or cookie
    Then the connection closes with code 4401 or 4403 or 1008 or 1006
    And no application frame was received before the close
