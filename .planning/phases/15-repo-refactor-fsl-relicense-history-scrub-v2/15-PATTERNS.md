<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->
<!-- REUSE-IgnoreStart -->
# Phase 15 — Pattern Map

**Mapped:** 2026-05-14
**Plans:** 15-01 (test-layout), 15-02 (structural reorg), 15-03 (FSL + Helm releaser), 15-04 (history scrub runbook)
**Mode:** advisor-style; no source edits in this artifact.

## File Classification (cross-plan)

| File (new or modified) | Plan | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|---|
| `docs/conventions.md` (extend test-layout section) | 15-01 | doc | static | `docs/conventions.md` (Phase 5 conventions doc — already exists) | exact |
| `Phase15-MOVE-INVENTORY.md` (root) | 15-01 | doc artifact | generated | `compose-chart-parity.allowlist.json`-style generated artifact at root | partial |
| `tools/migrate-tests.ts` (ts-morph codemod) | 15-01/02 | tooling/codemod | filesystem | `tools/spdx-header.ts` (CLI codemod, audit/fix modes) | exact (shape) |
| `tools/migrate-tests.test.ts` | 15-01 | test | unit | `tools/__tests__/spdx-header.test.ts` | exact |
| ESLint rule `no-colocated-tests` | 15-01 | lint rule | static AST | **no precedent — ESLint config file missing** | RISK |
| `vitest.config.ts` (root) + 13 per-workspace `vitest.config.ts` | 15-02 | config | static | `vitest.config.ts` (root) + `apps/api/vitest.config.ts` | exact |
| `compose/docker-compose.embedded-litellm.yml` (moved) | 15-02 | infra | static | `compose/docker-compose.*.yml` (6 already moved in Phase 14) | exact |
| `compose/docker-compose.load-test{,.realistic}.yml` (moved) | 15-02 | infra | static | same | exact |
| `compose/traefik/dynamic.dev.yml` (new host split) | 15-02 | config | static | `compose/traefik/dynamic.yml` | exact |
| `apps/api/src/auth.ts` (trustedOrigins edit) | 15-02 | config | static | `apps/api/src/auth.ts` lines 244-248 (existing pattern) | exact |
| `tests/e2e-cjm/playwright.config.ts` (baseURL switch) | 15-02 | config | static | `tests/e2e-cjm/playwright.config.ts` line 46 | exact |
| `apps/web/public/.gitkeep` | 15-02 | infra | static | (no analog — trivial) | n/a |
| `docs/adrs/0013-fsl-relicense.md` | 15-03 | ADR | static | `docs/adrs/0000-template.md` + `0004-apache-2-0-licensing.md` | exact |
| `MIGRATING.md` (new, root) | 15-03 | doc | static | `CONTRIBUTING.md` (sibling root doc) | partial |
| `LICENSE` (replace Apache-2.0 → FSL-1.1-ALv2) | 15-03 | legal | static | current `LICENSE` | exact |
| `REUSE.toml` (root, new) | 15-03 | config | static | **no precedent — file does not exist** | RISK |
| SPDX header sweep (~675 files) | 15-03 | codemod | filesystem | `tools/spdx-header.ts` (shape exists; needs FSL parametrization) | role-match |
| Workspace `package.json` `license` field update | 15-03 | metadata | static | **no package.json currently has a `license` field** (grep result empty) | RISK |
| `apps/api/Dockerfile` etc. — `LABEL org.opencontainers.image.licenses` | 15-03 | infra | static | `images/cnpg-postgres-17-pgpartman/Dockerfile:39` (ONLY existing license label) | partial |
| `.github/workflows/chart-release.yml` (new) | 15-03 | CI | events | `.github/workflows/helm-release.yml` (existing OCI release on `v*` tag) | role-match |
| `charts/openwhispr/artifacthub-repo.yml` | 15-03 | metadata | static | **no precedent** | RISK |
| `CONTRIBUTING.md` (DCO section) | 15-03 | doc | static | `CONTRIBUTING.md` (existing) | exact |
| `tools/history-scrub.sh` | 15-04 | script | filesystem/git | `tools/bootstrap.sh` (header style + `set -euo pipefail` + exit-code discipline) | exact |
| `tools/history-scrub.test.sh` | 15-04 | test | shell | `tools/bootstrap.test.sh` | exact |
| `docs/runbooks/15-04-history-scrub.md` | 15-04 | runbook | static | **no `docs/runbooks/` directory exists** | RISK |

