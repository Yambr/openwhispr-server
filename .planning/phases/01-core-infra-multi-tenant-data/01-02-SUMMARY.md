---
phase: 01-core-infra-multi-tenant-data
plan: 02
subsystem: bootstrap-and-secrets-gate
tags: [bootstrap, secrets, security, defense-in-depth, tdd]
requirements: [DATA-05, DATA-06]
dependency-graph:
  requires:
    - tools/lint-english.ts (Phase 0 — English-only lint covers new sources)
    - tests/self-tests/cyrillic-injection.test.ts (Phase 0 — pattern mirrored)
    - .env.example (Plan 01-01 — canonical key list; bootstrap reads it)
  provides:
    - tools/bootstrap.sh (idempotent secret generator + deny-list gate)
    - tools/bootstrap/default-secrets.txt (operator-extensible deny-list)
    - apps/api/scripts/check-default-secrets.ts (container-startup defense-in-depth)
    - tests/self-tests/refuse-default-secrets.test.ts (constitutional self-test)
  affects:
    - Phase 1 success criterion #1 (no deny-listed secret can boot the API)
    - Phase 2/3 (Dockerfile ENTRYPOINT will invoke check-default-secrets.ts)
    - Plan 01-06 (Makefile backup target consumes BACKUP_AGE_IDENTITY)
tech-stack:
  added:
    - openssl (rand -base64 32 → base64url 43-char secrets)
    - age-keygen (optional, for X25519 BACKUP_AGE_IDENTITY)
    - bash >= 4 (associative arrays, mapfile)
  patterns:
    - mkdtempSync per test + BOOTSTRAP_REPO_ROOT env override (Pitfall 7)
    - exact-match case-sensitive deny-list (Pitfall 2)
    - regenerate-only-on-empty-or-placeholder (Pitfall 1)
    - atomic write via mktemp + mv; chmod 600 on .env
key-files:
  created:
    - tools/bootstrap.sh (executable, 0755)
    - tools/bootstrap/default-secrets.txt
    - tools/bootstrap/README.md
    - apps/api/scripts/check-default-secrets.ts
    - apps/api/scripts/check-default-secrets.test.ts
    - tests/self-tests/refuse-default-secrets.test.ts
    - keys/.gitkeep
    - backups/.gitignore
  modified:
    - .gitignore (allowlist /keys/.gitkeep + /backups/.gitignore + /keys/backup.age.pub)
decisions:
  - Deny-list lives in tools/bootstrap/default-secrets.txt — both bootstrap.sh and check-default-secrets.ts read it; operators extend without code changes.
  - Match is case-sensitive exact byte match (Pitfall 2); threat model is "operator forgot to change placeholder", not "operator chose mutated bad password".
  - Idempotency is strict — only empty or placeholder-equal values are regenerated; second run preserves operator-set values byte-for-byte.
  - BACKUP_AGE_IDENTITY is a separate key from MASTER_KEK; backup-restore role compromise must not unlock runtime data and vice versa; rotation schedules are independent.
  - bash 4+ is required; the script aborts with brew-install-bash hint when BASH_VERSINFO[0] < 4 (macOS default 3.2 documented).
  - Self-tests run against mkdtempSync directories via BOOTSTRAP_REPO_ROOT env override so the real repo .env is never clobbered (Pitfall 7).
metrics:
  duration: ~25 minutes
  tasks: 2
  commits: 2 (TDD red + green)
  tests-added: 9 (5 bootstrap + 4 entrypoint check)
  files-created: 8
  files-modified: 1
  completed: 2026-05-09
---

# Phase 1 Plan 02: Refuse-to-Start Gate (bootstrap + entrypoint defense-in-depth) Summary

Two-layer refuse-to-start gate: operator-side `tools/bootstrap.sh` generates strong random secrets + rejects deny-listed values, and container-side `apps/api/scripts/check-default-secrets.ts` independently refuses to boot the API when any required env var is unset or matches the deny-list. Both layers must be bypassed for a `changeme`-class secret to reach production.

