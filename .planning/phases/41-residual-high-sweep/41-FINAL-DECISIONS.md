---
phase: 41
title: Phase 41 finale — LOCKER-04 flip + Category-A/B test debt
date: 2026-05-16
status: deferred-to-v2.3
---

# Phase 41 finale decisions

After sub-plans 41.a–41.g landed, two open-question items remained from
the Phase 41 charter. Both are deferred to v2.3 with empirical rationale
below.

## D-41-FINAL-01 — LOCKER-04 BLOCKING flip → defer to v2.3

**Status:** keep `--warn-only` on `pnpm lint:prod-readiness` in main; defer
BLOCKING flip to v2.3.

**Evidence (re-run on 2026-05-16 against HEAD `fd26741`):**
- Route-shape findings (`LOCKER-04-NO-SCHEMA` / `LOCKER-04-RATELIMIT` /
  `LOCKER-04-INVALID-RATELIMIT-FALSE`): **46 open** across
  `apps/api/src/routes/{agent,auth-providers,capabilities,conversations,
  diarization,folders,locale,note-recording-config,notes,reason,setup-*,
  streaming-usage,...}.ts`. Phase 41.b only closed `agent/stream`; the
  remaining 45 routes still lack body zod schemas and/or per-user
  rateLimit configs.
- Dead-export findings (`LOCKER-04-DEAD-EXPORT`): **520 open**, dominated
  by the `packages/litellm-client` public-surface re-exports
  (`buildLitellmClient`, `loadLitellmConfigFromEnv`,
  `DEFAULT_CHAT_MODEL`, etc.). These are intentionally public package
  exports that no current `apps/` caller consumes directly because
  consumers go through `loadLitellmClientForRequest` / the boot-wrapped
  client; the linter's flat reachability heuristic cannot see the
  indirection without an API-surface allowlist.

**Why defer:**
- 46 routes × (RED test for zod schema + GREEN body wire-up + per-user
  rateLimit + LOCKER-03 allowlist line-shift sweep) ≈ a week of
  TDD-disciplined work. Not "Phase 41 finale" sized.
- The 520 dead-export findings need a packages-public-surface allowlist
  refactor in LOCKER-04 itself (or per-package `// @openwhispr-public-api`
  marker) before they can be reasoned about; flipping BLOCKING without
  that refactor would force a regression-by-stripping of legitimate
  package surface.

**Action items for v2.3:**
1. Open a v2.3 phase "LOCKER-04 BLOCKING flip + 46-route bulk zod/rateLimit"
   with RED tests per route family.
2. Either add `@openwhispr/public-api` markers to `litellm-client/src/index.ts`
   re-exports OR extend LOCKER-04 with a per-package public-surface allowlist
   (`tools/lint-prod-readiness.public-api.txt`).
3. Re-run `pnpm exec tsx tools/lint-prod-readiness.ts` after each
   sub-plan; flip `--warn-only` off once route count reaches 0 AND
   dead-export count reaches 0 (modulo the public-surface allowlist).

**DISCIPLINE Rule 14 prose update:** the WARN→BLOCKING ledger in CLAUDE.md
already states "LOCKER-04 BLOCKING flip is operationally deferred from
Plan 31-08 to Phase 41 closure". With this decision, the deferral target
shifts to v2.3. CLAUDE.md edit batched into the milestone-close commit
rather than per-decision (minimize churn).

## D-41-FINAL-02 — 6 Phase-32 Category-A/B test fixes → defer to v2.3

**Status:** the 6 remaining `packages/data` tests asserting pre-Phase-32
fail-open semantics stay broken on main; defer the rewrite to v2.3.

**Evidence:** `.planning/phases/32-rls-fail-closed/32-DEFERRED.md`
inventory remains current. Category-A (5 cases in
`0003_better_auth_tenant_defaults.test.ts`) asserts behavior that Phase 32
explicitly reversed — these are not bug fixes, they are intentional
contract changes that need their assertion targets re-written.

**Why defer:**
- The failing tests were already failing at Phase 32 closure; they are
  not a regression introduced by 41.a–41.g.
- The full `packages/data` suite still passes its Phase-32 invariant
  contract test (`rls-fail-closed.property.test.ts` 128/128 in isolation)
  per the DEFERRED ledger §Category-C note.
- Touching them now requires re-writing assertions that contradict
  Phase 32's intent — out-of-scope for "residual HIGH sweep".

**Action items for v2.3:** open a v2.3 phase "Phase-32 test-debt cleanup"
that rewrites the 6 assertions to the new fail-closed invariant, drops
the obsolete role-config expectations, and removes the 32-DEFERRED ledger
once empty.

## Phase 41 closure verdict

Phase 41 sub-plans **a–g all landed** with TDD, atomic commits, and
GREEN tests. The two finale items above are explicitly carried to v2.3
with rationale, not silently dropped. Phase 41 is flipped to `[x]` in
ROADMAP.md and HIGH-FIX-* requirements rows are marked Complete in
REQUIREMENTS.md.

The v2.2 milestone audit (11-agent re-run) is now unblocked.
