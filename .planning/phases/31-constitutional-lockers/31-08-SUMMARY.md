---
phase: 31-constitutional-lockers
plan: 08
subsystem: lockers/operational-closure
tags: [LOCKER-09, deferred-ledger, warn-only-deferral, phase-31-closure]
dependency-graph:
  requires: [31-01, 31-02, 31-03, 31-04, 31-05, 31-06, 31-07]
  provides:
    - .planning/phases/31-constitutional-lockers/31-08-DEFERRED.md
    - .planning/phases/31-constitutional-lockers/31-08-DECISIONS.md
    - operational-closure-of-LOCKER-09
  affects:
    - .planning/DISCIPLINE.md (Rule 14 WARN→BLOCKING ledger prose)
    - CLAUDE.md (mirror)
    - .planning/REQUIREMENTS.md (LOCKER-01..06 rows + checkbox bullets)
    - tools/lint-no-hardcode.allowlist.txt (retag 3 docker-compose defaults as PERMANENT)
tech-stack:
  added: []
  patterns:
    - operational-deferral-of-WARN→BLOCKING-flip-to-owning-phase
    - allowlist-rationale-retagging (no production-code change)
key-files:
  created:
    - .planning/phases/31-constitutional-lockers/31-08-DEFERRED.md
    - .planning/phases/31-constitutional-lockers/31-08-DECISIONS.md
    - .planning/phases/31-constitutional-lockers/31-08-SUMMARY.md
  modified:
    - tools/lint-no-hardcode.allowlist.txt
    - .planning/DISCIPLINE.md
    - CLAUDE.md
    - .planning/REQUIREMENTS.md
decisions:
  - "LOCKER-04 BLOCKING flip operationally deferred from Plan 31-08 to Phase 41 closure (47-route bulkfix backlog is Phase 41 content per ROADMAP:1226). Rationale: 31-08-DECISIONS.md §D-1."
  - "3 docker-compose internal service-address default URLs (auth-actions.ts:22, auth-server.ts:47, litellm-client/src/config.ts:29) retagged from MIGRATION-DEBT to PERMANENT bucket in lint-no-hardcode.allowlist.txt. Defaults are required by CLAUDE.md's OOB-boot constitutional rule. Rationale: 31-08-DECISIONS.md §D-2."
  - "Tasks 1-7 from PLAN.md reduce to no-ops because every in-scope finding belongs to a future phase (Phase 41 for routes; Phase 38 for dead-exports; Phase 37 for secret-shape; Phase 36.a for shell-credential; Phase 32 for RLS-touching suppressions). Spawn prompt explicitly authorised this outcome."
  - "REQUIREMENTS LOCKER-01/02 rows flipped Pending → Complete (back-fill of 31-07 oversight) as a Rule 2 critical-correctness scope addition."
metrics:
  duration_minutes: ~5
  completed: 2026-05-16
  commits: 3
  files_created: 3
  files_modified: 4
---

# Phase 31 / Plan 08: Operational closure of Phase 31 (LOCKER-09)

**One-liner:** Triage of the live-tree locker inventory after 31-07 established that every MEDIUM/LOW finding the plan intended to bulk-fix is actually owned by a future phase (Phase 32 / 36.a / 37 / 38 / 41); LOCKER-04's BLOCKING flip operationally deferred to Phase 41 closure with full deferred-ledger and DISCIPLINE Rule 14 prose update; one rationale-only retag of 3 docker-compose service-address defaults from MIGRATION-DEBT to PERMANENT in `lint-no-hardcode.allowlist.txt`.

## What Shipped

### Task 0 — Triage pass

Live-tree run of all six lockers (without `--warn-only`):

| Locker | Mode at HEAD | Findings | Disposition |
|---|---|---|---|
| LOCKER-01 (lint-no-env-branches) | BLOCKING | 0 | Clean. |
| LOCKER-02 (lint-no-suppressions) | BLOCKING | 0 new; 36 allowlisted | Phase 32 + targeted phases. |
| LOCKER-03 (lint-no-hardcode) | BLOCKING | 0 new; 47 allowlisted | 5 buckets after retag (a)+(d)+(e) permanent, (c) FP, (b) Phase 41.c. |
| LOCKER-04 (lint-prod-readiness) | WARN-only | 546 raw / 516 allowlisted | 47 routes → Phase 41; 469 dead-exports → Phase 38. |
| LOCKER-05 (lint-secret-shape-in-error) | WARN-only | 3 allowlisted | Phase 37. |
| LOCKER-06 (lint-shell-credential-interpolation) | WARN-only | 3 allowlisted + 11 new WARN | Phase 36.a (auth gate). |