---

## Plan 15-01 — Test-Layout Codification + MOVE-INVENTORY

### Closest analogs

- **ts-morph codemod precedent:** `tools/spdx-header.ts` (212 lines) — already an audit/fix CLI codemod with:
  - SPDX header line 1
  - Module-level `export function` shape (`shouldSkip`, `hasHeader`, `applyHeader`, `auditDir`, `fixDir`)
  - CLI entry guard at lines 198-212 (`invokedDirect` check)
  - Pinned `EXTENSIONS`, `SKIP_DIRS`, `IGNORE` glob arrays at top
  - Tested by `tools/__tests__/spdx-header.test.ts` (≥90/90/90/90 — gated by `.github/workflows/spdx.yml`)
  - **Note:** `spdx-header.ts` uses Node's built-in `node:fs/promises` glob — `tools/migrate-tests.ts` will need ts-morph (`Project`, `SourceFile.getImportDeclarations()`, `moveToDirectory()`) for **import-rewrite-aware moves**. ts-morph is NOT yet a dep of any package — `tools/package.json` will need it added (or root devDeps).
- **Lint tool precedent (for ESLint rule + test pairing):** `tools/lint-tdd.ts` (~4 KB) + `tools/lint-tdd.test.ts`; `tools/lint-english.ts`; `tools/lint-weak-assertions.ts` — uniform pattern: `tsx tools/lint-X.ts [paths...]`, exit 0/1, stderr enumeration.

### Vitest config inventory (14 files — all need `include` patch + `projects` migration)

```
./vitest.config.ts                                  # root, current threshold 85/80/80/85
./apps/api/vitest.config.ts                          # mergeConfig + 90/90/90/90 floor
./apps/web/vitest.config.ts
./apps/worker/vitest.config.ts
./packages/data/vitest.config.ts
./packages/email/vitest.config.ts
./packages/litellm-client/vitest.config.ts
./packages/byok-guard/vitest.config.ts
./packages/contract-tests/vitest.config.ts
./tools/load-test/vitest.config.ts                   # EXEMPTED per CONTEXT (stays co-located)
./tools/test-probe/vitest.config.ts
./compose/mock-litellm/vitest.config.ts
./tests/e2e/vitest.config.ts                          # root-level — STAYS
./tests/e2e/mock-realtime/vitest.config.ts
```

Pattern to copy (from `apps/api/vitest.config.ts` lines 19-46):
```ts
import { defineConfig, mergeConfig } from "vitest/config";
import rootConfig from "../../vitest.config.js";
export default mergeConfig(rootConfig, defineConfig({
  test: { coverage: { include: ["src/**/*.ts"], thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 } } }
}));
```
After 15-02 the per-workspace `test.include` must become `["tests/**/*.test.ts"]` and the **root** `vitest.config.ts` should adopt Vitest 3.2+ `projects: [...]` (replaces deprecated `workspace` field).

### Test files to migrate — inventory targets

Co-located test sites discovered (output of Plan 15-01 dry-run codemod must match):
- `apps/api/src/**/*.test.ts` + `apps/api/src/__tests__/**`, `apps/api/src/{lib,routes,i18n}/__tests__`
- `apps/web/src/**/*.test.ts` + `apps/web/src/{app,components,lib,locales}/__tests__`
- `apps/worker/src/i18n/__tests__`
- `packages/data/src/__tests__`, `packages/data/src/schema/__tests__`, `packages/data/migrations/__tests__`
- `packages/wire-schemas/src/__tests__`
- `packages/byok-guard/src/__tests__`
- `packages/email/src/EmailSender.test.ts` (co-located file)
- `packages/contract-tests/src/*.test.ts` (~20 files) + `packages/contract-tests/src/{__tests__,helpers/__tests__}`
- `tools/__tests__/*.test.ts` — REVISIT (load-test exempted; spdx tests stay where reviewer expects)

