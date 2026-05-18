# Deferred Items — OPEN ONLY

Items discovered during execution that are still actionable. Closed items
are archived under `.planning/backlog-archive/`.

**Triage convention:** any item below is OPEN. When a fix lands, delete
the entry rather than marking it closed — git history preserves the
record. Keep this file under ~200 lines.

---

## Coverage debt

### BUG-53-36 — root vitest workspace Branches coverage 88.08% (< 90% floor)

`pnpm test` at repo root reports:
- Statements 92.18% ✅
- Branches  **88.08% (2958/3358)** ❌ (-1.92 below DISCIPLINE floor)
- Functions 93.97% ✅
- Lines     92.82% ✅

Branch axis is the only one under floor. Not a single-bug item — 400
uncovered branches need a coverage-closure phase. Likely hotspots:
- `apps/api/src/lib/**` conditional fallbacks
- `apps/api/src/routes/v1/keys/**` BYOK error envelopes
- `packages/data/src/encryption` `catch` arms

**Plan of attack:** open `coverage/lcov-report/index.html` after a fresh
`pnpm test`, sort by Uncovered Branches desc, file targeted plans for
the top 10 files. Per-file fix is typically <50 LOC of vitest.

---

## Test-architecture debt

### BUG-vitest-workspace-load — `pnpm --filter @openwhispr/api test` reports 104 file-load failures (NOT test failures)

`pnpm --filter @openwhispr/api test` exit 1 but:
- **Tests: 3296 passed, 188 skipped, 0 functional failures**
- **Test Files: 104 FAILED TO LOAD, 313 passed, 32 skipped (449 total)**

The 104 failures are workspace auto-pulled projects (`tests-self-tests`,
`tests-e2e-cjm-support`, `tests-integration`) that fail to initialize
under the `@openwhispr/api` scope context. Each fail is a load error,
not a test assertion. Running the same files individually passes —
e.g. `pnpm vitest run tests/integration/email-lowercase-normalize.test.ts`
returns 7/7 GREEN in ~5s.

**Why it matters:** CI exit code is 1 even when every test passes.
Operators reading `pnpm test` output have to filter out 104 phantom
fails to see the 3296 real passes. Confuses gsd-verifier coverage
checks.

**Fix recommendation:** audit `vitest.workspace.ts` + each
package-local `vitest.config.ts`. Either (a) make workspace projects
opt-in by package filter, or (b) provide per-project `extends:`
that resolves correctly under cross-package scope.

**Linked memory:** `feedback_testcontainers_cleanup_audit` notes
this as a long-standing issue.

---

### BUG-53-41-remaining — defense-in-depth for LiteLLM-backed routes

DX vector closed via dev-tools overlay seeding `LITELLM_MASTER_KEY`.
Still open:

- (a) **Boot fail-loud in production:** when `LITELLM_MASTER_KEY` is
  missing AND `NODE_ENV === "production"`, EX_CONFIG-exit at boot.
  Mirror the `validateAuthBoot` pattern in `apps/api/src/config/auth.ts`.
- (b) **Register-as-503 fallback:** when client construct fails for
  ANY reason (not just missing key), register the 4 routes with a 503
  handler that surfaces `"LiteLLM client failed at boot: <reason>"`
  instead of bare 404 "Not found".
- (c) **/api/health surface:** add `litellm_ready: boolean` to the
  health response. Wire-contract change — needs BACKEND_SPEC.md
  alignment review first.

Currently 4 LiteLLM-backed routes (transcribe, reason, diarization,
realtime) silently 404 if the key is unset and the operator missed
the boot-time warning.

---

## Phase 54+ ownership

### BUG-53-27 — server-side fetch intercept (MSW node-server)

24 e2e specs in `apps/web/tests/e2e/` are auto-skipped under the slim
topology because their `page.route()` stubs can't intercept the
RSC server-side fetch wall. Phase 54 should land MSW node-server to
intercept inside the Next.js server runtime; would re-enable the
24 currently-skipped loading/error state specs.

### Phase 38 / `@openwhispr/auth` retirement

Dead-export backlog from LOCKER-04 flagged in CLAUDE.md (operationally
deferred from Plan 31-08 to Phase 41 closure).

### LOCKER-05, LOCKER-06.a flips

Defense-in-depth lint upgrades scheduled — LOCKER-05 flips in Phase 37;
LOCKER-06.a flips in Phase 36.a. Rationale in
`.planning/phases/31-constitutional-lockers/31-08-DECISIONS.md §D-1`.

---

## Historical (pre-Phase 53)

Older items from Phases 14, 18, 20, 31, 33, 51 live in
`.planning/backlog-archive/deferred-items-2026-05-19-archive.md`. Most
are either:
- Closed but not removed when the fix landed
- Subsumed by later phase work
- Still open but cold (no signal in 30+ days)

If a cold item resurfaces (test failure, prod alert, audit hit),
promote it back into this file with current date + repro.
