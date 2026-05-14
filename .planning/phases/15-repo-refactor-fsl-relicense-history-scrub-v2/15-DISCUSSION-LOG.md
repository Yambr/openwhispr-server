# Phase 15 — Discussion Log

**Date:** 2026-05-14
**Mode:** discuss (advisor-style; 4 parallel `gsd-advisor-researcher` agents)
**User pacing:** yolo — all 4 research recommendations accepted as-is

## Gray areas selected

User selected ALL four researched gray areas:
1. Sub-plan split granularity
2. STRUCT-03 Helm monorepo vs separate repo
3. History scrub atomic event mechanics
4. Test-layout migration strategy

Plus an embedded sub-decision in Q4: `vitest.config.ts` include patterns + Vitest 3.2 `projects` config migration.

## Questions asked and decisions made

### Q1. Sub-plan split granularity

**Options presented (after research):**
- A. 2 plans (roadmap default — 15.a struct / 15.b FSL+scrub)
- B. 4 plans (15-01 test-layout+inventory / 15-02 struct+Traefik / 15-03 FSL codemod+Helm / 15-04 scrub solo) — research recommendation
- C. 6 plans (max granular)
- D. 3 plans (struct-bulk / Traefik / FSL+scrub)

**User selected:** B.

**Rationale recorded:** Separates reviewable codemod (FSL) from irreversible runbook event (history scrub) — PITFALLS §10 "ONE force-push" constraint. 15-04 owns its atomic window. 15-01 cheap pre-flight surfacing path collisions before bulk reorg. C over-fragments natural boundaries; D bundles codemod + scrub again.

### Q2. STRUCT-03 Helm location

**Options presented (after research):**
- 1. Keep monorepo as-is (no release workflow)
- 2. Extract to separate `openwhispr-charts` repo (TD-15.d original proposal)
- 3. Monorepo + `helm/chart-releaser-action` (research recommendation)

**User selected:** 3.

**Rationale recorded:** `helm/chart-releaser-action` natively supports `charts_dir: charts/` — Helm-sanctioned, not a hack. Industry precedent: multi-chart orgs (Grafana, prometheus-community, Bitnami) use separate repos for 40+ charts; single-product projects (cert-manager, Traefik, CloudNativePG, Linkerd) keep their single chart in main repo. OpenWhispr is firmly the latter. Option 2 would destroy Phase 14 Compose-Chart parity gate and violate user-global "НЕ СОЗДАВАТЬ ОТДЕЛЬНЫЕ ПРОЕКТЫ". Chart semver decoupled via tag prefix `chart-v*`.

### Q3. History scrub atomic event mechanics

**Combined runbook accepted (4 sub-decisions):**

**Sub-A (order):** Order 2 — FSL codemod merged via normal PRs first (15-03), then scrub as the single force-push event (15-04). Homebrew/Rails precedent + PITFALLS §10.

**Sub-B (force-push window):** Approach α — lock → local filter-repo → push → unlock (~7 min, scripted `gh api`). Small-team OSS context; freeze overkill; PR-on-rewritten-history makes diffs unreadable.

**Sub-C (recovery docs):** BOTH — short pointer + one-liner in `MIGRATING.md` (FSL-01); full runbook + recovery recipe in `docs/adrs/0013-fsl-relicense.md`.

**Sub-D (DCO):** new commits only; DCO bot grandfather cutoff = post-scrub HEAD SHA. Retroactive `Signed-off-by:` backfill REJECTED — misrepresents original committer attestations.

**User selected:** all 4 sub-decisions accepted.

**Rationale recorded:** Combined runbook = 10 steps. Pre-scrub tag pushed BEFORE filter-repo (preserves orphan reflog ~90 days). GHA cache flush via UI + `CACHE_VERSION` bump. Advisory issue T-24h + T+15min. Lock window ~7 min minimizes contributor blockage.

### Q4. Test-layout migration strategy

**Options presented (after research):**
- A. Big-bang `git mv` codemod co-landed inside 15-02 (research recommendation)
- B. Phased per-app (4 PRs) — fallback only
- C. Strangler (new tests only) — rejected (fails STRUCT-01 intent)
- D. Hybrid apps-vs-packages — rejected (permanent two-rule tax)

**User selected:** A + the embedded bonus migration.

**Rationale recorded:** Matches `Phase15-MOVE-INVENTORY.md` shape (one inventory → one move). Coverage gate operates on diff — pure path moves are 0-diff for coverage. `tools/migrate-tests.ts` ts-morph codemod handles import rewrites precisely (NOT regex). Bonus: `vitest.config.ts` switches from default `**/*.{test,spec}.ts` to explicit `tests/**/*.test.ts`; adopts Vitest 3.2+ `projects` config (replaces deprecated `workspace`).

## Deferred ideas

1. Signed tag re-signing automation — manual one-shot in 15-04 runbook for v2
2. Cross-repo Compose-Chart sync (only if STRUCT-03 ever flips to Option 2 in v3) — not relevant unless Helm extracted
3. `tools/lint-compose-chart-parity.ts` cross-overlay extension — orthogonal hygiene
4. `tools/load-test/` test-layout migration — exempted in v2
5. Per-package ESLint rule packaging — future shared config
6. ArtifactHub README badge — once first chart release publishes
7. cert-manager Helm sub-chart wiring — Phase 17 territory

## Research artifacts

- `15-RESEARCH-subplan-split.md` (Option B locked)
- `15-RESEARCH-helm-location.md` (Option 3 locked)
- `15-RESEARCH-history-scrub.md` (combined runbook locked)
- `15-RESEARCH-test-layout.md` (Option A + Vitest 3.2 projects bonus locked)

## Claude's discretion items (no user input requested)

- Strict sequential plan ordering (no parallel waves) — file conflicts + irreversibility forbid parallelism
- 15-04 documented as runbook-event plan (not subject to standard code-review gate)
- Pre-scrub tag name `pre-fsl-scrub-2026-05-15` (matches today's date)
- `tools/load-test/` exempted from test-layout migration (dev tooling, not app/library)
- `apps/web/tests/` is already partially aligned with new convention — codemod handles delta
- Chart tag prefix `chart-v*` (decouples chart semver from server semver)
- DCO bot cutoff SHA = filled in 15-04 once new HEAD is known (placeholder authored in 15-03)
