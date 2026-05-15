# Phase 31: Constitutional Lockers — Context

**Gathered:** 2026-05-16
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss; user is offline; advisor-agent handles grey-area decisions)
**Source:** `.planning/ROADMAP.md` Phase 31 entry + `.planning/phases/PROPOSED-v2.2-pre-oss-security-and-hygiene.md` Phase 30 (renumbered to 31)

<domain>
## Phase Boundary

A contributor who tries to commit production code containing `as any`, `if (NODE_ENV === 'test')` in a runtime path, a hardcoded `localhost:3000`, a Fastify route without zod, a dead export, an Error class leaking full upstream bodies, or a `bash -c "${DATABASE_URL}"` interpolation finds the commit REFUSED by lefthook AND the PR REFUSED by GitHub Actions CI, with a precise `file:line` + remediation pointer. The four new constitutional rules (11–14) live in `.planning/DISCIPLINE.md` and `CLAUDE.md`, shipped in the SAME atomic commit as the linter source so discipline doc and tool can never drift.

Phase 31 ships FIRST in v2.2 — it is the GATE Phases 32–41 are tested against. A fix that violates a Phase-31 locker cannot land.

## Scope (in)

Six tsx-CLI linters under `tools/`:
- `lint-no-env-branches.ts` — refuse `process.env.NODE_ENV` / `NODE_ENV` runtime comparisons in `apps/**/src/**` + `packages/**/src/**`. Allowlist: `bootstrap.ts`, `config/*.ts`, `otel-bootstrap.ts`, `*.config.ts`. (LOCKER-01)
- `lint-no-suppressions.ts` — refuse `as any`, `as unknown as`, `@ts-ignore`, `@ts-nocheck`; require `@ts-expect-error` to carry a reason + issue ID. Seed allowlist from current main; CI fails on net additions. (LOCKER-02)
- `lint-no-hardcode.ts` — refuse `localhost`, `127.0.0.1`, `:3000`/`:4000`/`:8080`, UUID literals, fake-token shapes (`sk-…`, `sk-ant-…`, `AIza…`, `AKIA…`, `Bearer ey…`). Allowlist: `tests/`, `.env.*.example`, `compose/`, `docs/`, `charts/`, `tools/`. (LOCKER-03)
- `lint-prod-readiness.ts` — AST scan: (a) every Fastify `app.route/get/post/...` MUST have `schema: { body|querystring|params: <ZodSchema> }` AND `config: { rateLimit: ... }` (or explicit `rateLimit: false` only for `/api/health`); (b) every exported symbol MUST have ≥ 1 non-test importer. (LOCKER-04)
- `lint-secret-shape-in-error.ts` — refuse `class X extends Error { public/readonly <bodyText|responseBody|upstreamPayload|response|body>: string }` unless constructor truncates the field. (LOCKER-05)
- `lint-shell-credential-interpolation.ts` — refuse template-literal strings passed to `spawn('bash', ['-c', ...])` / `execSync` / `exec` referencing `*_URL`, `*_KEY`, `*_PASSWORD`, `*_SECRET`, `*_TOKEN` bindings. (LOCKER-06)

Plus:
- `.planning/DISCIPLINE.md` Rules 11–14 amendment + `CLAUDE.md` mirror, shipped in the SAME atomic commit as the linter source. (LOCKER-07)
- `lefthook.yml` pre-commit + `.github/workflows/{ci,nightly}.yml` updates wiring all six lockers as BLOCKING. `make lint:lockers` make target. (LOCKER-08)
- Per-locker `tools/lint-*-allowlist.txt` files seeded with current main inventory; each entry needs a tracking-issue ID. (LOCKER-09)

## Scope (out)

- Fixing every violation surfaced by the new linters (deferred to Phase 31-08 bulk-fix pass OR to Phases 32–41 which close CRITICAL/HIGH).
- Touching production behaviour (these are pure tooling additions).
- Modifying existing linters (`lint-english`, `lint-tdd`, `lint-rls`, `lint-tenant-context`, etc.) — Phase 31 adds NEW lockers without breaking existing ones.

</domain>

<decisions>
## Implementation Decisions

### Architecture
- Each locker is a standalone tsx CLI under `tools/`, mirroring the existing `lint-english.ts` / `lint-tdd.ts` / `lint-rls.ts` style. Single entry, glob-driven scan, JSON-stable error output with `file:line` + rule-name + remediation pointer. Exit non-zero on any finding.
- AST scanning uses `ts-morph` ONLY for `lint-prod-readiness.ts` and `lint-secret-shape-in-error.ts` (AST-required); the other four are regex-based for speed (< 200ms on the full repo).
- Vitest test file co-located: `tools/lint-*.test.ts` with fixture directory `tools/lint-*/fixtures/`. Coverage gate enforced via per-locker `pnpm test:lint-<name>` scripts in root `package.json` (mirroring the pattern at `test:lint-colocated-tests`).
- E2E suite at `tests/e2e/lockers.spec.ts` invokes each binary via `execa` against temp files, asserts non-zero exit + expected stderr lines. Real binaries, real exit codes, no mocks (DISCIPLINE Rule 4 + 8).

### Allowlist policy
- Each locker has a `tools/lint-<name>.allowlist.txt` file. Format: one `file:line` (or `file` if rule is whole-file) per row, optional trailing `# issue-NNNN` for tracking. Empty lines + `#` comments allowed.
- Allowlist is consulted AFTER the rule fires; if `file:line` is in the allowlist, the finding becomes a WARN (visible but non-blocking).
- New violations (not in allowlist) fail the run. The CI workflow includes a `git diff` step that re-runs the locker AFTER the allowlist diff is applied, ensuring "I can't sneak a new violation by adding it to the allowlist in the same PR" — the allowlist itself is reviewed at PR.

