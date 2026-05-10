# Phase 03 Plan Check Report — Iteration 2 (re-check after revision)

**Verdict:** PASS
**Date:** 2026-05-10
**Iteration:** 2 (re-check of revision 1 — `ad13625` / branch HEAD)
**Plans checked:** 10 (03-01..03-10) + VALIDATION.md
**Methodology:** goal-backward against locked decisions D-01..D-10 + REQUIREMENTS.md; targeted re-verification of CRIT-1 + HIGH-1..4 from iteration 1.

---

## Coverage Matrix — Locked Decisions

(Unchanged from iteration 1 — all D-01..D-10 still have implementing tasks AND tests.)

| Decision | Implementing Plan(s) / Task(s) | Test(s) | Status |
|----------|-------------------------------|---------|--------|
| D-01 OpenRouter+OpenAI Whisper+pyannote bundled | 03-01 T2 (litellm_config.yaml model_list); 03-04 sttProvider/sttModel | 03-01 verify (yaml parse ≥4 models); 03-04 contract test | COVERED |
| D-02 Postgres co-tenant spend ingest | 03-08 T2 (runIngestOnce) | 03-08 testcontainers integration | COVERED |
| D-03 user body param (no virtual keys) | 03-03 T1 (chatCompletions injects user); 03-04/05 routes; 03-07 ?user query | 03-03 unit (assert body.user); 03-05 unit; 03-08 spike | COVERED |
| D-04 Fastify wsUpstream | 03-07 T1 (@fastify/http-proxy) | 03-07 unit + handshake | COVERED |
| D-05 mock + e2e two-mode | 03-02 T1 (contract YAML); 03-09 T2 (e2e-test target) | 03-02 verify; 03-09 verify | COVERED |
| D-06 qwen3.5-plus default | 03-03 (defaultChatModel); 03-05 (default model) | 03-05 unit | COVERED |
| D-07 single-hop pyannote OR 503 fallback | 03-01 T2 step 3 — **MANDATORY spike** (Replicate → HF → other) before fallback | 03-01 verify; 03-06 unit | COVERED (HIGH-2 fixed) |
| D-08 request_id metadata spike | 03-02 T2 (live spike test) | 03-02 verify | COVERED |
| D-09 BACKEND_SPEC source-of-truth | 03-01 T1 (wire-contracts-phase-3.md) | 03-01 verify (4 H2 sections) | COVERED |
| D-10 3 OpenRouter models | 03-01 T2 step 3 (qwen + gemini + gpt-4o-mini) | 03-01 verify (≥4 models) | COVERED |

All requirements (WIRE-05/06, LITELLM-01..07, PROVIDER-01, DATA-03) still covered.

---

## Iteration-1 Findings — Re-Check

### CRITICAL-1 (Plan 10 GHA `secrets` in job-level `if:`) — RESOLVED ✅

Verified in `03-10-PLAN.md:202-251`:
- Job-level `if: ${{ secrets.* }}` removed.
- New `id: gate` step probes `OPENROUTER_KEY` env (sourced from `secrets.OPENROUTER_API_KEY`) and writes `have_keys=true|false` to `$GITHUB_OUTPUT`.
- All subsequent steps gated by `if: steps.gate.outputs.have_keys == 'true'`.
- `::notice::` annotation surfaces a clean GHA UI message when keys absent.
- Verify command extends to fail loud on regression: `! grep -E '^\s+if:\s+\$\{\{\s*secrets\.' .github/workflows/nightly.yml && grep -q 'steps.gate.outputs.have_keys' .github/workflows/nightly.yml`.
- Bonus: `printf` indirection via env vars (not direct `${{ secrets.* }}` expansion) prevents quoting/masking pitfalls when writing `.env.e2e`.

Pattern is correct per GHA documented restriction. Plan 09 `make e2e-test` belt-and-braces refusal-on-missing-`.env.e2e` provides defense-in-depth.

### HIGH-1 (existing-volume `litellm` DB auto-create) — RESOLVED ✅

