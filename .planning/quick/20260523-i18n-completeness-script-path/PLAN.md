---
slug: i18n-completeness-script-path
created: 2026-05-23
status: planned
---

# Quick: fix stale path in apps/api `test:i18n-completeness` script

## Problem

CI job `i18n-completeness` fails on `main` (run `26326357759`):

```
$ vitest run src/i18n/__tests__/i18n-completeness.test.ts
No test files found, exiting with code 1
```

`apps/api/package.json` script line 10:

```json
"test:i18n-completeness": "vitest run src/i18n/__tests__/i18n-completeness.test.ts"
```

But the real file lives at `apps/api/tests/unit/i18n/__tests__/i18n-completeness.test.ts` (moved during the apps-tree reorg). It DOES run successfully under the full `pnpm test` run (`✓ 6 tests passed`); only the dedicated CI script targets the stale `src/` path.

## Fix

Update the script path to the actual location.

## TDD

The test file itself already exists and passes. Verification is direct:

```bash
pnpm --filter @openwhispr/api test:i18n-completeness
```

must produce `6 tests passed` and exit 0.

## Files

- `apps/api/package.json` — 1-line path update

## Acceptance

- Local: `pnpm --filter @openwhispr/api test:i18n-completeness` → 6 tests pass, exit 0
- CI: `i18n-completeness` job goes green
