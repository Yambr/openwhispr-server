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

## Notes

- The init context for 01-06 reported `01-05` as incomplete; this was a
  stale list — `01-05-SUMMARY.md` is present and 01-05 is fully landed.
  No action needed.
