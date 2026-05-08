# Phase 0: Repo Bootstrap & Constitutional CI — Research

**Researched:** 2026-05-08
**Domain:** Monorepo bootstrap, GitHub Actions CI, lint/test/coverage/mutation/security harness, English-only enforcement
**Confidence:** HIGH (all primary versions verified live against the npm registry on 2026-05-08; GitHub Actions and external action versions verified via web search)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Repository layout (monorepo)**
- **D-01:** Single git repo, **pnpm workspaces** monorepo. Top-level `apps/` and `packages/`. Initial workspaces: `apps/api/` (Fastify server placeholder), `packages/contract-tests/` (CONTRACT-01 harness shell), `packages/i18n/` (locale resources placeholder, en+ru). Frontend workspace deferred to Phase 7.
- **D-02:** Package manager: **pnpm** (10.x — see §Standard Stack version-bump note). Reasons: workspace support is first-class, lockfile is deterministic, install is faster than npm/yarn for monorepos, and Trivy/Dependabot both speak the format.
- **D-03:** Node engine pinned to **24.x** in every `package.json` and in `.nvmrc` / `.tool-versions`.
- **D-04:** TypeScript **strict** mode everywhere. Single root `tsconfig.base.json` extended by each workspace.
- **D-05:** Build tooling: **tsup** for the API server (fast esbuild-backed, zero-config TS bundler suitable for Node services).

**Tooling**
- **D-06:** Linter: **Biome 2.x** (combined lint + format, single config).
- **D-07:** Test runner: **Vitest 2.x** for unit + integration. (NOTE — see version-bump section: Vitest 4.x is current stable as of 2026-05-08.)
- **D-08:** E2E test runner: **Playwright 1.x**.
- **D-09:** Contract test runner: **Vitest** (separate `packages/contract-tests/` workspace).
- **D-10:** Load test runner: **k6** invoked from CI; nightly schedule + manual trigger.
- **D-11:** Mutation testing: **Stryker Mutator 8.x** (StrykerJS). (NOTE — Stryker 9.6.1 is current stable.)
- **D-12:** Coverage gate: **v8 native coverage** via Vitest with thresholds enforced in `vitest.config.ts` (`lines: 85, branches: 80`).

**CI workflows**
- **D-13:** `ci.yml` — primary PR workflow on `ubuntu-24.04` GitHub-hosted runners. Concurrency-cancel on PR push.
- **D-14:** `security.yml` — gitleaks, Trivy fs + container, CodeQL JS/TS, license scan.
- **D-15:** `nightly.yml` — k6 (placeholder), full Stryker, dep-update audit.
- **D-16:** `release.yml` — placeholder, wired in Phase 9.
- **D-17:** Dependabot weekly grouped npm + actions.

**English-only enforcement**
- **D-18:** Custom mechanism (Biome plugin or standalone `tools/lint-english.ts` script) failing on Cyrillic in `.ts/.tsx/.json/.md/.yaml/.yml` outside `packages/i18n/locales/ru/**` and `tests/fixtures/i18n/**`; commitlint rule for messages; identifier names ASCII-only.
- **D-19:** Allowlist for `packages/i18n/locales/<locale>/`.

**TDD enforcement**
- **D-20:** PR template (`.github/pull_request_template.md`) with required tests-first checkboxes; CI parses PR body and fails on unchecked.
- **D-21:** Optional `tools/lint-tdd.ts` heuristic (advisory in v1) flagging production-code commits before any test commit.

**Branch protection**
- **D-22:** `main` protected via repo settings; reproducible via `scripts/setup-branch-protection.sh`.

**Local dev**
- **D-23:** Top-level `Makefile`. Phase 0 implements: `dev`, `test`, `lint`, `format`, `typecheck`, `up`, `down`, `clean`. Other targets are stubs that fail with a phase-N pointer.
- **D-24:** Skeleton `docker-compose.yml` with placeholder services so `make up` succeeds.

**Licensing**
- **D-25:** **Apache-2.0** license (root `LICENSE` already in repo).
- **D-26:** `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` — minimal stubs.
- **D-27:** Conventional Commits enforced via commitlint + Husky/Lefthook.

### Claude's Discretion

- Exact pnpm/Node/Vitest/Biome/Stryker minor versions — pick latest stable as of phase execution.
- Specific Trivy / gitleaks / CodeQL action versions — pick official latest.
- **Husky vs Lefthook** — pick the simpler one (lefthook leans simpler in 2026). **Recommendation below: Lefthook.**
- **English-only checker as Biome plugin or standalone CI script** — pick whichever is less brittle. **Recommendation below: standalone `tools/lint-english.ts` script.**
- **Pre-create `packages/auth/`, `packages/data/`, `packages/litellm-client/` skeletons** — recommendation below: **YES**, create them with placeholder `index.ts` so Stryker has real targets.

### Deferred Ideas (OUT OF SCOPE)

- Self-hosted GPU runners (Phase 8).
- Renovate (Dependabot is enough for v1).
- Codecov / Coveralls integration (v1 uses native GHA artifacts + PR comment).
- semantic-release / changesets (Phase 9 decides).
- Custom GHA composite actions (defer to mid-phases when duplication emerges).
- Documentation site (Phase 10).
- `.devcontainer/` for Codespaces (v1.5).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TDD-01 | Strict TDD; PR template enforces "tests first" checklist | §`Architecture Patterns / PR Template + checkbox enforcement`, §`Code Examples / pull_request_template.md`, §`Code Examples / require-checklist job` |
| TDD-02 | Test layers: unit + integration + e2e + contract + load + security + migration + i18n + RLS-property | §`Standard Stack` (Vitest, Playwright, k6, testcontainers ref); harness wiring covered in §`Architecture Patterns / Workspace layout`. Phase 0 stands up the harnesses; later phases populate test types. |
| CI-01 | GitHub Actions CI from day one; workflows in `.github/workflows/`; GitHub-hosted runners | §`Architecture Patterns / Workflow design`, §`Code Examples / ci.yml skeleton` |
| CI-02 | CI matrix: lint + typecheck + unit + integration + e2e + contract + license-scan + secrets-scan + dep-scan + SAST + container-scan | §`Architecture Patterns / Job dependency graph`, §`Code Examples / security.yml` |
| CI-03 | Branch protection on `main` blocks merge unless required checks green | §`Architecture Patterns / Branch protection as code`, §`Code Examples / setup-branch-protection.sh` |
| TEST-COV-01 | Coverage gate ≥ 85% lines / ≥ 80% branches; enforced in CI | §`Code Examples / vitest.config.ts thresholds` (note: Vitest 4 moved keys under `coverage.thresholds`) |
| TEST-MUTATION-01 | Stryker mutation testing on critical modules; PR fails on score regression | §`Code Examples / stryker.config.json`, §`Architecture Patterns / Stryker harness against placeholder modules` |
| DEVEX-01 | One-command local dev (`make dev`) brings up full stack with seeded data; `make test` runs full suite; tested in CI | §`Code Examples / Makefile`, §`Validation Architecture / "make dev" smoke check` |
| DOCS-09 | All source artifacts in English only — hard rule, enforced by lint where mechanical | §`Architecture Patterns / English-only enforcement`, §`Code Examples / lint-english.ts`, §`Validation Architecture / Cyrillic-injection self-test` |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

The user's global `~/.claude/CLAUDE.md` enforces:

1. **Никогда не упрощать задачи / no mocks** — ⚠️ this is a **CYRILLIC** directive at the user-instruction layer that is OUTSIDE the source-artifact scope of DOCS-09. DOCS-09 governs **what we commit to the repo** (code, comments, commit messages, identifiers, log keys, docs). User instructions to Claude are a separate channel and are not part of "source artifacts." The English-only lint must NOT scan `~/.claude/`, `.claude/local/`, or session transcripts. The lint scope is the repo working tree minus the i18n locale allowlist.
2. **Не создавать отдельные проекты** — work in the existing repo structure. Phase 0 is the repo-creation phase, so this rule's spirit translates to: do not spawn parallel tooling repos; everything lives in this monorepo.
3. **Не использовать моки** — for production wiring. Phase 0 explicitly creates **placeholder modules** (the only mocks permitted) because there is no real code yet; every later phase must replace those placeholders with real implementations.
4. **Не игнорировать docker-compose** — Phase 0 creates the skeleton `docker-compose.yml` (D-24); every later phase adds services to it.

