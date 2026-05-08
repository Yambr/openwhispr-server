# Project State: OpenWhispr Server

## Project Reference

**Core Value:** A drop-in OpenWhispr cloud backend that any organization can self-host on its own infrastructure with its own AI providers — without modifying the desktop client.

**Current Focus:** Roadmap created (12 phases). Awaiting `/gsd-plan-phase 0` to decompose Phase 0 into executable plans.

**Constitutional Rules (apply to every phase):**
- Strict TDD — tests precede production code (TDD-01).
- GitHub Actions CI from day one; branch protection on `main` (CI-01..03).
- ≥85% lines / ≥80% branches coverage on the API tier (TEST-COV-01).
- Mutation testing on auth / multi-tenancy / quota / billing math (TEST-MUTATION-01).
- English-only source artifacts (DOCS-09).
- Wire-contract conformance suite (CONTRACT-01) extends incrementally — every wire endpoint adds a contract test in the same PR.

## Current Position

**Phase:** 0 — Repo Bootstrap & Constitutional CI (not started)
**Plan:** None (planning pending)
**Status:** Awaiting `/gsd-plan-phase 0`
**Progress:** [░░░░░░░░░░░░] 0/12 phases complete

## Performance Metrics

(Populated as phases complete and load tests run.)

- **Wire-conformance suite:** 0 endpoints covered / 22 wire endpoints planned
- **Coverage:** N/A (no code yet)
- **Load-test SLOs:** Not yet validated (publication gated on Phase 9)
- **Security gates:** N/A (CI scaffold pending in Phase 0)

## Accumulated Context

### Decisions Logged

(All Key Decisions from PROJECT.md remain in "Pending" state until ADRs are written in Phase 11. Roadmap-level decisions:)

- **Phase count = 12 (Phases 0-11):** Standard granularity for an enterprise OSS backend with 93 v1 requirements; the 12-phase build order from research SUMMARY.md is preserved with no compression because the orthogonal failure modes between phases (especially Phase 2 wire/auth vs Phase 3 LiteLLM, and Phase 4 streaming vs Phase 3 sync) require independent verification.
- **Phase 0 establishes constitutional CI before any production code** — retrofitting TDD/coverage/security gates after Phase 1 is harder than starting clean.
- **Phase 5 (multi-provider) MUST design tenant-scoped from day 1** — DIFF-01 (per-tenant provider override) is the project's primary differentiator; install-scoped abstraction would force an L-sized rewrite.
- **Per-endpoint p95 SLOs are NOT published until Phase 9 load test validates them** — research flagged sizing math as MEDIUM confidence; do not promise SLOs before measurement.
- **Phase 8 (UI-SPEC) can run in parallel with Phases 5-7** since it does not block backend work; sequencing is opportunistic.

### Open Todos

- Run `/gsd-plan-phase 0` to decompose Phase 0 into plans.
- Update PROJECT.md Key Decisions to "Resolved" with ADR references as Phase 11 ADRs are written.
- Reconcile REQUIREMENTS.md preamble figure ("78 requirements") with the actual count of 93 v1 line items at next requirements review.

### Blockers

None.

### Research Flags (from SUMMARY.md — apply additional `/gsd-research-phase` if deemed necessary)

- **Phase 2 (Wire/Auth contract):** HIGH research depth — 9 critical pitfalls. Multi-channel redirect matrix and contract-test harness scaffold should be locked before OAuth shim is written.
- **Phase 3 (Multi-tenancy + LiteLLM happy path):** HIGH — `SET LOCAL` discipline + framework middleware contract spike before tenant-scoped code lands.
- **Phase 4 (LiteLLM/Speaches integration):** HIGH — Realtime per-event compatibility matrix authored first.
- **Phase 9 (Scale + load test):** MEDIUM-HIGH — k6 scenario design for realistic 1000-user simulation.

## Session Continuity

**Last session:** 2026-05-08 — Roadmap created from PROJECT.md + REQUIREMENTS.md + research/ outputs.

**Next session entry point:** `/gsd-plan-phase 0` to begin Phase 0 planning.

**Files of record:**
- `.planning/PROJECT.md` — project context and constitutional rules
- `.planning/REQUIREMENTS.md` — 93 v1 requirements with phase mappings
- `.planning/ROADMAP.md` — 12-phase build order with success criteria
- `.planning/research/` — STACK.md, ARCHITECTURE.md, FEATURES.md, PITFALLS.md, SUMMARY.md
- `.planning/STATE.md` — this file

---
*State initialized: 2026-05-08*
