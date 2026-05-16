# Phase 36.a — Decisions

## D-1: LOCKER-06 BLOCKING flip carries 11 pre-existing test/tooling allowlist entries

**Context.** Phase 36.a's exit criteria require LOCKER-06 (`lint-shell-credential-interpolation`) to flip from WARN-only to BLOCKING in the same atomic commit that rewrites `apps/worker/src/jobs/audit-archive.ts:96-128` to argv-array form. That rewrite is done; the production locker target is clean.

**Surface.** Dropping `--warn-only` from `package.json` exposed 11 pre-existing findings that the flag was masking:

| File | Lines | Binding | Surface |
|---|---|---|---|
| `packages/data/migrations/__tests__/0017-setup-state.test.ts` | 81, 84, 95 | `ownerPassword` | test fixture |
| `tests/e2e/compose-helper.ts` | 139, 150 | `BACKEND_URL` | e2e helper, non-secret |
| `tests/e2e/helpers/phase6-compose.ts` | 316, 782, 801 | `BACKEND_URL` | e2e helper, non-secret |
| `tests/self-tests/rls-introspection.test.ts` | 40, 58 | `ownerPassword` | self-test fixture |
| `tools/lint-rls.test.ts` | 67 | `ownerPassword` | linter test fixture |

All 11 are in `tests/`, `tools/`, or `packages/data/migrations/__tests__/` — NOT production paths (`apps/**/src/**`, `packages/**/src/**`). The `ownerPassword` bindings are test-container passwords minted per-test by `@testcontainers/postgresql`; `BACKEND_URL` is the operator-facing compose endpoint, non-secret.

**Decision.** Add the 11 entries to `tools/lint-shell-credential-interpolation.allowlist.txt` with explicit "pre-existing test-fixture" rationale, and link back to this §D-1 in each comment. **Do NOT block Phase 36.a on this collateral.** Rationale:

1. **Scope.** Phase 36 CONTEXT.md and CR-5 / CRIT-FIX-07 are explicit: target is `apps/worker/src/jobs/audit-archive.ts`. The 11 collateral findings are out of scope.
2. **Regression-prevention contract preserved.** LOCKER-06's purpose — catch any reintroduction of the audit-archive pattern in production code — is achieved by the BLOCKING flip. A future test/tooling change that re-introduces a `spawn('bash', ['-c', \`...${cred}...\`])` in production-source paths is refused by lefthook + CI. Existing test debt is documented, attributed, and bounded.
3. **No new debt.** The allowlist additions are EXISTING violations, not new ones. The flip exposes them; it does not create them.
4. **Cheaper to fix in a dedicated phase.** Each `tests/e2e/compose-helper.ts` template literal is the WAIT-FOR pattern (`bash -c "until curl ${BACKEND_URL}/health; do sleep 1; done"`). Rewriting that as a polling loop in node would touch the entire e2e harness — a multi-hour refactor. A follow-up phase can do it as a single coherent change instead of splattering it across Phase 36.

**Follow-up.** A future-phase entry SHOULD be added to ROADMAP.md (test/tooling LOCKER-06 cleanup), but is NOT a blocker for any v2.2 closure. Rule 2 of the user-mandated hard rules from `CLAUDE.md` is honored: pre-existing test-infra constraints are documented and bounded, NOT silently rewritten in-flight.

**Verification at flip time.** `pnpm lint:shell-credential-interpolation` exits 0 with the new allowlist; all 11 findings appear as `WARN allowlisted` lines on stderr. `pnpm lint:lockers` exits 0. The full audit-archive test suite is GREEN (20/20).