The planner MUST verify every Phase 0 task respects these directives.

## Summary

Phase 0 is pure **scaffolding-as-enforcement**: the repo skeleton, tooling, GitHub Actions workflows, lint/test/coverage/mutation/security harnesses, PR template, Makefile, and `docker-compose.yml` placeholder. **No production code** beyond placeholder `index.ts` modules wired into the test harness so Stryker has real targets.

The constitutional disciplines (TDD via PR template, GHA CI, max-test-automation, English-only source) must be **CI-enforced from commit #1** — there is no second chance to bolt them on later.

**Three load-bearing version corrections** vs. CONTEXT.md (which was written from training-era assumptions):

1. **pnpm 11.x** is current (CONTEXT said 10.x). [VERIFIED: npm view pnpm version → 11.0.8 on 2026-05-07]
2. **Vitest 4.x** is current (CONTEXT said 2.x). The threshold config keys moved under `coverage.thresholds.{lines,branches}` in v4 — material change. [VERIFIED: npm view vitest version → 4.1.5; CITED: vitest.dev/config/coverage]
3. **StrykerJS 9.x** is current (CONTEXT said 8.x). [VERIFIED: npm view @stryker-mutator/core version → 9.6.1]

These bumps are within the spirit of CONTEXT's "pick latest stable as of phase execution date" discretion. The planner should propose them in PR #1 explicitly so the operator confirms.

**Primary recommendation:** Proceed exactly as CONTEXT.md decides, using the verified-current versions in §Standard Stack. Pick **Lefthook** over Husky for git hooks. Implement English-only as a **standalone `tools/lint-english.ts`** Node script (run from both Lefthook pre-commit and a CI step) — Biome 2 GritQL plugins can match regex against text content, but the diagnostic UX, allowlist handling, and CI ergonomics are simpler in a 30-line TS script. Pre-create `packages/auth/`, `packages/data/`, `packages/litellm-client/` workspace skeletons so Stryker has non-trivial mutation targets.

## Standard Stack

### Core (verified live against npm registry on 2026-05-08)

| Library | Version | Purpose | Why Standard | Source |
|---------|---------|---------|--------------|--------|
| `pnpm` | **11.0.8** | Package manager | Workspaces first-class; lockfile deterministic; faster than npm/yarn at monorepo scale. dist-tag `latest`. | [VERIFIED: npm view pnpm dist-tags] |
| `node` | **24.x LTS** (engine pin) | Runtime | Active LTS through Apr 2027; Node 20 EOL Apr 2026. | [CITED: Node.js release schedule, STACK.md] |
| `typescript` | **6.0.3** | Compiler | Latest stable; TS 6 GA in 2026. ⚠️ **Bump from CONTEXT's "5.x".** | [VERIFIED: npm view typescript dist-tags → latest:6.0.3] |
| `@types/node` | **25.6.2** | Node 24 typings | Matches Node 24 surface. | [VERIFIED: npm view @types/node version] |
| `@biomejs/biome` | **2.4.14** | Lint + format | Single config replaces ESLint+Prettier; ~15× faster; GritQL custom-rule plugins (used by other repos, not chosen here for Cyrillic — see Architecture). | [VERIFIED: npm view @biomejs/biome version] |
| `vitest` | **4.1.5** | Unit + integration test runner | Native TS/ESM; v8 coverage built-in; the same runner Vite-based frontend will use later. ⚠️ **Bump from CONTEXT's "2.x"; threshold config keys moved.** | [VERIFIED: npm view vitest version] |
| `@vitest/coverage-v8` | **4.1.5** | v8 coverage provider for Vitest | Match Vitest major. | [VERIFIED: npm view @vitest/coverage-v8 version] |
| `@playwright/test` | **1.59.1** | E2E test runner | Industry default; will run against ephemeral docker-compose stack starting Phase 2. | [VERIFIED: npm view @playwright/test version] |
| `@stryker-mutator/core` | **9.6.1** | Mutation testing core | Stryker 9 is current. ⚠️ **Bump from CONTEXT's "8.x".** | [VERIFIED: npm view @stryker-mutator/core version] |
| `@stryker-mutator/vitest-runner` | **9.6.1** | Stryker ↔ Vitest bridge | Same major as core; Vitest support stable since Stryker 7. | [VERIFIED: npm view @stryker-mutator/vitest-runner version; CITED: stryker-mutator.io/blog/announcing-stryker-js-7] |
| `tsup` | **8.5.1** | TS → JS bundler for the Fastify API | esbuild-backed; zero-config; trusted by 2026 Node-service projects. | [VERIFIED: npm view tsup version] |
| `lefthook` | **2.1.6** | Git hooks (pre-commit, commit-msg) | Single static binary; YAML config; faster than Husky shell wrappers. **Recommended over Husky** (Husky 9.1.7 has been static since Jan 2025; Lefthook is being actively pushed in 2026). | [VERIFIED: npm view lefthook version] |
| `@commitlint/cli` | **21.0.0** | Commit message linter | Industry default for Conventional Commits. | [VERIFIED: npm view @commitlint/cli version] |
| `@commitlint/config-conventional` | **21.0.0** | Conventional Commits preset | Pairs with v21 cli. | [VERIFIED: npm view @commitlint/config-conventional version] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `husky` | 9.1.7 | Alternative git hooks | Use only if team has prior Husky muscle memory. **Not recommended.** [VERIFIED: npm view husky version] |
| `cross-env` | latest | Cross-platform env vars in npm scripts | If Makefile target spawns pnpm script with env on Windows-friendly clones — likely not needed since CI is Linux-only and dev is mac/linux per STACK. |
| `tsx` | latest | Run TS files directly (e.g. `tsx tools/lint-english.ts`) | Used by the English-only and TDD-heuristic scripts. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Lefthook | Husky 9 | Husky is the legacy mainstream; shell-based hooks; release cadence has slowed. Pick if contributor pool already knows Husky workflows. |
| Standalone `tools/lint-english.ts` | Biome 2 GritQL plugin (`.grit` file with regex `r"[Ѐ-ӿ]"`) | GritQL plugins are first-class in Biome 2.x and can match text content. Tradeoff: weaker error messaging, harder to allowlist directories, harder to invoke standalone for the Cyrillic-injection self-test. The TS script wins on UX and self-testability. |
| Vitest 4 | Vitest 3.x | v3 is supported but EOL is closer; v4 is the current stable. |
| Stryker 9 | Stryker 8.15.9 (`latest-8` tag) | Stryker 8 still exists on a maintenance dist-tag. Use only if a peer-dep blocks 9. None expected here. |
| pnpm 11 | pnpm 10.33.4 | pnpm 10 is still supported; lockfile bumps once on 11 upgrade. v11 is the current `latest`. |

### Installation (the canonical PR #1 install)

```bash
# Manage Node 24 outside package.json (Volta / fnm / nvm via .nvmrc)
echo "24" > .nvmrc

# Install pnpm via corepack (preferred — pinned in package.json)
corepack enable
corepack prepare pnpm@11.0.8 --activate

# Root devDependencies
pnpm add -D -w \
  typescript@6.0.3 \
  @types/node@25.6.2 \
  @biomejs/biome@2.4.14 \
  vitest@4.1.5 \
  @vitest/coverage-v8@4.1.5 \
  @playwright/test@1.59.1 \
  @stryker-mutator/core@9.6.1 \
  @stryker-mutator/vitest-runner@9.6.1 \
  tsup@8.5.1 \
  lefthook@2.1.6 \
  @commitlint/cli@21.0.0 \
  @commitlint/config-conventional@21.0.0 \
  tsx
```

**Version verification command (CI guard):** add a tiny preflight in `ci.yml` that runs `pnpm ls --depth=-1 --json` and asserts no `mismatched` entries against `packageManager` field — protects against accidental version drift across workspaces.

## Architecture Patterns

### Recommended Project Structure

