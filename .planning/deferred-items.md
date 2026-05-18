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

## Documentation refresh

### DOC-refresh — sweep all `*.md` for accuracy after recent fixes + friendly OOB start

After the recent fix wave (BUG-53-37/39/40/41 + the precheck/overlay
work), most repo docs are stale on:
- How to run tests safely with the dev stack up (precheck behavior).
- The `LITELLM_MASTER_KEY` overlay default + when the prod boot guard
  exits 78.
- The `openwhispr-self-test` / `openwhispr-obs-smoke` compose project
  namespaces.
- The slim vs traefik topology toggle in playwright projects.

**Goal:** sweep every `*.md` under the repo root + `docs/`. Every
command in code-fences must actually work as-is on a fresh clone.
The OOB start path (`git clone && make up-with-dev-tools && open
http://localhost:3000`) must be the FIRST thing a new user reads.

**Specifically:**
- `README.md` — top-of-file QUICKSTART that fits in a screen and gets
  the user to a working browser tab in <5 minutes. Include `.env`
  template, what to copy from `.env.example`, and the one-line
  test command (`pnpm test` filtered or `pnpm vitest run apps/web`).
- `SELF_HOSTING.md` — operator-facing. Production `.env` checklist
  must call out `LITELLM_MASTER_KEY` is REQUIRED + the boot guard
  will exit 78 if missing or set to the dev default.
- `docs/security.md` — already has §12 (KEK) and §3 (auth boot guard);
  add a §13 for the LiteLLM boot guard with the same shape.
- `docs/operator-runbook.md` (or equivalent) — recovery instructions
  for "I ran `pnpm test` and my dev stack vanished" → "no longer
  possible, but here's how to recover an OLDER clone before the fix".
- All `docs/litellm-*.md` — verify env-override path still matches
  the dev-tools overlay seeding.

**Friendly OOB minimums:** the user (or any OSS contributor) should
be able to verify the install works in ≤2 commands AFTER `make up`:
1. `curl http://localhost:4000/api/health` → `{"status":"ok"}`
2. `cd apps/web && OPENWHISPR_TOPOLOGY=slim pnpm exec playwright test
   --project=slim` → 69/0/24

These two minimal checks are the contract. README must surface them
front-and-center.

---

## Phase 54+ ownership

### BUG-53-27 — server-side fetch intercept (MSW node-server)

24 e2e specs in `apps/web/tests/e2e/` are auto-skipped under the slim
topology because their `page.route()` stubs can't intercept the
RSC server-side fetch wall. Phase 54 should land MSW node-server to
intercept inside the Next.js server runtime; would re-enable the
24 currently-skipped loading/error state specs.

### Phase 38 / `@openwhispr/auth` retirement

Dead-export backlog from LOCKER-04 flagged in CLAUDE.md (operationally
deferred from Plan 31-08 to Phase 41 closure).

### LOCKER-05, LOCKER-06.a flips

Defense-in-depth lint upgrades scheduled — LOCKER-05 flips in Phase 37;
LOCKER-06.a flips in Phase 36.a. Rationale in
`.planning/phases/31-constitutional-lockers/31-08-DECISIONS.md §D-1`.

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
