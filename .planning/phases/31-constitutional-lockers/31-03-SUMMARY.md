---
phase: 31-constitutional-lockers
plan: 03
subsystem: lockers/lint-no-hardcode
requirements: [LOCKER-03]
tags: [tooling, linter, blocking, locker, security, hardcode]
dependency-graph:
  requires: []
  provides:
    - tools/lint-no-hardcode.ts
    - tools/lint-no-hardcode.allowlist.txt
    - tools/lint-no-hardcode.test.ts
    - pnpm:lint:no-hardcode
    - pnpm:test:lint-no-hardcode
  affects:
    - package.json (scripts)
tech-stack:
  added: []
  patterns:
    - regex-line-scan locker mirroring lint-dockerfile-tls.ts shape
    - severity-tagged Violation (BLOCKING | WARN) — allowlist downgrades, never silences
    - file:line allowlist with rationale-stripping reader + bucketed entries (PERMANENT / DEBT / FALSE-POSITIVE / FIXTURE)
key-files:
  created:
    - tools/lint-no-hardcode.ts
    - tools/lint-no-hardcode.allowlist.txt
    - tools/lint-no-hardcode.test.ts
    - tools/lint-no-hardcode/fixtures/violates.ts
    - tools/lint-no-hardcode/fixtures/uuid-zero.ts
    - tools/lint-no-hardcode/fixtures/clean.ts
  modified:
    - package.json
decisions:
  - "Violation carries `severity: BLOCKING | WARN`; allowlist downgrades to WARN rather than suppressing — preserves regression-catch on NEW UUID-zero hits at unseen file:line keys."
  - "Comment-only false positives are allowlisted with `# comment-only-narrative-issue-31-fp` rationale rather than tightening the linter to AST-aware comment-strip (deferred to REFACTOR per plan Risks)."
  - "Allowlist seeded in 4 buckets: (a) PERMANENT canonical-default-tenant (8), (b) MIGRATION DEBT issue-31-debt-* (12), (c) DOCUMENTED FALSE POSITIVES comment-only (18), (d) PERMANENT canonical fixture infra (9) — total 47 entries."
metrics:
  duration_min: 25
  completed: 2026-05-16
---

# Phase 31 / Plan 03: lint-no-hardcode (LOCKER-03) Summary

Regex-line-scan locker refusing hardcoded `localhost`, `127.0.0.1`, port literals (`:3000|:4000|:8080`), UUID literals, and fake-token shapes (`sk-…`, `sk-ant-…`, `AIza…`, `AKIA…`, `Bearer ey…`) in `apps/*/src/**` + `packages/*/src/**` *.ts + *.tsx; BLOCKING from day one.

## Closes

- **LOCKER-03** (DISCIPLINE Rule 13 — no hardcoded localhost / UUID / test-tokens).

## What Shipped

### `tools/lint-no-hardcode.ts`

Mirrors `lint-dockerfile-tls.ts` (Violation type, `readAllowlist`, `findViolations`, `main`; exit codes 0 / 1 / 2; SPDX header; `c8 ignore` guards on the auto-run block and structurally-unreachable defensive branches).

One deviation from the template: `Violation` carries `severity: "BLOCKING" | "WARN"`. Allowlist-matched findings are surfaced in stderr as WARN (visible, non-blocking) rather than silenced. This preserves the regression-catch contract — a 9th UUID-zero hit at a NEW `file:line` key will still fire BLOCKING even though the 8 canonical-default-tenant sentinels sit on the allowlist permanently.

FORBIDDEN patterns (regex set):

| Label | Pattern | Remediation |
|---|---|---|
| `localhost-string` | `\blocalhost\b` | use env-driven `APP_BASE_URL` / `INTERNAL_API_URL` |
| `loopback-ip` | `\b127\.0\.0\.1\b` | use env-driven URLs |
| `port-literal` | `:(?:3000\|4000\|8080)\b` | ports come from env (PORT, INTERNAL_API_PORT, LITELLM_PORT) |
| `uuid-literal` | `\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b` (case-insensitive) | UUIDs from DB / env / fixtures; canonical sentinels → allowlist with rationale |
| `secret-shape-openai-anthropic` | `\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b` | never inline OpenAI / Anthropic API-key shapes |
| `secret-shape-google` | `\bAIza[A-Za-z0-9_-]{20,}\b` | never inline Google API-key shapes |
| `secret-shape-aws` | `\bAKIA[A-Z0-9]{16,}\b` | never inline AWS access-key shapes |
| `secret-shape-jwt-bearer` | `\bBearer\s+ey[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+\.[A-Za-z0-9_=.-]+` | never inline Bearer-JWT shapes |

