# Phase 15 — Context

**Phase:** 15 — Repo Refactor + FSL Relicense + History Scrub (v2)
**Date captured:** 2026-05-14
**Mode:** discuss (advisor-style research-backed; 4 parallel `gsd-advisor-researcher` runs)
**Locked requirements:** STRUCT-01..07, FSL-01..07 (14 reqs from REQUIREMENTS.md)

<domain>
The repo's structure stops fighting the framework (Traefik host split eliminates `/api/locale` 404 shadowing), the license switches from Apache-2.0 to FSL-1.1-ALv2 across every surface (LICENSE + 675 SPDX headers + every workspace `package.json` + every Docker LABEL + every README badge), and `speaches-audio.md` is scrubbed from git history — bundled as ONE release event so contributors absorb one force-push, not two.

This phase delivers HOW to execute the structural reorg + Traefik host split + license migration + history scrub. The WHAT is locked by ROADMAP.md success criteria.
</domain>

<canonical_refs>
**MANDATORY reads for downstream agents:**

- `.planning/ROADMAP.md` — Phase 15 entry + success criteria (lines 472-484 of REQUIREMENTS.md)
- `.planning/REQUIREMENTS.md` lines 472-484 — STRUCT-01..07 + FSL-01..07
- `.planning/PROJECT.md` — core value + constraints
- `.planning/STATE.md` — current milestone state (Phase 14 closed 2026-05-14)
- `.planning/phases/15-repo-refactor-fsl-relicense-history-scrub-v2/15-RESEARCH-subplan-split.md` — sub-plan split research (Option B locked)
- `.planning/phases/15-repo-refactor-fsl-relicense-history-scrub-v2/15-RESEARCH-helm-location.md` — STRUCT-03 research (Option 3 locked)
- `.planning/phases/15-repo-refactor-fsl-relicense-history-scrub-v2/15-RESEARCH-history-scrub.md` — atomic event mechanics research (combined runbook locked)
- `.planning/phases/15-repo-refactor-fsl-relicense-history-scrub-v2/15-RESEARCH-test-layout.md` — STRUCT-01 migration strategy (Option A locked)
- `.planning/phases/14-slim-core-byok-profiles-v2/14-VERIFICATION.md` — Phase 14 final state (compose overlays live in `compose/` already; 6 overlay files + 7 service base compose)
- `.planning/phases/13-e2e-cjm-harness-v2-ships-first/` — Phase 13 Playwright tests at `tests/e2e-cjm/` (stay at root)
- `charts/openwhispr/values.yaml` + `charts/openwhispr/Chart.yaml` — Helm chart state (5 `*.enabled` toggles from Phase 14)
- `tools/lint-compose-chart-parity.ts` — parity gate that REQUIRES Helm + compose to live in same repo
- ROADMAP open question for Phase 15 (STRUCT-03 Helm location) — **RESOLVED here: Option 3**
</canonical_refs>

<code_context>
**Current repo structure (scouted 2026-05-14):**

- Compose: `docker-compose.yml` (base, 7 services after Phase 14) + `docker-compose.embedded-litellm.yml` + `docker-compose.load-test.yml` + `docker-compose.load-test.realistic.yml` at ROOT; `compose/docker-compose.*.yml` (6 overlays: contract-test, dev-tools, ingress, observability, pgbouncer, storage) already moved.
- Helm: `charts/openwhispr/` (Chart.yaml, values.yaml, values.schema.json, templates/, tests/) — single chart.
- Compose-Chart parity gate: `tools/lint-compose-chart-parity.ts` — assumes single-repo.
- Tests (mixed layout):
  - `apps/api/src/__tests__/`, `apps/api/src/routes/__tests__/`, `apps/api/src/**/*.test.ts` — co-located
  - `apps/web/tests/` — separate dir already (closer to target convention)
  - `packages/*/src/__tests__/`, `packages/*/src/**/*.test.ts` — co-located
  - `tests/e2e/`, `tests/e2e-cjm/`, `tests/conformance/ui-spec/`, `tests/infra/` — root-level (stay)
  - `tools/load-test/src/**/*.test.ts` — co-located
