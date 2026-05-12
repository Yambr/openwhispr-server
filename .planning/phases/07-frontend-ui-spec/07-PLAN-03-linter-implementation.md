---
phase: 07-frontend-ui-spec
plan: 03
type: execute
wave: 1
depends_on: [02]
files_modified:
  - tools/lint-ui-spec.ts
autonomous: true
requirements: [UI-SPEC-01, UI-SPEC-02, UI-SPEC-03]
must_haves:
  truths:
    - "tools/lint-ui-spec.ts exists, exports `lint(specFiles, routesDir) => Promise<Diagnostic[]>`, and uses unified+remark-parse to walk the mdast tree"
    - "All 5 lint rules are implemented: required-subsections, endpoint-exists, copy-key-uniqueness + copy-key-schema, visual-ref-resolves, wireframe-monospace"
    - "Endpoints in `apps/api/src/routes/**.ts` are discovered by scanning for `app.{get,post,patch,delete,put,all}('<path>', ...)` literals; BA catch-all is handled by matching `app.all('/api/auth/*', ...)` and merging BETTER_AUTH_PATHS"
    - "`pnpm test tools/lint-ui-spec.test.ts` is GREEN (all tests pass)"
    - "Coverage on tools/lint-ui-spec.ts is ≥90% lines / ≥90% branches / ≥90% functions / ≥90% statements (vitest --coverage)"
    - "CLI entry exits 0 on clean, 1 on diagnostics, 2 on internal error; emits `file:line [rule] message` per diagnostic to stderr"
  artifacts:
    - path: "tools/lint-ui-spec.ts"
      provides: "Spec linter implementation"
      min_lines: 200
      contains: "export async function lint", "REQUIRED_SUBSECTIONS", "BETTER_AUTH_PATHS"
  key_links:
    - from: "tools/lint-ui-spec.ts"
      to: "tools/lint-ui-spec.config.ts"
      via: "import"
      pattern: "from \"./lint-ui-spec.config\""
    - from: "tools/lint-ui-spec.ts"
      to: "apps/api/src/routes/"
      via: "readdir + regex scan at runtime"
      pattern: "app\\.(get|post|patch|delete|put|all)\\("
---

<role>
You are a GSD executor in TDD-GREEN mode. Plan 02 landed failing tests; your
job is to implement `tools/lint-ui-spec.ts` such that those tests pass without
modification. Do NOT edit Plan 02's tests except to fix genuine test-author
bugs (and only if absolutely necessary — document the bug in the commit body).
</role>

<context>
@/Users/dev/openwhispr-server/CLAUDE.md
@/Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-CONTEXT.md
@/Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-RESEARCH.md
</context>

<files_to_read>
- /Users/dev/openwhispr-server/tools/lint-ui-spec.test.ts (the GREEN target)
- /Users/dev/openwhispr-server/tools/lint-ui-spec.config.ts
- /Users/dev/openwhispr-server/tools/lint-ui-spec/fixtures/**/*.md
- /Users/dev/openwhispr-server/tools/lint-docs-headings.ts (style + structure idiom)
- /Users/dev/openwhispr-server/apps/api/src/routes/index.ts (route registration entry point)
- /Users/dev/openwhispr-server/apps/api/src/routes/usage.ts (representative route shape — `app.get("/api/usage", ...)`)
- /Users/dev/openwhispr-server/apps/api/src/routes/better-auth-handler.ts (catch-all)
- /Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/design/screens-admin.jsx
- /Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/design/screens-user.jsx
</files_to_read>

<files_to_modify>
- /Users/dev/openwhispr-server/tools/lint-ui-spec.ts (CREATE)
</files_to_modify>

<task>
## Objective

Implement the UI-SPEC linter per the skeleton in RESEARCH § "Code Examples /
Spec linter skeleton" and the rules locked by D-ART7. Turn Plan 02's RED tests
GREEN. Hit ≥90/90/90/90 coverage on the file.

## Step-by-step

### 1. Module shape