Full per-entry inventory + owning-phase assignment in `31-08-DEFERRED.md`.
Decision rationale in `31-08-DECISIONS.md`.

### Task A — Retag docker-compose internal-URL defaults as PERMANENT

3 entries in `tools/lint-no-hardcode.allowlist.txt` moved from bucket (b)
MIGRATION-DEBT to a new bucket (e) PERMANENT docker-compose-internal-url:

- `apps/web/src/lib/auth-actions.ts:22` (`DEFAULT_INTERNAL_API_URL = "http://api:3000"`).
- `apps/web/src/lib/auth-server.ts:47` (`DEFAULT_INTERNAL_API_URL = "http://api:3000"`).
- `packages/litellm-client/src/config.ts:29` (`DEFAULT_LITELLM_BASE_URL = "http://litellm:4000"`).

Each call site already routes through `process.env.<NAME>` first; the
literal port is the **docker-compose internal service-address default**
required by CLAUDE.md's constitutional OOB-boot rule ("a fresh `git
clone && docker compose up` works out of the box"). The 5
`apps/web/(auth)/app/**/page.tsx` port-3000 entries stayed in bucket (b),
retagged with `-phase-41c` suffix to make the deferred-ledger trail
explicit.

The retag is **rationale-only** — no production-code change, no
allowlist count change (49 WARN → 49 WARN), `pnpm lint:no-hardcode`
exits 0 before and after.

### Final — DISCIPLINE Rule 14 + CLAUDE.md mirror + REQUIREMENTS update

- `.planning/DISCIPLINE.md` Rule 14 closing prose ("Locker WARN→BLOCKING
  ledger") amended to record the LOCKER-04 deferral to Phase 41 closure
  with explicit cross-reference to `31-08-DECISIONS.md §D-1` and
  `31-04-SUMMARY.md:118-124` (the flip-readiness proof).
- `CLAUDE.md` mirror updated with the same prose, single sentence
  appended to the existing Rule 14 sub-bullet (LOCKER-07 atomicity
  preserved — same commit edits both files).
- `.planning/REQUIREMENTS.md` LOCKER-01/02/03/04/05/06 rows + bullet
  checkboxes updated to match operational reality (LOCKER-01/02/03
  Complete + BLOCKING; LOCKER-04/05/06 WARN-only-pending-phase-N with
  per-row phase tag). This is a Rule 2 critical-correctness back-fill
  of 31-07's REQUIREMENTS table oversight — 31-07 flipped LOCKER-07/08/09
  but left LOCKER-01/02 stale at Pending.

## Commits

| SHA | Subject | Files |
|---|---|---|
| `c4f1938` | `docs(31-08): triage MEDIUM/LOW vs CRITICAL/HIGH deferred to Phases 32-41` | 31-08-DEFERRED.md, 31-08-DECISIONS.md |
| `33572f7` | `fix(31-08): retag docker-compose internal-url defaults as PERMANENT (LOCKER-03)` | tools/lint-no-hardcode.allowlist.txt |
| _pending_ | `docs(31-08): finalize Phase 31 — LOCKER-04 BLOCKING flip deferred to Phase 41` | DISCIPLINE.md, CLAUDE.md, REQUIREMENTS.md, 31-08-SUMMARY.md, STATE.md, ROADMAP.md |

## Verification Gate

- `pnpm lint:lockers` → **exit 0** on HEAD (3 BLOCKING + 3 WARN-only lockers all green).
- `pnpm lint:lockers-allowlist-diff` → **exit 0** (no net additions; the
  retag is rationale-only — parser strips `# ...` comments).
- `pnpm test:lint-no-hardcode` → **16/16 pass, coverage 97.18 / 93.93 /
  100 / 100** (≥ 90/90/90/90 per DISCIPLINE Rule 2).
- LOCKER-04 BLOCKING flip-readiness proof still holds per 31-04-SUMMARY:118-124.
- Nightly `lockers-nightly` job in `.github/workflows/nightly.yml`
  unchanged — continues to invoke the BLOCKING form daily, providing
  early-warning on the deferred 47-route + 469-dead-export inventory.

## Deviations from Plan

### 1. [Rule 4 — Architectural; user pre-authorised] Tasks 1-7 deferred to Phase 41 / 32 / 36.a / 37 / 38

**Found during:** Task 0 triage.

