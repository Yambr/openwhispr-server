# Phase 12 Plan-Check — Re-Verification (Iteration 2)

**Phase:** 12 — Admin Onboarding Wizard + UI-SPEC Conformance Audit (v2)
**Mode:** RE-VERIFICATION after planner revision
**Date:** 2026-05-14

---

## Prior Check Baseline (Iteration 1)

| ID | Severity | Dimension | Description |
|----|----------|-----------|-------------|
| BLOCKER 1 | blocker | Dimension 1 + 13 (Q2) | `/setup` RSC fetched `/api/capabilities` (session-required) — would 401 the anonymous /setup visitor; no public setup-state endpoint existed. |
| BLOCKER 2 | blocker | Dimension 5 | 12-03 + 12-04 both Wave 2; both touch `en/end-user.json` + `ru/end-user.json` → parallel-merge collision. |
| BLOCKER 3 | blocker | Dimension 13 (Q1) | Wizard collected `workspace` + `timezone` but handler silently dropped both; ADMIN-02 unmet (no persistence). |
| TIDY 1 | warning | Dimension 5 | 12-02 edited `apps/api/src/auth.ts` lines 115-128 but did not declare it in `files_modified`; risked unsequenced parallel-hunk vs Plan 12-01 lines 270-279. |
| TIDY 2 | warning | Dimension 2 | 12-02 frontmatter claimed `ADMIN-05` (ops-docs requirement) which belongs to Plan 12-04 alone — duplicate claim. |

---

## Revision Summary (Planner Iteration 2)

- **Plan 12-02:** Added Task 5 (`GET /api/setup-state`), declared `apps/api/src/auth.ts` in `files_modified`, added `depends_on: [12-01]`, removed `ADMIN-05` from `requirements:`.
- **Plan 12-03:** Retargeted RSC fetch from `/api/capabilities` → `/api/setup-state`; added `tenants.name` persistence (RESEARCH Q1) with `tenant_rename_failed` warnings branch; documented timezone as deferred (handler accepts but does not write); added grep regression gate against `/api/capabilities` in `/setup/page.tsx`.
- **Plan 12-04:** Added `12-03` to `depends_on` (now `[12-02, 12-03]`) — Wave 2 serialized.
- **VALIDATION.md:** New row `12-02-T5`; amended `12-03-T1` (workspace + timezone-deferred + tenant_rename_failed); amended `12-03-T4` (PUBLIC `/api/setup-state` fetch).
- **CONTEXT.md:** New entry in `<deferred_ideas>` for `users.timezone` column persistence.

---

## Re-Verified Dimensions

### Fix 1 — Dimension 1 + Dimension 13 (Q2): Public `/api/setup-state` endpoint + RSC retarget — **PASS**

**Verified in Plan 12-02 Task 5 (lines 291-331):**
- New file `apps/api/src/routes/setup-state.ts` declared in `files_modified` (line 16) + `must_haves.artifacts` (lines 42-44).
- Public endpoint: handler does NOT enforce auth — `grep -n "AuthError\\|req.user\\|req.tenant" apps/api/src/routes/setup-state.ts` must return ZERO (acceptance criterion line 325).
- Boolean-shaped: `Object.keys(body) === ['status']` asserted (sub-test 7, line 314; acceptance line 327: `expect(Object.keys(body)).toEqual(['status'])`).
- Rate-limited: `{ max: 30, timeWindow: '1 minute' }` (line 302) — per-IP, T-12.02-05.
- No PII/env leak: threat T-12.02-05 (lines 86-90) — "No tenant id, no email, no env, no timestamps."
- `Cache-Control: no-store` (line 306) — wizard sees fresh status.
- `must_haves.truths` line 29-30 enumerates: zero-auth, boolean-shape, per-IP rate-limit.

**Verified in Plan 12-03 Task 4 (lines 281-333):**
- RSC fetches `/api/setup-state` (line 293, 322): `cache: 'no-store'`, branches on `status === 'pending' | 'completed' | 'skipped_legacy'`.
- `must_haves.truths` line 29 explicitly cites "PUBLIC `/api/setup-state` endpoint shipped by Plan 12-02 Task 5 — NOT `/api/capabilities`".
- `key_links` (lines 53-55) wire `setup/page.tsx → /api/setup-state` with pattern `fetch.*api/setup-state`.
- **Regression grep gate present:** acceptance line 324: `grep -n "api/capabilities" apps/web/src/app/\(public\)/setup/page.tsx` returns 0. Also sub-assertion at line 308 ("fetch URL is `/api/setup-state` NOT `/api/capabilities` (regression net against the BLOCKER 1 contradiction)").

**Verdict:** All three sub-requirements (public endpoint exists with correct shape/rate-limit, RSC fetches it, regression grep gate present) **PASS**.

---

### Fix 2 — Dimension 5 (Wave 2 i18n collision): 12-04 depends_on 12-03 — **PASS**

**Verified in Plan 12-04 frontmatter:**
- Line 6: `depends_on: [12-02, 12-03]  # BLOCKER 2 fix: sequential within Wave 2 to avoid en/end-user.json + ru/end-user.json merge collision with Plan 12-03`
- Both plans still `wave: 2` per VALIDATION.md (12-03-T4, 12-04-T1..T5), but the `depends_on` edge forces serial execution (orchestrator dispatches 12-04 only after 12-03 completes).
- Both plans touch `apps/web/src/locales/en/end-user.json` + `apps/web/src/locales/ru/end-user.json` (12-03 line 19-20; 12-04 line 22-23). Sequencing now resolves the collision.

