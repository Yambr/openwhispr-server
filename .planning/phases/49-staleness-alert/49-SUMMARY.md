# Phase 49 — SUMMARY (closed 2026-05-16)

ROADMAP "Phase 49: L8 weekly @expected-red staleness alert" met.

- `tools/check-expected-red-staleness.ts` — CLI/library: walks `tests/e2e-cjm/features/**/*.feature`, extracts `@expected-red @after-phase-N[.M][-SUFFIX]` pairs, cross-references `.planning/ROADMAP.md` closures, emits a Markdown report listing scenarios whose phase has been closed for ≥ `--stale-days` (default 7).
- `tools/check-expected-red-staleness.test.ts` — 12/12 vitest GREEN. Tests pure helpers (extract, parse, find, render) + a graceful-error path in `run()`.
- `.github/workflows/expected-red-staleness.yml` — Monday 09:07 UTC cron + workflow_dispatch. On stale findings: open or update a tracking issue labelled `staleness-report` (deduped via the label).

Exit code semantics: 0 = clean, 1 = stale found (workflow uses this to open/update issue), 2 = internal error.

Accepts the suffixed phase-id form (e.g. `51-WIRE-11-PUT`) and matches numeric prefix when a suffix is present and no exact match exists in ROADMAP closures.

This **completes the v2.1 QA cascade** — all 19 phases planned in `~/.claude/plans/mellow-watching-hinton.md` (originally Q-00..Q-18 → renumbered to 21..30 + 42..50 after rebase) are now CLOSED.