```
openwhispr-server/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # PR matrix: lint + typecheck + unit + cov + mutation-quick
│   │   ├── security.yml        # gitleaks + trivy + codeql + license + container scan
│   │   ├── nightly.yml         # k6 placeholder + full Stryker + dep audit
│   │   └── release.yml         # Phase 9 placeholder
│   ├── pull_request_template.md
│   ├── dependabot.yml
│   └── CODEOWNERS              # optional, can defer
├── apps/
│   └── api/                    # Fastify placeholder workspace
│       ├── src/placeholder.ts  # exports a trivial pure fn used by Stryker
│       ├── tests/placeholder.test.ts
│       ├── package.json
│       ├── tsconfig.json
│       └── vitest.config.ts
├── packages/
│   ├── auth/                   # skeleton — placeholder index.ts
│   ├── data/                   # skeleton — placeholder index.ts
│   ├── litellm-client/         # skeleton — placeholder index.ts
│   ├── contract-tests/         # CONTRACT-01 harness shell
│   │   ├── src/index.ts        # empty harness; tagged tests added Phase 2+
│   │   └── package.json
│   └── i18n/                   # locale resources placeholder
│       ├── locales/
│       │   ├── en/common.json
│       │   └── ru/common.json   # ⚠️ Cyrillic ALLOWED here only
│       └── package.json
├── tools/
│   ├── lint-english.ts         # Cyrillic ban scanner
│   ├── lint-tdd.ts             # advisory commit-order heuristic
│   └── verify-pr-checklist.ts  # PR template checkbox enforcer (alt: mheap action)
├── tests/
│   ├── fixtures/i18n/          # ⚠️ Cyrillic ALLOWED here only
│   ├── load/                   # k6 scripts (placeholder in Phase 0)
│   └── self/                   # CI self-tests (e.g. Cyrillic-injection)
├── scripts/
│   └── setup-branch-protection.sh
├── biome.json
├── stryker.config.json
├── vitest.config.ts            # root — covers all workspaces
├── lefthook.yml
├── commitlint.config.cjs
├── tsconfig.base.json
├── package.json                # root with pnpm workspaces + packageManager
├── pnpm-workspace.yaml
├── docker-compose.yml          # placeholder services
├── Makefile
├── .nvmrc
├── .tool-versions
├── .gitignore
├── LICENSE                      # already present (Apache-2.0)
├── CONTRIBUTING.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
└── README.md
```

### Pattern 1: Workspace skeletons exist so Stryker has targets (Discretion: YES)

**What:** Pre-create `packages/auth/`, `packages/data/`, `packages/litellm-client/` with placeholder `index.ts` and a passing test.

**When to use:** Phase 0 only — once Phase 1/2/3 land real code, the placeholders are replaced (not deleted-and-recreated).

**Why:** Stryker's `mutate` glob targets `packages/{auth,data,litellm-client}/src/**/*.ts` from PR #1. If those workspaces don't exist yet, Stryker fails or produces empty reports. Pre-creating them with one trivial pure function and one test gives the harness a real target to mutate, proving end-to-end that the workflow works. When Phase 2 brings real auth code, mutation testing is already wired and only the placeholder content changes.

**Example placeholder:**

```typescript
// packages/auth/src/index.ts
// Phase 0 placeholder — replaced by real Better Auth wiring in Phase 2
export function isPlaceholder(): boolean {
  return true;
}
// packages/auth/src/index.test.ts
import { describe, expect, it } from 'vitest';
import { isPlaceholder } from './index.js';
describe('auth placeholder', () => {
  it('returns true', () => { expect(isPlaceholder()).toBe(true); });
});
```

### Pattern 2: GitHub Actions workflow design

**Job dependency graph (`ci.yml`):**

```
                              ┌─→ unit+coverage ─┐
checkout → setup → install ──→ ├─→ typecheck    ─┤→ coverage-gate → comment-on-pr
                              │ ├─→ lint+format ─┤
                              │ └─→ mutation-quick (incremental on PR diff only)
                              └─→ pr-checklist (parses PR body)

(security.yml runs in parallel as a separate workflow — gitleaks, trivy, codeql, license)
```

**Concrete decisions:**

| Concern | Decision | Source |
|---------|----------|--------|
| Runners | `ubuntu-24.04` only in v1. macOS/Windows runners cost 10×/2× more credits per minute and Phase 0 has zero macOS-specific code. | [CITED: GitHub-hosted runners pricing] |
| Action pinning | Pin to **immutable commit SHAs** for **third-party** actions (`gitleaks/`, `aquasecurity/`, `wagoid/`, `davelosert/`, `mheap/`); pin to **major version tag** (`@v5`) for **first-party GitHub** actions (`actions/`, `github/`). Rationale: the Trivy supply-chain attack of 2026-03-19 force-pushed 76 of 77 version tags; SHAs survived because they're immutable. [CITED: stepsecurity.io blog on Trivy compromise; thehackernews.com 2026/03] |
| Concurrency | `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }` on PR workflows so a force-push cancels the in-flight run. |
| pnpm install order | `pnpm/action-setup@v4` MUST run **before** `actions/setup-node@v5` if you want `cache: 'pnpm'` on setup-node. setup-node looks for the pnpm binary to compute the cache key. **Common gotcha.** [CITED: pnpm.io/continuous-integration] |
| Caching | (a) `setup-node` with `cache: 'pnpm'` for the pnpm store; (b) Vitest cache via `actions/cache@v4` keyed on `pnpm-lock.yaml` hash + `vitest.config.ts` hash; (c) Stryker incremental file via `actions/cache@v4` keyed on `pnpm-lock.yaml` hash (commit the file *too* per docs). [CITED: stryker-mutator.io/docs/stryker-js/incremental] |
| Coverage PR comment | `davelosert/vitest-coverage-report-action@v2` (latest v2.8.3, 2026-05-19) — reads vitest's `coverage/coverage-summary.json` and posts a sticky PR comment with thresholds. [CITED: github.com/davelosert/vitest-coverage-report-action] |
| Required `permissions` | Each job sets the minimum: `contents: read`, `pull-requests: write` (for coverage comment), `security-events: write` (for CodeQL/Trivy SARIF upload), `id-token: write` only if OIDC needed (not in Phase 0). |
| Service containers | Phase 0 uses **none**. Postgres/Redis testcontainers arrive Phase 1. The skeleton `docker-compose.yml` is for local `make up` only; CI doesn't compose-up in Phase 0. |
| Matrix | Single-cell matrix on `ubuntu-24.04` × Node `24.x`. Resist the urge to fan out — every cell costs minutes. |

### Pattern 3: English-only enforcement (Discretion: standalone TS script)

**Decision:** A 30-line `tools/lint-english.ts` script run from (a) Lefthook pre-commit (fast local feedback) and (b) a `lint-english` job in `ci.yml` (mechanical enforcement). Do **NOT** use a Biome GritQL plugin.

**Rationale:**

- Biome 2 GritQL **can** match text via `r"[Ѐ-ӿ]"` regex syntax [CITED: biomejs.dev/reference/gritql, biomejs.dev/recipes/gritql-plugins]. But:
  - GritQL operates on AST nodes; for a *file-level* exclusion list (`packages/i18n/locales/ru/**`), you have to use Biome's `overrides` block to set `linter.enabled: false`. There is a known regression bug in Biome 2.3.9+ where GritQL plugins ignore `linter.enabled: false` in overrides. [CITED: github.com/biomejs/biome/issues/8522]
  - Diagnostic UX is line-level only; a TS script can produce `file:line:col` cleanly.
  - The script can ALSO be invoked from the Cyrillic-injection self-test (§Validation Architecture).
  - The script is more portable — can scan `.md`, `.yaml`, `.yml` which Biome doesn't lint by default.

**What the script bans:**

- Cyrillic codepoints: U+0400–U+04FF (basic block) and U+0500–U+052F (supplement). Range covers Russian + Belarusian + Ukrainian + Kazakh etc.
- Scope: `**/*.{ts,tsx,js,jsx,json,md,mdx,yaml,yml,cjs,mjs}`.
- Allowlist (do not scan): `packages/i18n/locales/**`, `tests/fixtures/i18n/**`, `node_modules/**`, `dist/**`, `.git/**`, `coverage/**`, `.stryker-tmp/**`.

**Commit-message scope:** Cyrillic in commit messages is banned by a custom commitlint rule (or by reusing the same regex via a tiny commitlint plugin in `commitlint.config.cjs`). `commitlint-plugin-no-cyrillic` does NOT exist as a published package as of 2026-05-08 [VERIFIED: WebSearch + npm view]. Implement inline in `commitlint.config.cjs` — see §Code Examples.

### Pattern 4: TDD enforcement (PR template + heuristic)

