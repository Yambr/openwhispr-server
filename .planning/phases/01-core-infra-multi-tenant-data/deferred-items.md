# Phase 1 — Deferred Items

Out-of-scope discoveries logged during plan execution. None block Phase 1
closure. Each entry is a candidate for a quick-fix follow-up commit
before Phase 2 begins.

## Pre-existing biome warnings (discovered during 01-06 final smoke)

`pnpm exec biome check .` reports three lint/format issues in files
authored by earlier Phase 1 plans (01-04, 01-05). They are NOT introduced
by 01-06 and are out of scope per the executor SCOPE BOUNDARY rule:

| File | Line | Rule | Suggestion |
|------|------|------|-----------|
| `packages/data/src/__tests__/usage-ledger.test.ts` | 24 | `lint/style/noNonNullAssertion` | replace `rows[0]!.id` with `rows[0]?.id` |
| `tools/lint-rls.ts` | 172 | `lint/complexity/useOptionalChain` | replace `!f \|\| !f.rls_enabled` with `!f?.rls_enabled` |
| `packages/data/src/__tests__/rls-property.test.ts` | 326 | format | biome formatter would re-wrap the line |

All three are biome-FIXABLE via `pnpm exec biome check --write --unsafe`.
Recommend a `chore(01): apply biome --unsafe fixes from earlier plans`
clean-up commit at the start of Phase 2.

## SC#1 partial: API entrypoint defense-in-depth orphaned

Verifier flagged SC#1 as PARTIAL:

- **Layer 1 (bootstrap.sh):** FULLY WIRED. Aborts on deny-list values; 5
  self-tests green.
- **Layer 2 (API container entrypoint, D-08):** ORPHANED. The script
  `apps/api/scripts/check-default-secrets.ts` exists and passes 4 unit
  tests, but Phase 1 doesn't add a `Dockerfile` or an `api` service to
  `docker-compose.yml` — that work belongs to Phase 2.

**Why deferred to Phase 2:** Phase 1's scope is the data plane only. The
API container materializes in Phase 2 (Auth + Wire-API Skeleton). At
that point:
- Add `apps/api/Dockerfile` with ENTRYPOINT calling
  `node /app/scripts/check-default-secrets.cjs` BEFORE node entry.
- Add `api` service to `docker-compose.yml`.
- Add an integration self-test that runs `docker compose up` with a
  fixture `.env` containing `MASTER_KEK=changeme` and asserts the API
  container exits non-zero with the offending key name in stderr.

**Risk while deferred:** A bad actor can write `MASTER_KEK=changeme`
directly to `.env` (skipping bootstrap.sh) and `docker compose up` will
bring up the data plane without the API container objecting. The data
plane itself doesn't read MASTER_KEK (only the API does at runtime), so
the practical exploitability is low — but the constitutional design
contract (D-08) is unfulfilled until Phase 2 wires Layer 2.

## Notes

- The init context for 01-06 reported `01-05` as incomplete; this was a
  stale list — `01-05-SUMMARY.md` is present and 01-05 is fully landed.
  No action needed.
