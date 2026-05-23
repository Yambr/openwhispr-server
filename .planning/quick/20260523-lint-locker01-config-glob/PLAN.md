---
slug: lint-locker01-config-glob
created: 2026-05-23
status: planned
---

# Quick: extend LOCKER-01 boundary glob to cover files named `config.ts`

## Problem

CI step `lint-english` (composite of `lint:lockers`) fails on `main` (commit `ee90182b`, run `26326357759`):

```
packages/litellm-client/src/config.ts:205  NODE_ENV-compare
```

The offending line is the HI-3 production https-veto:

```ts
if (baseUrlOverridden && env.NODE_ENV === "production") { ... }
```

This is a **legitimate boundary read** at the config-builder. LOCKER-01 (`tools/lint-no-env-branches.ts`) intends to exempt boundary files — `bootstrap.ts`, `config/*.ts`, `otel-bootstrap.ts`, `*.config.ts`. Current globs at `tools/lint-no-env-branches.ts:84-89`:

```ts
const BOUNDARY_GLOBS = [
  "**/bootstrap.ts",
  "**/otel-bootstrap.ts",
  "**/config/*.ts",   // ← matches files INSIDE a `config/` dir, NOT files NAMED `config.ts`
  "**/*.config.ts",
];
```

`packages/litellm-client/src/config.ts` is named `config.ts` but lives in `src/`, not `src/config/`. The glob misses it — a regression of the original boundary intent.

## Fix (option 1, durable)

Extend the boundary glob list to also match `**/config.ts` (any file literally named `config.ts`). This covers the entire class without per-path allowlist growth.

## TDD steps

1. **RED** — Add a vitest case to `tools/lint-no-env-branches.test.ts` that:
   - Writes a temp fixture at `<tmp>/packages/foo/src/config.ts` containing `process.env.NODE_ENV === "production"`.
   - Asserts `lintNoEnvBranches({ root: <tmp> })` returns `{ findings: [] }` (boundary exempt).
   - Commit this test seeing it **fail** (current glob doesn't match).
2. **GREEN** — Add `"**/config.ts"` to `BOUNDARY_GLOBS` in `tools/lint-no-env-branches.ts`. Re-run the test → passes. Re-run `pnpm lint:no-env-branches` at repo root → exits 0.
3. **Atomic commit** — `fix(lint): treat files named config.ts as LOCKER-01 boundary`. Push.
4. **Verify CI** — Confirm `lint-english` step on next CI run turns green.

## Files

- `tools/lint-no-env-branches.ts` — add one entry to `BOUNDARY_GLOBS`
- `tools/lint-no-env-branches.test.ts` — add fixture-test
- (No production code touched.)

## Acceptance

- Local: `pnpm lint:no-env-branches` exits 0
- Local: `pnpm vitest run tools/lint-no-env-branches.test.ts` passes (incl. new case)
- CI: `lint-english` job goes green on the resulting commit