## What Shipped

- `tools/bootstrap.sh` (0755): bash 4+ idempotent generator. Walks `.env.example` for the canonical key list, reads current values from `.env`, regenerates only empty or placeholder-equal entries via `openssl rand -base64 32 | tr -d '\n=' | tr '+/' '-_'` (base64url, 43 chars). Atomic write via `mktemp` + `mv`; `chmod 600` on the result. Honors `BOOTSTRAP_REPO_ROOT` env override for self-tests so the real repo `.env` is never clobbered.
- `tools/bootstrap/default-secrets.txt`: 5-entry deny-list (`changeme`, `password`, `admin`, `sk-1234`, `secret`) with `#` comments and blank lines tolerated. Operators extend by appending lines.
- `tools/bootstrap/README.md`: documents purpose, key list, deny-list semantics (case-sensitive exact match), idempotency rule, macOS bash 3.2 caveat with `brew install bash` upgrade hint, and `BACKUP_AGE_IDENTITY` vs `MASTER_KEK` separation.
- `apps/api/scripts/check-default-secrets.ts`: container-entrypoint check. 10 `REQUIRED_KEYS`. Reads same deny-list as bootstrap; `DENY_LIST_PATH` env override lets operators extend without rebuilding the image. Names offending KEY on stderr (never the value); exits 1 on any miss.
- `tests/self-tests/refuse-default-secrets.test.ts`: 5 cases — `POSTGRES_OWNER_PASSWORD=changeme` rejected, `MASTER_KEK=changeme` rejected, placeholders generate complete deny-list-clean `.env`, two-run idempotency preserves all values, source contains the bash >= 4 guard + `set -euo pipefail` + brew-install hint.
- `apps/api/scripts/check-default-secrets.test.ts`: 4 cases — all `REQUIRED_KEYS` unset → exit 1 with each key on stderr; all valid → exit 0; one deny-listed → exit 1 naming that key only; `DENY_LIST_PATH` override honored.
- `.gitignore` extended with `/.env`, `/backups/*`, `/keys/*` plus `!/backups/.gitignore`, `!/keys/.gitkeep`, `!/keys/backup.age.pub` allowlists.
- `keys/.gitkeep` and `backups/.gitignore` placeholders so the directories exist on a fresh clone.

## REQUIRED_KEYS (canonical list)

`POSTGRES_OWNER_PASSWORD`, `POSTGRES_APP_PASSWORD`, `PGBOUNCER_ADMIN_PASSWORD`, `VALKEY_PASSWORD`, `MINIO_ROOT_PASSWORD`, `TRAEFIK_ADMIN_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`, `MASTER_KEK`, `BACKUP_AGE_IDENTITY`, `BETTER_AUTH_SECRET`.

`bootstrap.sh` does not hard-code this list — it walks `.env.example` line-by-line. Adding a row to `.env.example` automatically extends bootstrap coverage. The container-side `check-default-secrets.ts` does hard-code the list, intentionally — it must fail-closed even if `.env.example` is absent or tampered with.

## TDD Discipline

Two commits, in order, both passing the lefthook commit-msg + biome + English-only gates:

1. `5e96c94 test(01-02): add bootstrap deny-list and entrypoint check self-tests` — RED: 9/9 tests fail (bootstrap.sh and check-default-secrets.ts do not yet exist).
2. `6a221d1 feat(01-02): refuse-to-start gate via bootstrap.sh and entrypoint check` — GREEN: 9/9 tests pass; `bash -n` clean; smoke-test against `mkdtempSync` directory confirms first run generates all keys and second run preserves them byte-for-byte.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Installed `bash >= 4` via Homebrew so vitest can spawn the script.**
- **Found during:** Task 2 verify (`pnpm vitest run`).
- **Issue:** macOS ships bash 3.2 at `/bin/bash`, the bash 4+ guard correctly aborts the script, every subprocess test failed.
- **Fix:** `brew install bash` (resolves to `/opt/homebrew/bin/bash` 5.3.9) — the exact upgrade path documented in the script's stderr hint and in `tools/bootstrap/README.md`. `/opt/homebrew/bin` is already first on `PATH`, so `which bash` → bash 5 with no shell config change. This is the same upgrade path operators take; we ate our own dog food.
- **Files modified:** none (host environment only).