**Issue:** Plan §Tasks 1-7 prescribe per-area atomic-commit bulk-fixes
for MEDIUM/LOW LOCKER-04 routes, suppressions, hardcodes,
shell-credentials, and secret-shape findings. Task 0 triage established
that **every** finding in the live-tree inventory is owned by a future
phase by current ROADMAP wording:

- 47 LOCKER-04 routes → Phase 41 (ROADMAP:1220-1232 explicitly frames
  Phase 41 as the residual HIGH/MEDIUM route-shape sweep with per-route
  TDD; 41.b names `agent/stream.ts` as the exemplar).
- 469 LOCKER-04 dead-exports → Phase 38 (`@openwhispr/auth` retirement).
- 9 LOCKER-02 suppressions in `apps/worker/src/db/app-pool.ts` → Phase 32.
- 1 LOCKER-02 suppression in `apps/api/src/index.ts:288` → Phase 32.
- 3 LOCKER-05 secret-shape entries → Phase 37 (CRIT-FIX-09).
- 3 LOCKER-06 shell-credential entries (audit-archive) → Phase 36.a.
- 11 LOCKER-06 NEW shell-credential entries in test/migration files →
  Phase 36.a (linter scope decision belongs to Phase 36.a's flip
  context).
- 5 LOCKER-03 port hardcodes in `apps/web/(auth)/app/**/page.tsx` →
  Phase 41.c.
- 3 LOCKER-03 docker-compose internal-URL defaults → retagged PERMANENT
  in Task A (constitutional OOB-boot rule).
- 4 residual LOCKER-03 entries in apps/api migration-debt → no current
  owner; surfaced as deferred items.

