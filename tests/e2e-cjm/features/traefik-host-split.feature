# SPDX-License-Identifier: Apache-2.0
# Phase 15 / Plan 02 / Task 1 — @cjm-traefik-host-split (TD-15.g closure).
#
# Asserts that the dev compose stack's Traefik host split routes
# `api.localhost` to the Fastify API container (port 3000) and
# `web.localhost` to the Next.js web container (port 3001).  Both routers
# are declared in `compose/traefik/dynamic.dev.yml`.  Cucumber scenarios
# are tagged `@after-docker-up` because the e2e-cjm harness requires a
# live `docker compose up` (api + web + traefik); they go GREEN as part
# of the GHA `e2e-cjm` workflow once the stack boots.

Feature: Traefik host split (web.localhost vs api.localhost)

  @cjm-traefik-host-split @after-docker-up
  Scenario: GET /api/locale on api.localhost returns localized JSON (not 404)
    When a GET to /api/locale on api.localhost is issued with Accept-Language "ru"
    Then the response is 200 with content-type application/json and a locale of "ru"

  @cjm-traefik-host-split-web @after-docker-up
  Scenario: GET / on web.localhost returns the web app shell (not routed to api:3000)
    When a GET to / on web.localhost is issued
    Then the response is 200 with content-type text/html and the body contains the web app shell marker