Target paths per CONTEXT Q4:
- `apps/<app>/src/**/*.test.ts` → `apps/<app>/tests/unit/<mirror>.test.ts`
- `apps/<app>/src/**/__tests__/<f>` → `apps/<app>/tests/unit/<mirror>/__tests__/<f>` (preserve harness dir shape)
- `packages/<pkg>/src/...` → `packages/<pkg>/tests/unit/...`

### Reusable conventions

- SPDX line-1 header on every new `.ts`/`.sh`/`.tsx` (enforced by `tools/spdx-header.ts` + `.github/workflows/spdx.yml`)
- `tsx` invocation pattern for CLI tools (`#!/usr/bin/env tsx` shebang in `tools/lint-migrations.ts` line 1)
- Test pairing: every `tools/*.ts` ships a sibling `tools/*.test.ts` or `tools/__tests__/*.test.ts`
- Doc cross-ref via "Authoritative cross-references" pointer (see `docs/conventions.md` head)

### Risk callouts

- **No existing ESLint config file** (`eslint.config.{js,mjs,ts}` or `.eslintrc*` not found in repo root) — CI runs `pnpm lint` (ci.yml line 25) which presumably resolves via package.json or workspace tsconfig. Plan 15-01 must DISCOVER where lint config lives before adding `no-colocated-tests` rule; this likely lives in a `@openwhispr/eslint-config` package or per-workspace. Investigate first; do NOT assume root file.
- **ts-morph not in any package.json** — adding as devDep at root is a 1-line PR but worth flagging.
- **Import-rewrite correctness** is the hard part; ts-morph handles static `from "..."` but **NOT** template-literal dynamic imports — codemod must scan/warn for those.

---

## Plan 15-02 — Structural Reorg

### Closest analogs

- **Compose moves:** `compose/docker-compose.{contract-test,dev-tools,ingress,observability,pgbouncer,storage}.yml` already moved in Phase 14 — pattern is "move + update every Makefile target + every CI workflow target". Inventory of refs to update:
  - `Makefile` lines 47-70 (per-overlay `up` targets), lines 65-70 (composite up-all), lines 199-238 (`compose/e2e/`), lines 295+ (testcontainers driver), lines 399-410 (embedded-litellm — **target of this move**).
  - CI workflows referencing root-level `docker-compose.embedded-litellm.yml` or `docker-compose.load-test*.yml`: `.github/workflows/conformance-axe.yml`, `.github/workflows/e2e-cjm.yml` (grep confirmed).
- **Traefik dynamic config:** `compose/traefik/dynamic.yml` (138 lines) — exact analog. Existing `Host(api.localhost) && PathPrefix(/api)` constraint at line 18 already partially addresses host-split. New `dynamic.dev.yml` should add:
  - `web@docker` router for `Host(web.localhost)` → `web:3001`
  - Confirm the existing `api@docker` rule shape (line 18) — host-split DOES already separate `api.localhost` from `web.localhost`; the closure of TD-15.g may be simply documenting + adding `web.localhost` explicitly, not a rewrite.
- **Better Auth `trustedOrigins`:** `apps/api/src/auth.ts` lines 244-248 — already env-driven (`OPENWHISPR_API_URL`, `AUTH_URL`, `AUTH_TRUSTED_ORIGINS_EXTRA`). Plan 15-02 only updates DOCS/`.env.example` to list `https://web.localhost` + `https://api.localhost` in the comma-separated extras; no code change to auth.ts itself unless trustedOrigins-host-pair becomes a literal.
- **Playwright config:** `tests/e2e-cjm/playwright.config.ts` line 46 `baseURL: "https://app.localhost"` — switch to `https://web.localhost`. Cucumber/Gherkin host refs to update: 10+ `.feature` files mention `api.localhost` (already correct); 1 file mentions `app.localhost` (must be searched + replaced with `web.localhost`).
- **Route groups:** `apps/web/src/app/` currently contains `(admin)/`, `(auth)/`, `(public)/` — three route groups. `__tests__/` + `api/` siblings. Phase 15-02 audit may consolidate or document; the three-group `(public)/(authed)/(admin)` pattern proposed in CONTEXT Q1 is close to actual (`(auth)` vs `(authed)` naming — disambiguate during audit).

