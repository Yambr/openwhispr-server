# Phase 31: Constitutional Lockers — Research

**Researched:** 2026-05-16
**Domain:** TypeScript repo-wide static-analysis tooling (regex + ts-morph + node:typescript AST) + lefthook/CI wiring + discipline-doc co-amendment
**Confidence:** HIGH (every claim cited against working tree at HEAD `1832f28`)

## Summary

Phase 31 ships six new `tsx`-CLI linters under `tools/` that turn the CR-1..CR-10 regression patterns identified in `.planning/review/REVIEW-INDEX.md` into pre-commit + CI blockers. The repository already has 16 functioning lint CLIs in `tools/` establishing a fully-fledged canonical pattern (regex-line-scan, allowlist file, exit codes 0/1/2, vitest-co-located test at 90/90/90/90, `pnpm lint:*` script, Lefthook hook block, GitHub Actions step). Three existing linters use TypeScript AST traversal — `tools/lint-await-in-non-async.ts:21`, `tools/lint-colocated-tests.ts:38`, `tools/lint-tenant-context.ts:59` — all importing `typescript` directly, NOT `ts-morph`. `ts-morph` 28.0.0 IS installed at the root (`package.json:81`) but is only used by `tools/migrate-tests.ts:35` (a codemod, not a linter). Recommendation: **for LOCKER-04 + LOCKER-05 use `import ts from "typescript"` directly, mirroring `lint-tenant-context.ts` — keeps the locker family stylistically uniform with the existing three AST linters and avoids ts-morph's Project-bootstrap cost on a `pnpm exec tsx` cold-start.** ts-morph remains acceptable if a richer Node API materially shortens the implementation; both options are pre-installed.

Current-main violation inventories are SMALL (good news — bulk-fix is feasible in-scope, not a multi-day blocker): **13 NODE_ENV hits across 8 files**, **36 type-suppressions across 13 files** (10 `as any` + 26 `as unknown as`; **zero** `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`), **24 hardcode hits across 14 files** (3 localhost + 13 ports + 8 UUID-zero; **zero** sk-/AIza/AKIA leaks). One shell-credential-interpolation hit confirmed: `apps/worker/src/jobs/audit-archive.ts:106,115,127` — the CR-5 source. One Error-body-leak hit confirmed: `packages/litellm-client/src/errors.ts:31` (`public readonly bodyText: string` with NO truncation on the field — only the `message` is truncated).

**Primary recommendation:** Sequence Phase 31 as 31-01 → 31-02 → 31-03 → 31-06 → 31-05 → 31-04 → 31-07 → 31-08. Land LOCKER-04 in WARN mode first (allowlist seeded from a `--seed-allowlist` audit run), then drive the Fastify-route bulk-fix in 31-08, then flip 31-04 to BLOCKING in a follow-on commit inside 31-07. Every other locker can ship directly in BLOCKING mode because the violation inventory is bounded and trivially audited.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Architecture**
- Each locker is a standalone `tsx` CLI under `tools/`, mirroring `lint-english.ts` / `lint-tdd.ts` / `lint-rls.ts` style. Single entry, glob-driven scan, JSON-stable error output with `file:line` + rule-name + remediation pointer. Exit non-zero on any finding.
- AST scanning uses `ts-morph` ONLY for `lint-prod-readiness.ts` and `lint-secret-shape-in-error.ts` (AST-required); the other four are regex-based for speed (< 200ms on the full repo).
- Vitest test file co-located: `tools/lint-*.test.ts` with fixture directory `tools/lint-*/fixtures/`. Coverage gate enforced via per-locker `pnpm test:lint-<name>` scripts in root `package.json`.
- E2E suite at `tests/e2e/lockers.spec.ts` invokes each binary via `execa` against temp files, asserts non-zero exit + expected stderr lines. Real binaries, real exit codes, no mocks.

**Allowlist policy**
- Each locker has a `tools/lint-<name>.allowlist.txt` file. Format: one `file:line` (or `file` if rule is whole-file) per row, optional trailing `# issue-NNNN` for tracking. Empty lines + `#` comments allowed.
- Allowlist consulted AFTER the rule fires; if `file:line` is in the allowlist, the finding becomes a WARN (visible but non-blocking).
- New violations (not in allowlist) fail the run.

**Discipline doc atomicity**
- LOCKER-07 ships DISCIPLINE.md and CLAUDE.md edits in the SAME commit as the linter that enforces each rule. Verifier rejects split commits.

**Rule numbering**
- Phase 31 introduces Rules 11–14 (after existing 10 rules): Rule 11 = NODE_ENV branches; Rule 12 = type-suppression; Rule 13 = hardcoded localhost/UUID/test-tokens; Rule 14 = production-readiness (zod + rateLimit + dead-export-free).
- LOCKER-05 + LOCKER-06 folded into Rule 12 + Rule 14 prose (no separate rule numbers).

**Plan split**
- 31-01: `lint-no-env-branches.ts`
- 31-02: `lint-no-suppressions.ts`
- 31-03: `lint-no-hardcode.ts`
- 31-04: `lint-prod-readiness.ts` (AST-based, larger plan)
- 31-05: `lint-secret-shape-in-error.ts` (AST-based)
- 31-06: `lint-shell-credential-interpolation.ts`
- 31-07: DISCIPLINE.md + CLAUDE.md amendment + lefthook + ci.yml + nightly.yml + `make lint:lockers` + `tests/e2e/lockers.spec.ts`
- 31-08: bulk-fix pre-existing MEDIUM/LOW violations (≤ 50 files per atomic commit). CRITICAL/HIGH are Phases 32–41's scope.

**Advisor fallback**
- Any grey-area decision is resolved via `gsd-advisor-researcher`; verdict recorded in `<plan>-DECISIONS.md`.

### Claude's Discretion

- Choice between `import ts from "typescript"` vs `ts-morph` for LOCKER-04/05 (both pre-installed; recommendation below in Question 2).
- Exact allowlist line-format details (line:col vs file:line vs whole-file) per locker — choose what minimizes false-positives.
- Per-locker `--seed-allowlist`, `--json`, `--quiet` flag presence and naming — modelled on existing tools.
- The exact AST node-matching strategy for LOCKER-04 (recommended below).
- Whether to land LOCKER-04 in WARN-only mode initially (recommended — see Question 15).

### Deferred Ideas (OUT OF SCOPE)

- Auto-fix mode on lockers (codemod logic) — Phase 31 is ENFORCEMENT only.
- IDE integration (VSCode linter extension).
- Per-CRITICAL findings closure — Phases 32–41's scope.
- New DISCIPLINE rule for "no plaintext secret columns in schema" — Phase 33 (Rule 15).
</user_constraints>

<phase_requirements>
## Phase Requirements

Drawn from `.planning/REQUIREMENTS.md:614-622` and `.planning/REQUIREMENTS.md:661-669`.

