# SPDX-License-Identifier: FSL-1.1-ALv2
# Phase 17 / Plan 02 — TLS journey scenarios.
#
# Three scenarios under @phase-17 @tls:
#   1. @cjm-tls-trusted-localhost — mkcert dev cert trusted by browser
#      after `make tls-trust` (ROADMAP §17 SC #5). Live; requires the
#      docker compose stack — tagged @after-docker-up @expected-red and
#      deferred to GHA CI per Phase 15-16 precedent.
#   2. @cjm-tls-no-dev-ca-in-prod-image — TLS-05 enforcement. Static
#      filesystem scan of the built prod image via `docker create + docker
#      export | tar -t`; runnable in CI without compose stack-up. Sole
#      regression guard against per-context .dockerignore drift.
#   3. @cjm-tls-acme-staging — TLS-02-prod / TLS-03 enforcement. ACME
#      staging issuance via Traefik prod profile; live, @after-docker-up
#      @expected-red, deferred to GHA CI.

@phase-17 @tls
Feature: Trusted local TLS + production ACME isolation

  @cjm-tls-trusted-localhost @after-docker-up @expected-red
  Scenario: mkcert dev cert is trusted by browser on first run
    Given the developer has run `make tls-trust` on this host
    When they curl https://api.localhost/healthz with the mkcert root CA
    Then the response is 200 with no TLS warning
    And the served leaf cert SAN list contains exactly the 5 explicit hosts
    And the served leaf cert SAN list contains no wildcard entries

  @cjm-tls-no-dev-ca-in-prod-image
  Scenario: production image contains no dev CA artefacts
    Given the api production image has been built with tag openwhispr-api:tls-test
    When the image filesystem is scanned via docker-export + tar
    Then no path matches rootCA.pem
    And no path matches local.crt or local.key
    And no path contains mkcert
    And no path matches compose/traefik/certs/
    And any bootstrap-minted cert SAN list contains no wildcard entries

  @cjm-tls-acme-staging @after-docker-up @expected-red
  Scenario: ACME staging endpoint issues cert via Traefik prod profile
    Given the operator has set LETSENCRYPT_EMAIL and LETSENCRYPT_STAGING=1
    And the stack is up via docker compose with the acme overlay
    When they curl https://api.example.com/healthz
    Then the served leaf cert is issued by STAGING Let's Encrypt
    And the cert chain validates against the staging root
