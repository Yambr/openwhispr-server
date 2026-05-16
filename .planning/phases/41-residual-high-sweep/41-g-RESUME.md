---
created: 2026-05-16
status: paused-mid-task-2 — context-window 65% on session
resume_command: pop stash + complete tasks
---

# Phase 41.g resume notes

## What landed (commit `d7e7df7`)

- **Task 1 HI-01** ✅ — `@openwhispr/i18n` renamed to `@openwhispr/i18n-stub`. `isPlaceholder()` export (Stryker target). `locales/` deleted. `vitest.config.ts` aligned. `41-g-DECISIONS.md` written (§D-41g-01). Audit clean: zero non-self importers.

## Stashed WIP

`git stash list` shows `stash@{0}: phase-41g-task2-parity-test-wip-glob-bug`. Pop it to recover `packages/observability/tests/unit/redact-providers-parity.test.ts` (Task 2 draft).

## What's left

### Task 2 — HI-02: byok-guard ↔ observability/redact parity test

**Current draft state (in stash):**
- File: `packages/observability/tests/unit/redact-providers-parity.test.ts`
- Greps `apps/*/src` for `process.env.*_(API_KEY|_KEY|_SECRET|_TOKEN|_PASSWORD)` env-var refs at test time.
- Asserts every discovered name appears in `REDACT_PATHS` (or is family-covered like `password` / `secret`).
- **BUG:** git-grep pathspec `'apps/*/src/*' 'apps/*/src/**/*'` returns empty in vitest context (works on CLI). discovery returns 0 names, so the "non-empty" guard test fails.

**Fix attempt:**
- Replace git-grep with a node `fs/promises` recursive walk over `apps/*/src/**/*.{ts,tsx}` since git CWD context in vitest may not match.
- Or `git ls-files 'apps/*/src/**/*.ts' | xargs grep -hE '...'`.

**Expected env vars to find** (per Phase 40.b parity test which works): 7+ — `ASSEMBLYAI_API_KEY`, `DEEPGRAM_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `PYANNOTE_API_KEY`, `TAVILY_API_KEY`, `YANDEX_API_KEY` (or `YANDEX_SEARCH_API_KEY`), plus `LITELLM_*_KEY` family.

**REDACT_PATHS coverage** (per `packages/observability/src/redact.ts:73-89`) — all 7 already present. Test should turn GREEN once discovery is fixed.

### Task 3 — HI-03: SMTP_SECURE strict-string parser

**File:** `packages/email/src/EmailSender.ts:115`. Strict `=== "true"` check rejects `1`, `TRUE`, `yes`, `on`.

**Fix:** replace with `parseBoolEnv()` helper:
```ts
function parseBoolEnv(v: string | undefined): boolean {
  if (!v) return false;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase().trim());
}
const secure = parseBoolEnv(process.env.SMTP_SECURE);
```

Tests in `packages/email/tests/`: `SMTP_SECURE=1|TRUE|yes|on|true → true; =false|0|unset → false`.

### Closure

- `41-g-SUMMARY.md`
- Flip HIGH-FIX-SMALL to Complete in REQUIREMENTS.md
- Flip Phase 41 row (or sub-row 41.g) to `[x]` in ROADMAP.md

## After 41.g — remaining Phase 41 finale

1. **LOCKER-04 BLOCKING flip** — `pnpm lint:prod-readiness` (no `--warn-only`) currently shows 47 route entries + 469 dead-export entries in allowlist. After all 7 sub-plans landed:
   - Re-run `pnpm exec tsx tools/lint-prod-readiness.ts` (without `--warn-only`) to get current finding count.
   - If route-shape findings dropped to 0 (all 47 routes have zod+rateLimit now via 41.b + cascade) → drop `--warn-only` from `package.json` `lint:prod-readiness`, clear route entries from `tools/lint-prod-readiness.allowlist.txt`, update DISCIPLINE Rule 14 prose.
   - If route findings remain → keep `--warn-only`, defer flip to v2.3, document in `41-FINAL-DECISIONS.md`.

2. **11 Phase-32 DEFERRED tests** — `.planning/phases/32-rls-fail-closed/32-DEFERRED.md` lists them. Phase 33-05 already deleted 5 Category-A. Remaining 6 (Category-B/C):
   - `tests/unit/__helpers__/__tests__/bootstrap-roles.test.ts` — role-bootstrap assertion update
   - `tests/unit/__tests__/settings-rls.test.ts` — old policy body text expected
   - `tests/unit/__tests__/worker-rls-property.test.ts` — BullMQ concurrent property test
   - `tests/unit/__tests__/audit-log-actions.test.ts` — suite-level boot fail (RLS context required)
   - 2 others per ledger

3. **v2.2 milestone close audit** — re-run the 11-agent pre-publication review against main; expect ≤ 5 residual HIGH + 0 CRITICAL.

## Why I paused

Context window hit 65% mid-task. Spawning further executors safely requires < 50% headroom for the orchestrator to consume + verify their reports. Continuing now risks hitting the 90% truncation wall mid-fix-flow, which is the failure mode CLAUDE.md warns against ("agent reports completion based on parroting sub-agent summary verbatim without verification").

Phase 41.a..f are landed clean. Phase 41.g Task 1 is closed. Tasks 2+3 are small (~30 min each) and can resume in a fresh session.