| ID | Description | Research Support |
|----|-------------|------------------|
| LOCKER-01 | `tools/lint-no-env-branches.ts` — refuse `process.env.NODE_ENV` / `NODE_ENV` comparisons in `apps/**/src/**` + `packages/**/src/**`; allowlist `bootstrap.ts`, `config/*.ts`, `otel-bootstrap.ts`, `*.config.ts`. ≥ 90/90/90/90. | Pattern = `lint-english.ts` (regex line-scan + glob + allowlist via `IGNORE` block). Current main: 13 hits / 8 files (Q8). |
| LOCKER-02 | `tools/lint-no-suppressions.ts` — refuse `as any`, `as unknown as`, `@ts-ignore`, `@ts-nocheck`; require `@ts-expect-error` to carry reason + issue ID. Seed allowlist from current main. ≥ 90/90/90/90. | Pattern = `lint-dockerfile-tls.ts` (regex + allowlist file `tools/lint-dockerfile-tls.allowlist.txt`). Current main: 36 hits / 13 files; zero `@ts-ignore`/`@ts-nocheck` (Q9). |
| LOCKER-03 | `tools/lint-no-hardcode.ts` — refuse `localhost`, `127.0.0.1`, `:3000`/`:4000`/`:8080`, UUID literals, fake-token shapes. Allowlist `tests/`, `.env.*.example`, `compose/`, `docs/`, `charts/`, `tools/`. ≥ 90/90/90/90. | Pattern = `lint-dockerfile-tls.ts` FORBIDDEN[] regex array. Current main: 24 hits / 14 files; zero secret-shape leaks (Q10). |
| LOCKER-04 | `tools/lint-prod-readiness.ts` — AST scan: (a) Fastify routes need `schema: { body\|querystring\|params: <ZodSchema> }` + `config: { rateLimit: ... }` (or `rateLimit: false` only for `/api/health`); (b) every export has ≥ 1 non-test importer. ≥ 90/90/90/90. | Pattern = `lint-tenant-context.ts` (typescript-AST traversal via `ts.forEachChild`). Routes use `app.route({...})` dominantly; 4 test-only `app.get/post` exceptions in `apps/api/src/routes/test-only.ts` (Q3). Schemas imported from `@openwhispr/contract-tests/schemas`, `@openwhispr/wire-schemas`, or `zod` directly (Q4). |
| LOCKER-05 | `tools/lint-secret-shape-in-error.ts` — refuse `class X extends Error { public/readonly <bodyText\|responseBody\|upstreamPayload\|response\|body>: string }` unless constructor truncates. ≥ 90/90/90/90. | Pattern = AST class+property+constructor inspection (sketch in Q6). Current main: 1 violation = `packages/litellm-client/src/errors.ts:31` (CR-9). |
| LOCKER-06 | `tools/lint-shell-credential-interpolation.ts` — refuse template-literal strings passed to `spawn('bash', ['-c', ...])` / `execSync` / `exec` referencing `*_URL`, `*_KEY`, `*_PASSWORD`, `*_SECRET`, `*_TOKEN` bindings. ≥ 90/90/90/90. | Current main: 1 violation = `apps/worker/src/jobs/audit-archive.ts:106,115,127` (CR-5). Regex-based; AST not required (Q7). |
| LOCKER-07 | DISCIPLINE.md Rules 11–14 + CLAUDE.md mirror, SAME commit as linter source. | Pattern = commit `5f1a1e4 docs(discipline): codify constitutional TDD/coverage/E2E rules across all phases` — single atomic commit mutating both files. |
| LOCKER-08 | Lefthook + ci.yml + nightly.yml wiring; `make lint:lockers` target. | Pattern: `lefthook.yml:33-35` (dockerfile-tls block), `.github/workflows/ci.yml:38-41` (`lint-english` job with multiple `pnpm lint:*` runs). `Makefile:21-23` for `lint:` target shape. |
| LOCKER-09 | Per-locker `tools/lint-*-allowlist.txt` seeded; CI fails on net additions; each entry has tracking-issue ID. | Pattern = `tools/lint-dockerfile-tls.allowlist.txt` + `tools/lint-phase-tag-comments.allowlist.txt`. Allowlist diff-comparison pattern not yet exemplified — see Pitfall 5. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pre-commit refusal | Lefthook (developer machine) | — | First line of defence; sub-second feedback. |
| CI refusal | GitHub Actions (`ci.yml` + `nightly.yml`) | — | Authoritative gate; runs on the merge candidate. |
| Rule definition | `.planning/DISCIPLINE.md` (source of truth) | `CLAUDE.md` (mirror) | DISCIPLINE.md is the audit-trail anchor; CLAUDE.md mirror surfaces it for in-IDE Claude agents. |
| Violation detection (regex) | `tools/lint-no-{env-branches,suppressions,hardcode,shell-credential-interpolation}.ts` | — | Line-scan is sufficient and 10–100× faster than AST. |
| Violation detection (AST) | `tools/lint-{prod-readiness,secret-shape-in-error}.ts` | — | Requires structural understanding of class shape + Fastify route option object. |
| Allowlist storage | `tools/lint-<name>.allowlist.txt` per locker | — | Plain-text, git-tracked, PR-reviewable, one source of truth per locker. |
| Test fixtures | `tools/lint-<name>/fixtures/` | `tools/__tests__/fixtures/` | Co-located per-locker fixture directory matches `lint-ui-spec/fixtures/` precedent. |
| E2E binary invocation | `tests/e2e/lockers.spec.ts` | — | DISCIPLINE Rule 3 — every operator-facing artifact ships an e2e. |

## Standard Stack

### Core (already installed; nothing new to add)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tsx` | `latest` (root devDep) | Run `.ts` CLIs without a build step | All 16 existing tools use it (`package.json` scripts). |
| `typescript` | `6.0.3` (root devDep) | Direct `ts.createSourceFile` AST walks | `lint-tenant-context.ts:59`, `lint-await-in-non-async.ts:21`, `lint-colocated-tests.ts:38`. |
| `ts-morph` | `28.0.0` (root devDep) | Higher-level AST API (Project, SourceFile, ClassDeclaration helpers) | Already in deps; used by `tools/migrate-tests.ts:35`. Optional for LOCKER-04/05. |
| `node:fs/promises` `glob` | Node 24 native | File discovery | `lint-english.ts:30`, `lint-dockerfile-tls.ts:26`. **No `glob` npm package — Node-native is the canonical idiom.** |
| `vitest` | `4.1.5` | Per-locker test suite with v8-coverage gate | All 16 existing `.test.ts` co-located files use it. |
| `lefthook` | `2.1.6` | Pre-commit hook orchestrator | `lefthook.yml` already configured. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `execa` (transitive via `@playwright/test`) | — | Spawn locker binary in e2e | `tests/e2e/lockers.spec.ts` per CONTEXT decision; **NOT pre-installed as direct dep** — either add it to root devDeps OR use `node:child_process.spawn`/`execFileSync` (already used by `audit-archive.ts:23`). **Recommend `node:child_process.execFileSync`** for zero new deps. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ts-morph` Project API | Direct `import ts from "typescript"` + `ts.createSourceFile` | typescript-direct is the established pattern in 3 existing linters; ts-morph adds Project bootstrap overhead (~80–120 ms on cold tsx start) but simpler class/property queries. Pick typescript-direct for code-uniformity. |
| `execa` in e2e | `node:child_process.execFileSync` | execFileSync zero-dep, sync, returns Buffer; sufficient for assert-exit-code-and-stderr tests. |

**Installation:** No new packages needed. Confirm with:

```bash
node -e "console.log(require('ts-morph/package.json').version)"   # 28.0.0
node -e "console.log(require('typescript/package.json').version)" # 6.0.3
```

## Architecture Patterns

### System Diagram

```
                ┌──────────────────────────┐
   developer ──▶│ git commit               │
                └────────────┬─────────────┘
                             │
                             ▼
                ┌──────────────────────────┐
                │ Lefthook pre-commit      │  (lefthook.yml:3-55)
                │  parallel: true          │
                │  ├─ biome                │
                │  ├─ english              │
                │  ├─ colocated-tests      │
                │  ├─ phase-tag-comments   │
                │  ├─ dockerfile-tls       │
                │  ├─ tenant-context       │
                │  ├─ ui-spec              │
                │  ├─ web-typecheck        │
                │  └─ ◯ lockers (NEW)      │──┐
                └──────────────────────────┘  │
                                              │ refuse on exit≠0
                                              ▼
              ┌──────────────────────────────────────────┐
              │ pnpm exec tsx tools/lint-<name>.ts       │
              │   ├─ glob discovery (node:fs/promises)   │
              │   ├─ per-file regex OR AST walk          │
              │   ├─ allowlist consult                   │
              │   │   tools/lint-<name>.allowlist.txt    │
              │   ├─ stderr "file:line  reason"          │
              │   └─ exit 0 / 1 / 2                       │
              └──────────────────────────────────────────┘
                             ▲
                             │  same binary
                             ▼
                ┌──────────────────────────┐
                │ GitHub Actions ci.yml    │  (.github/workflows/ci.yml:29-41)
                │  lint-english job +      │
                │  ◯ lockers step (NEW)    │
                │  → pnpm lint:lockers     │
                └──────────────────────────┘
