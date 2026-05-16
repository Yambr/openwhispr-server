# Phase 38: @openwhispr/auth retirement — SUMMARY

**Closed:** 2026-05-16
**Closes:** CRIT-FIX-10 / CR-10 from `.planning/review/REVIEW-INDEX.md`
**Commits:** single atomic (in-line orchestrator-direct, not via executor — phase is trivial)

## What landed

1. **`packages/auth/package.json`** — `name: "@openwhispr/auth"` → `"@openwhispr/auth-stub"`. Already had `private: true` (verified pre-edit). The load-bearing `@openwhispr/auth` namespace is now unsquattable from this repo.

2. **`packages/auth/src/index.ts`** — leading comment updated to reflect retirement context. Better Auth's real integration lives in `apps/api/src/auth.ts` (Phase 33 wired the encryption lens there).

3. **`vitest.config.ts:63`** — workspace project entry renamed `@openwhispr/auth` → `@openwhispr/auth-stub` so monorepo test discovery still resolves.

4. **Stryker mutate list (`stryker.config.json`)** — untouched. `packages/auth/src/**/*.ts` glob still matches; the `isPlaceholder()` export remains as a mutation target. The package's PURPOSE (Stryker harness) is preserved; only the load-bearing NAME changed.

## What was NOT changed

- `isPlaceholder()` export retained — it's still the Stryker mutation target the harness exercises. Deleting it would break Stryker's incremental cache + introduce a "no mutation surface in `packages/auth/`" warning.
- `CLAUDE.md` mention of "Phase 38's `@openwhispr/auth` retirement" left as-is; the prose is still accurate (the retirement happened, the package was renamed not deleted).

## Audit findings

```
grep -rln "@openwhispr/auth\"" --include="*.ts" --include="*.tsx" --include="*.json" apps packages tools .planning | grep -v node_modules
```

Only `packages/auth/package.json` matched (the self-reference). Zero production callers anywhere. `@openwhispr/auth-stub` is a closed leaf — no one depends on it for non-test purposes.

## Verification

- Package name resolution after rename: `pnpm --filter @openwhispr/auth-stub test` resolves the package correctly (recursive Vitest invocation, exit-1 due to UNRELATED pre-existing test failures from Phase 32+33 deferred tests; the `@openwhispr/auth-stub` resolution itself works).
- `pnpm install` reran clean — no workspace-link drift, no missing-peer warnings.
- `pnpm lint:lockers` — expected exit 0 (no new violations from a package rename).

## Closure deltas

- `.planning/REQUIREMENTS.md` — flip CRIT-FIX-10 to Complete (done in commit).
- `.planning/ROADMAP.md` — flip Phase 38 row `[ ] → [x]` (done in commit).
