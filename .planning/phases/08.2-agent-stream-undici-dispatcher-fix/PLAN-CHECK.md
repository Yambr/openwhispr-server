# Phase 08.2 — Plan Check

**Verdict:** PASS
**Date:** 2026-05-12
**Plans verified:** 08.2-PLAN.md (umbrella), 08.2-01-PLAN.md, 08.2-02-PLAN.md
**Research:** 08.2-RESEARCH.md

## Per-SC Verdict

| SC | Statement | Verdict | Evidence |
|----|-----------|---------|----------|
| SC1 | Option A selected with documented analysis | PASS | Umbrella "Decision: Option A (locked by 08.2-RESEARCH.md)" section names the 6.5/8 vs 1.5/8 scorecard explicitly; RESEARCH §"Decision: Option A vs Option B" enumerates 8 criteria with rationale. |
| SC2 | No `upstream_error`; first SSE chunk arrives; stream terminates per spec | PASS | Plan 02 Task 1 Test 14+15 RED on upstream_error path; Task 2 GREEN restores content-bearing NDJSON. Plan 02 Task 3 (live operator probe) validates first chunk + final `{type:finish, finishReason:stop}` against running stack. |
| SC3 | SSRF gate preserved | PASS | Plan 01 Task 1 Test G asserts NO `dispatcher:` key passed; Plan 02 done-criteria explicitly: "SSRF unit tests untouched and GREEN". T-08.2-01 in umbrella threat register encodes this. |
| SC4 | RED-then-GREEN per plan | PASS | Plan 01 Task 1 = 7 RED tests; Task 2 = GREEN. Plan 02 Task 1 = 3 new RED tests (13/14/15) + adapted 12; Task 2 = GREEN. TDD ordering explicit in both. |
| SC5 | forensic-probe.ts re-run returns 200 + SSE | PASS | Plan 02 Task 3 is a checkpoint:human-verify gate=blocking; operator runs `pnpm --filter @openwhispr/load-test exec tsx scripts/forensic-probe.ts` and inspects `runs/<latest>/diagnostics/forensic-probe-output.json` with explicit pass criteria. |
| SC6 | Coverage ≥ 90/90/90/90 on diff | PASS | Both plans carry an explicit per-plan coverage gate with vitest --coverage commands and ≥90/90/90/90 in success_criteria. |
| SC7 | TDD first; CI green; 08-08 unblocked | PASS | Wave 0 (Plan 01) creates new contract first; Wave 1 (Plan 02) consumes it. Each plan ends with full-suite test invocation. Umbrella explicitly states 08-08 unblocked. |

## Research-Mandated Pitfalls

| Pitfall | Encoding | Verdict |
|---------|----------|---------|
| `bodyTimeout: 0` (Pitfall 1) | Plan 01 Task 1 Test C asserts second arg has `bodyTimeout: 0`; Plan 01 truth #2 + key_link regex `bodyTimeout:\s*0` | PASS |
| Reply.hijack BEFORE upstream await (Pitfall 3) | Plan 02 Task 2 behavior: "Preserve the surrounding hijack-before-await ordering"; truth #4 "preserving the hijack-before-await contract" | PASS |
| `_call-provider.ts:44-55` SSRF stomp deferred (Pitfall 4 / Open Q2) | Umbrella "Deferred Items" #1 with explicit follow-up phase recommendation | PASS |
| Pitfall 2 (`headersTimeout`) | Mentioned in research; not encoded as test — flagged minor warning below | minor |
| Pitfall 5 (undici 8.x drift) | Umbrella Deferred Items #2 (CI gate filed for future) | PASS |
| Pitfall 6 (`x-litellm-end-user-id` extra header) | Plan 01 Test B asserts canonical authHeaders; route inherits via client swap | PASS |
| Spend-logs metadata canonical shape (Pitfall 5/Open Q1) | Umbrella T-08.2-05 explicit decision: client's `{openwhispr_request_id}` shape; tests assert "no extra keys" | PASS |

## Additional Checks

- **DAG cleanliness:** 08.2-01 wave 0, depends_on []; 08.2-02 wave 1, depends_on [08.2-01]. Linear DAG, no cycles, no forward refs. (Note: SDK `phase-plan-index` not exposed in current toolchain; manual trace clean.)
- **Atomic commit subjects:** Plan 01 `feat(08.2-01): add chatCompletionsStream to @openwhispr/litellm-client`; Plan 02 `fix(08.2-02): replace undici.fetch in agent/stream with shared litellm-client streaming method`. Conventional commits, scoped, one per fix. PASS.
- **No mocks of internal logic:** All test seams mock MockAgent at the dispatcher boundary (network) or stub `chatCompletionsStream` at the network-boundary client interface. SSRF gate itself never mocked. PASS — within CLAUDE.md's "process/network boundary" carve-out.
- **Plan-size sensibility:** 2 plans appropriate. Plan 01 = new package surface + 7 unit tests; Plan 02 = route refactor + 15 tests + operator gate. Splitting along the package boundary enables independent atomic commits with coverage gates per CLAUDE.md TDD-01b. PASS.
- **Architectural tier compliance:** RESEARCH "Architectural Responsibility Map" assigns all tasks to API/Backend tier and shared client package. Plans honor it exactly. PASS.

## Findings

### Blockers
None.

### Warnings (recommended, non-blocking)

1. **[task_completeness / research_resolution] Pitfall 2 (`headersTimeout` for slow cold-start) is not encoded as a test or env-override task.** Research recommends `LITELLM_HEADERS_TIMEOUT_MS` default 30000. Plan 01 inherits undici defaults silently. WARNING — does not block SC1–SC7 but a slow cold-model first-token could re-introduce a different `upstream_error` failure mode under high latency. Suggest: add Pitfall 2 to Deferred Items in umbrella OR a single Plan 01 test asserting the default is passed through (no behaviour change).

2. **[verification_derivation] Open Question 1 (spend-logs `openwhispr_user_id` shape) is resolved in T-08.2-05 with "accept" disposition.** This is reasonable per the canonical-decision logic, but the resolution lives only in the threat register, not in Open Questions section of RESEARCH.md. WARNING — for Dimension 11 strictness, mark `## Open Questions (RESOLVED)` in RESEARCH.md with inline resolutions, or note in umbrella that Q1=adopt-client-shape, Q2=defer, Q3=in-client, Q4=defer.

3. **[task_completeness] Plan 02 Task 2 verify command uses `grep -c ... | grep -q "^0$"`** — this pipeline is correct but slightly brittle (the second grep silently exits 1 if the count is not zero, failing the conjunction). Functional but suggest replacing with `! grep -q "undiciFetch" stream.ts` for clearer signal.

## Must-Fix List

None. All 7 SCs covered; all 3 research-mandated pitfalls (the load-bearing ones — bodyTimeout, hijack ordering, deferred SSRF stomp) traceable to tasks/deferred items.

## Recommendation

**PASS.** Execute Plans 08.2-01 → 08.2-02 in order. Address the three warnings if revising opportunistically; otherwise proceed to `/gsd-execute-phase 08.2`.
