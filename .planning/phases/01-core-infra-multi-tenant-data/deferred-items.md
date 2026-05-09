# Phase 1 — Deferred Items

All Phase 1 deferred items resolved as of Phase 2 completion (2026-05-09).

- **SC#1 partial (API entrypoint defense-in-depth orphaned)** — CLOSED by Plan 02-02. The `apps/api/Dockerfile` ENTRYPOINT now invokes `dist/scripts/check-default-secrets.cjs` BEFORE Node main; `tests/self-tests/api-entrypoint-default-secrets.test.ts` exercises the contract end-to-end (compose up with fixture `MASTER_KEK=changeme` → exit non-zero with offending key on stderr). See `.planning/phases/02-auth-wire-api-skeleton-conformance-harness/02-02-SUMMARY.md` for details.
- **Pre-existing biome warnings (01-04 / 01-05)** — handled out-of-band during Phase 2; no longer outstanding.