IGNORE skips `node_modules`, `dist`, `.next`, `coverage`, `build`, `__generated__`, `.git` + whole-tree out-of-scope per plan: `tests/`, `__tests__/`, `*.{test,spec}.{ts,tsx}`, `.env*.example`, `compose/`, `docs/`, `charts/`, `tools/`.

### `tools/lint-no-hardcode.allowlist.txt` (47 entries, 4 buckets)

- **(a) PERMANENT — canonical DEFAULT_TENANT_ID sentinel (8 entries):** `apps/api/src/middleware/tenant.ts:44`, `apps/api/src/auth.ts:330,380`, `apps/api/src/lib/default-tenant.ts:5,19`, `apps/api/src/routes/setup-admin.ts:55`, `packages/data/src/seed/conformance.ts:35`, `packages/data/src/schema/tenants.ts:4` — all tagged `# canonical-default-tenant`. Never removed.
- **(b) MIGRATION DEBT — port/localhost literals (12 entries):** `apps/api/src/auth.ts:237`, `apps/api/src/routes/test-only.ts:181`, `apps/api/src/routes/better-auth-handler.ts:49`, `apps/api/src/index.ts:656`, 5 `apps/web/src/app/(auth)/app/**/page.tsx`, `apps/web/src/lib/auth-{actions,server}.ts`, `packages/litellm-client/src/config.ts:29` — tagged `# issue-31-debt-...`. Target Phase 41.c (web) + future targeted phase (api).
- **(c) DOCUMENTED FALSE POSITIVES — comment-only narrative (18 entries):** JSDoc / `//` / `/* */` lines describing env-driven defaults, Traefik routing patterns, security-boundary narration, or the `timeout:3000`-ms JSDoc in `_call-provider.ts:34`. Tagged `# comment-only-narrative-issue-31-fp` (or `# comment-only-jsdoc-timeout-ms-not-port-issue-31-fp` for the timeout case). Comment-strip pass deferred per plan Risks.
- **(d) PERMANENT — canonical fixture infrastructure (9 entries):** `packages/contract-tests/src/env.ts:13` + `negative-matrix.ts:98` + 6 `packages/data/src/seed/conformance.ts:29-34` SEED_* UUIDs + `conformance.ts:123` — tagged `# canonical-fixture-*`. These are the conformance-test fixture surface consumed by mock-litellm + e2e + RLS property tests.

### `package.json` scripts

```json
"lint:no-hardcode": "tsx tools/lint-no-hardcode.ts",
"test:lint-no-hardcode": "vitest run tools/lint-no-hardcode.test.ts --coverage --coverage.include=tools/lint-no-hardcode.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90"
```

### `tools/lint-no-hardcode.test.ts` (16 tests, 4 suites)

- `findViolations` (F1–F8): one-finding-per-FORBIDDEN-class on `violates.ts` fixture, clean-fixture zero-findings, UUID-zero allowlist-downgrade to WARN, UUID-zero non-allowlisted BLOCKING, IGNORE coverage (tests/compose/docs/charts/tools/.env.example), packages scope, file/line sort, `.tsx` scan.
- `readAllowlist` (R1–R3): missing-file empty Set, rationale-stripping `file:line` parse, fresh Set per call.
- `main` (C1–C5): dirty → exit 1, clean → exit 0, WARN-only → exit 0, default cwd, allowlist-path-is-directory → exit 2.

## Atomic Commits

| SHA | Subject |
|---|---|
| `d0309f0` | `test(31-03): red — lint-no-hardcode fixtures + failing import` |
| `cd49775` | `feat(31-03): green — lint-no-hardcode.ts + seeded allowlist (LOCKER-03)` |

## Verification Gate

