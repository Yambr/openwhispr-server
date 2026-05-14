# SPDX-License-Identifier: Apache-2.0
# Phase 14 / Plan 14-07 — BYOK observability overlay refusal + sentinel scenarios.
#
# Source-of-truth:
#   - .planning/phases/14-slim-core-byok-profiles-v2/14-CONTEXT.md decisions 2 + 5
#   - .planning/phases/14-slim-core-byok-profiles-v2/14-RESEARCH.md section E
#   - packages/byok-guard/src/index.ts (observabilityRow evaluator)
#
# Three scenarios cover the OTEL_EXPORTER_OTLP_ENDPOINT contract:
#   1. unset            → BYOK_OBSERVABILITY_REQUIRED fatal
#   2. =disabled         → no-op (sentinel short-circuit per CONTEXT.md
#                           decision 5; otel-bootstrap returns sdk=null)
#   3. <BYOK URL>        → boots; corp OTLP endpoint accepted (the URL
#                           may be unreachable — the scenario only
#                           asserts api boot health, not exporter delivery)

@cjm-byok-observability
Feature: BYOK observability loud-fail and `=disabled` sentinel

  Background:
    Given a fresh per-scenario compose project for BYOK boot testing

  @cjm-byok-observability @cjm-byok-observability.1
  Scenario: api refuses to start when observability overlay is OFF and OTEL_EXPORTER_OTLP_ENDPOINT is unset
    Given the slim-core compose stack without the observability overlay
    And the env override `S3_ENDPOINT` is "https://s3.corp.example.com"
    And the env override `S3_ACCESS_KEY` is "ak"
    And the env override `S3_SECRET_KEY` is "sk"
    And the env override `S3_BUCKET` is "ow"
    And the env override `OTEL_EXPORTER_OTLP_ENDPOINT` is unset
    And the env override `INGRESS_BASE_URL` is "http://api.localhost"
    And the env override `DATABASE_URL` is "postgresql://app@postgres/app"
    When the api container boots expecting exit code 1
    Then the api process exits with code 1
    And stderr contains a Pino fatal record with code "BYOK_OBSERVABILITY_REQUIRED"
    And stderr contains a Pino fatal record with overlay "observability"

  @cjm-byok-observability @cjm-byok-observability.2
  Scenario: api boots in no-op telemetry mode when OTEL_EXPORTER_OTLP_ENDPOINT is set to "disabled"
    Given the slim-core compose stack without the observability overlay
    And the env override `S3_ENDPOINT` is "https://s3.corp.example.com"
    And the env override `S3_ACCESS_KEY` is "ak"
    And the env override `S3_SECRET_KEY` is "sk"
    And the env override `S3_BUCKET` is "ow"
    And the env override `OTEL_EXPORTER_OTLP_ENDPOINT` is "disabled"
    And the env override `INGRESS_BASE_URL` is "http://api.localhost"
    When the api container boots expecting a healthy ready state
    Then no `byok.required` fatal record is emitted
    And no OTel SDK initialization log appears

  @cjm-byok-observability @cjm-byok-observability.3
  Scenario: api boots and exports to corp OTLP when overlay OFF but BYOK endpoint set
    Given the slim-core compose stack without the observability overlay
    And the env override `S3_ENDPOINT` is "https://s3.corp.example.com"
    And the env override `S3_ACCESS_KEY` is "ak"
    And the env override `S3_SECRET_KEY` is "sk"
    And the env override `S3_BUCKET` is "ow"
    And the env override `OTEL_EXPORTER_OTLP_ENDPOINT` is "http://localhost:14317"
    And the env override `INGRESS_BASE_URL` is "http://api.localhost"
    When the api container boots expecting a healthy ready state
    Then no `byok.required` fatal record is emitted