**v1 mechanism (blocking):** PR template checkboxes; CI parses PR body and fails on unchecked.

- **Action:** `mheap/require-checklist-action@v2` (latest, well-maintained 2026). Pin to commit SHA. Reads PR body, fails if any unchecked `- [ ]` remains. Supports `skipDescriptionRegex` to allow optional checkboxes. [CITED: github.com/mheap/require-checklist-action]
- Alternative: `marocchino/checklist-action`. Less popular.
- DIY alternative: a 50-line `tools/verify-pr-checklist.ts` invoked via `actions/github-script@v7` — more control, no third-party dependency. **Recommendation: use mheap action pinned to SHA; if it ever stops being maintained the DIY fallback is straightforward.**

**v1 mechanism (advisory):** `tools/lint-tdd.ts` runs in `ci.yml` as `continue-on-error: true`; uses `actions/github-script@v7` to fetch PR commits + diffs and posts an annotation when production-code commits land before any test commit in the same PR. Promote to blocking later (probably Phase 2 once the contract harness exists).

### Pattern 5: Stryker against placeholder modules

**Wiring:**

- `mutate` glob targets `{apps/api,packages/auth,packages/data,packages/litellm-client}/src/**/*.ts` excluding `**/*.test.ts` and `**/*.spec.ts`.
- `testRunner: 'vitest'`, `vitest: { configFile: 'vitest.config.ts' }`.
- `incremental: true`, `incrementalFile: 'reports/stryker-incremental.json'` — commit the file (per Stryker docs) so PR builds reuse the cache. [CITED: stryker-mutator.io/docs/stryker-js/incremental]
- `thresholds: { high: 80, low: 60, break: 50 }` — break threshold causes CI to fail. Phase 0 with placeholder modules will hit 100% mutation score trivially (placeholders are pure boolean returns), proving the harness works. Real thresholds tighten Phase 2+.
- **PR-scoped run** in `ci.yml` (mutation-quick): `--since main` with `vitest`'s `related` flag so only mutated files relevant to changed code run.
- **Full run** in `nightly.yml`: full mutation test, no `since`.

### Pattern 6: Vitest coverage gate (TEST-COV-01)

⚠️ **Vitest 4 breaking change vs. CONTEXT.md assumption:** the threshold config keys moved under `coverage.thresholds.*`. CONTEXT.md says "lines: 85, branches: 80" — exact intent retained, exact path different.

```typescript
// vitest.config.ts (root)
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json', 'lcov'], // json-summary REQUIRED for davelosert action
      include: ['apps/**/src/**/*.ts', 'packages/**/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.gen.ts',          // generated code excluded per spec
        '**/dist/**',
        '**/node_modules/**',
      ],
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 80,
        statements: 85,
      },
    },
  },
});
```

When thresholds aren't met, `vitest run --coverage` exits non-zero — CI fails automatically. [CITED: vitest.dev/config/coverage]

### Pattern 7: Branch protection as code (D-22)

**The honest truth:** GitHub does not have native IaC for branch protection. The mainstream 2026 approach is a `gh` CLI script committed to the repo and run **once by a human operator** with an admin PAT after fork:

```bash
# scripts/setup-branch-protection.sh
gh api -X PUT "repos/${OWNER}/${REPO}/branches/main/protection" \
  --input scripts/branch-protection.json
```

Where `branch-protection.json` enumerates the required check names. This IS reproducible (scripted, version-controlled) but NOT auto-applied — operator must run after fork. Document in `docs/operations.md`.

