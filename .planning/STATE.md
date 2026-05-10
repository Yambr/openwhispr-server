---
gsd_state_version: 1.0
milestone: v1.6.9
milestone_name: expects plain session.token text; advisor research recommends Option C
status: Ready to execute
last_updated: "2026-05-10T20:33:17.300Z"
progress:
  total_phases: 16
  completed_phases: 3
  total_plans: 20
  completed_plans: 32
  percent: 100
---

# Project State: OpenWhispr Server

**Last updated:** 2026-05-11 (Phase 3 closure + TLS/coverage/lefthook debt closure)

## Project Reference

**Core value:** A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.

**Current focus:** Phase 3 (LiteLLM Integration + Bundled OSS Models) DONE end-to-end. Live e2e suite 25 passed | 1 conditional skip | 0 failed against real OpenRouter / Groq / OpenAI / pyannote.ai. Operational debt (TLS bootstrap two-tier CA chain, lefthook prepare-hook, Phase-2 coverage debt across 6 files) fully closed. 320 commits ahead of origin/main, push deferred per user direction.

## Current Position

| Field | Value |
|-------|-------|
| Milestone | v1 |
| Phase | 3 — LiteLLM Integration + Bundled OSS Models (COMPLETE — passed_with_audit_trail + debt closed) |
| Plan | 03-01 → 03-10 complete; Phase-2 coverage debt back-fill complete; Phase 02.22 TLS bootstrap complete; lefthook prepare-hook fix complete |
| Status | DONE — `make e2e-test` against real providers: 25 passed | 1 conditional skip (missing-key-503, gated on separate make target) | 0 failed. apps/api coverage: L=98.92 / B=94.52 / F=100 / S=98.38. All four constitutional axes ≥90 on every touched file. |
| Phase progress | Phases 0/1/2/3 closed; 02.x cascade fully closed; 03.x debt back-fill complete; Phase 02.22 (TLS bootstrap two-tier CA chain) inserted and closed |
| Next action | Begin Phase 4 — `/gsd-plan-phase 4` (Streaming + Realtime: NDJSON line-flush + WSS realtime 3600s + 3 realtime token endpoints) |

```
[X][X][X][X][ ][ ][ ][ ][ ][ ][ ]
 0  1  2  3  4  5  6  7  8  9  10
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

### Blockers

(— no current blockers; Phase 3 closed end-to-end; live e2e green against real providers; operational debt fully retired. Phase 4 ready to begin.)

### Risk Register (Top 3)

1. **Wire-contract drift** — every other category is recoverable; CONTRACT-01 is the regression net. Authored incrementally Phases 2-5.
2. **Multi-tenancy footguns** (RLS bypass under PgBouncer transaction-pool, missing RLS policies on new tables, cache-key collisions, tenant-context loss in workers). Addressed Phase 1 + Phase 6.
3. **LiteLLM/Speaches integration quirks** (pass-through unmetered, GPU cold-start, OpenAI Realtime spec compatibility delta). Addressed Phase 3 + Phase 4.

## Session Continuity

**Next session entry point:**

```
/gsd-plan-phase 4     # Phase 4: Streaming + Realtime (NDJSON line-flush + WSS realtime 3600s + 3 realtime token endpoints)
```

**Last session stopped at:** 2026-05-11 — Phase 3 closed end-to-end. Operational debt closure trio (TLS bootstrap two-tier CA chain via Phase 02.22, Phase-2 coverage debt back-fill across 6 files, lefthook prepare-hook idempotent wrapper) all landed in parallel agents. Final live e2e validation: `make e2e-test` against real providers (OpenRouter / Groq Whisper-large-v3 / OpenAI Realtime / pyannote.ai) → 25 passed | 1 conditional skip | 0 failed. apps/api coverage on every touched file ≥90/90/90/90. 320 commits ahead of origin/main, push deferred per user direction. Phase 4 (Streaming + Realtime) unblocked.

**Files of record:**

- `.planning/PROJECT.md` — Core value, constraints, key decisions, evolution log
- `.planning/REQUIREMENTS.md` — 89 v1 requirements + v2 deferred + traceability
- `.planning/ROADMAP.md` — 11 phases, 100% requirement coverage, success criteria
- `.planning/STATE.md` — This file (project memory)
- `.planning/research/SUMMARY.md` + `STACK.md` + `ARCHITECTURE.md` + `PITFALLS.md` + `FEATURES.md`

**Recent transitions:**

- 2026-05-11: Phase 3 CLOSED end-to-end — 10 plans + parallel debt closure (Phase 02.22 TLS bootstrap, Phase-2 coverage back-fill across 6 files, lefthook prepare-hook fix, delete-account test design fix). Live `make e2e-test` against real OpenRouter / Groq / OpenAI / pyannote.ai → 25 passed | 1 conditional skip | 0 failed. apps/api coverage L=98.92 / B=94.52 / F=100 / S=98.38. 18 atomic commits across the closure (344f4dd / 546096c / 97da5c1 / 382ebfc / f09ee84 / f02a183 / 2991f54 / f4927fc / 264064f / 7a8e0b1 / 1206a9e / e1372a9 / a73c70a + Phase-3 verification commits). Phase 4 unblocked.
- 2026-05-10: Phase 02.7 CLOSED — 7 plans + cascade tail (Phases 02.8 → 02.21, 9 numbered decimal phases) collectively closed all original 13/26 contract failures + every additional defect surfaced by the D-03A loud-fail discipline (Better Auth uuid id-mode, fixture email RFC, signInFixture Origin/XFF, session.token plain, OIDC env+discovery, runner-in-network, traefik aliases+trustedIPs, mycorp scheme comma-list, unverified-fixture helper, Group C residuals — 404 envelope + cookie cascade + suite isolation). `make contract-test` 25 passed | 1 deliberate skipped (26). 02-HUMAN-UAT.md Item 1 flipped without qualifier. 30+ atomic commits across the cascade. Phase 03 unblocked.
- 2026-05-08: Rebaseline pivot — defer Stripe/referrals/quotas to v2; bundle LiteLLM with OSS models; UI-SPEC only in v1; English-only source / en+ru runtime; constitutional TDD/GHA. Roadmap rewritten from scratch.

---
*State initialized: 2026-05-08*
