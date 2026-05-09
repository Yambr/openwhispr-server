# Phase 02.6 — Deferred items (out-of-scope discoveries)

These typecheck errors PRE-EXISTED Phase 02.6's surgical fix
(`apps/api/src/index.ts:229-233` destructure + remove `as never` casts).
Verified via `git stash -u && pnpm typecheck` against the pre-edit tree:
identical output, two errors per package — they are unrelated to the
entrypoint defect this phase closes. Deferred per gsd-executor scope-
boundary rule (only auto-fix issues directly caused by the current
change). Phase 02.7 candidates.

## packages/data

- `packages/data/src/__tests__/0003_better_auth_tenant_defaults.test.ts:72,85`
  — `error TS2532: Object is possibly 'undefined'.` Two array-element
  accesses without `!` or guards. Trivial fix; not load-bearing for
  Phase 02.6's contract-test goal.

## apps/api

- `apps/api/src/__tests__/auth-schema-mapping.test.ts:21` —
  `error TS2412: Type 'Record<string, unknown> | undefined' is not
  assignable to type 'Record<string, unknown>' with
  'exactOptionalPropertyTypes: true'.` Mock-capture object with optional
  `schema` property; trivial fix (initialize `schema: {}` or widen type).

- `apps/api/src/__tests__/auth-trusted-origins.test.ts:43` —
  `error TS2493: Tuple type '[]' of length '0' has no element at index '0'.`
  Trivial fix; tuple-vs-array type narrowing.

These do NOT block runtime; vitest runs tests through esbuild's transform
which strips types, so the tests themselves execute fine. Only `pnpm
typecheck` fails. The contract-test chain (`make contract-test`) does
NOT invoke `pnpm typecheck` so these pre-existing failures are irrelevant
to the Phase 02.6 acceptance gate.

Recommendation: bundle into a small Phase 02.7 cleanup (or a "ci-hygiene"
chore) that fixes all four with a single PR.