### Files to create vs modify

| Action | File |
|---|---|
| Move | `docker-compose.embedded-litellm.yml` → `compose/docker-compose.embedded-litellm.yml` |
| Move | `docker-compose.load-test.yml` → `compose/docker-compose.load-test.yml` |
| Move | `docker-compose.load-test.realistic.yml` → `compose/docker-compose.load-test.realistic.yml` |
| Modify | `Makefile` (lines 399-410 + any other refs) |
| Modify | `.github/workflows/conformance-axe.yml`, `.github/workflows/e2e-cjm.yml` |
| Modify | `docs/operations.md` (paths to compose files) |
| Create | `compose/traefik/dynamic.dev.yml` (or extend `dynamic.yml`) |
| Modify | `tests/e2e-cjm/playwright.config.ts` (`baseURL`) |
| Modify | `tests/e2e-cjm/features/*.feature` (any `app.localhost` → `web.localhost`) |
| Modify | `.env.example` / `.env.slim.example` (trustedOrigins extras docs) |
| Modify | every `vitest.config.ts` (`include` → `tests/**/*.test.ts`); root adopts `projects` |
| Move | ~100+ test files (output of `tools/migrate-tests.ts`) |
| Create | `apps/web/public/.gitkeep` |
| Modify | possibly rename `apps/web/src/app/(auth)/` → `(authed)/` per route-group convention |

### Risk callouts

- **Compose-Chart parity gate** (`tools/lint-compose-chart-parity.ts`) — reads compose file paths; moving root compose files into `compose/` may need the lint script to be path-updated. Inspect `tools/lint-compose-chart-parity.ts` for hard-coded path lists before moving.
- **Atomic-commit discipline (CLAUDE.md):** tests + impl in same commit. The ~100-file test move + import rewrite + vitest.config edits MUST land as ONE commit (or atomic batch) to keep CI green.
- **Vitest `projects` migration** — Vitest 3.2 deprecates `workspace`; CONTEXT mandates `projects`. Verify current Vitest version in root `package.json` is ≥3.2 BEFORE adopting (root config uses Vitest 4 per comment line 8 — fine).

---

## Plan 15-03 — FSL Codemod + ADR + DCO + REUSE + Helm Releaser

### Closest analogs

- **ADR shape:** `docs/adrs/0000-template.md` (template) + `docs/adrs/0004-apache-2-0-licensing.md` (the direct predecessor — ADR-0013 supersedes it). Header pattern:
  ```md
  # ADR-NNNN: <title>
  **Status:** accepted
  **Date:** YYYY-MM-DD
  **Phase:** <number / name>
  ## Context / ## Decision / ## Consequences / ## Alternatives considered / ## References
  ```
  ADR-0013 MUST set `**Status:** accepted` and ADR-0004 MUST be patched to `**Status:** superseded by ADR-0013`.
- **SPDX codemod:** `tools/spdx-header.ts` already does the exact mechanical sweep, BUT it hard-codes `Apache-2.0` at line 35 (`export const HEADER = "// SPDX-License-Identifier: Apache-2.0";`). Plan 15-03 has two paths:
  1. **In-place edit:** flip `HEADER` constant to `FSL-1.1-ALv2`, run `fix`, audit. Adds zero new tools.
  2. **REUSE-tool path:** install `reuse` CLI, author `REUSE.toml`, run `reuse annotate --license FSL-1.1-ALv2` over all in-scope files, run `reuse lint` in CI. Aligns with CONTEXT decision ("REUSE.toml covering every SPDX-managed file pattern").
  CONTEXT mandates the REUSE path. Then `tools/spdx-header.ts` either (a) updates `HEADER` constant for the parallel audit job, or (b) is **deprecated** in favor of `reuse lint`. Pick (a) — keep the codemod for non-Python contributor convenience; add `reuse lint` as the CI gate.