Verified in `03-01-PLAN.md:144-229`:
- `ensureLitellmDatabase(adminUrl, owner)` added to `packages/data/src/migrate.ts` BEFORE `runDrizzleMigrations()`.
- Uses `POSTGRES_ADMIN_URL` direct admin pool (port 5432, NOT pgbouncer) per Pitfall #9.
- Idempotent: probes `pg_database` first; only `CREATE DATABASE` when missing; logs distinct messages for create vs skip.
- Owner identifier whitelisted via `pgIdent()` (no SQL injection — owner from bootstrap-controlled env).
- Single-statement `pg.query()` auto-commits → safe (`CREATE DATABASE` not in transaction).
- Fail-fast on missing `POSTGRES_ADMIN_URL` documented in HIGH-1 test 3.
- New testcontainer test `packages/data/src/__tests__/migrate-litellm-db.test.ts` covers: missing-DB → create; existing-DB → skip; missing-admin-URL → fail.
- `.env.example` adds `POSTGRES_ADMIN_URL=postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/postgres`.

Plan 09 (`03-09-PLAN.md:103`): `make clean-stack` retained as dev convenience but **explicitly NOT REQUIRED for upgrades and EXPLICITLY NOT RECOMMENDED for production operators**. Migration path documented as zero-action `git pull && docker compose up -d`. CLAUDE.md no-workaround rule honored.

### HIGH-2 (D-07 diarization spike mandatory before fallback) — RESOLVED ✅

Verified in `03-01-PLAN.md:240-289`:
- "MANDATORY spike investigation order" with three concrete probe commands (Replicate, HuggingFace Inference, other documented single-hop).
- Each spike includes a representative `curl` invocation.
- Order is locked: try (1) → (2) → (3); first that succeeds → bundled default.
- "Only if ALL three spike paths conclusively fail" branch documents the 503-only fallback AND requires "spike output as evidence" recorded in 03-01-SUMMARY.md.
- Negative-evidence requirement is explicit ("DO NOT default to 503-only without recording the spike output as evidence").
- Bundled-default Plan ownership of provider selection clarified vs. Plan 06 wiring.

### HIGH-3 (per-package vitest 90% threshold enforcement) — RESOLVED ✅

Verified in `03-02-PLAN.md:325-405` (new Task 4) + `03-VALIDATION.md:50` (03-02-T4):
- Per-package `vitest.config.ts` files for `apps/api`, `packages/litellm-client`, `apps/worker`, `packages/data`.
- **Thresholds nested correctly** under `coverage.thresholds.{lines,branches,functions,statements} = 90` — explicit Pitfall callout in test 3 ("`coverage.lines` FLAT is NOT set on any of the four configs (Vitest 4 silently ignores the flat shape)").
- Uses `mergeConfig(rootConfig, defineConfig({test: {coverage: {thresholds: ...}}}))` — clean override pattern.
- `coverage.include = ['src/**/*.ts']` per package narrows scope correctly.
- Root config left at 85/80/80/85 (project-wide floor unchanged).
- `apps/worker` carve-out documented: Plan 08 authors its own vitest.config.ts since the package is created in Wave 3.
- Plans 03-08 `<done>` blocks updated:
  - 03-03 line 295: "coverage ≥90% ENFORCED via `pnpm --filter @openwhispr/litellm-client test --coverage`"
  - 03-04 line 245: "coverage ≥90% ENFORCED via `pnpm --filter @openwhispr/api test --coverage`"
  - 03-05 line 191/239: same pattern
  - 03-06 line 213: same pattern
  - 03-07 line 172: same pattern
  - 03-08 line 357/436: same pattern, plus authoring its own config
- `03-PHASE-COVERAGE.md` documents the gate for `/gsd-verify-work` consumption.

### HIGH-4 (multipart wave-2 collision) — RESOLVED ✅