```ts
#!/usr/bin/env -S pnpm exec tsx
/**
 * lint-ui-spec.ts — Phase 07 / Plan 03 (D-ART7).
 *
 * Validates the two UI-SPEC markdown files:
 *   - .planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md
 *   - .planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md
 *
 * Five rules:
 *   1. required-subsections — each `## <screen>` section contains all 10 of
 *      Purpose / Roles / Route / Data / Actions / States / User journey /
 *      Copy keys / Wireframe / shadcn primitives as `**Subsection.**` lead-in
 *      or `### Subsection` heading.
 *   2. endpoint-exists — every `(GET|POST|PATCH|DELETE|PUT) /api/...` inline
 *      code reference resolves to either:
 *        (a) a Fastify route registered in apps/api/src/routes/**.ts via
 *            `app.<method>("<path>", ...)`, or
 *        (b) a BETTER_AUTH_PATHS allowlist entry (when path starts with /api/auth/).
 *      An endpoint named in WIP_ENDPOINTS passes (warning only).
 *   3. copy-key-uniqueness — every dotted key matching COPY_KEY_REGEX is
 *      globally unique across all spec files passed to lint().
 *      Bonus rule copy-key-schema — any token that LOOKS like a copy key
 *      (lives inside a backtick on a "Copy keys" subsection table row) but
 *      fails COPY_KEY_REGEX produces a copy-key-schema diagnostic.
 *   4. visual-ref-resolves — every `See visual: design/<file>.jsx#<Name>`
 *      line resolves to an export `function <Name>` or `const <Name>` in the
 *      named file (under .planning/phases/07-frontend-ui-spec/design/).
 *   5. wireframe-monospace — every `## Wireframe` subsection's fenced
 *      ```text``` block satisfies: (a) every non-empty line length within
 *      WIREFRAME_LENGTH_TOLERANCE of the longest line, after stripping the
 *      block-uniform leading indent, OR (b) the block contains the
 *      WIREFRAME_VISUAL_ONLY_SENTINEL line exactly.
 *
 * Exit codes:
 *   0 — all rules satisfied
 *   1 — at least one diagnostic
 *   2 — internal error (unreadable file, etc.)
 *
 * Usage:
 *   pnpm lint:ui-spec
 *   pnpm exec tsx tools/lint-ui-spec.ts <spec-file...>
 */
```

### 2. Diagnostic type

```ts
export type Diagnostic = {
  file: string;
  line: number;
  rule:
    | "required-subsections"
    | "endpoint-exists"
    | "copy-key-uniqueness"
    | "copy-key-schema"
    | "visual-ref-resolves"
    | "wireframe-monospace"
    | "wip-endpoint";
  message: string;
  severity?: "error" | "warning"; // default error; wip-endpoint = warning
};
```

### 3. Public API

```ts
export async function lint(
  specFiles: string[],
  routesDir: string,
  designDir = ".planning/phases/07-frontend-ui-spec/design",
): Promise<Diagnostic[]>;
```

### 4. Implementation steps

a. **Parse each spec file** with `unified().use(remarkParse).parse(src) as Root`.
   Build a position-aware walker using `unist-util-visit` (already a transitive
   dep of remark; if not, add it to package.json).

b. **Discover screen sections.** A "screen section" is every `## ...` heading.
   For each, slice the mdast children up to (but not including) the next `##`
   heading.

