---
gsd_state_version: 1.0
milestone: v1
milestone_name: OpenWhispr Server v1
status: Phase 8 plans 01–07 closed; 08.1/08.2/08.3 closed; Run 4 yielded a valid 3-of-4 baseline (transcribe / reason / agent-stream PASS, realtime-ws p95 still 0 — api-routing follow-on); Plan 08-08 unblocked for the 3 measurable endpoints
last_updated: "2026-05-13T00:25:00.000Z"
progress:
  total_phases: 35
  completed_phases: 12
  total_plans: 88
  completed_plans: 112
  percent: 34
---

# Project State: OpenWhispr Server

**Last updated:** 2026-05-13 (Phase 08.3 CLOSED: 3 atomic commits — mock-litellm `/v1/realtime` echo handler landed under strict TDD, full 30-min Run 4 plateau completed with 1000 VU sustained at 530 rps / 88 GB sent, 3/4 exit gates PASS (transcribe 2469 / reason 1177 / agent-stream TTFB 595 ms, error rate 0.10%), realtime_ws_roundtrip_ms p95 still 0 — different bug than Run 3, traced to a likely api-side routing issue (`/v1/realtime` reverse-proxy registration, dualAuth on WS upgrade, or @fastify/http-proxy frame forwarding); operator probe instructions recorded in RUN-LOG.md; Plan 08-08 unblocked for 3 measurable endpoints, realtime-ws baseline deferred). Phase 08.2 CLOSED: 3 atomic commits across 2 plans landed Option A — agent-stream now calls shared litellm-client's chatCompletionsStream via undici.request; live forensic-probe returns content-bearing NDJSON ending in finishReason:"stop"; new architectural finding documented re. undici 7.25 signal + custom-wrapped Agent)

## Project Reference

**Core value:** A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.

**Current focus:** Phase 08.2 (agent-stream undici dispatcher fix) CLOSED 2026-05-12. Three atomic commits across two plans landed Option A from 08.2-RESEARCH.md scorecard. Plan 08.2-01 (`feat(08.2-01): add chatCompletionsStream to @openwhispr/litellm-client`, commit `6040ed5`) extended the shared client with a streaming method returning Dispatcher.ResponseData (Node Readable body NOT pre-consumed on 2xx); 7 RED→GREEN tests against MockAgent + doRequest spy; coverage 100/98/100/100; T-08.2-01 mitigation verified (no per-call dispatcher option). Plan 08.2-02 (`fix(08.2-02): replace undici.fetch in agent/stream with shared litellm-client streaming method`, commit `741a009`; `fix(08.2-02): stop forwarding signal to litellm client in agent/stream (live-probe finding)`, commit `ae0dcc3`) refactored the route + delivered a deviation-after-live-probe: empirical evidence showed `undici 7.25` + `signal:AbortSignal` + the process-wide SSRF-wrapped Agent fails at connect/dispatch even on `undici.request`; removing the signal at the route call site restored content-bearing SSE. 17/17 unit tests GREEN; coverage 100/90.47/100/100 on stream.ts; SSRF dispatcher untouched, 54/54 SSRF tests GREEN. Live forensic-probe artifact at `.planning/phases/08.2-agent-stream-undici-dispatcher-fix/forensics/forensic-probe-output-post-fix.json` shows 12 text-delta chunks then a `{"type":"finish","finishReason":"stop"}` chunk — original upstream_error symptom eliminated. Plan 08-08 unblocked. Realistic profile remains DEFERRED per RESEARCH.md §Pitfall 2. Phases 0/1/2/3/4/5/6/7/07.1/08.1/08.2 closed; Phase 8 partially done (08-01..08-07 closed; 08-08 next).

## Current Position

| Field | Value |
|-------|-------|
| Milestone | v1 |
| Phase | 8 — Load Test, Tuning & SLO Publication (in progress); 08.1 — CLOSED 2026-05-12; 08.2 — CLOSED 2026-05-12 |
| Plan | Phase 8: 08-01..08-07 closed, 08-08 unblocked (awaiting operator 30-min plateau). Phase 08.1: 08.1-01 CLOSED. Phase 08.2: 08.2-01 + 08.2-02 CLOSED. |
| Status | 08.2 closed. 08-08 next, requires the operator to run the full 30-min `make load-test PROFILE=mock` plateau — the api-side agent-stream blocker is now resolved (live forensic-probe GREEN). |
| Phase progress | Phases 0/1/2/3/4/5/6/7/07.1/08.1/08.2 closed. Phase 8 partially done (08-01..08-07 closed; 08-08 unblocked, awaiting operator plateau). |
| Next action | Operator runs `make load-test PROFILE=mock` to produce SLO-grade summary; agent-stream is now content-bearing in the same stack. |

```
[X][X][X][X][X][X][X][X][X][~][X][X][X][ ][ ]
 0  1  2  3  4  5  6  7 7.1 8 8.1 8.2 8.3 9 10
```