- **CI gate wiring:** `.github/workflows/spdx.yml` (current Apache-2.0 audit job) — exact template for the new `reuse-lint.yml` (or extend `spdx.yml` to add a `reuse-lint` job). Existing `pnpm spdx:check` + `pnpm test:spdx-header` script names give the wiring pattern.
- **CI workflow file shape:** `.github/workflows/ci.yml` (uses `step-security/harden-runner`, `pnpm/action-setup@v4`, `actions/setup-node@v5` with `node-version: '24'`, `cache: 'pnpm'`) — copy for any new workflow.
- **Helm chart-releaser:** `.github/workflows/helm-release.yml` (current OCI-push to ghcr.io on `v*` tag) — closest analog. New `chart-release.yml` per CONTEXT decision should:
  - Trigger on `chart-v*` tag (separate semver lane)
  - Use `helm/chart-releaser-action@v1` with `charts_dir: charts/`
  - Publish to `gh-pages` branch (gh-pages init required — new operation)
  - Keep existing `helm-release.yml` if it serves a different distribution channel (OCI ghcr) — verify whether to deprecate or run both
- **License field on package.json:** **No workspace package.json currently has a `license` field** (grep returned empty). Plan 15-03 must ADD the field across all workspace package.json files (~12 packages):
  ```json
  "license": "FSL-1.1-ALv2"
  ```
- **Docker license labels:** Only ONE Dockerfile currently sets the label (`images/cnpg-postgres-17-pgpartman/Dockerfile:39`). Plan 15-03 must ADD `LABEL org.opencontainers.image.licenses="FSL-1.1-ALv2"` to all 12 Dockerfiles enumerated above. Pattern reference exists at the cnpg image — copy that line.
- **CONTRIBUTING.md DCO section:** `CONTRIBUTING.md` exists (already references TDD-01); add a `## Developer Certificate of Origin (DCO)` section pointing at the standard https://developercertificate.org/ text + `git commit --signoff` invocation. Industry-template language is fine here.
- **README badge:** `README.md` exists; check current license badge presence/format (grep returned no match — likely no badge today). Plan adds a shields.io badge: `![License: FSL-1.1-ALv2](https://img.shields.io/badge/license-FSL--1.1--ALv2-blue)`.

### Files to create vs modify

| Action | File |
|---|---|
| Create | `docs/adrs/0013-fsl-relicense.md` |
| Modify | `docs/adrs/0004-apache-2-0-licensing.md` (supersession header) |
| Create | `MIGRATING.md` (root, short pointer) |
| Replace | `LICENSE` (Apache-2.0 text → FSL-1.1-ALv2 text) |
| Modify | `NOTICE` (recompose under FSL-1.1-ALv2 patent grant text) |
| Create | `REUSE.toml` (root) |
| Modify | `tools/spdx-header.ts` (HEADER constant Apache-2.0 → FSL-1.1-ALv2) + its test fixtures |
| Modify | ~675 source files (SPDX line-1) — via `reuse annotate` and/or `tools/spdx-header.ts fix` |
| Modify | every `package.json` under `apps/`, `packages/`, root (add `"license": "FSL-1.1-ALv2"`) |
| Modify | every Dockerfile (add/patch `LABEL org.opencontainers.image.licenses`) |
| Modify | `README.md` (license badge) |
| Modify | `CONTRIBUTING.md` (DCO section + signed-off requirement) |
| Modify | `.github/workflows/spdx.yml` (rename or add `reuse-lint` job) OR create `.github/workflows/reuse-lint.yml` |
| Modify | `.github/workflows/ci.yml` (add `reuse-lint` to job matrix gate) |
| Create | `.github/workflows/chart-release.yml` (chart-releaser-action) |
| Create | `charts/openwhispr/artifacthub-repo.yml` |
| Init | `gh-pages` branch (one-shot operational step — flag in plan; non-code) |