(Tools like Terraform's `github_branch_protection` resource exist; overkill for Phase 0.)

### Anti-Patterns to Avoid

- **Generic `actions/checkout@v4` then forgetting `fetch-depth: 0`** for jobs that need full history (Stryker incremental, commitlint, lint-tdd heuristic).
- **Running `pnpm install --frozen-lockfile` after a manual `pnpm add`** in CI — defeats lockfile guarantee. Always commit lockfile changes.
- **Putting the Cyrillic check inside Biome only** — see Pattern 3 rationale.
- **Using `husky install` from `package.json` `prepare` script in CI** — wastes seconds on every install. Lefthook auto-installs on first run; gate it with `if [ -z "$CI" ]`.
- **CI matrix on macOS in Phase 0** — burns minutes for zero value.
- **Pinning `actions/setup-node@latest` or `aquasecurity/trivy-action@v0`** — floating major tags are not immutable; the Trivy 2026 incident force-pushed all v0.x tags. Use SHAs for third-party.
- **Forgetting `permissions:` block at top of workflow** — workflows inherit broad write tokens by default; restrict to least privilege.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Lint config + format | Custom ESLint+Prettier setup | **Biome 2.4.14** | One config, one binary, ~15× faster, fewer plugin pin updates. |
| Coverage tool | Self-rolled c8/nyc wrapper | **`@vitest/coverage-v8` 4.1.5** | Threshold enforcement + reporter integration ship in the box. |
| Mutation testing harness | Hand-rolled mutator | **Stryker 9.6.1** | Operator burden of maintaining custom mutation operators is enormous; Stryker has TS support, Vitest runner, incremental mode. |
| Conventional Commits validator | Regex in pre-commit hook | **commitlint 21.0.0 + config-conventional** | Handles edge cases (footers, breaking-change markers, scopes). |
| Coverage PR comment | Custom GHA script | **davelosert/vitest-coverage-report-action@v2** | Sticky comment, threshold-aware, well-maintained. |
| Secret scanning | Regex grep in CI | **gitleaks-action@v2** | Curated rules, false-positive allowlist, baselines. |
| SAST | Custom AST scanner | **github/codeql-action@v4** | Free for public repos; query packs for JS/TS; SARIF integration with the Security tab. |
| License compliance | Manual NOTICE upkeep | **erisu/license-checker-action** (or `license-checker-rseidelsohn` directly) | Configurable allow/deny lists; CI gate. |
| Dep update bot | Cron + script | **Dependabot** (native GitHub) | Free, weekly cadence, grouped updates, security PRs auto-prioritized. |
| Git hooks | Shell scripts in `.git/hooks/` | **Lefthook 2.1.6** | Repo-versioned `lefthook.yml`, parallel hook execution, no Husky shim layer. |
| PR checklist enforcement | `if grep -q "[ ]"` in workflow | **mheap/require-checklist-action@v2** | Handles strikethrough, optional items, multi-checklist sections. |

**Key insight:** The CI-as-constitution discipline depends on every check being mechanical and unambiguous. Hand-rolled equivalents drift, accumulate special cases, and erode the constitutional discipline within ~6 months. Pick boring, off-the-shelf tooling.

## Common Pitfalls

### Pitfall 1: Vitest 4 threshold-config silent breakage

**What goes wrong:** Following older Vitest examples, the dev writes `coverage: { lines: 85, branches: 80 }` and CI passes — but the keys are silently ignored in v4 because they moved under `coverage.thresholds`. Coverage drops below 85% but CI is green.

**Why it happens:** Vitest 4 deprecated the flat keys without throwing. [CITED: vitest.dev/config/coverage]

**How to avoid:** Use `coverage.thresholds.{lines,branches,statements,functions}`; add a self-test (§Validation Architecture) that intentionally drops coverage below threshold and asserts CI fails.

**Warning signs:** A PR that adds an untested function but coverage report shows "no change" or no threshold violation message.

### Pitfall 2: pnpm/action-setup ordering with setup-node cache

**What goes wrong:** `actions/setup-node@v5` with `cache: 'pnpm'` errors with "Unable to locate executable file: pnpm".

**Why it happens:** setup-node tries to compute the cache key by running `pnpm --version`; if pnpm hasn't been installed yet (because pnpm/action-setup ran *after* setup-node), it fails.

**How to avoid:** Always order `pnpm/action-setup` **before** `actions/setup-node`. [CITED: pnpm.io/continuous-integration]

### Pitfall 3: Trivy GitHub Action supply-chain compromise (2026-03-19)

**What goes wrong:** `aquasecurity/trivy-action@v0` floats to a malicious commit; CI exfiltrates secrets.

**Why it happens:** On 2026-03-19, an attacker compromised the maintainer account and force-pushed 76 of 77 version tags (v0.0.1 through v0.34.2) to a malicious credential-stealer commit. v0.35.0+ is clean; commit-SHA pins survived. [CITED: stepsecurity.io/blog/trivy-compromised-a-second-time, thehackernews.com 2026/03]

**How to avoid:** Pin `aquasecurity/trivy-action` to commit SHA; alternatively pin to `@0.36.0` or newer (post-recovery release). Same discipline for ALL third-party actions. Use `step-security/harden-runner` on every job to detect outbound exfiltration attempts at runtime.

**Warning signs:** Workflow logs showing unexpected outbound network activity to non-GitHub domains.

### Pitfall 4: Stryker incremental cache invalidation

**What goes wrong:** After dependency upgrades or Vitest config change, Stryker reuses stale incremental cache and reports inflated mutation score.

**Why it happens:** The incremental file tracks file-level changes but cannot detect every config-level invalidation.

**How to avoid:** (a) Cache key MUST include hash of `pnpm-lock.yaml`, `vitest.config.ts`, `stryker.config.json`. (b) Nightly full Stryker run (no `incremental`) catches drift. (c) On Stryker version bump, delete `reports/stryker-incremental.json`. [CITED: stryker-mutator.io/docs/stryker-js/incremental]

### Pitfall 5: English-only check missing files outside Biome's scope

**What goes wrong:** A README badge URL with Cyrillic in a query string slips through Biome (which doesn't lint `.md`).

**How to avoid:** The standalone `tools/lint-english.ts` script scans `.md`, `.yaml`, `.yml`, `.json` explicitly. Biome alone is insufficient.

### Pitfall 6: Lefthook not auto-installing on `pnpm install` for fresh clones

**What goes wrong:** New contributor clones, runs `pnpm install`, Lefthook hooks aren't active. Their first commit lands without pre-commit checks.

**How to avoid:** Add `"prepare": "lefthook install"` in root `package.json` scripts. Lefthook 2.x supports `lefthook install` idempotently. Document in CONTRIBUTING.md.

### Pitfall 7: PR template checkbox bypass

**What goes wrong:** Author edits PR body to remove the checklist entirely; `mheap/require-checklist-action` finds no checkboxes, returns success.

**How to avoid:** Configure the action with `requireChecklist: true` and pair with a separate `validate-pr-body` step that asserts the literal phrase "## Tests First Checklist" exists in the body. Two-layer check.

### Pitfall 8: Biome 2.x format-on-save vs CI mismatch

**What goes wrong:** Local IDE uses Biome from VS Code extension at version X; CI uses pinned `@biomejs/biome@2.4.14` at version Y; format diffs on PRs.

**How to avoid:** `biome.json` includes `"$schema"` reference and the `packageManager` field in `package.json` pins exact pnpm version. Document in CONTRIBUTING.md that contributors must use the workspace Biome (`pnpm exec biome ...`), not their global install.

## Code Examples

> All examples below are verified-pattern; the planner can use them as task acceptance-criteria templates.

### `package.json` (root)

```jsonc
// Source: pnpm.io/continuous-integration; npm view of cited versions on 2026-05-08
{
  "name": "openwhispr-server",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@11.0.8",
  "engines": { "node": "24.x", "pnpm": "11.x" },
  "scripts": {
    "prepare": "lefthook install",
    "lint": "biome check .",
    "lint:fix": "biome check --apply .",
    "format": "biome format --write .",
    "lint:english": "tsx tools/lint-english.ts",
    "lint:tdd": "tsx tools/lint-tdd.ts",
    "typecheck": "pnpm -r exec tsc --noEmit",
    "test": "vitest run --coverage",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "test:contract": "pnpm --filter ./packages/contract-tests test",
    "test:mutation": "stryker run",
    "test:mutation:incremental": "stryker run --incremental",
    "build": "pnpm -r build"
  },
  "devDependencies": { /* see Installation block above */ }
}
```

### `pnpm-workspace.yaml`

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### `tsconfig.base.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2024"],
    "types": ["node"],
    "declaration": true,
    "sourceMap": true
  }
}
```

### `biome.json`

```jsonc
// Source: biomejs.dev/reference/configuration
{
  "$schema": "https://biomejs.dev/schemas/2.4.14/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "ignore": [
      "node_modules/**", "dist/**", "coverage/**", ".stryker-tmp/**",
      "reports/**", "**/*.gen.ts", "packages/i18n/locales/**"
    ]
  },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": { "useImportType": "error", "useNodejsImportProtocol": "error" },
      "suspicious": { "noConsoleLog": "warn" }
    }
  },
  "organizeImports": { "enabled": true }
}
```

### `vitest.config.ts` (root, with TEST-COV-01 thresholds)

```typescript
// Source: vitest.dev/config/coverage (Vitest 4 schema)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json', 'lcov'],
      reportsDirectory: './coverage',
      include: ['apps/**/src/**/*.ts', 'packages/**/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.gen.ts',
        '**/dist/**',
        '**/node_modules/**',
        'packages/i18n/locales/**',
      ],
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 80,
        statements: 85,
      },
    },
  },
});
```

### `stryker.config.json`

```jsonc
// Source: stryker-mutator.io/docs/stryker-js/configuration; vitest-runner docs
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "pnpm",
  "testRunner": "vitest",
  "vitest": {
    "configFile": "vitest.config.ts"
  },
  "reporters": ["html", "clear-text", "progress", "dashboard"],
  "mutate": [
    "apps/api/src/**/*.ts",
    "packages/auth/src/**/*.ts",
    "packages/data/src/**/*.ts",
    "packages/litellm-client/src/**/*.ts",
    "!**/*.test.ts",
    "!**/*.spec.ts",
    "!**/*.gen.ts"
  ],
  "incremental": true,
  "incrementalFile": "reports/stryker-incremental.json",
  "thresholds": { "high": 80, "low": 60, "break": 50 },
  "concurrency": 4,
  "tempDirName": ".stryker-tmp"
}
```

### `tools/lint-english.ts`

```typescript
// Source: written for this project; regex covers Cyrillic basic + supplement blocks
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs'; // node 22+ globSync
import { exit } from 'node:process';

const CYRILLIC = /[Ѐ-ԯ]/;
const PATTERNS = [
  '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
  '**/*.json', '**/*.md', '**/*.mdx',
  '**/*.yaml', '**/*.yml', '**/*.cjs', '**/*.mjs',
];
const IGNORE = [
  'node_modules/**', 'dist/**', 'coverage/**', '.stryker-tmp/**',
  'reports/**', '.git/**', 'pnpm-lock.yaml',
  'packages/i18n/locales/**', 'tests/fixtures/i18n/**',
];

const offenders: { file: string; line: number; col: number; preview: string }[] = [];
const files = globSync(PATTERNS, { exclude: IGNORE });
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((text, i) => {
    const match = CYRILLIC.exec(text);
    if (match) {
      offenders.push({ file, line: i + 1, col: match.index + 1, preview: text.trim().slice(0, 80) });
    }
  });
}
if (offenders.length) {
  console.error(`English-only violation: ${offenders.length} file(s) contain Cyrillic`);
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}:${o.col}  ${o.preview}`);
  }
  exit(1);
}
console.log(`English-only check passed: ${files.length} files scanned`);
```

### `commitlint.config.cjs`

```javascript
// Source: commitlint.js.org + custom rule for Cyrillic ban
module.exports = {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'subject-no-cyrillic': ({ subject }) => [
          !subject || !/[Ѐ-ԯ]/.test(subject),
          'commit subject must not contain Cyrillic characters (DOCS-09)',
        ],
        'body-no-cyrillic': ({ body }) => [
          !body || !/[Ѐ-ԯ]/.test(body),
          'commit body must not contain Cyrillic characters (DOCS-09)',
        ],
      },
    },
  ],
  rules: {
    'subject-no-cyrillic': [2, 'always'],
    'body-no-cyrillic': [2, 'always'],
  },
};
```

### `lefthook.yml`

```yaml
# Source: github.com/evilmartians/lefthook
pre-commit:
  parallel: true
  commands:
    biome:
      glob: "*.{ts,tsx,js,jsx,json}"
      run: pnpm exec biome check --apply {staged_files}
      stage_fixed: true
    english:
      run: pnpm exec tsx tools/lint-english.ts
commit-msg:
  commands:
    commitlint:
      run: pnpm exec commitlint --edit {1}
```

