# PLAN-CHECK — Iteration 1 (rev 1)

**Phase:** `260528-0cm-agent-stream-error-contract`
**Plan:** `.planning/quick/260528-0cm-agent-stream-error-contract/PLAN.md` (rev 1, 1132 lines)
**Verdict:** **YELLOW** — plan delivers D1-D4 fully; two BLOCKERS from project DISCIPLINE rule "E2E mandatory" + one BLOCKER from interface drift between CONTEXT.md and PLAN.md export names; remaining 12 user check points pass.

---

## Per-user-check verdict

| # | User check | Status | Evidence |
|---|------------|--------|----------|
| 1 | D1 single terminal frame both preflight + mid-stream (L272-284 and L319-L337) | **PASS** | Task 5 Part D (preflight, L527-545) and Part E (drain, L549-560) both invoke the shared `emitTerminalErrorChunk` closure; Part E comment explicitly forbids a following `done`; Task 4 rewrite of Test 10 asserts NO `"type":"done"` in mid-stream drain response |
| 2 | D2 `provider` encoded inline in route, helper stays provider-agnostic; `ClassifiedAgentError` does NOT carry provider | **PASS** | Task 2 action Step A: "`provider:"litellm"` is encoded at the route call site, NOT inside this helper; the helper's `ClassifiedAgentError` does NOT carry provider"; Task 5 PART C closure computes `provider = err instanceof LitellmUpstreamError ? "litellm" : "unknown"` inline |
| 3 | D3 `CANONICAL_ERROR_MESSAGES` NOT exported; test-side duplicates literals; NO Cyrillic | **PASS** | Task 2 action: "`CANONICAL_ERROR_MESSAGES` is an internal const, NOT exported"; frontmatter `exports: ["classifyUpstreamError", "AgentErrorCode", "ClassifiedAgentError"]`; Task 1 action defines `EXPECTED_*` test-side literals; grep finds zero Cyrillic in PLAN.md |
| 4 | D4 remove `upstream_error`/`stream_error` literals; Task 9 step 7 grep verifies residual zero | **PASS** | Task 5 PART D deletes `endWithFinish(raw, "upstream_error")`; PART E deletes synthetic `finishReason:"stream_error"` chunk; Task 5 `<verify>` includes `git grep -nE '"upstream_error"\|"stream_error"' apps/api/src/ packages/*/src/`; Task 9 step 7 re-runs the same grep |
| 5 | R6 v1.0.12 evidence gate runs AFTER commit, BEFORE push | **PARTIAL (warning)** | Task 9 step 6 runs `pnpm test:evidence:projects-self-test` BEFORE commit (not after). The user's check asks for "AFTER commit + before push". This is a sequencing nit — Task 10 step 5 has "Do NOT push unless user explicitly requests", which is the practical equivalent. Acceptable, but Task 9 step 6 should ideally re-run AFTER Task 10 step 2's commit to produce evidence fragment binding to the actual landed SHA. |
| 6 | No `contentEmitted` flag introduced | **PASS** | R2 risk register explicitly disclaims it; Task 5 closure has no content-tracking state; relies on drain-catch position alone per D1's "same shape regardless of preceding content" |
| 7 | Tests 9/10/17/18 rewrite with exact test name references | **PASS** | Task 4 PART B enumerates all 4 tests by number with new behavior + new test names; covers preflight 401, mid-stream drain, preflight 500, preflight invalid-model |
| 8 | Gitleaks allowlist for fixtures + NO `--no-verify` | **PASS** | Task 9 step 8 + R8 risk: allowlist additions + `tools/lint-gitleaks-config.test.ts` regression assertion land in SAME atomic commit; Task 10 PART 2 commits without `--no-verify`; explicit "no `--no-verify` bypass" in Hard Rule 4 invocation |
| 9 | Helper exports limited to 3 names; LOCKER-04 happy | **PASS** | Frontmatter `exports` lists exactly those 3; Task 2 action: "no other exports — LOCKER-04 dead-export hygiene"; `CANONICAL_ERROR_MESSAGES` confirmed internal |
| 10 | Coverage ≥90/90/90/90 per new file; Task 9 asserts per-file thresholds | **PASS** | Task 9 step 3 + "Coverage Targets per File" table at L1018-1024 specifies helper ≥90/90/90/90; route catch paths 100/100/100/100; sse-parser unchanged (type-only) |
| 11 | Contract test mocks LiteLLM only at network boundary, real Postgres/Valkey via testcontainers | **PASS** | Task 6 behavior: "Real auth path... Real Postgres + Valkey via testcontainers... do NOT mock data plane — project rules forbid in-process logic mocks; only network-boundary mocks are allowed → MockAgent at the LiteLLM HTTP boundary" |
| 12 | Single atomic wave, 10 `auto` tasks, no checkpoints | **PASS** | Frontmatter `wave: 1`, `depends_on: []`; all 10 tasks are `type="auto"` (4 of them also `tdd="true"`); zero `checkpoint:*` tasks (verified via grep) |
| 13 | Risks R1-R6 covered with mitigations | **PASS** | Risk register at L1062-1090 actually covers R1-R10 (exceeds user's stated R1-R6); all six user-named risks have explicit mitigation lines |
| 14 | Out-of-scope deferrals explicit | **PASS** | "Out-of-Scope Deferrals" section L1094-1110 lists all 5 user-named items (Groq aliases, i18n, retries, SDK regen, LitellmUpstreamError refactor) plus 3 more (transcribe, realtime parity, LOCKER flip ledger) |
| 15 | Atomic commit + dual tags (v1.0.13 + openwhispr-server-1.0.16); Chart 1.0.15→1.0.16; appVersion 1.0.12→1.0.13 | **PASS** | Task 8 PART 1 bumps Chart.yaml `version: 1.0.15→1.0.16` + `appVersion: "1.0.12"→"1.0.13"`; Task 8 PART 2 bumps values.yaml `tag: "1.0.12"→"1.0.13"`; Task 10 steps 3-4 tag the SAME SHA with both identifiers |

---

## Dimension verdict

| Dimension | Status |
|-----------|--------|
| D1 Requirement coverage | PASS — HIGH-agent-stream-empty-bubble has 6 truths + 10 tasks delivering them |
| D2 Task completeness | PASS — every `auto` task has files/action/verify/done |
| D3 Dependency correctness | PASS — single wave, `depends_on: []`, implicit linear order documented in "Implementation Order (TDD)" |
| D4 Key links planned | PASS — 4 key_links in frontmatter mapping route catches → helper, sse-parser → helper, helper → litellm-client; Task 5 actions explicitly wire each |
| D5 Scope sanity | **WARNING** — 10 tasks in a single plan exceeds the 2-3-tasks-per-plan target (5+ = "split recommended" per scope sanity rubric). However, this is `mode: quick-full` (single-plan-per-quick-task) and tasks are tightly sequenced with clear RED/GREEN/refactor boundaries; net additions ~+1100 LOC across 12 files. The scope is borderline but justifiable for `quick-full`. No split required; flag as warning. |
| D6 must_haves derivation | PASS — 7 truths are user-observable (NDJSON wire bytes, log lines, no-secret-leakage); 9 artifacts mapped to truths |
| D7 Context compliance | PASS — D1-D4 from CONTEXT.md all locked into tasks; Out-of-Scope deferrals respected |
| D7b Scope reduction | PASS — zero "v1/v2/static/simplified/future enhancement" weasel-language in tasks; the only "v1" usage refers to i18n English-only contract (legitimate deferral acknowledged in CONTEXT.md "Out of scope") |
| D7c Architectural tier | SKIPPED (no Architectural Responsibility Map in RESEARCH.md) |
| D8 Nyquist | PASS — every task has `<automated>` verify; no full-E2E suite latency penalty (uses targeted `pnpm test <pattern>` commands); Wave 0 not applicable |
| D9 Cross-plan data contracts | N/A — single plan |
| D10 CLAUDE.md compliance | **TWO BLOCKERS — see below** |
| D11 Research resolution | PASS — RESEARCH.md has Open Questions but they appear resolved inline (R11 wording resolved by D3 lock; verified by spot-check) |
| D12 Pattern compliance | SKIPPED (no PATTERNS.md) |

---

## Blockers

### BLOCKER-1 [D10 CLAUDE.md compliance] — E2E mandatory requirement not satisfied

**Rule (CLAUDE.md constitutional, NON-NEGOTIABLE):**
> **E2E mandatory** — every phase touching a user-visible route, wire surface, or operator-facing artifact ships at least one e2e test booting the real `docker compose` stack (or hermetic mock-LiteLLM); lives in `tests/e2e/`, gated by `E2E=1`, run via `make e2e-test`.

**Evidence of violation:**
- CONTEXT.md L99 line 7 already plans `tests/e2e/agent/stream-error-rendering.spec.ts` as a Playwright-through-docker-compose e2e per audit §7.5 with the explicit note "(DISCIPLINE rule: E2E mandatory)".
- PLAN.md frontmatter `files_modified` list (L15-25) omits the `tests/e2e/agent/stream-error-rendering.spec.ts` artifact entirely.
- No task in the 10-task list creates an `tests/e2e/` artifact.
- Task 6's `apps/api/tests/integration/agent-stream-error-contract.test.ts` is the integration tier (`tests/integration/`), not the e2e tier — buildApp + MockAgent + testcontainers is integration-tier per project convention; `tests/e2e/` is reserved for the real `docker compose` stack boot via `make e2e-test` (CLAUDE.md verbatim).
- This phase **touches a user-visible route** (`POST /api/agent/stream`) and a **wire surface** (NDJSON envelope), squarely inside the "E2E mandatory" trigger condition.

**Severity:** BLOCKER. The constitutional rule wording is "non-negotiable" and the phase scope explicitly matches the trigger.

**Fix:** Add Task 6.5 (or extend Task 6) creating `tests/e2e/agent/stream-error-rendering.spec.ts`:
- Playwright-driven e2e booting `docker compose up` (or the project's hermetic mock-LiteLLM compose profile per MEMORY note `feedback_smoke_before_full_e2e`).
- At minimum 2 cases: preflight failure (404 model_not_found → terminal `type:"error"` chunk renders error bubble in the web client surface) + happy-path regression (successful stream renders content + done chunks).
- Gated by `E2E=1`; runnable via `make e2e-test`.
- Adds the file to frontmatter `files_modified`.

### BLOCKER-2 [D10 CLAUDE.md compliance] — Web client surface E2E not asserted

**Rule (MEMORY note `feedback_web_e2e_required_alongside_desktop`, inherited from CLAUDE.md hard rule on bifurcated client surface):**
> features that bifurcate client surface (verify-email, OAuth, deep links) need BOTH web AND desktop e2e tests; F8 shipped to prod because only R21/R22 desktop bridge was covered

**Evidence of violation:**
- The wire contract serves both desktop (Electron) and web client surfaces.
- `<verification>` step 3 explicitly defers the renderer-side check: "Sanity check that an immutable desktop client (v1.7.8 or later) consuming this wire shape DOES render a user-facing error bubble for the curl response above. This is a one-time visual verification, not a CI gate."
- No web-client e2e or desktop-client e2e is committed to in the plan; only a curl-based manual reproducer.

**Severity:** BLOCKER per the MEMORY rule's wording (BOTH web AND desktop e2e); the plan's "renderer is contract source-of-truth, we don't change it" framing (CONTEXT.md Out of Scope item 2) is correct in principle BUT does NOT excuse the absence of a server-side wire contract e2e that proves the SHAPE the renderer expects is what we ACTUALLY emit on the wire under realistic transport conditions.

**Fix:** The Task 6.5 e2e above MUST drive the assertion through the same NDJSON consumption path the web/desktop client uses (either by reusing the client's parser as a library, or by replaying recorded client expectations). Document in PLAN.md `<verification>` that absence of renderer-coupling regression is asserted in CI, not by ad-hoc visual check.

### BLOCKER-3 [Interface drift CONTEXT.md ↔ PLAN.md] — Export names mismatch

**Evidence:**
- CONTEXT.md L93 (cross-cutting implications for planner): "Exports `classifyAgentUpstreamError`, `AgentUpstreamErrorCode`, `AgentUpstreamProvider` (narrowed to `"litellm" | "unknown"` per D2), `AgentUpstreamErrorEnvelope`."
- PLAN.md frontmatter L54 + Task 2 action L266 use different names: `classifyUpstreamError`, `AgentErrorCode`, `ClassifiedAgentError` (and explicitly DROPS `AgentUpstreamProvider` — provider is inline-encoded per D2).

**Severity:** BLOCKER. The naming drift is not silent — PLAN.md uses shorter names consistently — but CONTEXT.md was discussed/locked with the longer names, so this is a contract drift between two pinned artifacts in the same phase. The planner shortened them without recording the rename in PLAN.md prose or marking CONTEXT.md as superseded.

**Fix options:** EITHER (a) rename to match CONTEXT.md (`classifyAgentUpstreamError`, `AgentUpstreamErrorCode`, `AgentUpstreamErrorEnvelope`), OR (b) add a "Naming drift from CONTEXT.md" subsection to PLAN.md explicitly recording the rename + rationale (e.g., "shorter names for ergonomics; no semantic change"). Either is acceptable. Option (b) is lower friction and keeps the locked artifact intact while making the drift auditable.

---

## Warnings (non-blocking)

### WARNING-1 [D5 scope sanity] — 10 tasks in single plan

10 tasks exceeds the 2-3-tasks-per-plan target. Justification: this is `mode: quick-full` (single-plan-per-quick-task) and the 10 tasks form a tight TDD RED → GREEN → refactor → integration → docs → chart → verify → release sequence. Net additions ~+1100 LOC. Borderline-acceptable for `quick-full`; not a split-required scenario.

### WARNING-2 [Task 9 step 6 sequencing] — Evidence gate runs BEFORE commit

Task 9 step 6 runs `pnpm test:evidence:projects-self-test` BEFORE Task 10's commit. The user's check #5 asks for AFTER-commit run to bind evidence to the landed SHA. Practically equivalent (no push between Task 9 and Task 10), but ideally Task 10 should include a re-run of the evidence gate AFTER the commit lands to produce a SHA-bound evidence fragment. Recommended adjustment to Task 10: add step 4.5 `pnpm test:evidence:projects-self-test` immediately after `git tag`, BEFORE the orchestrator verification grep in step 6.

### WARNING-3 [Task 6 case-4 provider acceptance] — "Accept either" weakens the contract

Task 6 contract case 4 says "provider depends on whether undici surfaces the mid-stream close as a LitellmUpstreamError or as a plain Error — accept either as long as terminal frame is `type:"error"`". This is a contract gap: the wire contract should pin which case undici reaches the route as. If the executor cannot determine this in advance, the test is non-deterministic and the contract is fuzzy. Recommend tightening: either (a) pin to "unknown" (mid-stream socket close is NOT a LitellmUpstreamError per package surface) OR (b) document in operations.md that mid-stream socket close maps to provider:"unknown".

---

## Recommendation

**Verdict: YELLOW** — plan is fundamentally sound and delivers the 4 locked decisions (D1-D4) correctly; 3 BLOCKERS prevent execution as-is. Return to planner for revision (Iteration 2):

1. Add Task 6.5: `tests/e2e/agent/stream-error-rendering.spec.ts` per CLAUDE.md "E2E mandatory" constitutional rule + add to frontmatter `files_modified`.
2. Resolve naming drift between CONTEXT.md and PLAN.md export names (either rename or document).
3. (Optional) tighten Task 6 case-4 provider determination.

The 12 of 15 user check points that pass cleanly include all four locked decisions, the atomic-release shape, the LOCKER posture proofs, the test matrix, and the gitleaks allowlist discipline. The three blockers are scope/interface gaps, not design defects.

