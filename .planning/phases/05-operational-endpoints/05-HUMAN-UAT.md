---
status: partial
phase: 05-operational-endpoints
source: [05-VERIFICATION.md]
started: 2026-05-11T00:00:00Z
updated: 2026-05-11T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live e2e suite — `make e2e-test`
expected: 9/9 phase-05 e2e specs pass against live docker-compose stack (usage, streaming-usage, web-search, stt-config, note-recording-config, notes/folders/conversations/transcriptions CRUD all round-trip through Traefik+API+Postgres+PgBouncer)
result: [pending]

### 2. Coverage gate — `pnpm -r test --coverage`
expected: ≥90/90/90/90 (lines/branches/functions/statements) on every file under apps/api/src/routes/{notes,folders,conversations,transcriptions,v1/keys,agent,streaming-usage.ts,usage.ts,stt-config.ts,note-recording-config.ts} and apps/api/src/lib/{argon2-keys,client-id-upsert,keyset-pagination,settings-resolver,soft-delete,web-search/*}.ts
result: [pending]

### 3. Live Yandex Cloud Search round-trip
expected: POST /api/agent/web-search with provider='yandex' returns 200 OK with non-empty results[] and writes a usage_ledger row (real YANDEX_SEARCH_API_KEY + YANDEX_SEARCH_FOLDER_ID required)
result: [pending]

### 4. Contract negative matrix — `make contract-test BACKEND_URL=https://api.localhost`
expected: negative-matrix-enumeration.test.ts hits /api/_test/route-list and asserts every fastify route is in the inventory; negative-matrix.test.ts loops over inventory + synthetic unknown paths; all return `{error: string}` envelope
result: [pending]

### 5. Phase 2-4 regression check
expected: All Phase 2-4 endpoints still pass full contract test suite; only the pre-existing fixture-id 404 failures (notes/folders/conversations crud.integration.test.ts, search.integration.test.ts) remain — these are documented in deferred-items.md as fixture issues, NOT Phase-5-introduced
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps

[none — VERIFICATION 9/9 static; these items confirm gate runtime evidence only]