## Performance Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Concurrent active users | 1000 | not measured |
| First-launch SLO (`git clone` -> first auth'd `/api/transcribe`) | < 5 min | not measured |
| Coverage (lines / branches) | >= 85% / >= 80% | not measured |
| NDJSON first-line latency | < 500ms | not measured |
| WSS realtime session ceiling | >= 1h | not measured |

(All targets are validated empirically only after Phase 8.)
| Phase 00 P01 | 12 | 2 tasks | 10 files |
| Phase 00 P03 | 30min | 2 tasks | 10 files |
| Phase 00 P02 | 7 | 2 tasks | 30 files |
| Phase 00 P04 | 30min | 2 tasks | 6 files |
| Phase 00 P05 | 189 | 2 tasks | 10 files |
| Phase 01 P01 | 298s | 2 tasks | 18 files |
| Phase 01 P02 | 25min | 2 tasks tasks | 9 files files |
| Phase 01 P03 | 30min | 2 tasks | 18 files |
| Phase 01 P04 | 30min | 2 tasks | 13 files |
| Phase 01 P05 | 10min | 3 tasks tasks | 8 files files |
| Phase 01 P06 | 30min | 2 tasks | 8 files |
| Phase 02.4 P02 | 2m | 1 tasks | 1 files |
| Phase 02.4 P04 | 4m 27s | 1 tasks | 1 files |
| Phase 02.4 P05 | 33s | 1 tasks | 1 files |
| Phase 02.4 P06 | 8m | 4 tasks | 10 files |
| Phase 02.5 P01 | 4m 15s | 3 tasks | 3 files |
| Phase 02.5 P03 | 3m | 1 tasks | 1 files |
| Phase 02.5 P02 | 6m | 2 tasks | 5 files |
| Phase 02.5 P04 | 6m | 2 tasks | 2 files |
| Phase 02.5 P05 | 12m | 3 tasks | 3 files |
| Phase 02.7 P01 | 5m | 2 tasks | 5 files |
| Phase 02.7 P02 | 18min | 3 tasks | 3 files |
| Phase 02.7 P03 | 5min | 3 tasks | 6 files |
| Phase 02.7 P05 | 22min | 3 tasks | 5 files |
| Phase 02.7 P06 | 3m | 2 tasks | 3 files |
| Phase 02.12 P01 | 21m 13s | 13 tasks | 17 files |
| Phase 02.15 Pinline | 12m | 1 tasks | 3 files |
| Phase 02.17 Pinline | 18m | 1 tasks | 4 files |
| Phase 02.18 Pinline | 15m | 1 tasks | 5 files |
| Phase 02.21 Pinline | 75m | 3 tasks | 9 files |
| Phase 06 P01 | 70m | 2 tasks | 27 files |
| Phase 06 P03 | 15m | 2 tasks | 6 files |
| Phase 06 P02 | 21m | 2 tasks | 18 files |
| Phase 06 P04 | 70min | 1 tasks | 11 files |
| Phase 06 P06 | 45m | 1 tasks | 12 files |
| Phase 06 P05 | 75 min | 2 tasks | 6 files |
| Phase 06 P07 | 35m | 2 tasks | 12 files |
| Phase 06 P11 | 25m | 2 tasks | 9 files |
| Phase 06 P10 | 7m | 1 tasks | 11 files |
| Phase 06 P09 | 35m | 2 tasks | 12 files |
| Phase 06 P08 | 70m | 2 tasks | 25 files |
| Phase 06 P12a | 75min | 2 tasks | 10 files |
| Phase 06 P12b | 65 | 3 tasks | 14 files |
| Phase 06 P12c | 180 | 3 tasks | 10 files |
| Phase 06 P12d | 75min | 2 tasks | 6 files |
| Phase 08 P01 | 6m | 2 tasks | 5 files |
| Phase 08 P03 | 11m | 3 tasks | 14 files |
| Phase 08 P04 | 23min | 2 tasks | 5 files |
| Phase 08 P05 | 10m | 3 tasks | 7 files |
| Phase 08 P06 | ~45 min | 5 tasks | 20 files |
| Phase 08 P07 | 32m03s wall clock | 4 tasks | 11 files |

## Accumulated Context

### Roadmap Evolution

- Phase 01.1 inserted after Phase 1: Phase 1 baseline image-pin audit and fix (URGENT) — discovered during Phase 02 contract-test auto-run that `minio/minio:RELEASE.2026-03-25T00-00-00Z` does not exist on Docker Hub (latest valid tag: `RELEASE.2025-09-07T16-13-09Z`); blocks `make contract-test` and any `docker compose up`. Audit + fix all baseline image pins.
- Phase 02.1 inserted after Phase 2: Fix `apps/api/Dockerfile` pnpm v10 `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE` (URGENT) — uncovered while running Phase 01.1 Plan 05 stack-up; was previously hidden behind the MinIO pull failure. Replace broken `pnpm --filter ... --prod deploy /out` with proper enterprise fix (`inject-workspace-packages: true` in pnpm-workspace.yaml OR multi-stage Dockerfile without `pnpm deploy`). Explicitly NOT `--legacy` escape hatch. Unblocks Phase 01.1 Plan 05.
- Phase 01.2 / 02.2 / 02.3 / 06.1 inserted during Yolo cascade resolution (see commits 451e9b3 / 7ccb8bb / 5f274e6 / 059b948) — each fixed a defect surfaced by the previous fix; all DONE.
- Phase 02.4 inserted after Phase 2 (URGENT, GAP-CLOSURE): Backfill TDD test coverage for the entire Phase 02.x Yolo cascade — 6 production fixes (commits 451e9b3, 26eaa69, 7ccb8bb, 059b948, 5f274e6) shipped without per-fix tests, violating the new constitutional rule (PROJECT.md TDD-01b: ≥90% coverage on every phase including decimals). Test-only phase, no production code changes. MUST land before Phase 02.5.
- Phase 02.5 inserted after Phase 2: Better Auth drizzle schema — drizzleAdapter call missing `schema` option AND `@openwhispr/data` lacks Better Auth required tables (`user`/`session`/`account`/`verification` — singular per Better Auth convention vs our pluralized tables). Add tables, pass schema to adapter, re-run migrations, `make contract-test` passes end-to-end → 02-HUMAN-UAT.md Item 1 finally flippable.
- **Constitutional update (2026-05-09):** PROJECT.md + CLAUDE.md amended with TDD-01b (≥90% per-phase coverage on touched files) and explicit "Yolo-mode does NOT exempt from TDD" clause. Triggered by Phase 02.x cascade shipping 5 commits without tests.
- Phase 02.5 Plans 01-04 landed (commits prior + `91784ab` + `eb92282` + this Plan 04 commit): RED tests → migration 0003 (tenant default binding) + auth.ts schema map → live `make contract-test` PARTIAL. Plans 02+03 verified live: migrate=ok, Better Auth resolves model `user`→`users` and dispatches into adapter `findOne`. Signup still 500s due to a SEPARATE wrapper-`db` defect in `apps/api/src/index.ts:229-233` (NOT the schema/tenant issue). 02-HUMAN-UAT.md Item 1 flippable: NO until Phase 02.6 fixes the one-line bootstrap destructure.
- **Phase 02.12 inserted (2026-05-10): Better-Auth-native plain `session.token` text storage.** Closes Phase 02.5-04 cascade tail #11 (`BetterAuthError: The field "token" does not exist in the schema for the model "session"`). Phase 02 Plan 01's bytea hash-only `tokenHash` design (AUTH-04 v1) is incompatible with BA v1.6.9, which has no native hashed-token support. Migration `0005_session_token_plain.sql` drops bytea columns + recreates SECURITY DEFINER lookup functions with `text` parameter; AUTH-04 5-minute overlap CONTRACT preserved via plain-text `previous_token`. Atomic commit `a7456d9`. Contract suite advances from 0 → 16/27 passing; remaining failures all classified as pre-existing Group B (OIDC 503) and Group C (rate-limit cascades).
- **AUTH-04 v2 hardening DEFERRED (Phase 02.12 / D-05):** Application-layer hash-only token storage was over-engineered for v1 (entire OSS auth ecosystem stores plain bearers). v2 hardening sweep will introduce either (a) column-level pgcrypto on `sessions.token` with Vault/KMS-rotated DEK, or (b) Postgres TDE / disk-level encryption documented in operator runbook. Phase 02 single-tenant dev posture acceptable until v2 multi-tenant sweep. Rationale + reverse-patch evidence in `02.12-SUMMARY.md`.
- **Phase 3 closed (2026-05-11): LiteLLM Integration + Bundled OSS Models.** All 10 plans landed; `passed_with_audit_trail` per gsd-verifier with 8/8 hard-pass + 6 user-ratified overrides. Live `make e2e-test` against real OpenRouter (chat) / Groq (Whisper-large-v3 STT) / OpenAI (Realtime WSS) / pyannote.ai (diarization sync-wrapper) — 25 passed | 1 conditional skip | 0 failed. Decisions of note: D-06 (Groq direct STT, not via LiteLLM) / D-07 REVISED (pyannote sync-wrapper in Fastify, not LiteLLM passthrough) / D-10 (OpenRouter chat completions) / D-11 (Groq STT explicit) / D-12 (OpenAI Realtime direct, not LiteLLM passthrough). Hermetic mock-LiteLLM profile (`make e2e-hermetic`) wired into CI on every PR.
- **Phase 02.22 inserted + closed (2026-05-11): TLS bootstrap two-tier CA chain.** Surfaced during Phase 3 live e2e validation: `tools/bootstrap.sh` emitted a self-signed end-entity cert with `basicConstraints = CA:FALSE`. Node 24 + OpenSSL 3 reject this as a trust anchor when supplied via `NODE_EXTRA_CA_CERTS`, so `contract-test-runner` could not probe `https://api.localhost/api/health` from inside `openwhispr_internal` (DEPTH_ZERO_SELF_SIGNED_CERT). 8 of 9 contract test files hit `describe.skipIf(!REACHABLE)` → 1 passed | 25 skipped baseline. Fix: rewrite bootstrap as root-CA (`CA:TRUE, keyCertSign`) signing leaf (`CA:FALSE, serverAuth`); compose `contract-test-runner` now mounts/trusts `root-ca.crt` instead of `local.crt`. Atomic commits 344f4dd / 546096c / 97da5c1. Result: 25 passed | 1 skipped | 0 failed.
- **Phase-2 coverage debt closed (2026-05-11):** 6 pre-existing Phase-2 files brought to ≥90/90/90/90: `error-handler.ts` (B 83→94), `lib/default-tenant.ts` (B 50/S 83 → 100/100), `routes/verification-status.ts` (B 75→100), `routes/delete-account.ts` (B 67→100), `auth.ts` (L 87 / F 38 / S 88 → 100/100/100, with one production refactor: `fallbackLog` extracted + 7 per-level no-op methods collapsed to shared `noop`), `plugins/rate-limit.ts` (50/67/75/50 → 100/90/100/100, real Valkey 8 testcontainer for ioredis construction tests). apps/api totals: L=98.92 / B=94.52 / F=100 / S=98.38. Atomic commits f02a183 / 2991f54 / f4927fc / 264064f / 7a8e0b1 / 1206a9e / e1372a9.
- **Lefthook prepare-hook fix (2026-05-11):** Root cause — `package.json` `prepare` script ran `lefthook install` directly, which refused to install when `core.hooksPath` was set locally. Every `pnpm install` failed → contributors fell back to `git commit --no-verify`. Fix: `tools/install-hooks.cjs` idempotent wrapper (exits silently when `.git/` absent, honors `SKIP_LEFTHOOK_INSTALL=1`, invokes `lefthook install --force`). Commits 382ebfc / f09ee84. `--no-verify` no longer required.
- **Test design fix (2026-05-11):** `delete-account.test.ts` previously used shared `fixture@conformance.test` and deleted it — broke on any repeated run against the same volume. Now signs up a transient unique user via Better Auth `/api/auth/sign-up/email` and deletes that. Idempotent across runs and shared volumes. Commit a73c70a.

### Key Decisions Logged

- Wire-compatible byte-for-byte with upstream `BACKEND_SPEC.md` / `OAUTH_SPEC.md` / `SELF_HOSTING.md` (1556 lines).
- v1 implements auth lifecycle + operational endpoints; defers Stripe / referrals / per-user quota enforcement to v2.
- Bundle LiteLLM >=1.83.7 with open-source models (faster-whisper, pyannote, Speaches-compatible image) in default compose; `LITELLM_BASE_URL` + `LITELLM_VIRTUAL_KEY` env-override path documented for corporate operators.
- Usage ledger is observability-only (no enforcement / `limitReached` always `false`) in v1.
- Single-LiteLLM-endpoint provider model — no parallel multi-LLM abstraction.
- UI-SPEC-only in v1 (no implementation).
- Stack: Node 24 LTS + Fastify 5 + Better Auth + Drizzle + Postgres 17 + PgBouncer + Valkey + BullMQ.
- Multi-tenancy retained, single "default" tenant in v1.
- Email+password is first-class; OIDC pluggable via Better Auth's OAuth-Provider plugin.
- Open IdP scope (no server-side allowlist).
- All source artifacts in English only — hard rule.
- Runtime i18n: en + ru minimum from day one.
- Strict TDD constitutional; GitHub Actions is the only sanctioned CI.
- Contract suite (CONTRACT-01) is the canonical conformance check, runs against any deployed instance.
- CodeQL v4 adopted from PR #1 (v3 deprecates Dec 2026).
- Third-party GHA actions SHA-pinned with version-tag comments (Trivy 2026-03-19 incident response).
- `lint-tdd` is advisory (`continue-on-error: true`) in v1; promoted to required in a later phase.
- drizzle-kit 0.31.10 does NOT emit ENABLE/FORCE RLS or CREATE POLICY natively (assumption A1 verified empirically) — first migration is hand-augmented after generation; pattern continues for future migrations with Plan 05 RLS lint catching drift.
- Migrations bookkeeping (`__drizzle_migrations`) lives in dedicated `_meta` schema, not `public` — keeps RLS lint scope clean and isolates from `openwhispr_app` role.
- Two-pool client factory: `makeOwnerDb` connects DIRECT to Postgres:5432 (BYPASSRLS, DDL only); `makeAppDb` via PgBouncer (RLS-subject); migrate runner refuses to start without `DATABASE_URL_OWNER` to prevent accidental DDL through PgBouncer.
- Backup encryption uses age (X25519 envelope) with `BACKUP_AGE_IDENTITY` separate from `MASTER_KEK` — different crypto primitives (X25519 vs AES-256), independent rotation cadences; conflating them couples unrelated rotation policies.
- `make-restore.sh` refuses on non-empty target (information_schema.tables count > 0) rather than CASCADE-dropping — accidental clobber prevention outweighs ergonomic cost; explicit DROP DATABASE override path documented in operations.md.
- MinIO single-bucket layout `openwhispr` with key prefix `tenants/<tenant-uuid>/<resource-type>/<resource-id>` (D-27/D-28); v1 relies on app-tier prefix discipline, MinIO IAM enforcement deferred to Phase 6+.

### Open Todos (Roadmap-level)

- **Push 320 commits to origin/main** (deferred per user direction 2026-05-11; live e2e green, ready when user signals).
- Author ADRs incrementally for every Key Decision (final consolidation in Phase 10).
- `packages/data/src/seed/conformance.ts` at 0/0/0/0 — decision pending (delete vs back-fill); flagged in 03-COVERAGE.md.
- 4 DATA-06 deny-list test failures still pre-existing (unrelated to debt back-fill scope) — separate ticket.
- Design tenant-scoped provider resolver shape revisited for Phase 4 (anticipate v1.5 multi-provider needs but do NOT build them in v1).
- **Phase 6.x cleanup: remove virtual-key-rotation dead code** (2026-05-12). Prod-flow uses single `LITELLM_MASTER_KEY` + `?user=<id>` query/header rewrite for identity propagation (see `apps/api/src/routes/realtime.ts:164`). Per-user virtual key minting/rotation never wired — `apps/worker/src/jobs/virtual-key-rotation.ts` is a sentinel-payload stub; scheduler entry, queue registration, and any plan-doc references around it are artifacts of original tech-stack research. Delete: worker job + test + scheduler entry + queues entry + index.ts importer. Keep PAK (`/api/v1/keys`) — that's separate, real, programmatic-access keys for our own API (Argon2id `pak_*`). Recovery point if multi-tenant SaaS ever lands: re-introduce per-tenant LiteLLM virtual keys with budget caps.

### Blockers

(— no current blockers; Phase 3 closed end-to-end; live e2e green against real providers; operational debt fully retired. Phase 4 ready to begin.)

- 06-12c LGTM-trio wall-time GREEN (3/3 tests, commit `6e19330`): reconciliation-drift 185s, log-scrub-sentinel 105s, otel-trace-propagation 117s. Round-2 fix landed five rule-1/rule-3 issues (testcontainers follow-mode hang, Ryuk image purge, api-Fastify-logger-disabled premise mismatch, traceparent rewrite, two-step Tempo verification).
- Plan 08-07 mock baseline FAILS error-rate gate (99.93%) and realtime-ws p95 tag bug; pgbouncer admin SCRAM hash missing — follow-on needed before operations.md SLO publication

### Risk Register (Top 3)

1. **Wire-contract drift** — every other category is recoverable; CONTRACT-01 is the regression net. Authored incrementally Phases 2-5.
2. **Multi-tenancy footguns** (RLS bypass under PgBouncer transaction-pool, missing RLS policies on new tables, cache-key collisions, tenant-context loss in workers). Addressed Phase 1 + Phase 6.
3. **LiteLLM/Speaches integration quirks** (pass-through unmetered, GPU cold-start, OpenAI Realtime spec compatibility delta). Addressed Phase 3 + Phase 4.

## Session Continuity

**Next session entry point:**

```
/gsd-verify-phase 07.1   # Verify Phase 07.1 (Web App Implementation) — 28/28 must-haves expected PASS
/gsd-plan-phase 8        # Phase 8: Load Test, Tuning & SLO Publication (k6 1000-concurrent nightly)
```

**Last session stopped at:** 2026-05-12 — Phase 07.1 (Web App Implementation) CLOSED. 27 atomic commits (554b54c → Plan 14). Full local sweep green: vitest 510/510 PASS in 36 files; coverage 98.53/92.99/97.79/97.62 (lines/branches/functions/statements) — all ≥90. Playwright 85/85 PASS (15 screens × 4 states + 15 axe-core + cross-screen smoke). size-limit ≤200 kB gz across 15 routes (max 168.84 kB on /sign-in /sign-up). 4-probe smoke against live compose stack verified: `/api/health` 200, `/` 307, `/admin/observability` 401 unauth + 200 with basic-auth. `.github/workflows/web.yml` YAML-valid; first remote run pending merge (recorded as Known follow-up). Negative-constraint audit clean: no emojis, no localStorage tokens, no next-i18next, no ESLint, no Recharts in src, no app-level admin role check. WEB-IMPL-01..04 flipped to Complete. Open follow-ups: DEF-07.1-NOTES-DELETE-ALL (apps/api pre-existing bug), Phase 7.x detail-endpoints backlog (transcriptions/notes/conversations single-resource GETs), Phase 10 Russian i18n, CSP nonce hardening.

**Earlier session stopped at:** 2026-05-12 — Phase 7 (Frontend UI-SPEC) CLOSED. 7 atomic commits. `tools/lint-ui-spec.ts` coverage 96.81/92.24/94.59/96.77.

**Earlier session stopped at:** 2026-05-11 — Phase 3 closed end-to-end. Operational debt closure trio (TLS bootstrap two-tier CA chain via Phase 02.22, Phase-2 coverage debt back-fill across 6 files, lefthook prepare-hook idempotent wrapper) all landed in parallel agents. Final live e2e validation: `make e2e-test` against real providers (OpenRouter / Groq Whisper-large-v3 / OpenAI Realtime / pyannote.ai) → 25 passed | 1 conditional skip | 0 failed. apps/api coverage on every touched file ≥90/90/90/90. 320 commits ahead of origin/main, push deferred per user direction. Phase 4 (Streaming + Realtime) unblocked.

**Files of record:**

- `.planning/PROJECT.md` — Core value, constraints, key decisions, evolution log
- `.planning/REQUIREMENTS.md` — 89 v1 requirements + v2 deferred + traceability
- `.planning/ROADMAP.md` — 11 phases, 100% requirement coverage, success criteria
- `.planning/STATE.md` — This file (project memory)
- `.planning/research/SUMMARY.md` + `STACK.md` + `ARCHITECTURE.md` + `PITFALLS.md` + `FEATURES.md`

**Recent transitions:**

- 2026-05-12: Phase 07.1 CLOSED — Web App Implementation. 27 atomic commits across 5 waves (Plan 01 scaffold 198e1fc, Plan 02 shadcn 132b084, Plan 03 compose+traefik c9a6a04 + DEF-07.1-01 lru-cache fix de3ada2, Plan 04 playwright+vitest 31a5e42, Plan 05 better-auth 8eae878+cfd40d9, Plan 06 providers 64125cf+8b2a618, Plan 07 U1/U2/U3 e9f170e+14d329d, Plan 08 U4/U5 7e82068, Plan 09 U6/U7 bad13b1+6c6040d Branch B, Plan 10 U8/U9/U10 c8a74ae+9fb6b6e, Plan 11 U11/U12/U13 9c6a5cd+947f546, Plan 12 A2/A3 4b5ca31+0606808, Plan 13 integration+CI+lefthook 2254fb2 + 3 fix commits 36c87f3/3d9ce2f/c12e6f9 → 85/85 e2e PASS, Plan 14 finalize). Final sweep: 510 unit + 85 e2e + 15 axe; coverage 98.53/92.99/97.79/97.62; bundle max 168.84 kB gz across 15 routes. Key learnings preserved as decisions: (a) env-switch pattern for prod-safe test-mode overrides (PLAYWRIGHT_DISABLE_SSR_PREFETCH / OPENWHISPR_DISABLE_EMAIL_ENUMERATION_PROTECTION / OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE — all default-OFF in prod); (b) worker-scoped Playwright fixtures (one provisioned user per worker, not per test) to avoid Better Auth rate-limit thrashing in full e2e suites; (c) Branch B list-then-filter access pattern documented when single-resource API endpoints absent; (d) apps/api preHandler for Better Auth route as config (not new endpoint, honors D-S1).
- 2026-05-12: Phase 7 CLOSED — Frontend UI-SPEC. 7 atomic commits across 3 waves: Plan 01 verify API + scaffold stubs (b72882f), Plan 02 RED linter tests + fixtures (0a240cd), Plan 03 GREEN linter implementation (ce72448), Plan 04 UI-SPEC-admin.md A2+A3 (70aed25), Plan 05 UI-SPEC-end-user.md U1–U13 (cd9bf30), Plan 06 shared appendix + GHA + lefthook + cross-file lint gate green (65824b7), Plan 07 finalize + SUMMARY + STATE/ROADMAP (this commit). Total ~4096 lines added. Coverage on `tools/lint-ui-spec.ts`: 96.81/92.24/94.59/96.77 — all ≥90. Notable refutations: A2/A3 collapsed U4 to KPI-only after `/api/usage` API verification proved dailySeries / providerBreakdown / activity feed absent (D-API6 design-gap); A4 moved admin role gate to deployment level (no per-user role column on Better Auth v1.6.9 schema). Three encoded design-gap markers queued for Claude Design re-engagement. `apps/web/` scaffold deferred to Phase 8.
- 2026-05-11: Phase 3 CLOSED end-to-end — 10 plans + parallel debt closure (Phase 02.22 TLS bootstrap, Phase-2 coverage back-fill across 6 files, lefthook prepare-hook fix, delete-account test design fix). Live `make e2e-test` against real OpenRouter / Groq / OpenAI / pyannote.ai → 25 passed | 1 conditional skip | 0 failed. apps/api coverage L=98.92 / B=94.52 / F=100 / S=98.38. 18 atomic commits across the closure (344f4dd / 546096c / 97da5c1 / 382ebfc / f09ee84 / f02a183 / 2991f54 / f4927fc / 264064f / 7a8e0b1 / 1206a9e / e1372a9 / a73c70a + Phase-3 verification commits). Phase 4 unblocked.
- 2026-05-10: Phase 02.7 CLOSED — 7 plans + cascade tail (Phases 02.8 → 02.21, 9 numbered decimal phases) collectively closed all original 13/26 contract failures + every additional defect surfaced by the D-03A loud-fail discipline (Better Auth uuid id-mode, fixture email RFC, signInFixture Origin/XFF, session.token plain, OIDC env+discovery, runner-in-network, traefik aliases+trustedIPs, mycorp scheme comma-list, unverified-fixture helper, Group C residuals — 404 envelope + cookie cascade + suite isolation). `make contract-test` 25 passed | 1 deliberate skipped (26). 02-HUMAN-UAT.md Item 1 flipped without qualifier. 30+ atomic commits across the cascade. Phase 03 unblocked.
- 2026-05-08: Rebaseline pivot — defer Stripe/referrals/quotas to v2; bundle LiteLLM with OSS models; UI-SPEC only in v1; English-only source / en+ru runtime; constitutional TDD/GHA. Roadmap rewritten from scratch.

---
*State initialized: 2026-05-08*

## Decisions

- [Phase 07.1]: Env-switch escape hatch pattern for test mode — `PLAYWRIGHT_DISABLE_SSR_PREFETCH`, `OPENWHISPR_DISABLE_EMAIL_ENUMERATION_PROTECTION`, `OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE` all default-OFF in prod; enable only in e2e to dodge non-deterministic flake without weakening production posture. Preferred over a mock layer.
- [Phase 07.1]: Worker-scoped Playwright fixtures — provision one Better Auth user per Playwright worker (not per test) to avoid per-IP rate-limit thrashing on full e2e runs. Pattern repeats: `auth.beforeAll(workerInfo => provisionTestUser(workerInfo.workerIndex))`.
- [Phase 07.1]: Branch B list-then-filter pattern for missing single-resource endpoints — when `GET /api/<resource>/:id` is absent, paginate `<resource>/list` with `limit=50` × `MAX_PAGES=5` (250-row cap) and render "not found" past cap. Use this until the api-side endpoint materializes; record backlog TODO.
- [Phase 07.1]: Admin gate at Traefik (basic-auth label middleware) NOT at app-level — Better Auth v1.6.9 has no `role` column; A4 refutation honored. Operator provisions `ADMIN_BASIC_AUTH_USERS` env. No `role === 'admin'` check anywhere in middleware.ts or `(admin)/` pages.
- [Phase 07.1]: CSP ships with `'unsafe-inline'` for Next.js RSC hydration in v1 — nonce-based hardening deferred to a future pass; recorded as Known follow-up.
- [Phase 07.1]: WEB-IMPL-01..04 → Complete; UI-SPEC-01..03 also flipped Complete (Phase 7 closed UI-SPEC artifacts; Phase 07.1 closed the implementation that consumed them).
- [Phase 07]: No new API endpoints introduced (D-S1) — every UI-SPEC endpoint resolves to live `apps/api/src/routes/` or `BETTER_AUTH_PATHS` allowlist, enforced by `tools/lint-ui-spec.ts` rule `endpoint-exists`.
- [Phase 07]: Admin role gate moved to deployment-level (Traefik / IdP claim filter), not per-user UI check (A4 refutation — Better Auth v1.6.9 has no `role` column on user/session schema).
- [Phase 07]: U4 Usage dashboard collapsed to KPI-only (A2/A3 refutation + D-API6) — `/api/usage` API verified to not expose dailySeries / providerBreakdown / activity feed; full grid rebalancing tracked as design-gap for Claude Design.
- [Phase 07]: Three design-gap markers encoded as HTML comments (`<!-- DESIGN-GAP ... -->`) — D-UX2 (forgot-password visual), D-API4 (A3 layout after Effective-env removal), A2/A3+D-API6 (U4 grid). These are queued for Claude Design re-engagement, not phase failures.
- [Phase 07]: `apps/web/` scaffold deferred to Phase 8 per RESEARCH § Open Q 1 — Phase 7 ships UI-SPEC artifacts + linter only, keeping verifier surface small.
- [Phase 06]: OTel SDK initialized as the literal first import of apps/api/src/index.ts so PinoInstrumentation patches pino at require time; tests assert load order by source-file inspection (Phase 6 D-T3).
- [Phase 06]: audit_log converted to pg_partman monthly RANGE partitions (Plan 06-02)
- [Phase 06]: SSRF dispatcher uses single-resolve-then-connect-by-IP via undici Agent connect.lookup; D-S3 13-entry CIDR block-list (8 IPv4 + 5 IPv6 incl. AWS IMDS v4+v6); default-deny allow-list with *.wildcard; enforce/warn modes; loopback opt-in dev/test only (Plan 06-06)
- [Phase 06]: 06-05 D-05-4 — Task 2 reduced from 15 wired emissions to 3 (account.delete, key.issued, key.revoked); 12 deferred because target routes (auth/admin/settings-mutation) don't exist yet.
- [Phase 06]: Plan 06-07: Worker tenant-context primitives shipped — withTenantContext (D-W1), withSystemContext (D-W2), typedQueue (D-W3), runtime app-pool guard + property test (D-W4 layers 2+3). Static lint (D-W4 layer 1) deferred to Plan 06-09 per CONTEXT.
- [Phase 06]: Plan 06-11: 4 Grafana dashboards + 2 unified-alerting reconciliation rules + postgres-readonly datasource shipped; grafana_reader role bootstrap deferred to operator (documented in postgres.yaml header)
- [Phase 06]: Plan 06-10: shared @openwhispr/observability package introduced — apps/api + apps/worker both import makePino + REDACT_PATHS; canonical sensitive-key list extends D-T4 with Phase 3/5 provider env keys; sentinel sweep integration test passes (12 tests).
- [Phase 06]: Plan 06-09 D-W4 layer 1 — TS-AST static lint chosen over GritQL (TypeScript Compiler API already devDep, mirrors lint-rls.ts; works on first try across every BullMQ handler shape)
- [Phase 06]: Plan 06-09 D-RL1 — single @fastify/rate-limit registration with hook:'preHandler' override; IP-tier ceiling implemented as separate onRequest hook with dedicated ioredis INCR+PEXPIRE counter (NOT a second plugin registration — fastify-plugin is idempotent). KeyGenerator reads req.user?.id (codebase shape) not req.session.userId (plan spec text).
- [Phase 06]: 06-08: New usage_rollup_daily migration (0015) added inline; runIngestOnce(since,until) refactor deferred — idempotency on request_id makes window-bounded SQL a nice-to-have, not a correctness requirement
- [Phase 06]: 12a — Reuse openwhispr compose project name (testcontainers.withProjectName) to dodge 10-15min cold-rebuild; drop withNoRecreate (v11 resets projectName)
- [Phase 06]: 12a — Audit e2e pivots from auth.signin to key.issued per 06-05-SUMMARY D-A1 deferral
- [Phase 06]: Plan 12b D-12b-1: Traefik file-provider preserved for scale test (test-only dynamic.yml enumerating both replicas), not switched to docker-provider.
- [Phase 06]: Plan 12b D-12b-3: SSRF audit emission via Fastify onError hook in buildApp (recordAudit needs req.tenant + db tx; dispatcher onBlock has neither).
- [Phase 06]: Plan 12d: Phase 6 close-out — CI wiring (PR-gate quick + nightly full) + Makefile global gate + per-file COVERAGE.md audit (28 green / 24 rationalised / 0 follow-up). Transcribe rate-limit Rule-2 wire-up fix landed inline. 5/8 e2e wall-time GREEN; 2 wire-up gaps documented as Phase 6.x follow-up (SSRF NODE_ENV propagation; verification-status auth-vs-rate-limit hook order).
- [Phase 06]: Plan 12e (post-12d follow-up): all 3 remaining e2e gaps CLOSED → `make e2e-test-phase6` reports 8/8 GREEN, 14 tests, 853s wall-time. Two REAL production-code SSRF defenses landed: (a) `makeSSRFConnectGuard` closes the IP-literal connect-bypass where Node's `net.connect` skips the dispatcher's `lookup` callback entirely for IP literals (rfc1918, link_local, ula, loopback, etc.); (b) `findSSRFBlockedError` walks `err.cause` chain to map Node 24's `TypeError('fetch failed', { cause })` wrapping back to the canonical 502 envelope. Plus 3 test-harness wiring fixes in `tests/e2e/helpers/phase6-compose.ts`: `compose run --no-deps` (avoid recreate-under-stale-config), `TESTCONTAINERS_RYUK_DISABLED=true` (avoid ryuk reaping locally-built images via `addComposeProject` label match), drop `compose --wait` for scaled path (grafana healthcheck false-negative blocks). Commits af6a3c8 + 949f1d7.
- [Phase 08]: OPENWHISPR_DISABLE_RATE_LIMIT switch wired into both Fastify @fastify/rate-limit AND Better Auth's built-in limiter via per-module process.env reads (matches existing OPENWHISPR_DISABLE_* convention); two WARN banners at boot for safety; .env.example documents the LOAD-TEST-ONLY use case
- [Phase 08]: Plan 08-04: ENTRYPOINT chain via existing entrypoint.sh ([fd-probe.sh, entrypoint.sh]) preserves the default-secrets gate; traefik probe duplicated (not symlinked) with diff -q drift detector — symlinks do not survive per-service Docker build contexts.
- [Phase 08]: Use overlay file docker-compose.load-test.yml (not single-file profiles) so default profile stays byte-identical; profile-additive merge brings api/traefik/postgres/mimir/valkey into load-test profiles
- [Phase 08]: Plan 06: agent-stream records TTFB and total Trends separately to keep per-axis SLO regressions visible
- [Phase 08]: Plan 06: Grafana dashboard 19665 rewritten with DS_PROMETHEUS->mimir + stable uid for provisioning
- [Phase 08]: Plan 07 live mock run: D-LOAD-EV env-gate for email verification; mock-litellm overrides base litellm under load-test; pgbouncer rename + 4-replica scale-out; realistic profile DEFERRED with Apple-Silicon CPU-saturation root cause
