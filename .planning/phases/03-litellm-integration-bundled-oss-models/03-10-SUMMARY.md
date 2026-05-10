---
phase: 03
plan: 10
slug: contract-suite-extension-and-data-03-idempotency
subsystem: contract-tests, ci
tags: [contract-tests, ci, idempotency, provider-abstraction, pitfall-8]
requires:
  - 03-04: WIRE-05 transcribe contract test (sibling, exists)
  - 03-05: WIRE-06 reason contract test (sibling, exists)
  - 03-06: LITELLM-03 diarization contract test + 503 path
  - 03-07: LITELLM-03 realtime handshake test
  - 03-08: DATA-03 ledger schema (request_id uniqueIndex)
  - 03-09: make e2e-test target + .env.e2e.example
provides:
  - PROVIDER-01: env-override single-source-of-truth verification (introspection seam)
  - DATA-03: ON CONFLICT DO NOTHING property test + cross-kind idempotency
  - Pitfall-8: 503-not-401 contract assertion (transcribe / reason / diarization)
  - CONTRACT-01: Phase 3 contract suite extended with cross-cutting tests
  - CI: nightly e2e-test job (real provider APIs, secret-gated)
affects:
  - apps/api/src/routes/test-only.ts (add /api/_test/litellm-baseurl seam)
  - apps/api/src/routes/index.ts (thread litellm into test-only deps)
  - docker-compose.yml (LITELLM_BASE_URL_PROBE env passthrough to runner)
  - Makefile (new contract-test-missing-keys target)
  - .github/workflows/nightly.yml (e2e-test job)
tech-stack:
  added: []
  patterns:
    - "Test-only introspection seam — gated by OPENWHISPR_TEST_ROUTES, registered only when LiteLLM client is wired (404 otherwise)"
    - "GHA secret-gating via step-output (CRIT-1 — secrets context unavailable at job-level if:)"
    - "Property-test pattern: insert N random rows + replay → distinct count stable"
key-files:
  created:
    - packages/contract-tests/src/litellm-base-url-override.test.ts
    - packages/contract-tests/src/missing-key-503.test.ts
    - packages/data/src/__tests__/usage-ledger-idempotency.test.ts
  modified:
    - apps/api/src/routes/test-only.ts
    - apps/api/src/routes/test-only.test.ts
    - apps/api/src/routes/index.ts
    - docker-compose.yml
    - Makefile
    - .github/workflows/nightly.yml
decisions:
  - "PROVIDER-01 verification via introspection seam (Option B) instead of dual-LiteLLM container (Option A). Rationale: same assertion target — proves all routes derive from `client.baseUrl` — without doubling compose footprint or per-CI-run cost. The api constructs ONE LitellmClient at boot via loadLitellmConfigFromEnv() and threads it into all four LiteLLM-backed route factories; if the seam returns the override value, every route emits to the override target by construction."
  - "Missing-key suite gated by MISSING_KEY_TEST_MODE=1 + dedicated `make contract-test-missing-keys` target. Default `make contract-test` boots with fake-but-present keys (litellm_config.contract.yaml mock_response paths) so Pitfall #8 path was unreachable from the main suite. Two targets keep assertion targets focused (happy-path vs misconfigured-operator)."
  - "DATA-03 idempotency split across two files: usage-ledger.test.ts (existing) covers naked unique-violation 23505; usage-ledger-idempotency.test.ts (new) covers ON CONFLICT DO NOTHING no-op + cross-kind first-writer-wins + 50-row replay property. Both are required — Plans 04/05 use the ON CONFLICT shape; the 23505 path covers DDL contract."
  - "Nightly e2e gate via step-output, NOT job-level if-secrets (CRIT-1). The `gate` step reads OPENROUTER_API_KEY through an env var and writes `have_keys` to GITHUB_OUTPUT; subsequent steps condition on `steps.gate.outputs.have_keys == 'true'`. Forks/fresh repos see a `::notice::` annotation rather than a silent skip."
metrics:
  duration: ~30 minutes
  completed-on: 2026-05-10
  files-created: 3
  files-modified: 6
  tasks-completed: 2
---

# Phase 3 Plan 10: Cross-Cutting Contract Tests + DATA-03 Idempotency Summary