Verified in `03-03-PLAN.md:298-335` (new Task 2 added in Wave 1):
- `@fastify/multipart` registered ONCE at `apps/api/src/index.ts` `buildApp()` level by Plan 03 Task 2 (Wave 1, single sibling — no collision possible).
- Registration uses `attachFieldsToBody:false` + `limits.fileSize: 100*1024*1024` per Pitfall #5.
- Test `apps/api/src/__tests__/multipart-registered.test.ts` asserts: registered + correct limits + attachFieldsToBody:false + idempotent re-init.
- Plan 04 explicitly told NOT to re-register (line 231-240): "DO NOT register @fastify/multipart here. Per the revised Plan 03 Task 2, multipart is registered ONCE at buildApp level by Plan 03 (Wave 1, single sibling) to avoid a Wave-2 cross-plan edit collision with Plan 06 (diarization, also needs multipart). This task only ASSUMES the plugin is already registered."
- Plan 04 `files_modified` no longer touches `apps/api/src/index.ts`.
- Plan 06 only references multipart as a property of incoming requests (no plugin registration); spot-check confirmed no `@fastify/multipart` registration in 03-06-PLAN.md.
- Defensive smoke assertion in `transcribe.test.ts` setup confirms registration didn't regress.

---

## VALIDATION.md Re-Check

Updated correctly (`03-VALIDATION.md:43-65`):
- Task IDs added: 03-02-T4 (HIGH-3 coverage), 03-03-T2 (HIGH-4 multipart).
- 03-01-T2 expanded to reference HIGH-1 + HIGH-2 fixes with `migrate-litellm-db.test.ts`.
- 03-10-T2 verify command includes the `! grep -E '^\s+if:\s+\$\{\{\s*secrets\.'` regression guard for CRIT-1.
- Revision 1 changelog (lines 109-115) accurately summarizes all 5 fixes.
- `nyquist_compliant: true` retained; sampling continuity preserved.

---

## Regression / Side-Effect Check

- **Wave dependency graph still valid:** Wave 0 (01,02) → Wave 1 (03) → Wave 2 (04,05,06,07) → Wave 3 (08,09,10). Plan 03 promotion to "infrastructure-bearing" Wave 1 plan is correctly reflected in its dependents (04,05,06 all `depends_on: ["03-03"]` for litellm-client + multipart).
- **No new TDD violations:** all new tasks (02-T4, 03-T2) have `tdd="true"` + `<behavior>` precedes `<action>`.
- **No requirement coverage regression:** all WIRE-XX, LITELLM-XX, PROVIDER-01, DATA-03 still mapped.
- **No scope creep:** no new tasks attempt deferred work (NDJSON, web-search, audit log, virtual-key minting).
- **No CONTEXT.md contradictions:** all D-01..D-10 still honored; no Deferred Ideas resurrected.
- **CLAUDE.md compliance:** ≥90% coverage now ENFORCED (HIGH-3); no-workaround rule honored on upgrade path (HIGH-1); enterprise-grade diarization decision evidence-required (HIGH-2).
- **Cross-plan data contracts:** litellm-client baseUrl exposed + override semantics consistent across 03/04/05/06/07/10; metadata header shape validated by spike (Plan 02) before consumed by ingest worker (Plan 08).

---

## MEDIUM / LOW Findings — Status

The iteration-1 MEDIUM/LOW findings were non-blocking and the planner was free to defer them. Status:

- **MEDIUM-1** (Plan 08 over-broad depends_on) — STILL PRESENT, non-blocking. Optional optimization.
- **MEDIUM-2** (Plan 07 weak handshake assertion) — STILL PRESENT, non-blocking.
- **MEDIUM-3** (Plan 10 missing Makefile in files_modified) — RESOLVED ✅. Verified `03-10-PLAN.md:15` files_modified now lists `Makefile` and `.github/workflows/nightly.yml`.
- **MEDIUM-4** (Plan 06 mount-path coupling to Plan 01 docs) — STILL PRESENT, non-blocking. Plan 01 SUMMARY contract is acceptable.
- **LOW-1..4** — STILL PRESENT, non-blocking nits.

None of the remaining MEDIUM/LOW issues block execution.

---

## Recommendation

All 1 CRITICAL + 4 HIGH findings from iteration 1 are properly resolved with no regressions. Coverage matrix unchanged, dependency graph still valid, TDD discipline preserved, CONTEXT.md decisions still honored.

Proceed to execution: `/gsd-execute-phase 3` is unblocked.

## CHECK COMPLETE — VERDICT: PASS
