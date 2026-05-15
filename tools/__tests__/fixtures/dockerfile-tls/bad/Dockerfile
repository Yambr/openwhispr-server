# SPDX-License-Identifier: FSL-1.1-ALv2
# Bad fixture for lint-dockerfile-tls — contains ONE forbidden token per
# line so each assertion in tools/__tests__/lint-dockerfile-tls.test.ts
# has a clean target line.
FROM debian:stable-slim
COPY rootCA.pem /usr/local/share/ca-certificates/
COPY root-ca.crt /etc/ssl/certs/
COPY root-ca.key /etc/ssl/private/
RUN mkcert -install
COPY compose/traefik/certs/ /certs/
COPY api.localhost.pem /certs/
COPY api.localhost.key /certs/
COPY local.crt /certs/
COPY local.key /certs/