| Gate | Result | Evidence |
|---|---|---|
| `pnpm test:lint-no-hardcode` ≥ 90/90/90/90 | ✅ 97.18 / 93.93 / 100 / 100 | 16/16 tests pass under root vitest config |
| `pnpm lint:no-hardcode` exit 0 on main | ✅ exit 0 | "49 allowlisted finding(s) (WARN, non-blocking); clean" |
| Synthetic `const TOKEN = "sk-..."` outside allowlist → exit 1 | ✅ exit 1 | Locker reports `[secret-shape-openai-anthropic]` and returns 1 |
| E2E case in `tests/e2e/lockers.spec.ts` | Deferred | Plan 31-07 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking task completion] Live-tree scan surfaced 27 BLOCKING findings on initial seed**

- **Found during:** Task 2 GREEN — `pnpm lint:no-hardcode` exited 1 on main after seeding only the 24-entry inventory from RESEARCH §LOCKER-03.
- **Root cause:** RESEARCH inventory counted production *string* hits but did not count comment-line matches (the regex set is intentionally regex-only per plan Risks: "Acceptable false-positive rate; comment-strip pass deferred to refactor if needed"). Additional legitimate fixtures in `packages/contract-tests/**` and 6 `SEED_*_ID` UUID constants in `packages/data/src/seed/conformance.ts` were also unaccounted for.
- **Fix:** Extended allowlist with two new buckets — (c) `# comment-only-narrative-issue-31-fp` for 18 comment-only hits + (d) `# canonical-fixture-*` for 9 conformance-test fixture entries. Each entry carries explicit rationale; total allowlist grew from 24 → 47.
- **Files modified:** `tools/lint-no-hardcode.allowlist.txt`.
- **Commit:** Included in `cd49775` (single GREEN commit per plan's two-commit boundary).

**2. [Rule 3 — Blocking task completion] Test file landed in main repo, not worktree (cwd-drift #3099)**

- **Found during:** Task 1 RED — initial `Write` calls used relative paths; cwd resolved to `/Users/nick/openwhispr-server/` (main repo) instead of the per-agent worktree, leaving worktree empty.
- **Fix:** Moved `tools/lint-no-hardcode.test.ts` + `tools/lint-no-hardcode/fixtures/{violates,uuid-zero,clean}.ts` from main repo into the worktree via absolute-path `mv`; cleaned main-repo stragglers. Subsequent Write calls used absolute worktree paths.
- **Files modified:** None permanently — main repo restored to pre-error state before any commit.

### Scope-Honored Decisions

- **No changes to lefthook / CI / Makefile / DISCIPLINE.md / CLAUDE.md** per plan Wave-1 isolation instruction; those land in Plan 31-07.
- **No production-code edits** to remove the 12 migration-debt port/localhost literals; those move via Phase 41.c (apps/web) + future targeted phase (apps/api). Per CLAUDE.md Hard Rule 1 ("NEVER edit production server code to make tests pass").
- **No `--seed-allowlist` flag** implemented — the seed was hand-curated with per-entry rationale (PERMANENT vs DEBT vs FP vs FIXTURE), which a generic dump-everything-as-`# issue-NNNN` flag could not produce. The plan listed it as an optional convenience; not load-bearing for LOCKER-03 closure.

## Known Stubs

None. The locker is fully wired, the allowlist is comprehensive, and every entry carries explicit rationale.

## Threat Flags

None — this plan adds tooling only; no new network surface, auth path, schema change, or file-access pattern. The locker itself **mitigates** STRIDE-Info-Disclosure by closing the regression vector where a real `sk-…` / `AIza…` / `AKIA…` literal could land in production source.

## Self-Check: PASSED

- **Commits exist:** `d0309f0` + `cd49775` on `worktree-agent-a43ef5dc0d413840c` (verified via `git log --oneline -3`).
- **Files exist:** `tools/lint-no-hardcode.ts` (302 lines post-format), `tools/lint-no-hardcode.allowlist.txt` (60 lines, 47 entries), `tools/lint-no-hardcode.test.ts` (16 tests), 3 fixture files under `tools/lint-no-hardcode/fixtures/`.
- **Tests GREEN:** `pnpm test:lint-no-hardcode` → 16/16 pass, coverage 97.18 / 93.93 / 100 / 100 (all axes ≥ 90).
- **Live tree clean:** `pnpm lint:no-hardcode` → exit 0 with 49 WARN, 0 BLOCKING.
- **Synthetic regression catches:** ad-hoc `apps/api/src/__synthetic-violation.ts` with `sk-…` literal → exit 1 with `[secret-shape-openai-anthropic]` finding (verified, file removed).