- Traefik: existing config in `compose/traefik/` (already from Phase 14 ingress overlay) — currently single host or no host split.
- License: Apache-2.0 (root `LICENSE`); SPDX headers present on most source files; `REUSE.toml` does not yet exist.
- Speaches reference doc `speaches-audio.md` was deleted in working tree (pre-flight cleanup); still present in git history — target for `git filter-repo`.
</code_context>

<decisions>

### Q1 — Sub-plan split granularity: **Option B (4 plans)**

Phase 15 splits into 4 plans:

- **15-01** — Test-layout codification + `Phase15-MOVE-INVENTORY.md`
  - Authors `docs/conventions.md` test-layout section + ESLint rule preventing future co-located test files
  - Authors `Phase15-MOVE-INVENTORY.md` enumerating every test file move (computed via `tools/migrate-tests.ts` codemod; commits with `--dry-run` output)
  - No actual `git mv` yet — pure pre-flight inventory + convention authorship
  - Closes STRUCT-01 deliverable "MOVE-INVENTORY exists BEFORE any move PR"

- **15-02** — Structural reorg (compose + Traefik host split + test moves + route-groups + `.gitkeep`)
  - Move remaining root compose files to `compose/` (`docker-compose.embedded-litellm.yml`, `docker-compose.load-test*.yml`); update Makefile refs; update CI workflow refs; update `docs/operations.md`
  - Traefik host split: dev `compose/traefik/dynamic.dev.yml` routes `web.localhost` → web:3001, `api.localhost` → api:3000; closes TD-15.g
  - Better Auth `trustedOrigins` updated for new host pair
  - Phase 13 Playwright `baseURL` switched to `https://web.localhost` (or http for non-TLS dev); related cucumber step regexes updated
  - **Test layout migration: Option A big-bang** — `tools/migrate-tests.ts` codemod runs; all moves land in this plan as part of one atomic commit (per task) wave
  - `vitest.config.ts` switches from default `**/*.{test,spec}.ts` to explicit `tests/**/*.test.ts` per workspace; adopts Vitest 3.2+ `projects` config (replaces deprecated `workspace`)
  - Route-group audit: scan `apps/web/src/app/(*)/`, document `(public)/(authed)/(admin)` convention in `docs/conventions.md`; or eliminate vestigial groups
  - `apps/web/public/.gitkeep` committed (closes deferred-items #2 + STRUCT-06)
  - Closes STRUCT-01 execution + STRUCT-02 + STRUCT-04 + STRUCT-05 + STRUCT-06 + STRUCT-07

- **15-03** — FSL codemod + ADR + DCO + REUSE.toml + Helm chart-releaser
  - Author `docs/adrs/0013-fsl-relicense.md`
  - Replace root `LICENSE` (Apache-2.0 → FSL-1.1-ALv2)
  - Author `MIGRATING.md` with 7-day notice + recovery one-liners (short pointer; full runbook lives in ADR-0013)
  - Author `REUSE.toml` covering every SPDX-managed file pattern
  - Run `reuse annotate` / `reuse lint` codemod across every `.ts/.tsx/.js/.sh/.py/.sql/.yaml/.yml` file (~675 SPDX header rewrites)
  - Update every workspace `package.json` `license` field → `"FSL-1.1-ALv2"`
  - Update every Docker `LABEL org.opencontainers.image.licenses` → `"FSL-1.1-ALv2"`
  - Update root `README.md` license badge
  - Add `reuse lint` CI gate to `.github/workflows/ci.yml`
  - Add DCO requirement to `CONTRIBUTING.md` (`Signed-off-by:` required on every commit); DCO bot installed/configured with grandfather cutoff SHA placeholder (filled in 15-04 once new HEAD is known)
  - Retroactive consent thread: link from ADR-0013 to GitHub issue/PR with contributor sign-off
  - **STRUCT-03 — Helm location: Option 3** — Helm STAYS in monorepo at `charts/openwhispr/`; new `.github/workflows/chart-release.yml` using `helm/chart-releaser-action@v1` with `charts_dir: charts/` and tag prefix `chart-v*` (chart semver decoupled from server semver); publishes to gh-pages; ArtifactHub metadata file authored
  - Closes FSL-01..05 + STRUCT-03

- **15-04** — History scrub atomic event (SOLO terminal wave)
  - Pure runbook execution + scripts; no code-review reversibility expected
  - Authors `tools/history-scrub.sh` + `docs/runbooks/15-04-history-scrub.md` runbook
  - Executes the 10-step combined runbook from `15-RESEARCH-history-scrub.md`:
    1. Push pre-scrub annotated tag `pre-fsl-scrub-2026-05-15` (before any rewrite — preserves orphan reflog ~90 days)
    2. Post advisory issue T-24h (template in runbook)
    3. Lock branch protection on `main` via scripted `gh api`
    4. Fresh-clone + `git filter-repo --path speaches-audio.md --invert-paths --force` locally
    5. Sanity-check rewritten history (commit count delta, hash drift table)
    6. Force-push `main` (ONE force-push — PITFALLS §10)
    7. Force-push surviving tags (annotated tags re-anchored; signed tags re-signed manually)
    8. GHA cache flush: clear UI caches + bump `CACHE_VERSION` env in workflows
    9. Re-lock branch protection
    10. Post advisory issue T+15min + update MIGRATING.md with new HEAD SHA + DCO bot cutoff SHA
  - Closes FSL-06 + FSL-07

**Plan-ordering DAG (strict sequential — NO parallel waves):**
`15-01 → 15-02 → 15-03 → 15-04`

Rationale: each plan depends on outputs of the prior. 15-02 needs inventory from 15-01. 15-03 codemod writes SPDX headers against final paths from 15-02. 15-04 force-push needs 15-03's relicense already merged.

### Q2 — STRUCT-03 Helm location: **Option 3 (monorepo + chart-releaser-action)**

- `charts/openwhispr/` stays where it is.
- New `.github/workflows/chart-release.yml` uses `helm/chart-releaser-action@v1` with `charts_dir: charts/`.
- Tag prefix `chart-v*` for chart releases (decoupled from server `v*` tags).
- ArtifactHub metadata in `charts/openwhispr/artifacthub-repo.yml`.
- Compose-Chart parity gate (`tools/lint-compose-chart-parity.ts`) stays intact — single-repo invariant preserved.
- Honors user-global rule "НЕ СОЗДАВАТЬ ОТДЕЛЬНЫЕ ПРОЕКТЫ".

### Q3 — History scrub atomic mechanics: **Combined runbook locked**

Sub-decisions:

- **Order:** FSL codemod via normal PRs FIRST (15-03), then scrub as the single force-push event (15-04). Matches Homebrew/Rails precedent + PITFALLS §10 "ONE force-push".
- **Window:** Approach α — lock → local `git filter-repo` → force-push → unlock (~7 min lock window, scripted via `gh api`). Small-team OSS context makes multi-day freeze overkill; PR-on-rewritten-history makes diffs unreadable.
- **Recovery docs:** BOTH — short pointer + one-liner in `MIGRATING.md` (FSL-01); full runbook + recovery recipe in `docs/adrs/0013-fsl-relicense.md`.
- **DCO:** new commits only; DCO bot grandfather cutoff = post-scrub HEAD SHA. Retroactive `Signed-off-by:` backfill REJECTED (misrepresents original committer attestations).
- Pre-scrub tag `pre-fsl-scrub-2026-05-15` pushed BEFORE `filter-repo` runs (preserves orphan reflog).
- GHA cache flush: clear UI caches + bump `CACHE_VERSION` env in workflows.
- Advisory issue T-24h + T+15min.

### Q4 — Test-layout migration: **Option A (big-bang codemod, co-landed in 15-02)**

- `tools/migrate-tests.ts` ts-morph codemod:
  - Moves `apps/<app>/src/**/*.test.ts` → `apps/<app>/tests/unit/<mirror-of-src-path>.test.ts`
  - Moves `apps/<app>/src/**/__tests__/<file>` → `apps/<app>/tests/unit/<...>/__tests__/<file>` (preserve harness dir shape)
  - Moves `packages/<pkg>/src/**/*.test.ts` → `packages/<pkg>/tests/unit/<...>.test.ts` (uniform — no apps/packages split per Q4 rejection of Option D)
  - Rewrites relative imports in moved test files via ts-morph (NOT regex)
  - Updates each `vitest.config.ts` `include` pattern to `tests/**/*.test.ts`
  - Adopts Vitest 3.2+ `projects` config (replaces deprecated `workspace`)
- 15-01 pre-flight runs the codemod in `--dry-run` mode → commits `Phase15-MOVE-INVENTORY.md` (the resulting move table)
- 15-02 executes the real move
- Coverage gate operates on diff — pure path moves should be 0-diff for coverage (just file relocations + import rewrites)

**Out of scope for test-layout:**
- `tools/load-test/src/**/*.test.ts` — stays co-located (load-test is dev tooling, not an app or library; convention exemption documented)
- `tests/e2e/`, `tests/e2e-cjm/`, `tests/conformance/ui-spec/`, `tests/infra/` — stay at root (per ROADMAP)

</decisions>

<deferred>

Captured during discussion; NOT in Phase 15 scope:

1. Signed tag re-signing automation — manual one-shot in 15-04 runbook for v2; automate in Phase 18+ if multiple history rewrites accrue
2. Cross-repo Compose-Chart sync (if STRUCT-03 ever flips to Option 2 in v3) — not relevant unless Helm extracted
3. `tools/lint-compose-chart-parity.ts` cross-overlay extension (today checks base compose; could check all 6 overlays) — orthogonal hygiene improvement
4. `tools/load-test/` test-layout migration to `tools/load-test/tests/unit/` — exempted in v2; can revisit in v3 if dev-tooling layout becomes contentious
5. Per-package ESLint rule packaging (today the rule lives in root config) — refactor into shared `@openwhispr/eslint-config` package later
6. ArtifactHub badge in README — nice-to-have once first chart release publishes; not v2 scope
7. cert-manager Helm sub-chart wiring — Phase 17 territory (`ingress.enabled` already authored in Phase 14)

</deferred>

<scope_guardrail>

**Phase 15 boundary is FIXED by ROADMAP.md:**
- IN scope: STRUCT-01..07, FSL-01..07 — exactly 14 requirements
- OUT of scope (other phases): Phase 16 comment audit, Phase 17 TLS/ACME, Phase 18 SSO SPEC, any new feature, any compose-base service add/remove (Phase 14 closed that), any new Helm toggle (Phase 14 closed that)

User suggested no scope creep during discussion. All gray-area discussion stayed inside STRUCT/FSL boundaries.

</scope_guardrail>

<next_steps>

1. `/gsd-plan-phase 15` — gsd-planner reads this CONTEXT.md + 4 RESEARCH-*.md files + REQUIREMENTS.md, produces 4 PLAN.md files (15-01 through 15-04) with task breakdowns, TDD wave structure, file-touch inventories, and PLAN-CHECK.md goal-backward verification.
2. `/gsd-execute-phase 15` — orchestrates plan execution with strict sequential ordering (15-01 → 15-02 → 15-03 → 15-04; NO parallel waves due to file conflicts + irreversibility).
3. `/gsd-verify-phase 15` — verifier checks every must-have observable truth + coverage ≥ 90/90/90/90 on diff + e2e green.
4. `/gsd-code-review` — full review pass on the 3 reviewable plans (15-01, 15-02, 15-03); 15-04 is a runbook execution event, not a code-review surface.

</next_steps>