### Reusable conventions

- ADR numbering: next ID = 0013 (current max = 0011 — `0012` is RESERVED if Phase 12 added one; verify by `ls docs/adrs/` — grep showed up to 0011)
- SPDX line-1 + `tools/spdx-header.ts` audit in CI (current ci.yml `spdx-audit` job pattern)
- Workflow header: `concurrency.group: <name>-${{ github.ref }}` + `cancel-in-progress: true` (see ci.yml lines 6-9, spdx.yml lines 24-26, helm-release.yml lines 22-24)
- Pinned action SHAs (`step-security/harden-runner@a5ad31d6...`) — replicate for new chart-release.yml

### Risk callouts

- **`reuse` CLI is Python** — adds Python toolchain to CI (or runs in a separate job/container). Verify ci.yml runner has python pre-installed (`ubuntu-24.04` does, but `pipx install reuse` is the canonical install path).
- **REUSE.toml syntax** — new format (Dec 2023+) requires `version = 1` + `[[annotations]]` blocks. No prior precedent in repo.
- **`gh-pages` branch initialization** — chart-releaser-action requires the branch pre-existing on first run; one-shot operator op. Document in runbook.
- **Tag namespace collision** — `helm-release.yml` already fires on `v*` tags (OCI push). `chart-release.yml` MUST fire on `chart-v*` only or the two will race. CONTEXT locks `chart-v*` prefix — enforce in workflow `on.push.tags`.
- **package.json `license` field absence** is a finding worth flagging in plan rationale — until this phase, npm tooling has been treating workspace packages as "license:UNLICENSED" implicitly (a license inheritance issue if any package were published, though none are).
- **License-text replacement** — `LICENSE` file rewrite is a single-commit semantic event; ADR-0013 must reference the exact FSL-1.1-ALv2 source URL + SHA.

---

## Plan 15-04 — History Scrub Atomic Event Runbook

### Closest analogs

- **Shell script:** `tools/bootstrap.sh` (300+ lines, exit-code discipline 0/1/2, `set -euo pipefail` line 27, env-overridable paths, bash-4+ guard line 31, BOOTSTRAP_REPO_ROOT escape hatch line 37). Copy for `tools/history-scrub.sh`:
  - `#!/usr/bin/env bash` shebang line 1
  - `set -euo pipefail` line 2 (or after SPDX header)
  - Comment block at top documenting: purpose, exit codes, env knobs
  - `REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"` line 37 pattern
- **Shell test:** `tools/bootstrap.test.sh` (104 lines) — pattern for testing `history-scrub.sh` driver functions (lock-emit, sanity-check, dry-run snapshot).
- **`gh api` usage:** **No existing precedent found in repo** for `gh api -X PATCH /repos/.../branches/main/protection` calls (grep returned empty). The history-scrub script will introduce this pattern. Document the API shape inline; reference https://docs.github.com/en/rest/branches/branch-protection.
- **Runbook doc:** **`docs/runbooks/` directory does NOT exist.** Plan 15-04 creates it. Closest content analog: long-form operational sections inside `docs/operations.md` and `docs/security.md`. Recommend the runbook copy the markdown heading shape from `docs/operations.md` (verify by reading).

### Files to create vs modify

| Action | File |
|---|---|
| Create | `tools/history-scrub.sh` |
| Create | `tools/history-scrub.test.sh` (or `.test.ts` if shellcheck is overkill) |
| Create | `docs/runbooks/15-04-history-scrub.md` |
| Create | `docs/runbooks/README.md` (index — optional but consistent with `docs/adrs/`) |
| Modify | `MIGRATING.md` (post-event: new HEAD SHA fill-in) — operational diff committed AFTER scrub |
| Modify | DCO bot config (grandfather cutoff SHA) — out-of-repo GitHub App config; document in runbook |

### Reusable conventions