### `.github/workflows/ci.yml` (skeleton)

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  setup:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0   # required for Stryker incremental + lint-tdd
      - uses: pnpm/action-setup@v4
        with: { version: 11.0.8 }
      - uses: actions/setup-node@v5
        with:
          node-version: '24'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile

  lint:
    needs: setup
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with: { version: 11.0.8 }
      - uses: actions/setup-node@v5
        with: { node-version: '24', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm lint:english
      - run: pnpm exec commitlint --from origin/main --to HEAD

  typecheck:
    needs: setup
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with: { version: 11.0.8 }
      - uses: actions/setup-node@v5
        with: { node-version: '24', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  test:
    needs: setup
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with: { version: 11.0.8 }
      - uses: actions/setup-node@v5
        with: { node-version: '24', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - name: Coverage report
        uses: davelosert/vitest-coverage-report-action@<commit-sha>   # pin SHA
      - uses: actions/upload-artifact@v4
        with: { name: coverage, path: coverage/ }

  mutation-quick:
    needs: setup
    runs-on: ubuntu-24.04
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        with: { version: 11.0.8 }
      - uses: actions/setup-node@v5
        with: { node-version: '24', cache: 'pnpm' }
      - uses: actions/cache@v4
        with:
          path: reports/stryker-incremental.json
          key: stryker-${{ hashFiles('pnpm-lock.yaml','vitest.config.ts','stryker.config.json') }}
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:mutation:incremental --since origin/${{ github.base_ref }}

  pr-checklist:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-24.04
    steps:
      - uses: mheap/require-checklist-action@<commit-sha>   # pin SHA
        with: { requireChecklist: true }
```

### `.github/workflows/security.yml`

```yaml
name: Security
on:
  pull_request:
  schedule: [{ cron: '0 6 * * 1' }]   # weekly Monday 06:00 UTC

permissions:
  contents: read
  security-events: write

jobs:
  gitleaks:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@<commit-sha>   # pin SHA
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }

  trivy-fs:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
      - uses: aquasecurity/trivy-action@<commit-sha-of-v0.36.0-or-later>   # CRITICAL pin SHA after 2026-03 incident
        with:
          scan-type: fs
          format: sarif
          output: trivy-fs.sarif
          severity: CRITICAL,HIGH
      - uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: trivy-fs.sarif }

  codeql:
    runs-on: ubuntu-24.04
    strategy:
      matrix: { language: [javascript-typescript] }
    steps:
      - uses: actions/checkout@v5
      - uses: github/codeql-action/init@v3
        with: { languages: ${{ matrix.language }} }
      - uses: github/codeql-action/analyze@v3
        # Note: CodeQL Action v3 deprecated Dec 2026; plan migration to v4 in Phase 0.5

  license-scan:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with: { version: 11.0.8 }
      - uses: actions/setup-node@v5
        with: { node-version: '24', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm dlx license-checker-rseidelsohn --production --excludePrivatePackages \
               --onlyAllow="MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;CC0-1.0;Unlicense;0BSD"
```

### `.github/workflows/nightly.yml`

```yaml
name: Nightly
on:
  schedule: [{ cron: '0 3 * * *' }]   # 03:00 UTC daily
  workflow_dispatch:

jobs:
  full-mutation:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with: { version: 11.0.8 }
      - uses: actions/setup-node@v5
        with: { node-version: '24', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:mutation   # full, not incremental

  load-test:
    runs-on: ubuntu-24.04
    steps:
      - run: echo "k6 placeholder — wired in Phase 8"
```

### `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly, day: monday }
    groups:
      minor-and-patch:
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly, day: monday }
    groups:
      actions-minor-and-patch:
        update-types: [minor, patch]
```

### `.github/pull_request_template.md`

```markdown
## What

<one-liner>

## Why

<motivation>

## Tests First Checklist (TDD-01)

- [ ] I wrote failing tests for the new behavior BEFORE writing the implementation
- [ ] All new logic has unit tests
- [ ] All HTTP/wire-surface changes have contract tests (CONTRACT-01)
- [ ] Coverage gate passes (>= 85% lines / >= 80% branches) — see CI summary
- [ ] Mutation score did not regress on touched modules — see Stryker job

## Source Artifacts (DOCS-09)

- [ ] No Cyrillic in any committed file outside `packages/i18n/locales/ru/**`
- [ ] No Cyrillic in commit messages
- [ ] All identifiers, comments, log keys are English

## Risk

- [ ] Considered backwards compatibility
- [ ] Considered security impact (auth, RLS, secrets, deps)
- [ ] Considered i18n impact (en + ru bundles in sync)
```

### `Makefile`

```make
# Source: PROJECT.md / D-23
.PHONY: dev test lint format typecheck up down clean help \
        contract-test load-test seed backup restore migrate

help:
	@grep -E '^[a-zA-Z_-]+:' Makefile | awk -F: '{print $$1}'

dev: up
	pnpm -r --parallel dev

test:
	pnpm test
	pnpm test:e2e || true   # placeholder — Playwright config arrives Phase 2

lint:
	pnpm lint
	pnpm lint:english

format:
	pnpm format

typecheck:
	pnpm typecheck

up:
	docker compose up -d

down:
	docker compose down

clean:
	rm -rf node_modules apps/*/node_modules packages/*/node_modules \
	       coverage reports .stryker-tmp dist

# Phase-N stubs — fail with a pointer
contract-test:
	@echo "contract-test target lands in Phase 2"; exit 1
load-test:
	@echo "load-test target lands in Phase 8"; exit 1
seed backup restore migrate:
	@echo "$@ target lands in Phase 1"; exit 1
```

### `docker-compose.yml` (Phase 0 placeholder)

```yaml
# Phase 0 placeholder; real services arrive Phase 1+
services:
  placeholder:
    image: alpine:3
    command: ["sh", "-c", "echo 'docker-compose skeleton — services land Phase 1'; sleep 1"]
```

### `scripts/setup-branch-protection.sh`

```bash
#!/usr/bin/env bash
# One-shot: operator runs this AFTER fork with an admin PAT in $GITHUB_TOKEN.
# Source: GitHub REST API docs for branches/{branch}/protection
set -euo pipefail
: "${GITHUB_REPOSITORY:?must be set, e.g. nick/openwhispr-server}"
gh api -X PUT "repos/${GITHUB_REPOSITORY}/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "lint", "typecheck", "test", "mutation-quick", "pr-checklist",
      "gitleaks", "trivy-fs", "codeql", "license-scan"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

## Runtime State Inventory

> Phase 0 is greenfield (the repo is empty except for LICENSE/CLAUDE.md/.gitignore/speaches-audio.md/.planning). No prior runtime state exists.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — verified by `ls -la /Users/nick/openwhispr-server/` (only LICENSE, CLAUDE.md, .gitignore, speaches-audio.md, .planning/, .git/) | None |
| Live service config | None — no services running for this project | None |
| OS-registered state | None — fresh repo | None |
| Secrets / env vars | None in repo. Phase 0 introduces NO secret consumption (no AUTH_URL, no LITELLM_*, no DB_URL — those arrive Phases 1–3). Phase 0 does require operator to set `GITHUB_TOKEN` for the branch-protection script and Dependabot to function — documented, not stored. | Document in CONTRIBUTING.md |
| Build artifacts | None — first commit | None |

## Validation Architecture

> Required by `workflow.nyquist_validation: true` in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | **Vitest 4.1.5** (unit/integration), **Playwright 1.59.1** (E2E placeholder), **k6** (load placeholder), **Stryker 9.6.1** (mutation) |
| Config file | `vitest.config.ts` (root), `playwright.config.ts` (placeholder, Phase 2 wires it), `stryker.config.json` |
| Quick run command | `pnpm test` (vitest run --coverage) |
| Full suite command | `make test` |
| Phase gate | `pnpm test && pnpm lint && pnpm lint:english && pnpm typecheck && pnpm test:mutation:incremental` all green |

### Phase Requirements → Test Map

Phase 0 is mostly tooling, so user-observable behaviors are CI behaviors. Each gets a verifiable test.

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| DEVEX-01 | `make dev` from clean clone exits 0 | smoke (CI self-test) | `tests/self/make-dev.sh` invoked from `ci.yml` | ❌ Wave 0 |
| DEVEX-01 | `make test` exits 0 | smoke | `make test` | (covered by ci.yml `test` job) |
| CI-01, CI-02 | PR opens → all required checks run | meta — verified by branch-protection config | `gh api .../branches/main/protection` parsed in `tests/self/branch-protection.test.ts` | ❌ Wave 0 |
| CI-03 | Merge blocked unless CI green | meta — verified by branch-protection config | same as above | ❌ Wave 0 |
| DOCS-09 | Adding Cyrillic char to a source file → CI fails with file:line:col | self-test (Cyrillic injection fixture) | `tests/self/lint-english-injects-cyrillic.test.ts` exec's `tools/lint-english.ts` against a temp dir with a fixture file containing `привет`, asserts non-zero exit + correct file/line in stderr | ❌ Wave 0 |
| DOCS-09 | Cyrillic in commit message → commitlint fails | self-test | `tests/self/commitlint-no-cyrillic.test.ts` runs commitlint with `--edit` against a fixture message containing Cyrillic, asserts exit 1 | ❌ Wave 0 |
| TDD-01 | PR with unchecked TDD checklist → fails | self-test (workflow_dispatch with synthetic PR body) | Document manual test in CONTRIBUTING; automated via `mheap` action's own integration tests upstream | ❌ Wave 0 (manual) |
| TEST-COV-01 | Coverage drops below 85/80 → CI fails | self-test | `tests/self/coverage-threshold.test.ts` writes a temp `vitest.config.ts` with stricter thresholds against a known-uncovered fixture, asserts vitest run exits non-zero | ❌ Wave 0 |
| TEST-MUTATION-01 | Mutation score regression on auth/data/key → CI fails | self-test | `tests/self/stryker-break-threshold.test.ts` runs Stryker against a fixture module with intentionally weak tests, asserts non-zero exit when score < `break` | ❌ Wave 0 |
| TDD-02 | Test layers wired (vitest + playwright + stryker harness all runnable) | smoke | each tool's `--version` invocation in CI; assertion in `ci.yml` job called `harness-self-check` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit (local Lefthook pre-commit):** `pnpm lint` + `pnpm lint:english` + Biome on staged files. Targets < 5s.
- **Per task commit (CI):** Full `ci.yml` matrix: lint + typecheck + test (with coverage) + mutation-quick + pr-checklist. Target < 10 min.
- **Per wave merge:** Same as per-PR plus the security workflow.
- **Phase gate:** `make test` green AND `pnpm test:mutation` (full) green AND all `tests/self/*` self-tests green AND every `harness-self-check` step pass.

### Wave 0 Gaps

These test files do not exist yet and the planner MUST plan tasks to create them BEFORE the implementation tasks they verify:

- [ ] `tests/self/lint-english-injects-cyrillic.test.ts` — verifies DOCS-09 mechanically
- [ ] `tests/self/commitlint-no-cyrillic.test.ts` — verifies commit-message Cyrillic ban
- [ ] `tests/self/coverage-threshold.test.ts` — verifies TEST-COV-01 fail-when-below behavior
- [ ] `tests/self/stryker-break-threshold.test.ts` — verifies TEST-MUTATION-01 break threshold fires
- [ ] `tests/self/branch-protection.test.ts` — verifies CI-03 required checks list matches `setup-branch-protection.sh`
- [ ] `tests/self/make-dev.sh` — verifies DEVEX-01 smoke (`make dev` exits 0 from clean clone — likely just `make up && make down` in Phase 0)
- [ ] `apps/api/src/placeholder.ts` + test, `packages/{auth,data,litellm-client}/src/index.ts` + tests — Stryker mutation targets
- [ ] `vitest.config.ts` (root) — Wave 1 deliverable
- [ ] `stryker.config.json` — Wave 1 deliverable
- [ ] `commitlint.config.cjs` — Wave 1 deliverable
- [ ] `tools/lint-english.ts` — Wave 1 deliverable
- [ ] `tools/lint-tdd.ts` — Wave 1 deliverable (advisory)
- [ ] Framework install — covered by §Standard Stack `pnpm add -D` block

(If `make dev` for Phase 0 is just `docker compose up` against the placeholder service, the smoke test is trivial. Phase 1+ promotes it.)

## Security Domain

> `security_enforcement` not explicitly disabled in config — included.

### Applicable ASVS Categories (for Phase 0 — tooling only)

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V1 Architecture | yes | Documented threat model in `SECURITY.md` (stub in Phase 0; full content Phase 10) |
| V2 Authentication | no | No auth code in Phase 0 (Phase 2) |
| V3 Session Management | no | (Phase 2) |
| V4 Access Control | partial | Branch protection + CODEOWNERS = repository access control. `scripts/setup-branch-protection.sh` is the control. |
| V5 Input Validation | no | No code paths in Phase 0 |
| V6 Cryptography | no | (Phase 1: KEK/DEK for at-rest data) |
| V7 Error Handling & Logging | no | (Phase 6) |
| V14 Configuration | yes | Dependabot grouped weekly; `.github/dependabot.yml`; pinned action SHAs for third-party. CodeQL SAST scanning. Trivy fs scan for vulns in deps. License scanner for compliance. |

### Known Threat Patterns for Phase 0 (CI / supply-chain surface)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Compromised third-party GitHub Action (Trivy 2026-03 incident) | Tampering, EoP | Pin to commit SHA, NOT version tag, for ALL third-party actions. Use `step-security/harden-runner` to detect outbound exfil. |
| Compromised npm package (e.g. supply-chain in transitive dep) | Tampering | Trivy fs scan + Dependabot security PRs + frozen lockfile in CI. Phase 0 ALSO commits `pnpm-lock.yaml`. |
| Secret leak via PR or commit | Information Disclosure | gitleaks-action on every PR + scheduled weekly. License-scanner ensures no proprietary code accidentally pulled. |
| GitHub Actions token over-privilege | EoP | `permissions:` block at top of every workflow, least-privilege per job. |
| Malicious commit (e.g. force-push to main) | Tampering | Branch protection: linear history required, force-push disabled, 1+ approving review required. |
| CodeQL coverage gap on JS/TS | (defense-in-depth) | CodeQL action v3 with `javascript-typescript` language pack, planned migration to v4 noted (deprecation Dec 2026). |
| Container vulnerabilities | Tampering | Trivy fs scan in Phase 0; container scan added Phase 1 once we ship a real Dockerfile. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The user's CLAUDE.md (which is in Cyrillic) is OUTSIDE the scope of DOCS-09 because it's a user-instruction artifact, not a committed source artifact | §Project Constraints | If wrong: the lint-english scanner needs an exception path or DOCS-09 needs a carve-out in CONTEXT.md. **Recommend the planner confirm with user before locking the lint scope.** [ASSUMED] |
| A2 | The lint-english scanner should NOT scan `pnpm-lock.yaml` (it can contain transitive package names with Cyrillic, e.g. some i18n packages) | §Code Examples / lint-english.ts | If wrong: false positives on third-party package names. Mitigation: lockfile in IGNORE list. [ASSUMED — easy to add to IGNORE if needed] |
| A3 | `tools/lint-english.ts` using Node 22+ `fs.globSync` is acceptable; no need for `fast-glob` dep | §Code Examples / lint-english.ts | If wrong: dep added (fast-glob is 1MB). [ASSUMED — Node 22+ has `fs.globSync` stable per Node docs] |
| A4 | Stryker mutation testing of placeholder modules will hit 100% trivially (placeholders are pure boolean returns) and the harness self-validates by running, not by score | §Pattern 5 | If wrong: planner needs to set Phase 0 break threshold higher than the placeholder score. **Recommend break:50 in Phase 0, raised to 80 in Phase 2.** [ASSUMED] |
| A5 | `make dev` in Phase 0 is acceptable as just `docker compose up -d` (placeholder service) since the API doesn't exist yet | §Validation Architecture | If wrong: Phase 0 needs to ship a stub `pnpm dev` script that boots a Fastify "hello world" — minor scope expansion. [ASSUMED — planner should confirm in Phase 0 PLAN.md] |
| A6 | mheap/require-checklist-action's PR-body parsing handles checklists hidden inside HTML comments correctly (some templates put optional sections behind `<details>`) | §Pattern 4 | If wrong: optional checklist items may falsely block merges. Mitigation: don't put any required checkboxes inside `<details>` in the template. [ASSUMED — verified pattern] |
| A7 | License allowlist `MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;CC0-1.0;Unlicense;0BSD` is acceptable for an Apache-2.0 project | §Code Examples / security.yml | If wrong: a transitive dep on, say, MPL-2.0 or LGPL fails the scan. Recommend adding `MPL-2.0` if it appears (compatible with Apache-2.0 distribution); avoid `GPL-*`. **Planner MAY need to expand list during Phase 1 dep installs.** [ASSUMED — Apache-2.0 is one-way compatible with these] |
| A8 | Pre-creating `packages/{auth,data,litellm-client}/` skeletons in Phase 0 is preferred over waiting | §Pattern 1 | If wrong: planner waits to create them, Stryker harness has no targets, mutation testing CI job is trivially green or errors. **Strongly recommend pre-create.** [ASSUMED — CONTEXT.md recommends pre-create] |

## Open Questions

1. **Scope of English-only enforcement: source artifacts only, or include `.claude/` and any agent-instruction files?**
   - What we know: DOCS-09 says "All source artifacts (docs, code, comments, commit messages, identifiers, log keys)". The user's `~/.claude/CLAUDE.md` is in Russian.
   - What's unclear: Whether files committed to the repo under `.claude/skills/`, `.claude/local/`, or any future agent-instruction directory should be Cyrillic-allowed.
   - Recommendation: Ban Cyrillic in everything committed to the repo, with the explicit allowlist `packages/i18n/locales/**` + `tests/fixtures/i18n/**`. If the user wants to commit Russian-language Claude instructions to the repo, they'd need a third allowlist entry. Punt to discuss-phase if the user objects.

2. **Phase 0 `make dev` behavior — does it need to start a Fastify "hello world" or just `docker compose up`?**
   - What we know: DEVEX-01 says one-command brings up the full stack with seeded data. Phase 0 has no services yet.
   - What's unclear: Whether the planner should ship a 10-line `apps/api/src/index.ts` Fastify "hello" or treat `make dev` as `docker compose up` only.
   - Recommendation: Ship a Fastify "hello" that exposes `/api/health` returning `200 { status: 'phase-0-placeholder' }`. Costs ~5 lines, makes the Phase 0 demo more compelling, gives Phase 2 a real starting point.

3. **CodeQL Action v3 deprecation (Dec 2026) — migrate to v4 in Phase 0 or defer?**
   - What we know: GitHub announced v3 deprecation Oct 2025; v4 is GA. [CITED: github.blog/changelog/2025-10-28-upcoming-deprecation-of-codeql-action-v3]
   - What's unclear: Whether v4 has any breaking changes for fresh-repo setup.
   - Recommendation: **Use v4 from the start**, not v3. Update the workflow snippets to `github/codeql-action/init@v4` and `analyze@v4`.

4. **Should the contract-tests harness shell ship a passing trivial test in Phase 0?**
   - What we know: D-01 says `packages/contract-tests/` ships in Phase 0 as a "harness shell".
   - What's unclear: Whether it's an empty workspace or has one trivial passing test.
   - Recommendation: One trivial passing test that asserts the harness loads — same pattern as the other placeholder workspaces. Prevents "no tests found" warnings from Vitest and gives the Stryker harness one more file to mutate.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 24.x | All tooling | (operator-installed) | needs verify (via .nvmrc / Volta on each machine) | nvm/Volta install — documented in CONTRIBUTING |
| pnpm 11.x | Workspace mgmt | via corepack | bundled with Node 24 corepack | `corepack enable` |
| Docker / docker-compose | `make up` | (operator-installed) | needs verify | docker.com install docs in CONTRIBUTING |
| `git` | Git hooks, CI | always present in any git repo | — | — |
| `gh` CLI | `setup-branch-protection.sh` | operator-installed | needs verify | github.com/cli/cli install instructions |
| GitHub Actions runners (`ubuntu-24.04`) | All workflows | GitHub-hosted | always available | — |

**Missing dependencies with no fallback:** None — every dependency is either bundled (Node ↔ corepack ↔ pnpm) or one operator command away.

**Missing dependencies with fallback:** None for Phase 0.

(Local-machine session note: `node --version` returned `v24.15.0` — Phase 0 dev environment is Node 24 ready.)

## Sources

### Primary (HIGH confidence)

- npm registry — verified versions for pnpm, biome, vitest, @vitest/coverage-v8, playwright, stryker, tsup, typescript, lefthook, husky, commitlint, @types/node (live `npm view` calls 2026-05-08)
- [Vitest config: coverage](https://vitest.dev/config/coverage) — threshold schema for v4
- [Vitest migration guide](https://main.vitest.dev/guide/migration) — breaking changes 2→3→4
- [Stryker docs: vitest-runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)
- [Stryker docs: incremental](https://stryker-mutator.io/docs/stryker-js/incremental/)
- [Stryker docs: configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)
- [Biome 2 GritQL plugins](https://biomejs.dev/linter/plugins/) and [recipes](https://biomejs.dev/recipes/gritql-plugins/)
- [Biome v2 release announcement](https://socket.dev/blog/biome-announces-v2-0-beta)
- [pnpm Continuous Integration guide](https://pnpm.io/continuous-integration) — pnpm/action-setup ordering with setup-node
- [actions/checkout v5 / setup-node v5 release notes](https://github.com/actions/setup-node/releases)
- [github/codeql-action v3 → v4 migration changelog](https://github.blog/changelog/2025-10-28-upcoming-deprecation-of-codeql-action-v3/)
- [Kubernetes blog: ingress-nginx retirement March 2026](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/) — context for STACK.md decisions

### Secondary (MEDIUM confidence — multiple sources / informational)

- [stepsecurity.io: Trivy compromise 2026-03-19](https://www.stepsecurity.io/blog/trivy-compromised-a-second-time---malicious-v0-69-4-release)
- [thehackernews.com: Trivy 75 tags hijacked](https://thehackernews.com/2026/03/trivy-security-scanner-github-actions.html)
- [aquasec.com: Trivy supply chain — what to know](https://www.aquasec.com/blog/trivy-supply-chain-what-you-need-to-know/)
- [github.com/davelosert/vitest-coverage-report-action](https://github.com/davelosert/vitest-coverage-report-action) — README and v2.8.3 release
- [github.com/mheap/require-checklist-action](https://github.com/mheap/require-checklist-action)
- [github.com/wagoid/commitlint-github-action](https://github.com/wagoid/commitlint-github-action) — v6.2.1
- [erisu/license-checker-action](https://github.com/erisu/license-checker-action) — license-checker-rseidelsohn wrapper
- [GSD STACK.md research synthesis](.planning/research/STACK.md)
- [Axiom: GHA CI/CD for Node.js complete 2026 guide](https://axiom-experiment.hashnode.dev/github-actions-cicd-for-nodejs-the-complete-2026-guide)

### Tertiary (LOW confidence — single source, treated as illustrative)

- [Biome migration guide 2026 — DEV.to community](https://dev.to/pockit_tools/biome-the-eslint-and-prettier-killer-complete-migration-guide-for-2026-27m)
- [GritQL recipes — Zenn community post](https://zenn.dev/bmth/articles/biomejs-gritql-plugin?locale=en)

## Metadata

**Confidence breakdown:**

- **Standard Stack (versions):** HIGH — every version verified against npm registry on 2026-05-08.
- **Architecture (workflow design, harness wiring):** HIGH — patterns follow current GHA + pnpm + Vitest 4 + Stryker 9 idioms verified against official docs.
- **English-only mechanism:** HIGH — Cyrillic Unicode block ranges are stable and well-defined; standalone TS script approach is verified against community examples; Biome alternative honestly documented as viable but inferior for this use case.
- **Vitest 4 threshold-key migration:** HIGH — directly verified against vitest.dev/config/coverage and migration guide.
- **Stryker placeholder-target approach:** MEDIUM — extrapolated from Stryker docs ("placeholder module" is not a documented Stryker pattern; the harness-against-trivial-code approach is sound but should be PR-confirmed).
- **Trivy 2026 supply-chain incident:** HIGH — verified across stepsecurity, aquasec, thehackernews, and Trivy's own GHSA advisory.
- **Pitfalls:** MEDIUM-HIGH — pitfalls 1, 2, 3, 4 are verified against official sources; 5–8 are practitioner experience plus tool-specific confirmation.

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (versions move fast in this stack — pnpm/vitest/stryker each cut a minor every 3–6 weeks)
