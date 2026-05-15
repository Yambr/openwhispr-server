---
phase: 19-server-error-closure
plan: 02
subsystem: byok-guard / api+worker entrypoints
tags: [SR-19.3, D-09, D-10, D-11, D-12, D-20, D-22, D-39, server-error-closure]
requires: [19-01]
provides: ["BYOKGuardError exported from @openwhispr/byok-guard", "process-boundary discipline at api+worker entrypoints"]
affects: [packages/byok-guard/src/index.ts, packages/byok-guard/tests/unit/__tests__/byok-guard.test.ts, apps/api/src/index.ts, apps/api/vitest.setup.ts, apps/api/tests/unit/otel-bootstrap.test.ts, apps/api/tests/unit/__tests__/boot-order.test.ts, apps/api/tests/unit/__tests__/entrypoint-db-shape.test.ts, apps/worker/src/index.ts]
key-files:
  created: []
  modified:
    - packages/byok-guard/src/index.ts
    - packages/byok-guard/tests/unit/__tests__/byok-guard.test.ts
    - apps/api/src/index.ts
    - apps/api/vitest.setup.ts
    - apps/api/tests/unit/otel-bootstrap.test.ts
    - apps/api/tests/unit/__tests__/boot-order.test.ts
    - apps/api/tests/unit/__tests__/entrypoint-db-shape.test.ts
    - apps/worker/src/index.ts
decisions:
  - "BYOKGuardError thrown from library; entrypoints catch+log+exit (process-boundary discipline)"
  - "Pitfall §7 mitigated at apps/api/vitest.setup.ts (one-shot BYOK env bootstrap for all api unit tests)"
  - "Phase 18.1.2-04-01 vi.mock workaround removed atomically with library refactor (D-20)"
metrics:
  duration: ~1h
  commits: 2
  completed: 2026-05-15
---

# Phase 19 Plan 02: SR-19.3 BYOK Guard Refactor Summary

SR-19.3 closed: `@openwhispr/byok-guard` library no longer calls `process.exit(1)` — it logs the fatal record then throws `BYOKGuardError`. `apps/api/src/index.ts` and `apps/worker/src/index.ts` catch the typed error, re-log via a synchronous boot pino with `{ err }` cause-chain, and exit at the process boundary. Phase 18.1.2-04-01's `vi.mock('@openwhispr/byok-guard', ...)` test workaround is reverted atomically (D-12 + D-20).

## Commits (start 0263435)

| SHA       | Type                | Subject                                                                          |
| --------- | ------------------- | -------------------------------------------------------------------------------- |
| `f8aaa1d` | test (RED)          | BYOKGuardError thrown contract (SR-19.3, D-09, D-11)                             |
| `1488057` | feat (GREEN+revert) | BYOK throw not exit; api+worker catch; 18.1.2-04-01 mock revert; pitfall §7 mit. |

## Pre-check finding

`packages/byok-guard/src/index.ts:242` STILL called `process.exit(1)` at start — Phase 18.1.2-04-02 had NOT landed the lib refactor as that plan's SUMMARY had promised. Full RED+GREEN path required (not the verify-only narrowing rollback branch).

## D-09 / D-10 BYOK refactor proof

- `packages/byok-guard/src/index.ts`: new `export class BYOKGuardError extends Error`; line 242 `process.exit(1)` → `throw new BYOKGuardError(msg)`. `logger.fatal(record, msg)` at L241 preserved (lib still logs structured record before throwing).
- `apps/api/src/index.ts`: `try { assertBYOKConfig(); } catch (err) { if (err instanceof BYOKGuardError) { bootLog.fatal({ err }, ...); process.exit(1); } throw err; }`. Boot pino on synchronous fd 2.
- `apps/worker/src/index.ts`: identical pattern with `worker-boot` logger name.

## D-12 revert proof

`apps/api/tests/unit/__tests__/entrypoint-db-shape.test.ts`: the `vi.mock('@openwhispr/byok-guard', () => ({ assertBYOKConfig: () => undefined }))` workaround REMOVED. `beforeAll` now sets BYOK envs (S3_*, OTEL_*, INGRESS_BASE_URL, NODE_ENV=test) so the guard returns void. Test stays GREEN — Phase 18.1.2-04-02 Δ-3 closure preserved.

## byok-guard suite update (D-11)