```

### Recommended Project Structure

```
tools/
├── lint-no-env-branches.ts                  # LOCKER-01
├── lint-no-env-branches.test.ts             # 90/90/90/90 vitest
├── lint-no-env-branches.allowlist.txt       # seeded inventory
├── lint-no-env-branches/
│   └── fixtures/                            # fixture .ts files for tests
├── lint-no-suppressions.ts                  # LOCKER-02
├── lint-no-suppressions.test.ts
├── lint-no-suppressions.allowlist.txt
├── lint-no-suppressions/fixtures/
├── lint-no-hardcode.ts                      # LOCKER-03
├── lint-no-hardcode.test.ts
├── lint-no-hardcode.allowlist.txt
├── lint-no-hardcode/fixtures/
├── lint-prod-readiness.ts                   # LOCKER-04  (AST)
├── lint-prod-readiness.test.ts
├── lint-prod-readiness.allowlist.txt
├── lint-prod-readiness/fixtures/
├── lint-secret-shape-in-error.ts            # LOCKER-05  (AST)
├── lint-secret-shape-in-error.test.ts
├── lint-secret-shape-in-error.allowlist.txt
├── lint-secret-shape-in-error/fixtures/
├── lint-shell-credential-interpolation.ts   # LOCKER-06
├── lint-shell-credential-interpolation.test.ts
├── lint-shell-credential-interpolation.allowlist.txt
└── lint-shell-credential-interpolation/fixtures/

tests/e2e/
└── lockers.spec.ts                          # spawn each binary, assert exit+stderr
```

### Pattern 1: Regex-line-scan locker (LOCKER-01, -02, -03, -06)

**Canonical example:** `tools/lint-dockerfile-tls.ts:82-92` (FORBIDDEN regex array) + `:121-164` (findViolations) + `:166-198` (main).

```typescript
// SPDX-License-Identifier: FSL-1.1-ALv2
import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { exit } from "node:process";

const PATTERNS = ["apps/**/src/**/*.ts", "apps/**/src/**/*.tsx",
                  "packages/**/src/**/*.ts", "packages/**/src/**/*.tsx"];
const IGNORE = ["**/node_modules/**", "**/dist/**", "**/coverage/**",
                "**/.next/**", "**/__tests__/**", "**/*.test.ts"];

const FORBIDDEN: { regex: RegExp; label: string; remediation: string }[] = [
  { regex: /\bprocess\.env\.NODE_ENV\b/, label: "NODE_ENV-read",
    remediation: "read NODE_ENV ONLY in bootstrap.ts / config/*.ts / otel-bootstrap.ts; inject via DI" },
  // ...
];

export const ALLOWLIST_FILE = "tools/lint-no-env-branches.allowlist.txt";

export function readAllowlist(rootDir: string): Set<string> { /* mirror lint-dockerfile-tls.ts:104-114 */ }

export async function findViolations(rootDir: string): Promise<Violation[]> {
  /* mirror lint-dockerfile-tls.ts:121-164 EXACTLY — same glob + IGNORE +
     allowlist-consult-by-`file:line`-key + sort */
}

export async function main(argv: string[]): Promise<number> {
  /* mirror lint-dockerfile-tls.ts:166-198 EXACTLY */
}
```

### Pattern 2: AST-walk locker (LOCKER-04, -05)

**Canonical example:** `tools/lint-tenant-context.ts:80-98` (visit) + `:104-112` (scanFile) + `:118-143` (runLint).

```typescript
import ts from "typescript";
import { readFileSync } from "node:fs";

function findFastifyRouteCalls(src: ts.SourceFile): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // Match app.route / app.get / app.post / app.put / app.patch / app.delete
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        if (["route", "get", "post", "put", "patch", "delete"].includes(method)) {
          out.push(node);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(src);
  return out;
}
```

### Anti-Patterns to Avoid

- **Globbing into `tests/` / `__tests__/`** — production lockers MUST exclude test trees (`**/*.test.ts`, `**/__tests__/**`, `tests/**`) or every test fixture becomes a false positive.
- **Reading NODE_ENV inside the locker** — would self-flag. The lockers themselves live in `tools/`, which is OUT of the LOCKER-01 scope (`apps/**`, `packages/**`), but stay disciplined anyway.
- **Throwing on parse errors** — `ts.createSourceFile` never throws on bad TS; downstream visit MUST handle malformed input. Exit 2 only for I/O failure.
- **Forgetting `process.argv[1]`-detection guard** — entry point auto-runs MUST be gated behind `if (import.meta.url === `file://${process.argv[1]}`)` so vitest can import the module without executing CLI logic. See `lint-traefik-routes.ts:313` for the canonical guard.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript AST parsing | Custom regex-soup for class detection | `typescript` package's `ts.createSourceFile` | Already used 3× in tools/; handles every TS dialect feature. |
| File globbing | `readdirSync` recursion | Node 24 `node:fs/promises.glob` | Native, fast, exclude-aware (`lint-english.ts:105`). |
| Allowlist parsing | YAML / JSON / TOML | Plain-text one-path-per-line + `#` comments | `lint-dockerfile-tls.ts:104-114` already proves the pattern; PR-readable. |
| CLI binary invocation in e2e | `child_process.exec` (shell injection risk) | `child_process.execFileSync` or `spawn` with argv-array | `audit-archive.ts:66` uses `spawn(cmd, args, { shell: false })` correctly. |
| `as` cast suppression detection | TypeScript AST | Regex on text | `as any` / `as unknown as` are stable string tokens; regex is faster and AST adds no precision (biome already typechecks). |

**Key insight:** This phase is 100% tooling on already-established patterns. The repo has a high-fidelity reference implementation per locker shape; the work is mechanical mirroring + careful allowlist seeding.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — pure source-tree linters; no DB / cache / file state. | none |
| Live service config | None. | none |
| OS-registered state | None. | none |
| Secrets/env vars | None — lockers read source files, not env vars. | none |
| Build artifacts | The `tools/` directory ships as source-only `.ts` files invoked via `tsx`; no compiled artifacts. | none |

## Common Pitfalls

### Pitfall 1: Allowlist explosion
**What goes wrong:** Initial seed grows to 200+ entries and every PR adds 1–2 more "while we sort it out". The locker becomes a wishlist.
**Why:** Bulk-fix is hard work; allowlist additions feel cheaper.
**How to avoid:** Require a tracking-issue ID per allowlist entry (REQUIREMENT LOCKER-09); CI step diffs allowlist size between base and HEAD on PR — net additions REFUSE the PR unless commit body contains `Allowlist-grow-approved: yes`.
**Warning signs:** Allowlist line-count grows commit-over-commit; entries lack `# issue-NNNN` suffixes.

### Pitfall 2: False-positive on legitimate boundary code
**What goes wrong:** LOCKER-01 fires on `apps/api/src/index.ts:498` (the test-only short-circuit) and gets dismissed.
**Why:** Some `NODE_ENV` reads ARE legitimate at the boundary (bootstrap, OTel init, test-only short-circuits).
**How to avoid:** Seed the allowlist with the 13 current-main hits (Q8 list), each carrying `# pre-existing-debt` or `# legitimate-boundary` rationale. Future hits not in allowlist fail. **Crucially: `apps/api/src/index.ts:498` MUST be flagged for migration debt** — it bypasses production wiring at runtime and is a CR-grade issue per `.planning/review/REVIEW-INDEX.md`.

### Pitfall 3: Glob performance with biome already running pre-commit
**What goes wrong:** Lefthook runs biome + 8 other linters in parallel; adding 6 more locker glob-walks doubles wall-time.
**Why:** Each locker re-globs the world.
**How to avoid:** (a) lefthook `parallel: true` is already set (`lefthook.yml:4`); (b) per-locker `glob:` pre-filter (lefthook only invokes the hook when matching files are staged — see `lefthook.yml:18` `glob: "{apps,packages}/*/src/**/*.test.ts"`); (c) **CRITICAL: in lefthook, configure `glob:` to pass `{staged_files}` to the locker** so it only scans the diff, not the full tree. The full-tree scan still happens in CI.

### Pitfall 4: ts-morph cold-start overhead
**What goes wrong:** LOCKER-04 takes 4+ seconds on every pre-commit because ts-morph builds a Project graph.
**Why:** ts-morph eagerly resolves type info.
**How to avoid:** Use `import ts from "typescript"` directly (mirroring `lint-tenant-context.ts:59`) — no Project, just per-file `ts.createSourceFile`. Measure: `lint-tenant-context.ts` runs in ~1 s for 8 worker job files; a route-tree scan over ~30 routes should be ~3 s cold, ~1 s warm.