- SPDX line-1 header on `.sh` files (per existing `tools/bootstrap.sh` line 0 — actually `tools/bootstrap.sh` does NOT have SPDX header on line 1; bash files in the repo use comment header instead; verify `.github/workflows/spdx.yml` glob — current SPDX workflow lists `.ts/.tsx/.js/.jsx/.mjs/.cjs` only; shell files exempt today. Future SPDX inclusion would be a separate hygiene change.)
- Exit codes 0/1/2 (per `tools/bootstrap.sh` header)
- Idempotent `gh api` invocations — every PATCH/DELETE wrapped in a check-current-state-first pattern (avoid double-toggle when re-running)
- Pre-flight tag (`pre-fsl-scrub-2026-05-15`) push BEFORE rewrite — preserves orphan reflog ≥90 days (per research §B)

### Risk callouts

- **NO test precedent for git-rewriting scripts** — `tools/history-scrub.test.sh` must mock `git filter-repo` (or run in a `mkdtempSync` repo) and CANNOT touch the real repo's `.git/`. Mock-via-PATH-override pattern (e.g., put a fake `git` first in PATH) is the only safe approach.
- **`reuse lint` interaction with scrub** — after scrub, every commit SHA shifts; the FSL codemod's SPDX coverage from 15-03 remains valid (content unchanged), but signed tags re-anchor. Document signed-tag re-sign as a manual step (deferred-items #1).
- **Branch protection scripting** — `gh api -X PUT /repos/{owner}/{repo}/branches/main/protection` is the documented endpoint; PATCH is NOT supported for the protection rule object (it's a full-replace PUT). Verify before writing the script; current GitHub REST docs accept PUT only.
- **GHA cache flush** — `gh api -X DELETE /repos/{owner}/{repo}/actions/caches?key=...` deletes by key; full flush is enumerate-then-delete loop. Bump `CACHE_VERSION` repo variable as belt-and-braces.
- **15-04 is a SOLO terminal wave** — no parallel TDD pairing in the conventional sense; the "test" surface is the dry-run output snapshot + the post-event sanity check. Coverage-gate-on-diff may need to be waived OR scoped to `tools/history-scrub.sh` only (≤200 LOC reachable from `tools/history-scrub.test.sh` with PATH-override mocks).

---

## Shared / cross-cutting

### SPDX header style (applied to all new `.ts/.tsx/.js/.sh` files in this phase)

After 15-03 lands:
```ts
// SPDX-License-Identifier: FSL-1.1-ALv2
```
Until 15-03 lands, new files in 15-01 + 15-02 carry `Apache-2.0` per current convention and are migrated by 15-03's codemod.

### Plan-ordering invariant (strict sequential)

`15-01 → 15-02 → 15-03 → 15-04`. No parallel waves. Codemod-vs-codemod collision (FSL header sweep touches every file moved by 15-02) is avoided by serialization. Verifier asserts each plan's state before next plan starts.

### "No precedent" gaps to surface in PLAN.md

1. ESLint config location — must be discovered before adding `no-colocated-tests` rule (15-01)
2. `REUSE.toml` — new file, no in-repo template (15-03)
3. `charts/openwhispr/artifacthub-repo.yml` — new file (15-03)
4. `docs/runbooks/` — new directory (15-04)
5. `gh api` branch-protection scripting — no in-repo precedent (15-04)
6. `package.json` `license` field — currently absent across workspace; 15-03 establishes baseline
7. Docker license labels on `apps/{api,web,worker}/Dockerfile` — currently absent; 15-03 establishes baseline

### Metadata

- **Pattern extraction date:** 2026-05-14
- **Files scanned (read-only):** 18 (incl. CONTEXT.md + 4 RESEARCH-*.md, vitest configs, spdx-header.ts, bootstrap.sh, traefik dynamic.yml, ADR-0004, ci.yml, spdx.yml, helm-release.yml, auth.ts excerpt, Dockerfile sample, conventions.md, ADR template, ADR-0011 head)
- **Search scope:** `tools/`, `compose/`, `apps/{api,web,worker}/`, `packages/`, `tests/`, `docs/`, `.github/workflows/`, root
- **Analogs found:** 18 / 25 files (72%); 7 files have no in-repo precedent (RISK callouts above)
<!-- REUSE-IgnoreEnd -->
