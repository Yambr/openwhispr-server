# Phase 2 / Plan 06 — Fixture OIDC IdP for the contract-test profile.
# NEVER built/run in production — gated by `profiles: [contract-test]`
# in docker-compose.yml.
FROM node:24-alpine

WORKDIR /app
COPY server.mjs /app/server.mjs

USER node
EXPOSE 9000
HEALTHCHECK --interval=5s --timeout=3s --retries=5 \
  CMD wget --quiet --tries=1 --spider http://localhost:9000/livez || exit 1
ENTRYPOINT ["node", "/app/server.mjs"]