### Pitfall 5: lefthook + CI drift
**What goes wrong:** Developer adds a new locker to lefthook but forgets `ci.yml`; some commits land via `--no-verify` (legitimately, in parallel-worktree mode per DISCIPLINE Rule 9) and CI never re-runs the locker.
**Why:** Two separate config files.
**How to avoid:** Single shared shell script `make lint:lockers` invoked by BOTH lefthook (`run: make lint:lockers`) AND ci.yml (`run: make lint:lockers`). One source of truth. **`make lint:lockers` MUST `pnpm lint:lockers` which fan-outs to all six.**

### Pitfall 6: Allowlist-tampering inside the same PR
**What goes wrong:** A PR adds a violation AND adds it to the allowlist in the same diff; locker passes.
**Why:** Allowlist is consulted at scan time; locker doesn't know about git.
**How to avoid:** CI step `lockers-allowlist-diff`: checks out base, snapshots allowlists, checks out HEAD, diffs. Net-additions REFUSE the PR unless commit body contains an explicit `Allowlist-grow-approved: <tracking-issue-id>` token. (This step is part of LOCKER-09's "CI fails on net additions" requirement.)

### Pitfall 7: `app.route({})` AST shape across overloads
**What goes wrong:** LOCKER-04 reports false-positives because some `app.route(...)` calls pass a variable: `app.route(routeOptions)` instead of inline literal.
**Why:** Fastify accepts both.
**How to avoid:** When the first arg is NOT an `ObjectLiteralExpression`, follow the identifier back to its declaration in the SAME file and inspect the literal. If unresolvable (cross-file), emit a WARN-level finding tagged `LOCKER-04-UNRESOLVED` so the human can intercede. Document this in the locker's header comment.

## Code Examples

### LOCKER-01 — regex-based NODE_ENV detection (extends `lint-dockerfile-tls.ts` pattern)

```typescript
// tools/lint-no-env-branches.ts (sketch)
const FORBIDDEN = [
  { regex: /\bprocess\.env\.NODE_ENV\b/, label: "NODE_ENV-read" },
  { regex: /\bNODE_ENV\s*[!=]==/,        label: "NODE_ENV-compare" },
];
// IGNORE adds: "**/bootstrap.ts", "**/config/*.ts", "**/otel-bootstrap.ts", "**/*.config.ts"
```

### LOCKER-04 — AST sketch for Fastify route audit (Question 6 also)

```typescript
import ts from "typescript";

function auditFastifyRoute(call: ts.CallExpression, src: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const arg0 = call.arguments[0];
  if (!arg0 || !ts.isObjectLiteralExpression(arg0)) return findings;

  const props = new Map<string, ts.ObjectLiteralElementLike>();
  for (const p of arg0.properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
      props.set(p.name.text, p);
    }
  }

  // (a) schema check
  const schemaProp = props.get("schema");
  if (!schemaProp) {
    findings.push({ rule: "LOCKER-04-NO-SCHEMA", line: src.getLineAndCharacterOfPosition(call.pos).line + 1 });
  }
  // (b) rateLimit check  → look at config: { rateLimit: ... }
  const configProp = props.get("config");
  const configLiteral = configProp && ts.isPropertyAssignment(configProp) && ts.isObjectLiteralExpression(configProp.initializer)
    ? configProp.initializer : null;
  if (!configLiteral) {
    findings.push({ rule: "LOCKER-04-NO-RATELIMIT", line: ... });
  } else {
    const hasRateLimit = configLiteral.properties.some(
      p => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "rateLimit"
    );
    if (!hasRateLimit) findings.push({ rule: "LOCKER-04-NO-RATELIMIT", ... });
  }
  return findings;
}
```

### LOCKER-05 — `typescript`-direct AST sketch for Error-class field truncation (≤ 30 lines per quality gate)

```typescript
import ts from "typescript";

const FORBIDDEN_FIELDS = new Set(["bodyText", "responseBody", "upstreamPayload", "response", "body"]);
const TRUNCATING_METHODS = new Set(["slice", "substring", "substr"]);

function classExtendsError(cls: ts.ClassDeclaration): boolean {
  return !!cls.heritageClauses?.some(h =>
    h.token === ts.SyntaxKind.ExtendsKeyword &&
    h.types.some(t => ts.isIdentifier(t.expression) && /Error$/.test(t.expression.text)));
}

function ctorTruncatesField(ctor: ts.ConstructorDeclaration, field: string): boolean {
  let truncated = false;
  function visit(n: ts.Node) {
    if (truncated) return;
    // Match `this.<field> = <expr>.slice(...)` or `.substring(...)` or `truncate(...)`
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(n.left) && n.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
        n.left.name.text === field) {
      const rhs = n.right;
      if (ts.isCallExpression(rhs) && ts.isPropertyAccessExpression(rhs.expression) &&
          TRUNCATING_METHODS.has(rhs.expression.name.text)) truncated = true;
      if (ts.isCallExpression(rhs) && ts.isIdentifier(rhs.expression) && rhs.expression.text === "truncate") truncated = true;
    }
    ts.forEachChild(n, visit);
  }
  ctor.body && visit(ctor.body);
  return truncated;
}

function findLeakingErrorClasses(src: ts.SourceFile): Finding[] {
  const out: Finding[] = [];
  function visit(n: ts.Node) {
    if (ts.isClassDeclaration(n) && classExtendsError(n)) {
      const ctor = n.members.find(ts.isConstructorDeclaration);
      for (const m of n.members) {
        if (ts.isPropertyDeclaration(m) && ts.isIdentifier(m.name) && FORBIDDEN_FIELDS.has(m.name.text)) {
          const type = m.type && m.type.getText(src);
          if (type === "string" && (!ctor || !ctorTruncatesField(ctor, m.name.text))) {
            out.push({ rule: "LOCKER-05-LEAK", className: n.name?.text ?? "<anon>",
                       field: m.name.text, line: src.getLineAndCharacterOfPosition(m.pos).line + 1 });
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(src);
  return out;
}
```

### LOCKER-06 — shell credential interpolation detection

```typescript
// Regex-based; AST not required given the narrow shape.
// Trigger: source contains a template literal passed to spawn('bash', ['-c', ...]) / execSync / exec
//   AND the template literal references identifiers matching /(_URL|_KEY|_PASSWORD|_SECRET|_TOKEN)\b/
//
// Two-pass scan:
//   Pass 1: find `spawn\(\s*['"]bash['"]\s*,\s*\[\s*['"]\-c['"]` OR `execSync\(` OR `\bexec\(`
//   Pass 2: within the same statement (peek next 5 lines or until ;), search for
//           `\$\{[^}]*(_URL|_KEY|_PASSWORD|_SECRET|_TOKEN)`
//
// Current-main violator: apps/worker/src/jobs/audit-archive.ts:104-127 — `${dbUrl}` interpolated
// where `dbUrl = env("AUDIT_ARCHIVE_DATABASE_URL") ?? env("DATABASE_URL_OWNER")` (line 96).
```

## Detailed Question-by-Question Answers

### Q1 — Canonical linter structure

**Reference file (simplest):** `tools/lint-english.ts` (157 lines). Structure:
- SPDX header (line 2), file-doc (lines 3-28), shebang line 1.
- Constants: `PATTERNS[]` glob array (line 38-50), `IGNORE[]` allowlist-as-glob (line 52-80).
- `main(): Promise<void>` (line 89-151): resolve cwd, iterate `glob(pattern, {cwd, exclude})`, read file, regex per line, collect offenders, stderr summary, `exit(1)`.
- `main().catch(err => { exit(2) })` (line 153-156).

**Reference file (with separate allowlist FILE):** `tools/lint-dockerfile-tls.ts` (216 lines).
- `ALLOWLIST_FILE = "tools/lint-dockerfile-tls.allowlist.txt"` (line 48).
- `readAllowlist(rootDir): Set<string>` (line 104-114).
- `findViolations(rootDir): Promise<Violation[]>` exported for unit-testability (line 121-164).
- `main(argv): Promise<number>` exported, returns exit code (line 166-198).
- Sort comparator with `/* c8 ignore */` annotations for unreachable branches (line 154-162).
- Entry-point detection via `process.argv[1]` filename check (line 200-216).

**Simplest mimic for LOCKERS 01/02/03/06 (regex):** `lint-dockerfile-tls.ts`. Single regex array → `find` → `report`. ~200 lines per locker.

**Heaviest mimic for LOCKERS 04/05 (AST):** `tools/lint-tenant-context.ts` (217 lines). Uses `import ts from "typescript"`, `ts.createSourceFile`, recursive `visit(node)` with `ts.forEachChild`. Exported `runMain(deps)` for test injection. Auto-run gated on `import.meta.url === _argvUrl` (lines 206-217).

**Test fixture pattern:** `tools/__tests__/fixtures/` holds inline `.ts` fixture files; the test reads them via the linter's `findViolations(fixtureDir)` then asserts the array shape. See `tools/__tests__/lint-dockerfile-tls.test.ts` for the canonical pattern.

**Coverage gate:** `package.json:30` for `test:lint-colocated-tests` shows the exact incantation:
```
vitest run tools/lint-colocated-tests.test.ts --coverage --coverage.include=tools/lint-colocated-tests.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90
```

### Q2 — AST tooling availability

**`ts-morph` 28.0.0** is installed at root (`package.json:81`). Used by `tools/migrate-tests.ts:35` only.
**`typescript` 6.0.3** is also installed at root (`package.json:83`). Used DIRECTLY (no ts-morph wrapper) by 3 existing linters:
- `tools/lint-await-in-non-async.ts:21` — `import ts from "typescript";`
- `tools/lint-colocated-tests.ts:38` — `import ts from "typescript";`
- `tools/lint-tenant-context.ts:59` — `import ts from "typescript";`

**Recommendation:** Use `import ts from "typescript"` directly for LOCKER-04 and LOCKER-05. Rationale:
1. Three existing linters establish the pattern; uniform style across the locker family.
2. `ts.createSourceFile` is per-file, zero-Project bootstrap, fast cold-start.
3. ts-morph's Project model is overkill — neither LOCKER-04 nor LOCKER-05 needs cross-file type resolution; both operate on AST shape of a single file.

`ts-morph` is acceptable if a planner determines its `Class`/`Constructor` query helpers materially simplify LOCKER-05. The verifier MUST NOT reject either choice — both are pre-installed and used in the repo.

### Q3 — Fastify route declaration patterns

Sampled 5 representative routes:

1. `apps/api/src/routes/transcribe.ts:67` — `app.route({ ... })`
2. `apps/api/src/routes/usage.ts:36-39` — `app.route({ ... method, url, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } })`
3. `apps/api/src/routes/capabilities.ts:148-151` — `app.route({ ... config: { rateLimit: { max: 120, timeWindow: "1 minute" } } })`
4. `apps/api/src/routes/auth-providers.ts:73-78` — `app.route({ ... config: { rateLimit: { max: 60, timeWindow: "1 minute" } } })`
5. `apps/api/src/routes/probes.ts:82-123` — FOUR `app.route({ ... config: { auth: false, rateLimit: false } })` calls (health/readiness probes).

**Total `app.route|get|post|put|patch|delete` call-sites in `apps/api/src/routes/*.ts`** (excluding `.test.ts`): **25 hits** (grep count).

**`app.<method>(...)` form** (not `app.route`): only 4 hits, ALL in `apps/api/src/routes/test-only.ts` (lines 143, 156, 211, 233) — these are test-only routes registered only under `NODE_ENV=test`. They use `app.get/post(url, { config: { rateLimit: false } }, handler)` shape.

**Recommendation for LOCKER-04:** Match ALL of `route|get|post|put|patch|delete` as `app.<method>(...)` call-expressions (handle both shapes: `app.route({...})` and `app.get(url, opts, handler)`). For the second shape, the options object is the SECOND argument, not the first.

**Plugin-registered case:** `app.register(plugin, opts)` does NOT declare a route directly; routes live inside the plugin's body. Recommend SKIPPING `app.register` calls in LOCKER-04 — they're not in scope.

### Q4 — Zod schema import locations

Three distinct sources observed:
1. **`@openwhispr/contract-tests/schemas`** — `apps/api/src/routes/delete-account.ts:54`, `check-user.ts:22`, `diarization.ts:43`, `reason.ts:36`, `verification-status.ts:21`.
2. **`@openwhispr/wire-schemas`** — `apps/api/src/routes/streaming-usage.ts:36`.
3. **Inline `from "zod"`** — `apps/api/src/routes/setup-admin.ts:47`.

**Recommendation for LOCKER-04:** The locker checks the AST SHAPE of `schema: { body: <expr> }` / `schema: { querystring: <expr> }` / `schema: { params: <expr> }` and accepts ANY identifier as `<expr>` (so all three import sources work). Don't try to resolve the import — just verify the property is present and non-null. Cross-package zod-schema-detection is fragile; existence-of-schema-property is sufficient.

### Q5 — Rate-limit configuration shape

Working example: `apps/api/src/routes/usage.ts:39`:
```typescript
config: { rateLimit: { max: 120, timeWindow: "1 minute" } }
```

`rateLimit: false` legitimate sites:
- `apps/api/src/routes/probes.ts:85,92,114,123` — health/readiness probes (kubelet probes at periodSeconds=10 × 1000 pods would otherwise rate-limit themselves; explicit comment at probes.ts:25 documents this).
- `apps/api/src/routes/test-only.ts:143,156,211,233` — test-only routes; gated behind NODE_ENV=test.

**Recommendation:** LOCKER-04 allows `rateLimit: false` ONLY for `/api/health`, `/api/ready`, `/api/healthz`, `/api/_test/*` URLs (substring match on the `url:` property of the same object literal). Everything else MUST have `rateLimit: { ... }`.

### Q6 — Error-class field truncation AST sketch

See **Code Examples → LOCKER-05** above (29 lines, meets ≤ 30-line quality gate). The matcher:
1. Walk `ts.ClassDeclaration`s whose heritage extends a `*Error` identifier.
2. For each `ts.PropertyDeclaration` whose name is in `{bodyText, responseBody, upstreamPayload, response, body}` AND type is `string`:
3. Find the class's `ts.ConstructorDeclaration` and walk its body.
4. Look for `BinaryExpression(=, PropertyAccess(this, <field>), Call(...slice|substring|substr|truncate))`.
5. If no truncation found, emit a finding tagged `LOCKER-05-LEAK`.

**Verified violator:** `packages/litellm-client/src/errors.ts:31` — `public readonly bodyText: string;` constructed at line 40 as `this.bodyText = bodyText` with NO truncation (only `message` is sliced at line 37).

### Q7 — Shell credential interpolation call-sites

Full grep of `apps/**/src/**` and `packages/**/src/**` for `spawn|execSync|exec(`:
- `apps/api/src/middleware/dual-auth.ts:218` — `/^Bearer\s+(.+)$/i.exec(value)` (regex `.exec`, NOT child_process `exec` — false positive on grep; LOCKER-06 regex MUST exclude regex-method-exec).
- `apps/api/src/routes/test-only.ts:77` — same regex `.exec` pattern.
- `apps/api/src/routes/desktop-signin.ts:64` — same regex `.exec` pattern.
- `apps/worker/src/jobs/audit-archive.ts:23,66,106,115,127` — **the only real child_process call-site.** Uses `spawn(cmd, args, { shell: false })` correctly at line 66, but lines 106/115/127 construct the `args` array as `["-c", "${pg_dump --table=public.${partition} --data-only \"${dbUrl}\" | gzip -c | mc pipe ...}"]` — i.e. interpolates `${dbUrl}` (which IS DATABASE_URL with password — line 96) into a shell script string. **THIS IS THE CR-5 SOURCE.**

**LOCKER-06 design implication:** Regex can be aggressive (the violator set is small). Exclude `.exec()` regex-method calls (regex method has `.` before `exec`; child_process exec has no `.`). Approach:
- Match `\bspawn\s*\(\s*['"]bash['"]` followed within ~10 lines by a template literal containing `\$\{[^}]*(_URL|_KEY|_PASSWORD|_SECRET|_TOKEN)`.
- ALSO match `\b(execSync|execFile|execFileSync)\s*\(` with same template-literal guard.

### Q8 — NODE_ENV inventory

**Count: 13 hits across 8 files** (greppattern: `process\.env\.NODE_ENV|NODE_ENV ?[!=]==` in `apps/*/src` + `packages/*/src`, excluding `.test.ts` / `__tests__/` / `test-only`).

Full list (the LOCKER-01 seed allowlist):
| File:Line | Disposition |
|-----------|-------------|
| `apps/api/src/index.ts:494,498` | **Migration debt** — production short-circuit branching on NODE_ENV=test (CR-grade). Allowlist with `# migration-debt-issue-NNNN`. |
| `apps/api/src/auth.ts:424` | **Legitimate boundary** — `useSecureCookies: NODE_ENV === "production"` at Better Auth construction time. Should move to a `config/` module. Allowlist with `# pre-existing-boundary`. |
| `apps/api/src/lib/ssrf-dispatcher.ts:59,163` | **Mostly legitimate** — env passed via DI (`opts.nodeEnv ?? process.env.NODE_ENV` at line 163). Comment at 59 is fine. Allowlist line 163 with `# DI-fallback`. |
| `apps/api/src/routes/index.ts:474` | **Migration debt** — production short-circuit. Allowlist + tracking issue. |
| `apps/api/src/routes/__test/fetch.ts:18,60` | **Legitimate test-only** — file path includes `__test/`. Locker should EXCLUDE `**/__test/**` in IGNORE, so these vanish from inventory after exclusion adjustment. |
| `apps/worker/src/jobs/email-delivery.ts:80,95` | **Boundary** — DI fallback at job construction. Allowlist line 95. |
| `packages/byok-guard/src/index.ts:221` | **Boundary** — refuses to enable guard outside production. Allowlist with `# boundary-check`. |
| `packages/email/src/EmailSender.ts:7,79` | **Boundary** — refuses dev fallback in production. Allowlist line 79. |

**Net seed allowlist size: 11 entries** (after excluding the 2 `__test/` paths via IGNORE glob). 4 entries are CR-grade migration debt requiring follow-on tracking issues.

### Q9 — Type suppression inventory

**Count: 36 hits across 13 files.**

| Pattern | Count | Notes |
|---------|-------|-------|
| `as any` | 10 | 8 are in `apps/worker/src/db/app-pool.ts:70-142` (pg-pool type erasure for tenant-context wrapping); 1 in `apps/web/src/lib/form-utils.ts:34`; 1 in `packages/data/src/seed/conformance.ts:241`. |
| `as unknown as` | 26 | Most are in `apps/api/src/index.ts` (8 hits) — TransactionalDb / RedisLike / AuthLike type-bridging at boot. |
| `@ts-ignore` | **0** | ZERO uses in production code. Clean. |
| `@ts-expect-error` | **0** | ZERO uses in production code. Clean. |
| `@ts-nocheck` | **0** | ZERO uses in production code. Clean. |

**LOCKER-02 seed allowlist:** 36 entries. **Strategy:** seed AS-IS, label every entry `# pre-existing-debt`. The `@ts-ignore`/`@ts-nocheck`/`@ts-expect-error` rules are pure-enforcement (no current violations).

**Sample 10:**
1. `apps/web/src/lib/form-utils.ts:34` — `args.schema as any`
2. `apps/worker/src/db/app-pool.ts:70` — `(origConnect as any)(cb)`
3. `apps/worker/src/db/app-pool.ts:74` — `(await (origConnect as any)())`
4. `apps/worker/src/db/app-pool.ts:110` — `(origQuery as any)(...args)`
5. `apps/worker/src/db/app-pool.ts:128` — `(await (origConnect as any)())`
6. `apps/worker/src/db/app-pool.ts:136` — `(probeClient.query as any)(...args)`
7. `apps/worker/src/db/app-pool.ts:142` — `(origPoolQuery as any)(...args)`
8. `packages/data/src/seed/conformance.ts:241` — `(import.meta as any).url`
9. `apps/api/src/error-handler.ts:226` — `req as unknown as { i18n?: ... }`
10. `apps/api/src/index.ts:288` — `opts.db as unknown as TransactionalDb<ExecutableTx>`

### Q10 — Hardcode inventory

**Count: 24 hits across 14 files** (combined: localhost + IP + ports + UUID-zero; secret-shapes are ZERO).

Sub-counts:
- `localhost` string in source: **3 hits** — `apps/api/src/auth.ts:237` (`"http://localhost:3000"`), `apps/api/src/routes/test-only.ts:181` (`"http://localhost:3000"`), `apps/api/src/routes/better-auth-handler.ts:49` (`"localhost"` default). (Comment hits in `cookie-domain.ts:21,34,41` are in source comments — locker should NOT flag comments, or accept the false positive and allowlist.)
- `127.0.0.1`: **0 hits**.
- `:3000` / `:4000` / `:8080` port literals: **13 hits**. Highlights: `apps/api/src/index.ts:656` (`http://litellm:4000`), `apps/api/src/auth.ts:237` (`http://localhost:3000`), 6 hits in `apps/web/src/app/(auth)/app/**/page.tsx` (`http://api:3000`), `apps/web/src/lib/auth-actions.ts:22`, `apps/web/src/lib/auth-server.ts:47`, `packages/litellm-client/src/config.ts:29` (`http://litellm:4000`).
- UUID-zero `00000000-0000-0000-0000-000000000000`: **8 hits** in 6 files. `apps/api/src/middleware/tenant.ts:44`, `apps/api/src/auth.ts:330,380`, `apps/api/src/lib/default-tenant.ts:5,19`, `apps/api/src/routes/setup-admin.ts:55`, `packages/data/src/seed/conformance.ts:35`, `packages/data/src/schema/tenants.ts:4`. **Note:** the UUID-zero is the canonical DEFAULT_TENANT_ID — every hit IS legitimate. Allowlist all 8 with `# default-tenant-canonical`.
- `sk-`, `AIza`, `AKIA`: **0 hits**. Clean.

**LOCKER-03 seed allowlist:** ~24 entries (the UUID-zero hits are legitimate forever; the port/localhost hits should ALL be migrated to env-driven defaults — they're CR-grade leak points if the proxy header isn't trusted).

### Q11 — lefthook + CI wiring

**Lefthook canonical block for adding a locker** (mirroring `lefthook.yml:33-35`):

```yaml
# lefthook.yml — append inside pre-commit.commands
lockers:
  glob: "{apps,packages}/*/src/**/*.{ts,tsx}"
  run: pnpm lint:lockers
```

**CI canonical step** (mirroring `.github/workflows/ci.yml:29-41`'s `lint-english` job):

```yaml
# .github/workflows/ci.yml — append a new job
lockers:
  runs-on: ubuntu-24.04
  steps:
    - uses: actions/checkout@v5
    - uses: pnpm/action-setup@v4
      with: { version: 11.0.8 }
    - uses: actions/setup-node@v5
      with: { node-version: '24', cache: 'pnpm' }
    - run: pnpm install --frozen-lockfile
    - run: pnpm lint:lockers
    # LOCKER-09: net-addition guard
    - run: pnpm lint:lockers-allowlist-diff
```

Or, more conservatively, add lockers as additional `pnpm lint:*` lines inside the existing `lint-english` job (matches `ci.yml:38-41` precedent of stacking lint steps).

**`make lint:lockers` target** (mirroring `Makefile:21-23`):

```makefile
lint\:lockers:
	pnpm lint:lockers
```

And in `package.json`:
```json
"lint:lockers": "tsx tools/lint-no-env-branches.ts && tsx tools/lint-no-suppressions.ts && tsx tools/lint-no-hardcode.ts && tsx tools/lint-prod-readiness.ts && tsx tools/lint-secret-shape-in-error.ts && tsx tools/lint-shell-credential-interpolation.ts"
```

### Q12 — Discipline-doc atomic commit pattern

Most recent DISCIPLINE.md commits (`git log --format="%h %s" -5 -- .planning/DISCIPLINE.md CLAUDE.md`):

| SHA | Subject |
|-----|---------|
| `bccc8a6` | `docs(claude-md): hard rule #3 — verify before reporting "done" from sub-agents` |
| `9643b92` | `docs(claude-md): codify hard rules — never edit prod code to fix tests` |
| `5f1a1e4` | `docs(discipline): codify constitutional TDD/coverage/E2E rules across all phases` |

**Convention:** Subject form `docs(<area>): <imperative summary>`. The DISCIPLINE-codification commit (`5f1a1e4`) shipped `.planning/DISCIPLINE.md` + `CLAUDE.md` updates in a single atomic commit. **LOCKER-07 mirrors this.**

For Phase 31's atomic commit: subject `docs(31): DISCIPLINE Rules 11–14 + lockers go-live`. Files in the single commit: `.planning/DISCIPLINE.md`, `CLAUDE.md`, all six `tools/lint-*.ts`, all six `tools/lint-*.test.ts`, all six allowlists, `lefthook.yml`, `.github/workflows/ci.yml`, `.github/workflows/nightly.yml`, `Makefile`, `package.json`, `tests/e2e/lockers.spec.ts`.

This violates the per-task-atomic-commit principle of the executor's RED→GREEN cadence, so the practical approach is: each of 31-01..31-06 lands as its own atomic commit (linter + tests + allowlist + DISCIPLINE entry for that rule); 31-07 lands the wiring + e2e in a single commit; 31-08 ships bulk fixes as ≤ 50-file atomic commits.

### Q13 — E2E test layout

E2E tests live in `/Users/nick/openwhispr-server/tests/e2e/`. Spec files follow `phase-NN-<name>.spec.ts` (e.g., `phase-05-conversations.spec.ts`) or `<feature>.e2e.test.ts` patterns.

**Recommended file:** `tests/e2e/lockers.spec.ts`. Spawn pattern (zero-new-dep):

```typescript
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("LOCKER-01 refuses NODE_ENV branch", () => {
  const dir = mkdtempSync(join(tmpdir(), "lockers-"));
  writeFileSync(join(dir, "src/handler.ts"), `if (process.env.NODE_ENV === 'production') {}`);
  expect(() =>
    execFileSync("pnpm", ["exec", "tsx", "tools/lint-no-env-branches.ts", dir], { stdio: "pipe" })
  ).toThrow(/NODE_ENV-read/);
});
```

`execa` is NOT a direct dependency; using `node:child_process.execFileSync` keeps the e2e zero-new-dep. (`execa` lives transitively via `@playwright/test` but importing transitives is fragile.)

### Q14 — Pitfalls when shipping repo-wide blocking linters

See **Common Pitfalls** above (Pitfalls 1-7) — directly addresses (a) allowlist explosion, (b) boundary-code false positives, (c) glob performance vs biome, (d) ts-morph cold-start, (e) lefthook+CI drift, plus (f) AST shape across overloads and (g) allowlist tampering inside same PR.

### Q15 — Sequencing within Phase 31 — LOCKER-04 strategy

LOCKER-04 will produce a **large** finding count: every existing route MAY lack one of {schema, rateLimit} OR may have schema imported from a non-zod source. From Q3+Q4: of 25 `app.route` call sites, only 7 routes have BOTH a `schema:` import (from `@openwhispr/contract-tests/schemas` or `@openwhispr/wire-schemas`) AND an explicit `config: { rateLimit: ... }`. The other ~18 routes will need bulk-fix.

**Recommended sub-plan ordering for Phase 31:**

| Order | Plan | Risk | Rationale |
|-------|------|------|-----------|
| 1 | 31-01 (lint-no-env-branches) | LOW | 13 hits / 8 files; allowlist seedable in one PR. BLOCKING mode from day one. |
| 2 | 31-02 (lint-no-suppressions) | LOW | 36 hits / 13 files; zero `@ts-ignore` family. BLOCKING. |
| 3 | 31-03 (lint-no-hardcode) | LOW | 24 hits / 14 files; UUID-zero is canonical-forever-allowlisted. BLOCKING. |
| 4 | 31-06 (lint-shell-credential-interpolation) | LOW | 1 hit (`audit-archive.ts` — CR-5). LOCKER-06 itself is the regression guard for Phase 36's CR-5 fix. **Land WARN-only** until Phase 36 lands the actual fix, then flip to BLOCKING during Phase 36's commit. |
| 5 | 31-05 (lint-secret-shape-in-error) | LOW | 1 hit (`packages/litellm-client/src/errors.ts:31` — CR-9). Same WARN→BLOCKING pattern as 31-06; flip at Phase 37 close. |
| 6 | 31-04 (lint-prod-readiness) | **HIGH** | ~18 route violations + uncounted dead-export violations. **Land WARN-only with seeded allowlist; flip to BLOCKING after Phase 31-08 bulk-fix.** |
| 7 | 31-07 (DISCIPLINE.md + CLAUDE.md + lefthook + ci.yml + nightly.yml + Makefile + e2e) | MED | Atomic commit per LOCKER-07. |
| 8 | 31-08 (bulk-fix MEDIUM/LOW violations) | MED | Per-area atomic commits ≤ 50 files. Ends with LOCKER-04 flipped to BLOCKING. |

**Critical recommendation for 31-04:** Implement a `--warn-only` flag on the locker. Lefthook + CI initially run `pnpm lint:prod-readiness --warn-only` (exit 0 even on findings; stderr printed for visibility). After 31-08 closes the bulk-fix, a follow-on commit inside 31-07 removes `--warn-only`. This avoids 31-04 + 31-08 being a single 100-file mega-commit and lets each route fix be a small atomic PR.

**Why this order:** the four LOW-risk regex lockers ship first as confidence-builders and start catching regressions immediately. The two AST lockers (CR-9 + CR-5 guards) ship in WARN-mode awaiting their cognate phase. LOCKER-04 ships LAST (most invasive) and only goes BLOCKING after bulk-fix.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Externally-installed `glob` npm package | `node:fs/promises.glob` (Node 24 native) | Node 22+ | Zero new deps; cwd-aware; exclude-aware. Pattern in `lint-english.ts:30`. |
| ts-morph everywhere AST is touched | `import ts from "typescript"` direct, per-file | Phase 6 onward (`lint-tenant-context.ts`) | Lower cold-start; uniform style. |
| Allowlist as JSON / YAML | Plain text one-per-line + `#` comments | Phase 17 onward (`lint-dockerfile-tls.allowlist.txt`) | PR-readable diffs; trivial git-blame. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `node:fs/promises.glob` exists at runtime in Node 24 (CI uses node 24 per `ci.yml`) | Standard Stack | LOW — verified live: `node -e "const fs=require('node:fs/promises'); console.log(typeof fs.glob)"` → `function`. |
| A2 | `ts.createSourceFile` on every file in `apps/**/src/**` parses without errors | LOCKER-04/05 sketch | LOW — TypeScript-direct parser is the same one `tsc` uses; if a file doesn't parse, biome already failed pre-commit before the locker runs. |
| A3 | `execFileSync` is sufficient for e2e binary invocation (no execa dep needed) | Q13 | LOW — `audit-archive.ts:23` uses `child_process.spawn` already; same shape works for sync exec. |
| A4 | `app.register(plugin, ...)` need not be audited by LOCKER-04 | Q3 | MEDIUM — IF a plugin registers routes directly with `fastify.route` (rebound name), LOCKER-04 won't see them. Mitigation: scan also for `fastify.route|get|post...` patterns alongside `app.*`. Recommend adding both name-roots to the matcher. |
| A5 | The 8 UUID-zero hits are all canonical-default-tenant references | Q10 | LOW — verified by file:line read; all 8 are explicit `DEFAULT_TENANT_ID` constants. |

## Open Questions

1. **`tests/e2e/lockers.spec.ts` framework — Playwright `test` or vitest?**
   - Existing `tests/e2e/*.spec.ts` mix Playwright (most `.spec.ts`) and vitest (`*.test.ts`). The locker e2e is a pure CLI invocation, no browser. Recommend vitest at `tests/e2e/lockers.test.ts` to avoid Playwright bootstrap overhead.
   - Resolution: planner's call. Either works. CONTEXT.md says `.spec.ts` so Playwright is implied — but vitest is fine because the spec doesn't touch a browser.

2. **`@ts-expect-error` reason+issue-ID enforcement format?**
   - LOCKER-02 says "require `@ts-expect-error` to carry a reason + issue ID" but current main has ZERO `@ts-expect-error` uses. Format proposal: `// @ts-expect-error issue-NNNN: short reason here`. Locker regex: `@ts-expect-error\s+issue-\d+:\s+\S`. Document this in the locker header + DISCIPLINE Rule 12 prose.
   - Resolution: planner picks a format; advisor-agent if dispute arises.

3. **LOCKER-04 dead-export detection — full repo or per-package?**
   - "Every exported symbol MUST have ≥ 1 non-test importer." Naive implementation requires building a full import-graph (expensive). Alternative: tsc-resolved cross-file analysis via ts-morph Project (the one place ts-morph IS justified). Recommend deferring dead-export detection to 31-04b (sub-plan inside 31-04) — ship route-zod-ratelimit checks first; dead-export second. **Reduces 31-04 scope by ~50%.**
   - Resolution: planner decides; advisor consultable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 24 | tsx, glob | ✓ | 24.x (per `package.json:7-9`) | — |
| pnpm 11.x | All scripts | ✓ | 11.0.8 | — |
| `tsx` | Run linters | ✓ | latest (root devDep) | — |
| `typescript` | AST walks | ✓ | 6.0.3 | — |
| `ts-morph` | Optional for LOCKER-04/05 | ✓ | 28.0.0 | typescript-direct (preferred) |
| `vitest` | Test suites | ✓ | 4.1.5 | — |
| `@vitest/coverage-v8` | Coverage gate | ✓ | 4.1.5 | — |
| `lefthook` | Pre-commit | ✓ | 2.1.6 | — |
| `execa` | E2E binary spawn | ✗ | — | `node:child_process.execFileSync` |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** `execa` — use `execFileSync` instead (zero new deps).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.5 + `@vitest/coverage-v8` 4.1.5 |
| Config file | repo-root `vitest.config.ts` (where tests resolve from); per-script coverage flags are inlined in `package.json` `test:lint-*` entries |
| Quick run command | `pnpm test:lint-no-env-branches` (per-locker, ~5s) |
| Full suite command | `pnpm lint:lockers && pnpm test:lockers` (where `test:lockers` runs all six per-locker test scripts) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| LOCKER-01 | Refuses NODE_ENV read in `apps/api/src/handler.ts` | unit | `pnpm test:lint-no-env-branches` | ❌ Wave 0 |
| LOCKER-02 | Refuses `as any` outside allowlist | unit | `pnpm test:lint-no-suppressions` | ❌ Wave 0 |
| LOCKER-03 | Refuses `"http://localhost:3000"` outside allowlist | unit | `pnpm test:lint-no-hardcode` | ❌ Wave 0 |
| LOCKER-04 | Refuses `app.route({ url, handler })` lacking schema | unit + e2e | `pnpm test:lint-prod-readiness` | ❌ Wave 0 |
| LOCKER-05 | Refuses `class X extends Error { public bodyText: string }` without truncation | unit | `pnpm test:lint-secret-shape-in-error` | ❌ Wave 0 |
| LOCKER-06 | Refuses `spawn('bash', ['-c', \`...${DATABASE_URL}...\`])` | unit | `pnpm test:lint-shell-credential-interpolation` | ❌ Wave 0 |
| LOCKER-07 | DISCIPLINE.md mentions Rules 11–14; CLAUDE.md mirrors | doc-grep test | inline assertion in `tests/e2e/lockers.spec.ts` | ❌ Wave 0 |
| LOCKER-08 | `pnpm lint:lockers` runs all six; `make lint:lockers` invokes pnpm | smoke | `make lint:lockers` | ❌ Wave 0 |
| LOCKER-09 | Allowlist net-addition refused | CI-only | `pnpm lint:lockers-allowlist-diff` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:lint-<name>` for the locker being edited.
- **Per wave merge:** `pnpm lint:lockers && pnpm test:lockers && pnpm test:e2e --filter lockers`.
- **Phase gate:** all six per-locker test scripts green at 90/90/90/90, plus the e2e suite, before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `tools/lint-no-env-branches.test.ts` — covers LOCKER-01
- [ ] `tools/lint-no-suppressions.test.ts` — covers LOCKER-02
- [ ] `tools/lint-no-hardcode.test.ts` — covers LOCKER-03
- [ ] `tools/lint-prod-readiness.test.ts` — covers LOCKER-04
- [ ] `tools/lint-secret-shape-in-error.test.ts` — covers LOCKER-05
- [ ] `tools/lint-shell-credential-interpolation.test.ts` — covers LOCKER-06
- [ ] `tests/e2e/lockers.spec.ts` (or `.test.ts`) — e2e binary invocation
- [ ] Six new `test:lint-<name>` scripts in root `package.json`
- [ ] Six new `lint:<name>` scripts in root `package.json` + `lint:lockers` aggregate
- [ ] Lefthook `lockers` block in `lefthook.yml`
- [ ] `.github/workflows/ci.yml` lockers job
- [ ] `.github/workflows/nightly.yml` lockers job
- [ ] `Makefile` `lint:lockers` target

Framework install: NONE — vitest + typescript + ts-morph + lefthook all pre-installed.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Pure tooling phase. |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes (meta) | LOCKER-04 enforces zod schema-validation on every Fastify route — turns V5 into a mechanically-enforced invariant. |
| V6 Cryptography | no (but LOCKER-05 indirectly enforces "no plaintext upstream secrets in error logs" — defence-in-depth for V6) | — |
| V7 Error Handling and Logging | yes | LOCKER-05 directly enforces "errors do not leak upstream payloads"; the CR-9 fix in Phase 37 closes the actual leak. |
| V14 Configuration | yes | LOCKER-01 enforces "runtime configuration is injected, not env-checked at every call-site". |

### Known Threat Patterns for tsx-CLI + Fastify stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell command injection via env-var interpolation | Tampering / EoP | LOCKER-06 refuses the pattern. CR-5 was the concrete instance. |
| Upstream-body PII leak via pino-serialized Error fields | Information Disclosure | LOCKER-05 refuses untruncated public string fields on Error subclasses. CR-9 was the concrete instance. |
| Route deployed without input validation (zod schema) | Tampering | LOCKER-04 refuses Fastify route declarations missing `schema:`. |
| Rate-limit absence → DoS | DoS | LOCKER-04 refuses Fastify routes missing `config: { rateLimit }`. |
| Unbounded test-only short-circuits in production | EoP | LOCKER-01 refuses NODE_ENV branches in runtime paths. |
| Stale secret-shape literals committed to source | Information Disclosure | LOCKER-03 refuses `sk-...` / `AIza...` / `AKIA...` literals; current main is clean (zero hits). |

## Sources

### Primary (HIGH confidence)

- `tools/lint-english.ts` (157 lines) — canonical regex-line-scan linter shape
- `tools/lint-dockerfile-tls.ts` (216 lines) — canonical regex + allowlist-file pattern
- `tools/lint-tenant-context.ts` (217 lines) — canonical `typescript`-direct AST walk
- `tools/lint-traefik-routes.ts` — canonical recent linter with YAML inspection
- `tools/__tests__/lint-dockerfile-tls.test.ts` — co-located test pattern
- `lefthook.yml:3-55` — hook block pattern
- `.github/workflows/ci.yml:25-41` — CI lint-job pattern
- `package.json:14-30` — script + coverage-flag pattern
- `Makefile:1-32` — lint target pattern
- `.planning/DISCIPLINE.md` — Rules 1-10 source-of-truth, Rules 11-14 to be added
- `.planning/REQUIREMENTS.md:614-622,661-669` — LOCKER-01..09 requirements
- `.planning/ROADMAP.md:1085-1097` — Phase 31 definition
- `.planning/review/REVIEW-INDEX.md:32,75,89,103,107` — CR-5, CR-7, CR-9 anchors
- `.planning/phases/31-constitutional-lockers/31-CONTEXT.md` — phase scope

### Secondary (MEDIUM confidence)

- Inventory greps (counts above) — re-run before plan to confirm freshness.

### Tertiary (LOW confidence)

- None — every claim is sourced to a file:line in working tree.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep verified installed via `node_modules` introspection.
- Architecture: HIGH — three existing AST linters + ten existing regex linters supply the exact pattern.
- Pitfalls: HIGH — pitfall 6 (allowlist-tampering) is novel for this phase; the rest are common-knowledge.
- Inventories: HIGH — direct grep counts on working tree at HEAD `1832f28`.

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days — repo stable enough that grep counts won't shift dramatically; if Phase 32+ lands first, re-run inventory greps before Phase 31 starts).