c. **Rule 1: required-subsections.** Within a screen section, treat any of
   these patterns as a "subsection marker":
   - A `### <Label>` heading whose text equals one of REQUIRED_SUBSECTIONS.
   - A paragraph whose first child is bold text matching `**<Label>.**` (the
     leading-bold pattern used in RESEARCH's per-screen template).
   For each REQUIRED_SUBSECTIONS label NOT found, emit
   `required-subsections` diagnostic with the screen's heading line + "missing
   subsection: <Label>".

d. **Rule 2: endpoint-exists.** Walk all `inlineCode` nodes; match
   ENDPOINT_REGEX. For each hit:
   - If path starts with `/api/auth/`, check against BETTER_AUTH_PATHS (string
     equality on `METHOD PATH`, with `:provider` matched as a wildcard segment).
   - Else, check against the set built by `listFastifyRoutes(routesDir)`.
   - If in WIP_ENDPOINTS, emit a `wip-endpoint` warning (not an error).
   - Else, emit `endpoint-exists` error.

e. **`listFastifyRoutes`.** Recursively scan `routesDir` for `.ts` files
   excluding `*.test.ts`. For each, read the source and regex-match **both**
   route-registration patterns Fastify supports in this codebase:

   **Pattern A — shorthand `app.<verb>(path, ...)`:**
   ```ts
   /app\.(get|post|patch|delete|put|all)\s*\(\s*['"`]([^'"`]+)['"`]/g
   ```

   **Pattern B — object form `app.route({ method, url, ... })`** — used by
   every route file under `apps/api/src/routes/{transcriptions,notes,conversations,folders}/`.
   BOTH key orderings must be supported (method-then-url and url-then-method):
   ```ts
   /app\.route\s*\(\s*\{[^}]*method\s*:\s*['"`](\w+)['"`][^}]*url\s*:\s*['"`]([^'"`]+)['"`]/gs
   /app\.route\s*\(\s*\{[^}]*url\s*:\s*['"`]([^'"`]+)['"`][^}]*method\s*:\s*['"`](\w+)['"`]/gs
   ```
   Note the `s` flag (dotall) so the regex spans the multiline object literal.

   For each match across A and B, push `"<METHOD> <PATH>"` (method uppercased).
   Also detect the catch-all: if path is `/api/auth/*`, do NOT add the literal
   star but trust the BETTER_AUTH_PATHS allowlist for `/api/auth/` namespace.

   **Regression guard:** the four route subdirectories above use Pattern B
   exclusively (e.g., `apps/api/src/routes/notes/search.ts:50` registers
   `POST /api/notes/search` via `app.route({ method: "POST", url: "/api/notes/search", ... })`).
   Shorthand-only detection misses these and breaks Rule 2.

f. **Rule 3: copy-key-uniqueness + copy-key-schema.**
   - Collect every backtick-wrapped token from "Copy keys" subsections
     (identify the subsection then walk inlineCode / tableCell descendants).
   - For each token: if it matches COPY_KEY_REGEX → add to global
     `Map<key, {file,line}>`; if a second occurrence of the same key appears,
     emit `copy-key-uniqueness` for the second hit, citing the first hit's
     line.
   - If the token looks key-shaped (contains dots and lowercase) but fails
     COPY_KEY_REGEX, emit `copy-key-schema`.

g. **Rule 4: visual-ref-resolves.** Walk paragraph children; find any text
   node matching `See visual:\s*(design\/[^\s#]+)#(\w+)`. For each:
   - Read the referenced file (cache reads).
   - Regex-test for `function <Name>(` or `const <Name>\s*=` or `export ... <Name>`.
   - If absent, emit `visual-ref-resolves` with the line number.

h. **Rule 5: wireframe-monospace.** Locate the "Wireframe" subsection within
   each screen. Find the first fenced code block (mdast `code` node) inside.
   - If `code.value` contains a line exactly equal to
     WIREFRAME_VISUAL_ONLY_SENTINEL, the block passes.
   - Otherwise, compute the per-block uniform leading-space indent (min of
     leading-spaces across non-empty lines), strip it, and assert every
     non-empty line length is within WIREFRAME_LENGTH_TOLERANCE of the max
     non-empty line length. If not, emit `wireframe-monospace`.

i. **CLI entry point.** Default to the two project UI-SPEC files when called
   without args. Print diagnostics to stderr in
   `<file>:<line> [<rule>] <message>` format. Exit 0/1/2 per spec.

### 5. Coverage

Run `pnpm test --coverage tools/lint-ui-spec.test.ts`. If coverage on
`tools/lint-ui-spec.ts` is below 90% on any axis, add tests to Plan 02's test
file (acceptable in this plan because tests + implementation ship as the
GREEN commit per CLAUDE.md). Target axes: lines / branches / functions /
statements.

### 6. Linter self-check

After GREEN, run the linter against the real Plan-01 stubs:

```
pnpm lint:ui-spec
```

It should exit 0 because Plan 01 stubs do not yet contain any screen sections
(no `## A` or `## U` headings — only `# Title` H1, `## API Reference (verified)`,
`## Assumptions resolved`, `## WIP endpoints` which are NOT screen sections).

**Timing-independence vs Plan 04/05 (Wave 1 parallel writes):**
The Plan-03 self-check linter run uses only the Plan-01 scaffold state (no
`## A\d+` or `## U\d+` screen headings present). The screen-subsection rule
(Rule 1) only fires when those headings exist, so this check is
timing-independent of Plan 04/05's content writes happening in parallel. Plans
04 and 05 do NOT invoke the linter themselves (their acceptance is content-
inspection only); the cross-file lint gate runs in Wave 2 (Plan 06).

To make the linter ignore non-screen `##` sections: treat a `##` heading as a
"screen section" only if its text matches the regex `/^(A\d+|U\d+)( |—)/`
(e.g., "A2 Observability hub", "U4 — Usage dashboard"). Any other `##` heading
is skipped. Document this in a code comment.

## Acceptance criteria

- `pnpm test tools/lint-ui-spec.test.ts` GREEN (all assertions pass).
- Linter MUST detect routes registered via BOTH `app.<verb>(path, ...)` shorthand
  AND `app.route({ method, url })` object form (Pattern A and Pattern B above).
  Manually verify: `pnpm exec tsx tools/lint-ui-spec.ts` against a fixture
  citing `POST /api/notes/search` (registered via `app.route`) exits 0.
- `pnpm test --coverage tools/lint-ui-spec.test.ts` reports ≥90/90/90/90 on
  `tools/lint-ui-spec.ts`.
- `pnpm lint:ui-spec` against Plan-01 stubs exits 0 (no screen sections yet).
- `pnpm lint` (biome) and `pnpm typecheck` pass.
- File is shebanged `#!/usr/bin/env -S pnpm exec tsx` like other tools/ scripts.
- English-only source. No emojis. No mocks of internal logic.

## Out of scope

- GHA workflow (Plan 06).
- Lefthook hook (Plan 06).
- Adding new test cases beyond what coverage forces (keep diff small).
- Writing UI-SPEC screen bodies (Plans 04, 05).
</task>

<tests>
- `pnpm test tools/lint-ui-spec.test.ts` exits 0.
- `pnpm test --coverage` ≥90/90/90/90 on `tools/lint-ui-spec.ts`.
- `pnpm lint:ui-spec` exits 0 against Plan-01 stubs.
- `pnpm lint && pnpm typecheck` clean.
- Manual: feed each fail-case fixture path to the linter via
  `pnpm exec tsx tools/lint-ui-spec.ts tools/lint-ui-spec/fixtures/fail-*/...md`
  and confirm exit 1 with the expected rule diagnostic.
</tests>

<commit_message>
feat(07): GREEN — implement lint-ui-spec (5 rules, unified+remark)

Implements tools/lint-ui-spec.ts per D-ART7: walks the mdast tree of each
UI-SPEC file with unified+remark-parse and validates:

1. required-subsections — 10 mandatory subsections per screen
2. endpoint-exists — every `(GET|POST|...) /api/...` resolves to a
   Fastify route in apps/api/src/routes/ or BETTER_AUTH_PATHS
3. copy-key-uniqueness + copy-key-schema — globally unique 5-level keys
4. visual-ref-resolves — every `See visual:` points to a real JSX export
5. wireframe-monospace — fenced ```text``` blocks parse as monospace
   within tolerance, or carry the visual-only sentinel

Turns Plan 02's RED tests GREEN; coverage on the linter is ≥90/90/90/90
(vitest --coverage). CLI entry exits 0 on clean, 1 on diagnostics, 2 on
internal error. `pnpm lint:ui-spec` script wired in package.json.

Refs: UI-SPEC-01, UI-SPEC-02, UI-SPEC-03
</commit_message>
