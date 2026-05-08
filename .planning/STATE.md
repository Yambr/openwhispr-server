---
gsd_state_version: 1.0
milestone: v1.83.7
milestone_name: milestone
status: unknown
last_updated: "2026-05-08T19:39:30.865Z"
progress:
  total_phases: 11
  completed_phases: 0
  total_plans: 6
  completed_plans: 1
  percent: 17
---

# Project State: OpenWhispr Server

**Last updated:** 2026-05-08 (rebaseline after pivot)

## Project Reference

**Core value:** A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.

**Current focus:** Phase 0 — Repo Bootstrap & Constitutional CI (not yet started)

## Current Position

| Field | Value |
|-------|-------|
| Milestone | v1 |
| Phase | 0 — Repo Bootstrap & Constitutional CI |
| Plan | (none yet — pending `/gsd-plan-phase 0`) |
| Status | Roadmap complete, awaiting first phase plan |
| Phase progress | 0/11 phases complete |

```
[ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ]
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
/gsd-plan-phase 0
```

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
