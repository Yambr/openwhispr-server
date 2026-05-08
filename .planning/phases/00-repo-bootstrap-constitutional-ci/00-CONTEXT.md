# Phase 0: Repo Bootstrap & Constitutional CI - Context

**Gathered:** 2026-05-08 (auto mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

A fresh `git clone` lands in a repo where every constitutional discipline (TDD, CI, scanning, coverage, English-only) is already enforced — no retrofit possible. This phase ships **only** the repository skeleton, tooling, GitHub Actions workflows, lint/test/coverage/mutation/security harnesses, the PR template, and the Makefile entrypoints. **No production code in this phase** beyond placeholder modules wired into the test harness.

Out of this phase: anything implementing wire endpoints, auth, data, LiteLLM, or providers. Those start in Phase 1+.
</domain>

<decisions>
## Implementation Decisions

### Repository layout (monorepo)
- **D-01:** Single git repo, **pnpm workspaces** monorepo. Top-level `apps/` and `packages/`. Initial workspaces: `apps/api/` (Fastify server placeholder), `packages/contract-tests/` (CONTRACT-01 harness shell), `packages/i18n/` (locale resources placeholder, en+ru). Frontend workspace deferred to Phase 7.
- **D-02:** Package manager: **pnpm** (10.x). Reasons: workspace support is first-class, lockfile is deterministic, install is faster than npm/yarn for monorepos, and Trivy/Dependabot both speak the format.
- **D-03:** Node engine pinned to **24.x** in every `package.json` and in `.nvmrc` / `.tool-versions`.
- **D-04:** TypeScript **strict** mode everywhere. Single root `tsconfig.base.json` extended by each workspace.
- **D-05:** Build tooling: **tsup** for the API server (fast esbuild-backed, zero-config TS bundler suitable for Node services).

### Tooling
- **D-06:** Linter: **Biome 2.x** (combined lint + format, faster than ESLint+Prettier, single config). One `biome.json` at repo root.
- **D-07:** Test runner: **Vitest 2.x** for unit + integration tests. Reasons: native TS, native ESM, watch mode, coverage built-in via v8, and runs the same way as Vite-based future frontend.
- **D-08:** E2E test runner: **Playwright 1.x** for full HTTP/WSS flows against a local server.
- **D-09:** Contract test runner: **Vitest** (same runner, separate `packages/contract-tests/` workspace). Test cases are tagged `@contract`. Runnable against any deployed instance via `make contract-test BACKEND_URL=...`.
- **D-10:** Load test runner: **k6** invoked from CI; scripts in `tests/load/`. Not run on every PR — nightly schedule + manual trigger.
- **D-11:** Mutation testing: **Stryker Mutator 8.x** (StrykerJS). Configured to target `apps/api/src/**/*.ts` once those modules land. Phase 0 wires the harness against a placeholder module so the workflow exists from day 1.
- **D-12:** Coverage gate: **v8 native coverage** via Vitest with thresholds enforced in `vitest.config.ts` (`lines: 85, branches: 80`). Reports uploaded to GitHub Actions as artifacts; PR comment via `vitest-coverage-report-action` or equivalent.

### CI workflows (`.github/workflows/`)
- **D-13:** `ci.yml` — primary PR workflow: matrix of (lint, typecheck, unit, integration, e2e, contract, coverage, mutation-quick) running on `ubuntu-24.04` GitHub-hosted runners. Concurrency-cancel on PR push.
- **D-14:** `security.yml` — security workflow on PR + scheduled weekly: gitleaks, Trivy filesystem + container scan, CodeQL (JavaScript/TypeScript), license scan via `license-checker-rseidelsohn` (or similar OSS).
- **D-15:** `nightly.yml` — k6 load test (placeholder until SCALE-06 lands), full Stryker mutation run, dependency-update audit.
- **D-16:** `release.yml` — placeholder, wired in Phase 9 with semantic-release or changesets.
- **D-17:** Dependabot configured (`.github/dependabot.yml`) for npm + GitHub Actions; weekly cadence; grouped minor/patch updates.

### English-only enforcement
- **D-18:** Custom Biome lint rule (or a tiny `tools/lint-english.ts` script run as a Biome `extends` plugin or standalone CI step) that fails on:
  - Cyrillic characters in any `.ts`, `.tsx`, `.json`, `.md`, `.yaml`, `.yml` file outside of `packages/i18n/locales/ru/**` and `tests/fixtures/i18n/**`
  - Cyrillic characters in commit messages (commitlint rule via Husky pre-commit hook)
  - Identifier names matching non-ASCII pattern
- **D-19:** Allowlist for `packages/i18n/locales/<locale>/` so Russian translation files are exempt.

### TDD enforcement
- **D-20:** PR template (`.github/pull_request_template.md`) includes "tests first" checklist with required checkboxes. CI parses the PR body and fails if checkboxes are unchecked.
- **D-21:** Optional but recommended: a `tools/lint-tdd.ts` heuristic — flags PRs where production-code commits land before any test commit in the same series. Advisory-warning in v1, can be promoted to blocking later.

### Branch protection
- **D-22:** `main` branch protected via repo settings (documented in `docs/operations.md`); required checks: every job in `ci.yml` + every job in `security.yml`. Linear history required. Force-push disallowed. Branch-protection settings reproducibly applied via a one-shot script (`scripts/setup-branch-protection.sh`) that an operator runs after fork.

### Local dev (`make dev` / `make test`)
- **D-23:** Top-level `Makefile` is the canonical entrypoint. Targets: `dev` (compose up + `pnpm dev` against bundled services), `test` (full suite), `lint`, `format`, `typecheck`, `contract-test`, `load-test`, `up`, `down`, `clean`, `seed`, `backup`, `restore`. Phase 0 implements `dev`/`test`/`lint`/`format`/`typecheck`/`up`/`down`/`clean` — others are stubs that fail with a phase-N pointer.
- **D-24:** A skeleton `docker-compose.yml` exists from Phase 0 with placeholder services so `make up` succeeds — actual service definitions land in Phase 1.

### Licensing & OSS housekeeping
- **D-25:** **Apache-2.0** license (root `LICENSE` already in repo).
- **D-26:** `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` — minimal stubs in Phase 0 (full content in Phase 10/DOCS).
- **D-27:** Conventional Commits enforced via commitlint + Husky.

### Claude's Discretion
- Exact pnpm/Node/Vitest/Biome/Stryker minor versions — pick the latest stable as of phase execution date.
- Specific Trivy / gitleaks / CodeQL action versions — pick the official latest.
- Whether to use `husky` or `lefthook` for git hooks — pick the simpler one (lefthook leans simpler in 2026).
- Whether the English-only checker is a Biome plugin or a standalone CI script — pick whichever is less brittle at implementation time.
- Whether to pre-create `packages/auth/`, `packages/data/`, `packages/litellm-client/` skeletons in Phase 0 or wait until each respective phase — recommend creating empty skeleton workspaces with placeholder `index.ts` so Stryker has real targets, but no logic.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — project context, constitutional rules
- `.planning/REQUIREMENTS.md` — v1 requirements (TDD-01, TDD-02, CI-01..03, TEST-COV-01, TEST-MUTATION-01, DEVEX-01, DOCS-09)
- `.planning/ROADMAP.md` § Phase 0 — phase goal, success criteria, requirements mapping
- `.planning/research/STACK.md` — runtime versions (Node 24, TypeScript strict, Biome, Vitest, Playwright, Stryker)
- `.planning/research/SUMMARY.md` — synthesis of all research

### Constitutional rule sources
- `~/.claude/projects/-Users-nick-openwhispr-server/memory/feedback_tdd_and_ci.md` — TDD + GitHub Actions + max-automation rule (memory-store)

### Wire-contract authority (CONTRACT-01 harness must reference)
- `/Users/nick/openwhispr/docs/SELF_HOSTING.md` — wire walkthrough
- `/Users/nick/openwhispr/docs/BACKEND_SPEC.md` — per-endpoint contract
- `/Users/nick/openwhispr/docs/OAUTH_SPEC.md` — auth flows

### External standards (no local file — referenced by URL in tooling configs)
- Conventional Commits 1.0.0 — commitlint preset target
- Semver 2.0.0 — version pinning
- WCAG 2.2 AA — accessibility (relevant later for UI-SPEC; surfaces here only as a docs link)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
None — this is the first phase of a brand-new repository.

### Established Patterns
None to inherit. Phase 0 establishes the patterns every later phase will follow:
- pnpm workspaces layout
- Vitest as the default test runner
- Biome as the default lint/format
- Conventional Commits + commitlint
- TDD-checked PR template

### Integration Points
- `.github/workflows/` — every later phase extends `ci.yml` matrix and `security.yml` jobs
- `Makefile` — every later phase adds targets (e.g. Phase 1 adds `make migrate`, Phase 3 adds `make litellm-up`)
- `docker-compose.yml` — every later phase adds services (Phase 1: postgres+pgbouncer+redis+observability; Phase 3: bundled litellm + open-source AI models)
- `packages/contract-tests/` — Phase 2 ships the harness shell; Phases 3/4/5 each add wire-conformance tests for their endpoints
- `packages/i18n/` — Phase 10 fills locale resources; Phase 0 establishes the structure and the completeness check

</code_context>

<specifics>
## Specific Ideas

- **English-only enforcement is non-negotiable.** It must be wired in CI (not just review) on day 1 so that as the codebase grows the rule stays mechanically enforced. The user explicitly called this out as constitutional.
- **TDD must be CI-checkable, not just policy.** The PR template checklist is the v1 mechanism; the heuristic commit-order check is a later upgrade.
- **Coverage thresholds are a hard CI gate** at 85/80 from PR #2 onwards (PR #1 is the bootstrap which establishes them).
- **Mutation testing scaffolding lands in Phase 0** even though there's no real auth/multi-tenancy/virtual-key code yet — the harness must run against a placeholder so we don't ship the harness late and then discover it's broken when the modules arrive.
- **GitHub Actions hosted runners only** — no self-hosted runners in v1. GPU work for k6/load is deferred until Phase 8.

</specifics>

<deferred>
## Deferred Ideas

- **Self-hosted GPU runners** for nightly k6 load test against bundled LiteLLM with real Whisper inference — defer to Phase 8 (Load Test). v1 nightly load test runs against mocked LiteLLM responses.
- **Renovate instead of Dependabot** — defer evaluation; Dependabot is sufficient for v1.
- **Codecov / Coveralls integration** — v1 uses native GHA artifacts + PR comment; external coverage UI is a v1.5 nice-to-have.
- **Release-please / changesets / semantic-release** — Phase 9 (Helm + Cloud Deploy) decides; Phase 0 leaves `release.yml` as a placeholder.
- **Custom GHA composite actions** for repeated steps — defer to mid-phases when duplication actually emerges.
- **Documentation site (Docusaurus / Starlight)** — defer to Phase 10 (i18n + Docs).
- **Pre-built dev container (`.devcontainer/`)** for VS Code / Codespaces — nice-to-have, not blocking; defer to v1.5.

</deferred>

---

*Phase: 00-repo-bootstrap-constitutional-ci*
*Context gathered: 2026-05-08 (auto mode — recommended defaults selected)*
