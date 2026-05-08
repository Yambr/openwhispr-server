---
gsd_state_version: 1.0
milestone: v1.83.7
milestone_name: milestone
status: unknown
last_updated: "2026-05-08T23:45:42.413Z"
progress:
  total_phases: 11
  completed_phases: 2
  total_plans: 12
  completed_plans: 12
  percent: 100
---

# Project State: OpenWhispr Server

**Last updated:** 2026-05-08 (rebaseline after pivot)

## Project Reference

**Core value:** A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.

**Current focus:** Phase 1 complete; ready for Phase 2 (auth + wire-shape).

## Current Position

| Field | Value |
|-------|-------|
| Milestone | v1 |
| Phase | 1 — Core Infra & Multi-Tenant Data (COMPLETE) |
| Plan | 06 complete (Phase 1 capstone — backup/restore + ops docs) |
| Status | Phase 1 closed; ready to begin Phase 2 |
| Phase progress | 2/11 phases complete; 12/12 plans complete (100%) |

```
[X][X][ ][ ][ ][ ][ ][ ][ ][ ][ ]
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

## Accumulated Context

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

- Begin Phase 0 (`/gsd-plan-phase 0`) once roadmap is approved.
- Author ADRs incrementally for every Key Decision (final consolidation in Phase 10).
- Decide token TTL + rotation overlap policy in Phase 2 (recommended: >=30d TTL, >=5min overlap, no scheduled batch rotation).
- Design tenant-scoped provider resolver shape in Phase 3 LiteLLM integration (anticipate v1.5 multi-provider needs but do NOT build them in v1).

### Blockers

(None — ready to begin Phase 0.)

### Risk Register (Top 3)

1. **Wire-contract drift** — every other category is recoverable; CONTRACT-01 is the regression net. Authored incrementally Phases 2-5.
2. **Multi-tenancy footguns** (RLS bypass under PgBouncer transaction-pool, missing RLS policies on new tables, cache-key collisions, tenant-context loss in workers). Addressed Phase 1 + Phase 6.
3. **LiteLLM/Speaches integration quirks** (pass-through unmetered, GPU cold-start, OpenAI Realtime spec compatibility delta). Addressed Phase 3 + Phase 4.

## Session Continuity

**Next session entry point:**

```
/gsd-plan-phase 2     # Phase 2: auth lifecycle + wire-shape (Better Auth)
```

**Last session stopped at:** Completed 01-06-PLAN.md (backup/restore via age envelope encryption; nightly round-trip CI; ops + storage docs). Phase 1 closed — all 6 plans landed, all Phase-1 requirements (DATA-01..02, DATA-05..07, PROVIDER-02, TEST-MIGRATION-01, TEST-RLS-01) complete.

**Files of record:**

- `.planning/PROJECT.md` — Core value, constraints, key decisions, evolution log
- `.planning/REQUIREMENTS.md` — 89 v1 requirements + v2 deferred + traceability
- `.planning/ROADMAP.md` — 11 phases, 100% requirement coverage, success criteria
- `.planning/STATE.md` — This file (project memory)
- `.planning/research/SUMMARY.md` + `STACK.md` + `ARCHITECTURE.md` + `PITFALLS.md` + `FEATURES.md`

**Recent transitions:**

- 2026-05-08: Rebaseline pivot — defer Stripe/referrals/quotas to v2; bundle LiteLLM with OSS models; UI-SPEC only in v1; English-only source / en+ru runtime; constitutional TDD/GHA. Roadmap rewritten from scratch.

---
*State initialized: 2026-05-08*