`packages/byok-guard/tests/unit/__tests__/byok-guard.test.ts`:
- 11 per-row tests rewritten from `expect(exitCode).toBe(1)` → `expect(threwGuardError).toBe(true)` (instanceof `BYOKGuardError`).
- 2 default-logger/default-env tests use `expect(() => assertBYOKConfig(...)).toThrow(BYOKGuardError)`.
- NEW describe block "BYOKGuardError thrown contract": Test 1 throws, Test 2 message matches record msg, Test 3 valid env no-throw, Test 4 .name === "BYOKGuardError" + subclass of Error.

Verification: `Test Files 1 passed (1); Tests 20 passed (20)` (byok-guard.test.ts).

## Pitfall §7 mitigation

After the refactor, every api unit test that imports `apps/api/src/index.ts` (health.test.ts, index.test.ts, multipart-registered.test.ts, build-app-diarization-wiring.test.ts, otel-bootstrap.test.ts) was tripping the entrypoint's BYOK guard at module-eval time → catch handler → `process.exit(1)` → vitest exit-trap → test-file load failure. Mitigated **in-commit** by adding BYOK env defaults to `apps/api/vitest.setup.ts` (`process.env.X ??= ...`). `OTEL_EXPORTER_OTLP_ENDPOINT` deliberately set to a real URL (not the `=disabled` sentinel) so `otel-bootstrap.ts` still instantiates its NodeSDK — otel-bootstrap.test.ts asserts `mod.sdk !== null` at default load.

## Test surface alignment (in-commit)

- `apps/api/tests/unit/otel-bootstrap.test.ts` L100 assertion: rewritten from regex-on-3-lines to indexOf — asserts byok import precedes otel import + try/catch handler appears between them.
- `apps/api/tests/unit/__tests__/boot-order.test.ts`: IMPORT_LINE regex updated to `{ assertBYOKConfig, BYOKGuardError }`; CALL_LINE regex allows leading whitespace (call inside `try { }`).
- `packages/byok-guard/tests/unit/__tests__/byok-guard.test.ts`: unused `beforeEach` import removed (biome).

## Per-target verification

| Target                                               | Test Files | Tests          |
| ---------------------------------------------------- | ---------- | -------------- |
| `byok-guard.test.ts`                                 | 1 passed   | 20 passed (20) |
| api entrypoint-db-shape + boot-order + otel-bootstrap | 4 passed   | 27 passed (27) |

## Coverage

The production diff in `packages/byok-guard/src/index.ts` exchanges an unreachable-by-tests `process.exit(1)` for a test-reachable `throw new BYOKGuardError(msg)`. The new `BYOKGuardError` class + throw line are exercised by the 4-test contract block. Net effect: coverage strictly ≥ pre-refactor on the file.

## Typecheck status

- `@openwhispr/byok-guard typecheck`: PASS.
- `@openwhispr/api typecheck`: pre-existing failures unrelated to this plan (`src/routes/transcriptions/create.ts:55` + `packages/litellm-client/src/index.ts:171`); verified by `git stash && pnpm typecheck` reproducing same failures on the pre-refactor tree. Out of scope (deferred-items.md).
- `@openwhispr/worker typecheck`: pre-existing failures in `src/lib/with-tenant-context.ts` unrelated to this plan. Out of scope.

## Lefthook status

GREEN commit passed biome + phase-tag-comments + english + commitlint with zero `--no-verify`. (Biome surfaced 6 pre-existing infos on `useLiteralKeys` and 1 `noNonNullAssertion` warning on file lines untouched by this refactor — non-blocking, deferred.)

## SERVER-ERRORS Entry 4

Entry 4 ("process.exit in @openwhispr/byok-guard violates process-boundary discipline") fix LANDED here. Formal ledger closure block (`Resolved by: 19-02 commits f8aaa1d + 1488057`) deferred to Plan 03 ledger update per D-25.

## Self-Check: PASSED

- `packages/byok-guard/src/index.ts`: contains `class BYOKGuardError` + `throw new BYOKGuardError`. The only `process.exit` references remaining are in comments documenting the new entrypoint discipline; no executable `process.exit` call.
- `apps/api/src/index.ts`: contains `BYOKGuardError` import + try/catch handler.
- `apps/worker/src/index.ts`: contains `BYOKGuardError` import + try/catch handler.
- `apps/api/tests/unit/__tests__/entrypoint-db-shape.test.ts`: no `vi.mock("@openwhispr/byok-guard"` remaining.
- Commits `f8aaa1d` and `1488057` exist in `git log`.
