# Deferred Items — OPEN ONLY

Items discovered during execution that are still actionable. Closed items
are archived under `.planning/backlog-archive/`.

**Triage convention:** any item below is OPEN. When a fix lands, delete
the entry rather than marking it closed — git history preserves the
record. Keep this file under ~200 lines.

---

## Coverage debt

### BUG-53-36 — root vitest workspace Branches coverage 88.08% (< 90% floor)

`pnpm test` at repo root reports:
- Statements 92.18% ✅
- Branches  **88.08% (2958/3358)** ❌ (-1.92 below DISCIPLINE floor)
- Functions 93.97% ✅
- Lines     92.82% ✅

Branch axis is the only one under floor. Not a single-bug item — 400
uncovered branches need a coverage-closure phase. Likely hotspots:
- `apps/api/src/lib/**` conditional fallbacks
- `apps/api/src/routes/v1/keys/**` BYOK error envelopes
- `packages/data/src/encryption` `catch` arms

**Plan of attack:** open `coverage/lcov-report/index.html` after a fresh
`pnpm test`, sort by Uncovered Branches desc, file targeted plans for
the top 10 files. Per-file fix is typically <50 LOC of vitest.

---

## Phase 54+ ownership

### BUG-53-27 — server-side fetch intercept (MSW node-server)

24 e2e specs in `apps/web/tests/e2e/` are auto-skipped under the slim
topology because their `page.route()` stubs can't intercept the
RSC server-side fetch wall. Phase 54 should land MSW node-server to
intercept inside the Next.js server runtime; would re-enable the
24 currently-skipped loading/error state specs.


---

## Historical (pre-Phase 53)

Older items from Phases 14, 18, 20, 31, 33, 51 live in
`.planning/backlog-archive/deferred-items-2026-05-19-archive.md`. Most
are either:
- Closed but not removed when the fix landed
- Subsumed by later phase work
- Still open but cold (no signal in 30+ days)

If a cold item resurfaces (test failure, prod alert, audit hit),
promote it back into this file with current date + repro.