### Discipline doc atomicity
- LOCKER-07 ships DISCIPLINE.md and CLAUDE.md edits in the SAME commit as the linter that enforces each rule. Verifier rejects split commits (Phase verifier rule).

### Rule numbering
- Phase 31 introduces Rules 11–14 (numbered after the existing 10 rules):
  - Rule 11: No `NODE_ENV` branches in runtime paths.
  - Rule 12: No type-suppression (`as any`, `@ts-ignore` family).
  - Rule 13: No hardcoded localhost/UUID/test-tokens.
  - Rule 14: Production-readiness (zod + rateLimit + dead-export-free).
- LOCKER-05 + LOCKER-06 are tactical (catch specific CR-classes) — they enforce existing Rule 4 ("No mocks of internal logic" / "Real services") and a new implicit "no secrets in error fields" / "no shell credential interpolation". Folded into Rule 12 + Rule 14 prose; no separate rule number.

### Plan split (per ROADMAP entry suggestion)
- 31-01: `lint-no-env-branches.ts` (RED → GREEN, fixture-driven, allowlist seeded)
- 31-02: `lint-no-suppressions.ts`
- 31-03: `lint-no-hardcode.ts`
- 31-04: `lint-prod-readiness.ts` (AST-based, larger plan)
- 31-05: `lint-secret-shape-in-error.ts` (AST-based)
- 31-06: `lint-shell-credential-interpolation.ts`
- 31-07: DISCIPLINE.md + CLAUDE.md amendment + lefthook wiring + ci.yml + nightly.yml + `make lint:lockers` target + E2E `tests/e2e/lockers.spec.ts`
- 31-08: bulk-fix pre-existing MEDIUM/LOW violations across `apps/**/src/**` + `packages/**/src/**` per-area atomic commits (each ≤ 50 files). Pre-existing CRITICAL/HIGH are addressed by Phases 32–41 — Phase 31-08 only fixes those NOT covered there.

### Advisor-agent fallback for grey-area decisions
The user is offline during this autonomous run. Any grey-area decision encountered by sub-agents (planner, executor, verifier) MUST be resolved via `gsd-advisor-researcher` rather than blocking on user input. The advisor's verdict is recorded in `<plan>-DECISIONS.md` for next-morning audit. This is a v2.2 milestone-wide convention.

</decisions>

<code_context>
## Existing Code Insights

- Existing tsx linters establish the canonical pattern: `tools/lint-english.ts`, `tools/lint-tdd.ts`, `tools/lint-rls.ts`, `tools/lint-tenant-context.ts`, `tools/lint-ui-spec.ts`, `tools/lint-migrations.ts`, `tools/lint-compose-chart-parity.ts`, `tools/lint-colocated-tests.ts`, `tools/lint-phase-tag-comments.ts`, `tools/lint-dockerfile-tls.ts`, `tools/lint-traefik-routes.ts`, `tools/lint-await-in-non-async.ts`, `tools/lint-docs-headings.ts`, `tools/lint-cjm-doc.ts`. Each has co-located `.test.ts` with coverage > 90/90/90/90 enforced via dedicated `test:lint-*` script.
- `lefthook.yml` pre-commit pattern is well-established (glob-driven, `pnpm exec tsx tools/lint-*.ts`, `pnpm lint:*`).
- `.github/workflows/ci.yml` and `.github/workflows/nightly.yml` exist with per-tool lint steps; need to add `lockers` step calling `pnpm lint:lockers`.
- `make` targets defined in root `Makefile`; need to add `lint:lockers` invoking `pnpm` recursively.
- `tools/spdx-header.ts` is a non-lint codemod with `audit` / `fix` subcommands — mirror this pattern for `--apply` flag on `lint-no-suppressions.ts` allowlist seeding.

</code_context>

<specifics>
## Specific Ideas

- Use `glob` (already a dev dep) for file discovery. Skip `**/node_modules/**`, `**/dist/**`, `**/.next/**`.
- Use `ts-morph` for AST scans (LOCKER-04, LOCKER-05). Already a transitive dep via Drizzle tooling.
- JSON output mode (`--json`) on every locker for CI consumption.
- Exit codes: 0 = clean, 1 = violations, 2 = setup error.
- Allowlist seeding: each locker accepts `--seed-allowlist` flag that writes the current findings to `tools/lint-<name>.allowlist.txt` for migration-debt mode. Use ONCE per locker on initial landing.
- Test the e2e behaviour end-to-end via `tests/e2e/lockers.spec.ts` — spawn the actual `pnpm exec tsx tools/lint-...ts` binary with `execa` against a temp dir with fixtures, assert exit code + stderr regex.

</specifics>

<deferred>
## Deferred Ideas

- Auto-fix mode on lockers (would require codemod logic) — out of scope, user wants ENFORCEMENT first, fixes via Phases 32–41.
- IDE integration (VSCode linter extension wrapping these tools) — out of scope.
- Per-CRITICAL findings closure — explicit scope of Phases 32–41; Phase 31 only adds the lockers.
- New DISCIPLINE rule for "no plaintext secret columns in schema" — will land in Phase 33 (envelope encryption) as Rule 15, not here.

</deferred>
