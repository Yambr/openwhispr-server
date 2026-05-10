# Deferred Items — Phase 04 Streaming Realtime

- **2026-05-11 (plan 04-05)**: `tests/integration/traefik-network-alias.test.ts` and `tests/integration/contract-test-runner-compose.test.ts` fail locally because the worktree lacks `.env`. `docker compose config` returns non-zero before they can parse output. Pre-existing, environmental, NOT caused by 04-05. Owner: next phase touching docker-compose env bootstrap.
