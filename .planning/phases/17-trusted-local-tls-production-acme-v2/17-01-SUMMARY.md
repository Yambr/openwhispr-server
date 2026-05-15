<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->
---
phase: 17-trusted-local-tls-production-acme-v2
plan: 01
subsystem: dev-toolchain / tls
tags: [tls, mkcert, makefile, bootstrap, dev-ux]
requires: [phase-14-bootstrap-cert-chain, phase-15-traefik-host-split]
provides: [make-tls-trust, bootstrap-san-explicit-hosts]
affects: [Makefile, tools/bootstrap.sh, README.md]
tech-stack:
  added: [mkcert]
  patterns: [inline-makefile-recipe, idempotent-cert-regen-guard, platform-specific-install-hint]
key-files:
  modified:
    - Makefile
    - tools/bootstrap.sh
    - README.md
  created: []
decisions:
  - Inline shell recipe in Makefile (no `tools/tls-trust.sh` delegation) — mirrors `clean-stack:` precedent.
  - Idempotency guard ANDs three predicates: ≥30d validity, contains `DNS:api.localhost`, lacks `DNS:*.localhost`.
  - bootstrap.sh SAN list re-enumerated 1–10 with NO wildcards (10 explicit hosts).
metrics:
  duration: ~12m
  completed: 2026-05-15
---

# Phase 17 Plan 01: Dev TLS Toolchain Summary

mkcert-backed `make tls-trust` Makefile target + `tools/bootstrap.sh` SAN de-wildcard + README quickstart step 2 — delivers TLS-01, TLS-02-dev, TLS-04 in one atomic commit.

## Commit

`26afaa0` — `feat(17-01): mkcert-backed \`make tls-trust\` + bootstrap SAN de-wildcard`

Files (3 modified, 0 created — `.gitkeep`/`.gitignore` were already in correct state from Phase 14):

| File | Status | Δ |
|---|---|---|
| `Makefile` | M | +43 / −1 |
| `tools/bootstrap.sh` | M | +12 / −9 |
| `README.md` | M | +10 / −5 |

## Tasks Completed

1. **Makefile `tls-trust` target** — added to first `.PHONY:` aggregation line (next to `dev test lint`), recipe appended after `clean-stack:`. Recipe encodes:
   - `command -v mkcert` discovery with `case "$$(uname -s)"` branching: Darwin → `brew install mkcert nss`; Linux → `apt install mkcert  (or see docs/operations.md#air-gap-mkcert)`; other → `See docs/operations.md#air-gap-mkcert`. Exit 2 on absence. No sudo, no `--auto-install`.
   - `mkcert -install` (idempotent).
   - `mkdir -p compose/traefik/certs`.
   - Idempotency: regen if NOT (cert valid ≥30d AND has `DNS:api.localhost` AND lacks `DNS:*.localhost`).
   - Regen: `mkcert -cert-file ... -key-file ...` for EXACTLY 5 hosts (api/web/app/grafana/mailpit `.localhost`) — no wildcards.
   - `cp "$$(mkcert -CAROOT)/rootCA.pem" compose/traefik/certs/root-ca.crt`.
   - chmod 644 leaf cert + root-ca; chmod 600 key.

2. **bootstrap.sh SAN de-wildcard** — `tools/bootstrap.sh:358-371` `[alt_names]` block re-enumerated:
   - Dropped `DNS.2 = *.localhost` and `DNS.10 = *.example.test`.
   - New explicit 10-host list: `localhost`, `api.localhost`, `web.localhost`, `app.localhost`, `auth.localhost`, `grafana.localhost`, `minio-console.localhost`, `mailpit.localhost`, `api.example.test`, `auth.example.test`. Plus the existing `IP.1` / `IP.2` entries (untouched).
   - Inserted 3-line `# Phase 17 / Plan 17-01 — PITFALLS §13` comment explaining the de-wildcard rationale.

3. **`compose/traefik/certs/.gitkeep`** — verified already present + tracked + not gitignored (from Phase 14). No edit needed.

4. **`.gitignore` exception** — verified already carries `!compose/traefik/certs/.gitkeep` at line 65 below the leaf-glob block. No edit needed.

5. **README quickstart step 2** — inserted `make tls-trust` block at line 56 immediately after `cp .env.embedded.example .env` (line 54). Renumbered subsequent steps: current 2→3, 3→4, 4→5, 5→6, 6→7. Final step count 7.

## Smoke Results

- `PATH=/usr/bin:/bin make tls-trust` → `mkcert not found in PATH. Install: brew install mkcert nss` → exit 2. ✓ (binary-absence branch verified)
- Live regen path NOT smoke-tested end-to-end because mkcert is NOT installed on this executor host. Documented in commit body; operator first-run + Phase 17-02 Gherkin scenarios regression-guard.

