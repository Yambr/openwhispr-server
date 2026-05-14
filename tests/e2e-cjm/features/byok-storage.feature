# SPDX-License-Identifier: Apache-2.0
# Phase 14 / Plan 14-07 — BYOK storage overlay refusal scenarios.
#
# Source-of-truth:
#   - .planning/phases/14-slim-core-byok-profiles-v2/14-CONTEXT.md decision 2
#   - .planning/phases/14-slim-core-byok-profiles-v2/14-RESEARCH.md section E
#   - packages/byok-guard/src/index.ts (storageRow evaluator)
#
# These scenarios assert that the slim-core api container loud-fails when
# the storage overlay is OFF and S3_ENDPOINT is unset / partially-set, and
# boots when either the overlay is layered or the operator supplies a
# corporate BYOK S3 endpoint + partner keys via env.
#
# Boot-and-capture-stderr is implemented in compose-harness.ts bootStack()
# via the `expectExit` option (Plan 14-07 Task 1). Step defs live in
# tests/e2e-cjm/support/byok-steps.ts.

@cjm-byok-storage
Feature: BYOK storage loud-fail and corporate-endpoint acceptance

  Background:
    Given a fresh per-scenario compose project for BYOK boot testing

  @cjm-byok-storage @cjm-byok-storage.1
  Scenario: api refuses to start when storage overlay is OFF and S3_ENDPOINT is unset
    Given the slim-core compose stack without the storage overlay
    And the env override `S3_ENDPOINT` is unset
    And the env override `OTEL_EXPORTER_OTLP_ENDPOINT` is "disabled"
    And the env override `INGRESS_BASE_URL` is "http://api.localhost"
    And the env override `DATABASE_URL` is "postgresql://app@postgres/app"
    When the api container boots expecting exit code 1
    Then the api process exits with code 1
    And stderr contains a Pino fatal record with event "byok.required"
    And stderr contains a Pino fatal record with code "BYOK_STORAGE_REQUIRED"
    And stderr contains a Pino fatal record with overlay "storage"

  @cjm-byok-storage @cjm-byok-storage.2
  Scenario: api boots when storage overlay is OFF but S3_ENDPOINT is set to corporate BYOK
    Given the slim-core compose stack without the storage overlay
    And the env override `S3_ENDPOINT` is "https://s3.corp.example.com"
    And the env override `S3_ACCESS_KEY` is "ak"
    And the env override `S3_SECRET_KEY` is "sk"
    And the env override `S3_BUCKET` is "ow"
    And the env override `OTEL_EXPORTER_OTLP_ENDPOINT` is "disabled"
    And the env override `INGRESS_BASE_URL` is "http://api.localhost"
    And the env override `DATABASE_URL` is "postgresql://app@postgres/app"
    When the api container boots expecting a healthy ready state
    Then no `byok.required` fatal record is emitted

  @cjm-byok-storage @cjm-byok-storage.3
  Scenario: api boots when storage overlay is ON
    Given the slim-core compose stack with the storage overlay
    And the env override `OTEL_EXPORTER_OTLP_ENDPOINT` is "disabled"
    And the env override `INGRESS_BASE_URL` is "http://api.localhost"
    When the api container boots expecting a healthy ready state
    Then no `byok.required` fatal record is emitted
