---
slug: i18n-completeness-script-path
created: 2026-05-23
completed: 2026-05-23
status: complete
---

# Summary — point `test:i18n-completeness` script at moved test file

## What

CI job `i18n-completeness` was failing with `No test files found, exiting with code 1`. The script in `apps/api/package.json` pointed at the stale `src/i18n/__tests__/...` path; the actual file lives at `tests/unit/i18n/__tests__/i18n-completeness.test.ts` (apps-tree reorg moved it there; full `pnpm test` already runs it via include glob).

## Fix

Updated `apps/api/package.json` line 10 — `src/i18n/__tests__/` → `tests/unit/i18n/__tests__/`.

## Verification

- `pnpm --filter @openwhispr/api test:i18n-completeness` → **6/6 passed, exit 0**

## Commit

`<set after commit>`