Hardened the Phase 3 contract suite with regression nets for the three
cross-cutting invariants that Plans 04–07 each touch but none individually
own: PROVIDER-01 (env-override single source of truth), Pitfall #8
(missing-provider-key surfaces as 503 NOT 401), and DATA-03 first-writer-wins
idempotency on `usage_ledger.request_id`. Wired the Plan 09 `make e2e-test`
target into the nightly GHA workflow with a step-output gate so the job
runs only when operator-supplied repo secrets are present (CRIT-1 fix —
GHA's `secrets` context is NOT available in job-level `if:` conditions).

## Phase 3 Contract Test Inventory (post-Plan-10)

| Test                                  | Source plan | Asserts                                                |
| ------------------------------------- | ----------- | ------------------------------------------------------ |
| `transcribe.test.ts`                  | 03-04       | WIRE-05 — TranscribeResponse shape, 401, 400           |
| `reason.test.ts`                      | 03-05       | WIRE-06 — ReasonResponse shape, 401, 400               |
| `diarization.test.ts`                 | 03-06       | LITELLM-03 — DiarizationResponse shape, mock + e2e     |
| `realtime.test.ts`                    | 03-07       | LITELLM-03 — WSS upgrade handshake                     |
| `litellm-base-url-override.test.ts`   | **03-10**   | PROVIDER-01 — client.baseUrl == LITELLM_BASE_URL_PROBE |
| `missing-key-503.test.ts`             | **03-10**   | Pitfall #8 — 503 (NOT 401) on empty provider keys      |
| `usage-ledger-idempotency.test.ts`    | **03-10**   | DATA-03 — ON CONFLICT DO NOTHING + 50-row property     |

`vitest run` discovers all `packages/contract-tests/src/**/*.test.ts`
automatically — no CI workflow change needed for the new files. Only the
missing-key suite is gated (MISSING_KEY_TEST_MODE=1) so it skips under
the standard `make contract-test` profile.

## DATA-03 Reverse-Patch Evidence

The `usage_ledger.request_id` UNIQUE INDEX is declared in
`packages/data/src/schema/usage_ledger.ts:26`:

```ts
requestIdUnique: uniqueIndex("usage_ledger_request_id_unique").on(t.requestId),
```

Reverse-patch test: comment out the line above, regenerate migrations,
re-run `vitest run packages/data/src/__tests__/usage-ledger-idempotency.test.ts`.
The "ON CONFLICT DO NOTHING is a no-op" test fails immediately because
without the unique constraint there is no conflict to suppress — both
inserts land. Restoring the line returns the suite to green. (Performed
locally on a scratch branch; reverse-patch lives in the test author's
verification log, NOT in the committed codebase. Operators wishing to
reproduce: `git stash && sed -i '' '/requestIdUnique/d' packages/data/src/schema/usage_ledger.ts && pnpm --filter @openwhispr/data drizzle:generate && pnpm --filter @openwhispr/data test usage-ledger-idempotency`.)

## PROVIDER-01 Introspection Seam

`apps/api/src/routes/test-only.ts` registers
`GET /api/_test/litellm-baseurl` when:

1. `OPENWHISPR_TEST_ROUTES=true` (compose contract-test profile sets this).
2. The LiteLLM client was constructible at boot (`LITELLM_MASTER_KEY` present).

The handler returns `{ baseUrl: client.baseUrl }`. The contract test
asserts:

- 200 response → seam is wired (no "OPENWHISPR_TEST_ROUTES forgotten" bug).
- `baseUrl` is non-empty `https?://...` URL (smoke).
- When `LITELLM_BASE_URL_PROBE` is set in the runner env, exact equality
  with the api-resolved value (strict mode — runs in CI via
  docker-compose.yml passthrough).

Production safety: the route is unregistered when `OPENWHISPR_TEST_ROUTES`
is unset (production posture); attempting to GET it returns the
canonical 404 envelope.

## Pitfall #8 (Missing Key → 503) Coverage

| Route                       | Required env       | Provider              |
| --------------------------- | ------------------ | --------------------- |
| POST /api/transcribe        | GROQ_API_KEY       | Groq Whisper-large-v3 |
| POST /api/reason            | OPENROUTER_API_KEY | OpenRouter            |
| POST /v1/audio/diarization  | PYANNOTE_API_KEY   | pyannote.ai           |

Each test:

1. Asserts `res.status === 503`.
2. Asserts `res.status !== 401` (the bug being guarded against).
3. Validates the body against `ErrorEnvelope.parse()` (no leak surface).
4. Asserts the error string mentions the env var name OR a canonical hint
   (e.g. "STT", "reason", "diarization", "provider") — actionable for
   operators.

Run via `make contract-test-missing-keys` (boots stack with empty keys
via a transient `.env.missing-keys` overlay; `MISSING_KEY_TEST_MODE=1`
flag flips the `it.skipIf` gate from skip to run).

## CI Wiring (Nightly e2e-test Job)

`.github/workflows/nightly.yml`:

```yaml
e2e-test:
  steps:
    - name: Check provider-key secret presence
      id: gate
      env:
        OPENROUTER_KEY: ${{ secrets.OPENROUTER_API_KEY }}
      run: |
        if [ -n "$OPENROUTER_KEY" ]; then
          echo "have_keys=true" >> "$GITHUB_OUTPUT"
        else
          echo "have_keys=false" >> "$GITHUB_OUTPUT"
          echo "::notice::OPENROUTER_API_KEY not configured — skipping E2E."
        fi
    - if: steps.gate.outputs.have_keys == 'true'
      ...
```

Why step-output and not `if: ${{ secrets.X != '' }}` at job level: GHA
silently treats missing-secret comparisons at the job level as falsy and
the job NEVER runs even when the secret IS configured. The step-output
pattern is the documented workaround.

The job:

- Triggers on `cron: '0 3 * * *'` (03:00 UTC daily) and `workflow_dispatch`.
- Skips cleanly on forks / fresh repos with a `::notice::` annotation.
- Runs `make e2e-test` (Plan 09) which boots production litellm_config.yaml
  + real keys + RUN_E2E=true and exercises the full Phase 3 surface.
- Captures compose logs on failure and uploads as artifact.
- NOT in branch-protection required checks (real-API tests can flake).

## Phase 3 Close-Out Checklist (for /gsd-verify-work handoff)

- [x] PROVIDER-01 verified via introspection seam (Plan 10).
- [x] Pitfall #8 (503-not-401) verified for transcribe + reason + diarization (Plan 10).
- [x] DATA-03 idempotency verified at schema layer with property test (Plan 10).
- [x] Nightly e2e-test job gated on secret presence (Plan 10).
- [x] Standard `make contract-test` includes all new Phase 3 tests automatically (vitest auto-discovery).
- [x] All CRIT-1 GHA secret-gating shapes use step-output (no job-level `if: ${{ secrets... }}`).
- [x] All third-party action references SHA-pinned (existing project convention).
- [x] CLAUDE.md hard rules honored: no mocks, real Postgres testcontainer, English-only artifacts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Worktree base reset**
- **Found during:** initial worktree-base verification step.
- **Issue:** Worktree HEAD was at `9f2de60` (one commit beyond expected base `ba1ae27`); the soft reset emptied the index but the working tree was already empty for unrelated reasons.
- **Fix:** Ran `git checkout HEAD -- .` after the soft reset to restore the working tree from the now-correct HEAD. No content changes — pure worktree-state correction.
- **Files modified:** none (transient state).

**2. [Rule 2 - Critical functionality] LITELLM_BASE_URL_PROBE passthrough**
- **Found during:** Task 1 PROVIDER-01 test design.
- **Issue:** Plan specified the introspection seam but did not specify how the contract-test runner receives the expected baseUrl for the strict-equal assert. Without it, the test could only smoke-assert `^https?://`.
- **Fix:** Added `LITELLM_BASE_URL_PROBE: ${LITELLM_BASE_URL:-http://litellm:4000}` to docker-compose.yml's contract-test-runner environment block. Operators overriding LITELLM_BASE_URL in their .env automatically get the strict comparison.
- **Files modified:** `docker-compose.yml`.

**3. [Rule 2 - Critical functionality] Test-only.test.ts coverage of new seam**
- **Found during:** Task 1 final verification.
- **Issue:** Plan did not call out adding unit-test coverage for the new `/api/_test/litellm-baseurl` handler. CLAUDE.md "Per-phase coverage floor ≥ 90%" is a hard rule; uncovered new code violates it.
- **Fix:** Added two cases (`Test 5`, `Test 5b`) to `apps/api/src/routes/test-only.test.ts` — 200 when litellm dep is wired, 404 when omitted.
- **Files modified:** `apps/api/src/routes/test-only.test.ts`.

### Authentication Gates

None. No external auth required for any task in this plan.

## Self-Check: PASSED

- FOUND: `packages/contract-tests/src/litellm-base-url-override.test.ts`
- FOUND: `packages/contract-tests/src/missing-key-503.test.ts`
- FOUND: `packages/data/src/__tests__/usage-ledger-idempotency.test.ts`
- FOUND: commit `dc9e486` (test(03-10): add cross-cutting tests + PROVIDER-01 introspection seam)
- FOUND: commit `67b0cb0` (ci(03-10): add nightly e2e-test job gated on secret presence)

All artifacts and commits verified present.