**2. [Rule 1 — Bug] Adjusted bash-version-guard self-test regex.**
- **Found during:** Task 2 verify.
- **Issue:** Test 5 used `/BASH_VERSINFO\[0\]\s*<\s*4/` but the actual bash literal is `${BASH_VERSINFO[0]} < 4` — the `}` between `]` and `<` made the regex never match.
- **Fix:** Updated regex to `/BASH_VERSINFO\[0\]\}?\s*<\s*4/` (closing `}` made optional so the test still passes if a future refactor uses `BASH_VERSINFO[0]` outside `${...}`).
- **Files modified:** `tests/self-tests/refuse-default-secrets.test.ts`.
- **Commit:** `6a221d1` (folded into the green commit since the fix is to test code that is itself part of the green deliverable).

### Non-deviations (planned-but-noted)

- Biome auto-formatted the multi-line `??` expression in `apps/api/scripts/check-default-secrets.ts` during the pre-commit hook. Functionally identical; no manual edit reverted the change.

## Authentication Gates

None encountered.

## Threat Model Status

All 6 mitigations from the plan's `<threat_model>` (T-01-02-01 through T-01-02-06) are implemented or accepted:

- T-01-02-01 (`.env` world-readable) — `chmod 600` after atomic write.
- T-01-02-02 (operator skips bootstrap) — `apps/api/scripts/check-default-secrets.ts` runs at container start.
- T-01-02-03 (regenerates live prod secret) — strict "empty or placeholder" rule, idempotency Test 4 enforces.
- T-01-02-04 (self-test fixtures clobber real `.env`) — every test uses `mkdtempSync` + `BOOTSTRAP_REPO_ROOT`.
- T-01-02-05 (KEK in process listing or logs) — values flow through env vars only; offenders printed by KEY name.
- T-01-02-06 (deny-list bypass via case mutation) — accepted; documented as case-sensitive in README.

## Known Stubs

None.

## Threat Flags

None.

## Follow-Ups

- **Phase 2/3 Dockerfile work:** wire the API container `ENTRYPOINT` to `node /app/scripts/check-default-secrets.js && exec node /app/dist/index.js` (or `tsx` equivalent) so the entrypoint check actually runs on container start.
- **Plan 01-06 backup target:** consume `BACKUP_AGE_IDENTITY` from `.env`; produce `keys/backup.age.pub` (the only file in `keys/` allowlisted by `.gitignore`) by deriving the public recipient from whichever path bootstrap took (real `age-keygen` vs openssl fallback).
- **Plan 01-01 finalization:** confirm `.env.example` enumerates exactly the 10 `REQUIRED_KEYS` in `check-default-secrets.ts`; if a key is added there, mirror it in both files.
- **Operations docs:** add `brew install bash` to the macOS prerequisites section so first-run `make bootstrap` is one step, not two.

## Self-Check: PASSED

- tools/bootstrap.sh — FOUND (executable, 0755)
- tools/bootstrap/default-secrets.txt — FOUND
- tools/bootstrap/README.md — FOUND
- apps/api/scripts/check-default-secrets.ts — FOUND
- apps/api/scripts/check-default-secrets.test.ts — FOUND
- tests/self-tests/refuse-default-secrets.test.ts — FOUND
- keys/.gitkeep — FOUND
- backups/.gitignore — FOUND
- Commit 5e96c94 (test red) — FOUND in git log
- Commit 6a221d1 (feat green) — FOUND in git log