## Lefthook Result

CLEAN — `english` job passed (978 files scanned, 0.70s). `phase-tag-comments`, `tenant-context`, `web-typecheck`, `colocated-tests`, `biome`, `ui-spec` all skipped (no matching staged files). `commitlint` PASS with one non-blocking warning (`footer-leading-blank`) — commit landed. ZERO `--no-verify` invoked.

## Deviations from Plan

### Auto-handled (no architectural change)

**1. [Rule 1 - State Already Correct] `.gitkeep` + `.gitignore` exception pre-existed**
- **Found during:** Task 3 pre-edit verification.
- **State:** `compose/traefik/certs/.gitkeep` is committed (tracked since Phase 14). `.gitignore` line 65 already reads `!compose/traefik/certs/.gitkeep` directly below the leaf glob block (`*.crt`, `*.srl`). `git check-ignore -v` confirms `.gitkeep` is NOT ignored and `local.crt` IS ignored.
- **Resolution:** Skipped Task 3 entirely. Truths #8 of the plan's `must_haves.truths` is satisfied by the pre-existing state.

**2. [Rule 2 - Parallel Wave 1 Artifacts] `compose/traefik/traefik.yml` + `compose/traefik/dynamic.prod.yml` present in worktree but UNSTAGED**
- **Found during:** `git status --short` pre-commit.
- **Cause:** Parallel 17-03 executor is editing those files (Wave 1 parallel-safe per CONTEXT Q4). They are NOT in 17-01's scope (PATTERNS cross-plan conflict matrix line 419).
- **Resolution:** Staged ONLY 17-01's three paths (`Makefile`, `tools/bootstrap.sh`, `README.md`). Did NOT use `git add .` or `git add -A`.

**3. [Rule 1 - Plan Verify Predicate Drift] Task 1 `<verify>` `! grep -q '\*\.localhost' Makefile` is too strict**
- **Issue:** The verbatim CONTEXT Q1 recipe DELIBERATELY contains `! grep -q 'DNS:\*\.localhost'` as the no-wildcard guard predicate AND a comment line mentioning `*.localhost`. The plan's verify predicate would falsely reject the correct recipe.
- **Resolution:** Executed the manually adapted verification (`grep -E '\*\.localhost' Makefile` returns ONLY the guard predicate line + comment line, both expected). All other Task 1 verify predicates passed.

### No-op deviations (truths satisfied without edit)

- **Truth #5** (`root-ca.crt` is the `mkcert -CAROOT` copy) — currently the live `root-ca.crt` is the openssl bootstrap CA. The mkcert overwrite happens on first operator `make tls-trust` run; truth #5 is the POST-FIRST-RUN invariant, not a pre-commit invariant. Plan accepts this per Q1-D1 status quo overwrite semantics.

## Success Criteria Status

| # | Criterion | Status |
|---|---|---|
| 1 | `make tls-trust` exists, `.PHONY`, inline recipe | ✓ |
| 2 | mkcert host: regen or skip; exit 0 | DEFERRED to operator (mkcert not installed here) |
| 3 | No-mkcert host: exit 2 + platform hint | ✓ (smoke-tested `PATH=/usr/bin:/bin`) |
| 4 | `bootstrap.sh` SAN zero wildcards, 10 explicit hosts | ✓ |
| 5 | `.gitkeep` tracked; cert leaf files gitignored | ✓ (pre-existing) |
| 6 | README step 2 is `make tls-trust`; renumber +1 | ✓ |
| 7 | ONE atomic commit lands all edits | ✓ (`26afaa0`) |
| 8 | ZERO `--no-verify`; lefthook clean | ✓ |
| 9 | `compose/traefik/dynamic*.yml` + `traefik.yml` untouched by 17-01 | ✓ (17-03 edits to those files NOT in this commit) |

## Forward References

- **17-02 Gherkin regression guard** — scenarios `@cjm-tls-trusted-localhost` (browser trust on first run) + `@cjm-tls-no-dev-ca-in-prod-image` (filesystem scan) will regression-guard this plan's output once Wave 2 lands.
- **`docs/operations.md#air-gap-mkcert`** — the Makefile recipe forward-references this anchor; section is authored in 17-02 Task 6.

## Self-Check: PASSED

- `Makefile` `tls-trust` target: present (`grep -E '^tls-trust:' Makefile` ✓)
- `tools/bootstrap.sh` zero wildcards in SAN block: confirmed (`! grep -E 'DNS\.[0-9]+ *= *\*\.' tools/bootstrap.sh` ✓)
- `README.md` `make tls-trust` at step 2: confirmed (`grep -A1 '^# 2\.' README.md` shows the block)
- Commit `26afaa0` exists: `git log --oneline | grep 26afaa0` ✓