**Verdict:** **PASS** — parallel execution within Wave 2 is now impossible by dependency.

---

### Fix 3 — Dimension 5 (auth.ts collision): 12-02 files_modified + depends_on — **PASS**

**Verified in Plan 12-02 frontmatter:**
- Line 6: `depends_on: [12-01]` — sequenced after Plan 12-01 (which edits `apps/api/src/auth.ts` lines 270-279 for `additionalFields.role`).
- Line 19: `apps/api/src/auth.ts  # lines 115-128 only (private readOidcProviders extraction); disjoint from Plan 12-01 lines 270-279, but sequenced via depends_on:[12-01] to eliminate auth.ts parallel-hunk risk` — explicit declaration + disjointness comment.
- Task 1 behavior (line 175) reiterates: "the ONLY auth.ts hunk in Plan 12-02; it is line-disjoint from Plan 12-01's lines 270-279 (additionalFields.role) — and sequenced via `depends_on: [12-01]` so the hunks land serially regardless."

**Verdict:** **PASS** — auth.ts declared, depends_on edge present, defense-in-depth via line disjointness commented.

---

### Fix 4 — Dimension 13 (Q1 workspace persistence + timezone deferred) — **PASS**

**Workspace persistence verified in Plan 12-03 Task 1:**
- `must_haves.truths` line 26: handler "renames the default tenant via `UPDATE tenants SET name=$workspace WHERE id='00000000-0000-0000-0000-000000000000'`".
- `must_haves.truths` line 32: explicit RESEARCH Q1 reference + "ADMIN-02 requires this; sub-test asserts the post-condition."
- `<interfaces>` block (lines 128-159) contains verbatim handler body extending RESEARCH §3 with the tenants UPDATE, wrapped in try/catch producing `warnings: ['tenant_rename_failed']` per T-12.03-05.
- Sub-test 1 (line 196-199): "**NEW sub-assertion (workspace persistence, RESEARCH Q1):** `SELECT name FROM tenants WHERE id='00000000-0000-0000-0000-000000000000'` returns `'Acme Inc'`".
- Sub-test 7 (line 205): tenant_rename failure path → 201 with `warnings: ['tenant_rename_failed']`, setup_state stays `completed` (admin not rolled back).
- Acceptance gates (lines 219-221): `grep -n "tenants"`, `grep -n "00000000-...|DEFAULT_TENANT_ID"`, `grep -n "tenant_rename_failed"` all ≥ 1.
- VALIDATION.md 12-03-T1 (line 52) cites: "winner 201 (incl. tenants.name=workspace persistence per RESEARCH Q1)" and "tenant-rename-failure warnings branch (BLOCKER 3 fix)".

**Timezone deferred verified:**
- Plan 12-03 truths line 33: "Timezone field is collected by the wizard as a UX preset only ... NO `users.timezone` column exists in the current schema; persistence is documented as deferred (see CONTEXT.md deferred-ideas). The handler accepts the field in the POST body but does NOT write it to any column".
- Sub-test 6 (line 204): introspects `information_schema.columns` to assert `users.timezone` does not exist — regression net flips RED if a future migration adds the column.
- Acceptance line 222: `grep -nE "users\\.timezone|set\\(\\{[^}]*timezone" apps/api/src/routes/setup-admin.ts` returns 0.
- **CONTEXT.md `<deferred_ideas>` line 173** documents the deferral verbatim with rationale + follow-up migration plan.

**Verdict:** **PASS** — workspace persists with sub-test post-condition; timezone-deferred is explicit, asserted by `information_schema` introspection, and CONTEXT.md records the deferral.

---

### Fix 5 — Dimension 2 (ADMIN-05 false claim) — **PASS**

**Verified in Plan 12-02 frontmatter:**
- Line 8: `requirements: [ADMIN-02, UICONF-01]` — `ADMIN-05` no longer present.

**Verified in Plan 12-04 frontmatter:**
- Line 8: `requirements: [ADMIN-04, ADMIN-05, UICONF-02, UICONF-06, UICONF-07]` — `ADMIN-05` retained.
- Plan 12-04 Task 5 (lines 273-306) implements the break-glass htpasswd section in `docs/operations.md` (must_haves line 36; artifact lines 54-55; verification command on line 295).

**Verdict:** **PASS** — single ownership restored; 12-04 carries ADMIN-05 alone.

---

## Final Verdict

All 5 prior issues (3 BLOCKERs + 2 tidy-ups) verified fixed:

| Fix | Dimension | Status |
|-----|-----------|--------|
| 1 — public /api/setup-state + RSC retarget + regression grep | D1, D13 (Q2) | PASS |
| 2 — Wave 2 i18n collision (12-04 depends_on 12-03) | D5 | PASS |
| 3 — auth.ts collision (12-02 files_modified + depends_on:[12-01]) | D5 | PASS |
| 4 — workspace persistence + timezone deferred + CONTEXT entry | D13 (Q1) | PASS |
| 5 — ADMIN-05 single ownership (removed from 12-02) | D2 | PASS |

## PLAN CHECK PASSED

Plans 12-02, 12-03, 12-04 + 12-VALIDATION.md + 12-CONTEXT.md are ready for execution. `/gsd-execute-phase 12` may proceed.