**Fix:** Operationally defer the BLOCKING flip to Phase 41 closure per
spawn-prompt directive ("If you discover that flipping LOCKER-04 to
BLOCKING would break main (because the deferred set still contains
active findings), the correct decision is: Keep `--warn-only` ON for
now"). Document in `31-08-DEFERRED.md` + `31-08-DECISIONS.md §D-1`. The
3 BLOCKING lockers (01/02/03) remain BLOCKING; the 3 WARN-only lockers
(04/05/06) remain WARN-only pending their respective owning-phase
closures. Phase 31 still closes — 6 lockers shipped, integrated,
seeded, and CI-gated.

**No user prompt issued:** user is offline; the spawn-prompt explicitly
pre-authorised this outcome ("THAT IS THE EXPECTED OUTCOME — do not
invent fixes that belong to other phases").

**Commits:** `c4f1938` (triage doc), pending (DISCIPLINE prose).

### 2. [Rule 2 — Critical correctness] REQUIREMENTS table LOCKER-01/02 rows back-filled

**Found during:** Final-commit drafting.

**Issue:** `.planning/REQUIREMENTS.md` showed LOCKER-01 and LOCKER-02
as `Pending` despite both being landed and BLOCKING since Phase 31-01
and 31-02 respectively. 31-07's REQUIREMENTS update flipped
LOCKER-07/08/09 but missed 01/02.

**Fix:** Flip both to `Complete` in the same final commit as the LOCKER-04
deferral note. Mirror via the bullet-checkbox flip. Out-of-scope strictly
but in-scope for LOCKER-09's "operational verification of the requirements
ledger".

**Commit:** pending (final commit).

### 3. [Rule 1 — Bug] One LOCKER-03 allowlist entry was mis-bucketed

**Found during:** Reading the allowlist before drafting Task 5.

**Issue:** `apps/web/src/lib/auth-actions.ts:22`, `apps/web/src/lib/auth-server.ts:47`,
and `packages/litellm-client/src/config.ts:29` were tagged
`issue-31-debt-hardcode-port-...` (MIGRATION-DEBT bucket) by 31-03. The
literal port in each is the **docker-compose internal service-address
default** required by CLAUDE.md's OOB-boot constitutional rule — not
migration debt. Closing the finding by removing the default would break
`git clone && docker compose up` for OSS users — a constitutional
regression.

**Fix:** Retag the 3 entries to a new `(e) PERMANENT
docker-compose-internal-url` bucket in `tools/lint-no-hardcode.allowlist.txt`.
Update bucket (b) header to explicitly forbid future `DEFAULT_*_URL`
defaults from being mis-bucketed. No production-code change. Rationale:
`31-08-DECISIONS.md §D-2`.

**Commit:** `33572f7`.

## Out of scope (documented, not acted on)

- Bulk-fix of 47 LOCKER-04 routes (Phase 41).
- Dead-export sweep of 469 entries (Phase 38).
- LOCKER-02 9-entry pg-typing suppression cleanup (Phase 32).
- LOCKER-05 3-entry secret-shape closure (Phase 37).
- LOCKER-06 3 audit-archive + 11 test-file shell-credential closure (Phase 36.a).
- LOCKER-03 4-entry apps/api port hardcode cleanup (no current owner; deferred).
- LOCKER-04 BLOCKING flip — package.json / lefthook.yml / ci.yml /
  nightly.yml / Makefile flag-removal (Phase 41 closing commit).

## Known Stubs

None. All work in 31-08 is documentation / allowlist-rationale / requirements-
ledger consistency. No production-code paths altered; no stubs introduced.

## Threat Flags

None. This plan modifies only documentation, requirements ledger, and the
rationale comments inside one allowlist file. No new network surface, no
auth path change, no schema change, no file-access pattern change. The
threat-mitigation surface of the six lockers remains unchanged.

## Phase 31 Exit Criteria — Status

Per ROADMAP:1089-1094:

1. ✅ `pnpm lint:lockers` runs in CI; 3 lockers BLOCKING (01/02/03) on every PR; 3 lockers (04/05/06) WARN-only with nightly BLOCKING. Synthetic violations refused on the 3 BLOCKING lockers. Per-locker fixtures exist + exit non-zero on broken fixtures (verified in 31-04..06 vitest suites).
2. ✅ Per-locker vitest suites ≥ 90/90/90/90 per DISCIPLINE Rule 2. E2E `tests/e2e/lockers.test.ts` runs real binaries with real exit codes (DISCIPLINE Rules 3 + 4) — 8 cases GREEN.
3. ✅ A synthetic PR introducing any of the 3 BLOCKING violation classes (01/02/03) is REFUSED by lefthook AND CI. The 3 WARN-only classes (04/05/06) are caught nightly until their owning-phase flip.
4. ✅ All 6 `tools/lint-*-allowlist.txt` files seeded with current-main inventory; each entry carries a tracking-issue ID; `tools/lockers-allowlist-diff.ts` CI step refuses net additions (`pnpm lint:lockers-allowlist-diff` → exit 0 on HEAD).
5. ✅ `.planning/DISCIPLINE.md` Rules 11-14 + closing WARN→BLOCKING ledger present + mirrored to `CLAUDE.md` in the LOCKER-07 atomic commit (`ccaaaab`); updated in 31-08 final commit (pending) to record the LOCKER-04 → Phase 41 deferral.

**Phase 31 closes** with 6 lockers landed, wired, seeded, CI-gated, and
covered by ≥ 90/90/90/90 unit suites + a real-binary e2e suite. The
LOCKER-04 BLOCKING flip moves operationally to Phase 41 closure — the
flip itself is a single-flag change as demonstrated by the
flip-readiness proof in 31-04-SUMMARY:118-124. The constitutional
discipline surface (Rules 11-14) is now active.

## Self-Check: PASSED

- [x] `git log --oneline -3` shows `c4f1938`, `33572f7` on HEAD (verified before final commit).
- [x] `.planning/phases/31-constitutional-lockers/31-08-DEFERRED.md` exists with full per-finding owning-phase assignment.
- [x] `.planning/phases/31-constitutional-lockers/31-08-DECISIONS.md` exists with §D-1 through §D-5 rationale chain.
- [x] `tools/lint-no-hardcode.allowlist.txt` retag landed in commit `33572f7`; bucket (e) PERMANENT docker-compose-internal-url present; 3 entries moved out of bucket (b).
- [x] `pnpm lint:lockers` → exit 0 on HEAD.
- [x] `pnpm lint:lockers-allowlist-diff` → exit 0 on HEAD.
- [x] `pnpm test:lint-no-hardcode` → 16/16 pass, coverage 97.18/93.93/100/100.
- [x] `.planning/DISCIPLINE.md` Rule 14 closing prose records the LOCKER-04 → Phase 41 deferral with cross-references to 31-08-DECISIONS.md §D-1 + 31-04-SUMMARY:118-124.
- [x] `CLAUDE.md` Rule 14 sub-bullet mirrors the same deferral note (LOCKER-07 atomicity preserved — same commit).
- [x] `.planning/REQUIREMENTS.md` LOCKER-01..06 rows + checkbox bullets match operational reality.
- [x] No production-code path modified (DISCIPLINE Rule 1 + CLAUDE.md Hard Rule 1 honoured).
