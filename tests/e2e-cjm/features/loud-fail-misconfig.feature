# SPDX-License-Identifier: Apache-2.0
# Phase 14 / Plan 14-07 — boot-order + credential-redaction scenarios.
#
# Source-of-truth:
#   - .planning/phases/14-slim-core-byok-profiles-v2/14-CONTEXT.md decision 2
#   - .planning/phases/14-slim-core-byok-profiles-v2/14-RESEARCH.md section E
#   - packages/byok-guard/src/index.ts (loud-fail boot ordering invariant)
#   - packages/byok-guard/src/redact-url.ts
#
# Two scenarios verify two distinct loud-fail discipline properties:
#
#   1. Boot-order — the Pino fatal record is the FIRST level-60 record on
#      stderr; neither installGlobalSSRF nor the OTel SDK initialization
#      log appears anywhere in the captured stderr. This proves the guard
#      fires before any side-effecting bootstrap.
#
#   2. Credential redaction — when an operator passes a credential-bearing
#      URL (e.g., `https://user:secret@host/`), the fatal record's `hint`
#      field contains the redacted form `https://*****@host/` and the raw
#      password substring never appears anywhere in stderr.

@cjm-loud-fail-misconfig
Feature: Loud-fail boot order and credential redaction

  Background:
    Given a fresh per-scenario compose project for BYOK boot testing

  @cjm-loud-fail-misconfig @cjm-loud-fail-misconfig.1
  Scenario: misconfig fatal precedes installGlobalSSRF and otel-bootstrap
    Given the slim-core compose stack without the storage overlay
    And the env override `S3_ENDPOINT` is unset
    And the env override `OTEL_EXPORTER_OTLP_ENDPOINT` is "disabled"
    And the env override `INGRESS_BASE_URL` is "http://api.localhost"
    And the env override `DATABASE_URL` is "postgresql://app@postgres/app"
    When the api container boots expecting exit code 1
    Then the api process exits with code 1
    And the very first Pino fatal log line on stderr has event "byok.required"
    And no SSRF dispatcher initialization log appears
    And no OTel SDK initialization log appears

  @cjm-loud-fail-misconfig @cjm-loud-fail-misconfig.2
  Scenario: credential-bearing strings in the fatal record are redacted
    Given the slim-core compose stack without the storage overlay
    And the env override `S3_ENDPOINT` is "https://access:secret@s3.corp.example.com/"
    And the env override `OTEL_EXPORTER_OTLP_ENDPOINT` is "disabled"
    And the env override `INGRESS_BASE_URL` is "http://api.localhost"
    And the env override `DATABASE_URL` is "postgresql://app@postgres/app"
    When the api container boots expecting exit code 1
    Then the api process exits with code 1
    And stderr contains a Pino fatal record with code "BYOK_STORAGE_REQUIRED"
    And the fatal record `hint` field contains the redacted form "*****@s3.corp.example.com"
    And the raw substring "secret" does not appear anywhere on stderr
