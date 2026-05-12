---
phase: 07-frontend-ui-spec
plan: 06
type: execute
wave: 2
depends_on: [03, 04, 05]
files_modified:
  - .planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md
  - .planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md
  - .github/workflows/ui-spec.yml
  - lefthook.yml
  - package.json
autonomous: true
requirements: [UI-SPEC-01, UI-SPEC-02, UI-SPEC-03]
must_haves:
  truths:
    - "Both UI-SPEC files carry the identical shared appendix block: Design tokens, Breakpoint matrix, i18n key index, API endpoint index"
    - "Design tokens are derived from design/ui.jsx (color roles, spacing scale, typography ramp, motion durations)"
    - "Breakpoint matrix: mobile <640, tablet 640–1024, desktop ≥1024"
    - "i18n key index is alphabetized; every key declared in either file appears exactly once in the index"
    - "API endpoint index is a single table: method, path, auth requirement, screen(s) consuming, source (file:line or BETTER_AUTH_HANDLER)"
    - "shadcn inventory appendix lists every primitive used across both files with the `pnpm dlx shadcn@latest add` command block"
    - ".github/workflows/ui-spec.yml exists, runs `pnpm lint:ui-spec` on PRs touching UI-SPEC-*.md OR tools/lint-ui-spec*.ts OR apps/api/src/routes/**"
    - "lefthook.yml pre-commit step runs `pnpm lint:ui-spec` when the same path globs match the staged changes"
    - "`pnpm lint:ui-spec` exits 0 with appendices in place"
    - "cross-file copy-key uniqueness sweep passes (no duplicate keys across the two files)"
    - "All three known design-gap markers are present (U1, A3, U4) — verified by grep"
  artifacts:
    - path: ".planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md"
      provides: "Appendix block appended (4 sub-appendices + shadcn block)"
    - path: ".planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md"
      provides: "Identical appendix block appended"
    - path: ".github/workflows/ui-spec.yml"
      provides: "GHA workflow gating UI-SPEC drift"
    - path: "lefthook.yml"
      provides: "Pre-commit hook running pnpm lint:ui-spec on relevant changes"
    - path: "package.json"
      provides: "lint:ui-spec script confirmed (may already exist from Plan 02; reconfirm)"
  key_links:
    - from: ".github/workflows/ui-spec.yml"
      to: "pnpm lint:ui-spec"
      via: "GHA job step"
      pattern: "run: pnpm lint:ui-spec"
    - from: "lefthook.yml pre-commit"
      to: "pnpm lint:ui-spec"
      via: "lefthook command"
      pattern: "pnpm lint:ui-spec"
    - from: "Appendix § Design tokens"
      to: "design/ui.jsx color/spacing/typography constants"
      via: "transcribed table values"
      pattern: "design/ui.jsx"
---

<role>
You are a GSD executor wiring Phase 7's integration layer. You write the
shared appendix block into both UI-SPEC files (identical content per D-ART6,
duplicated for self-contained reading), wire the GHA workflow, the lefthook
hook, and confirm the `lint:ui-spec` script. You do not modify any screen
sections (that's Plans 04 and 05's territory).
</role>

<context>
@/Users/nick/openwhispr-server/CLAUDE.md
@/Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-CONTEXT.md
@/Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-RESEARCH.md
@/Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md
@/Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md
@/Users/nick/openwhispr-server/.github/workflows/ci.yml
@/Users/nick/openwhispr-server/lefthook.yml
</context>

<files_to_read>
- /Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/design/ui.jsx (canonical source for color / spacing / typography / motion tokens)
- /Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md (post Plan 04)
- /Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md (post Plan 05)
- /Users/nick/openwhispr-server/.github/workflows/ci.yml (style + harden-runner pattern)
- /Users/nick/openwhispr-server/lefthook.yml (existing hooks)
- /Users/nick/openwhispr-server/package.json (script confirmation)
</files_to_read>

<files_to_modify>
- /Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md (APPEND appendix block)
- /Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md (APPEND identical appendix block)
- /Users/nick/openwhispr-server/.github/workflows/ui-spec.yml (CREATE)
- /Users/nick/openwhispr-server/lefthook.yml (MODIFY: add pre-commit ui-spec hook)
- /Users/nick/openwhispr-server/package.json (CONFIRM lint:ui-spec script)
</files_to_modify>

<task>
## Objective

1. Author the **identical** shared appendix block in both UI-SPEC files
   (D-ART6: duplicated for self-contained reading).
2. Create `.github/workflows/ui-spec.yml`.
3. Add a lefthook pre-commit step running `pnpm lint:ui-spec` on relevant
   staged-file globs.
4. Sanity-check `package.json` has the `lint:ui-spec` script.

## Step-by-step

### 1. Shared appendix content (write once, paste into both files)

Append the following H1 block at the end of each UI-SPEC file (after the
`## API Reference (verified)`, `## Assumptions resolved`, `## WIP endpoints`
sections Plan 01 created):

```markdown
# Appendix

> The four sub-appendices below are duplicated verbatim in both UI-SPEC files
> (D-ART6) so each artifact is self-contained for downstream readers.
> Source of truth for design tokens is `design/ui.jsx`.

## Appendix A — Design tokens

Transcribe the color / spacing / typography / motion constants from
`.planning/phases/07-frontend-ui-spec/design/ui.jsx`. Use the EXACT names
and values present in that file. Group as:

- Color roles (e.g., `background`, `foreground`, `primary`, `muted`,
  `destructive`, `border`, `ring`). Cite the OKLCH or RGB value from ui.jsx.
- Spacing scale (e.g., `space-0`..`space-12` in rem or px).
- Typography ramp (font family — note Tailwind 4 uses `@theme` CSS-first
  config; cite the canonical Inter family name and weight scale).
- Motion durations (transition timing — read from ui.jsx).

Note: Tailwind 4 places these under the `@theme` directive in
`app/globals.css`, NOT in `tailwind.config.js` (RESEARCH Pitfall 4).

## Appendix B — Breakpoint matrix

| Name | Min width | Pattern |
|------|-----------|---------|
| mobile | 0 | single column; sidebar collapsed to drawer |
| tablet | 640px | tablet layout; sidebar slide-over |
| desktop | 1024px | full layout; sidebar persistent |

(Tailwind 4 default breakpoints. Cite RESEARCH § Pattern 1 + 07-SPEC.md
constraints.)

## Appendix C — i18n key index

Every copy key declared in this UI-SPEC suite, alphabetized. Format:
table with `Key` column and `English` column. Russian deferred to Phase 10.
The linter validates uniqueness across both files; this index is the human
audit trail.

| Key | English |
|-----|---------|
| `admin.config.action.refresh.button.label` | Refresh |
| `admin.config.note.title.heading.label` | Note recording |
| ... | ... |
| `end-user.usage.title.heading.text` | Usage |

(Populate by scanning both UI-SPEC files post Plan 04 + Plan 05. Tooling
hint: `grep -hoE "\`(admin|end-user)\.[a-z0-9.-]+\`" UI-SPEC-*.md | sort -u`
gives the alphabetized list; map to the English value declared in each
screen's Copy keys subsection.)

## Appendix D — API endpoint index

Every endpoint either UI-SPEC file references, with auth requirement and the
screen(s) that consume it.

| Method | Path | Auth | Source | Screens |
|--------|------|------|--------|---------|
| POST | /api/auth/sign-in/email | public | BETTER_AUTH_HANDLER | U1 |
| POST | /api/auth/sign-up/email | public | BETTER_AUTH_HANDLER | U2 |
| GET | /api/auth/get-session | session | BETTER_AUTH_HANDLER | U5 |
| GET | /api/auth/list-sessions | session | BETTER_AUTH_HANDLER | U5 |
| POST | /api/auth/revoke-session | session | BETTER_AUTH_HANDLER | U5 |
| POST | /api/auth/revoke-other-sessions | session | BETTER_AUTH_HANDLER | U5 |
| DELETE | /api/auth/delete-account | session | BETTER_AUTH_HANDLER | U5 |
| GET | /api/auth/sign-in/social/:provider | public | BETTER_AUTH_HANDLER | U1, U2 |
| GET | /api/usage | session | apps/api/src/routes/usage.ts:LL | U4 |
| POST | /api/streaming-usage | session | apps/api/src/routes/streaming-usage.ts:57 | U4 |
| GET | /api/stt-config | session+admin | apps/api/src/routes/stt-config.ts:LL | A3 |
| GET | /api/note-recording-config | session+admin | apps/api/src/routes/note-recording-config.ts:LL | A3 |
| GET | /api/transcriptions/list | session | apps/api/src/routes/transcriptions/list.ts:LL | U6, U7 |
| DELETE | /api/transcriptions/delete | session | apps/api/src/routes/transcriptions/delete.ts:LL | U6, U7 |
| GET | /api/notes/list | session | apps/api/src/routes/notes/list.ts:LL | U8, U9 |
| POST | /api/notes/search | session | apps/api/src/routes/notes/search.ts:50 | U10 |
| DELETE | /api/notes/delete | session | apps/api/src/routes/notes/delete.ts:LL | U8, U9 |
| GET | /api/folders/list | session | apps/api/src/routes/folders/list.ts:LL | U8 |
| GET | /api/conversations/list | session | apps/api/src/routes/conversations/list.ts:LL | U11 |
| GET | /api/conversations/messages | session | apps/api/src/routes/conversations/messages.ts:LL | U12 |
| POST | /api/conversations/search | session | apps/api/src/routes/conversations/search.ts:48 | U13 |
| DELETE | /api/conversations/delete | session | apps/api/src/routes/conversations/delete.ts:LL | U11, U12 |

(Update the `:LL` line numbers to the actual line where each `app.get/post/...`
is declared. Cross-check against Plan 01's verified API Reference table.)

## Appendix E — shadcn/ui v2 primitive inventory

Union of every primitive named in any screen's "shadcn primitives" subsection.
After `apps/web/` scaffolds (Phase 8), run this block once to prime the project:

```bash
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button input form label card table dialog \
  dropdown-menu badge skeleton toast alert avatar checkbox \
  separator tabs tooltip sheet command popover scroll-area sonner
```

(Adjust the list to be the actual union from the screens; do not invent
primitives not used. Cite RESEARCH § Standard Stack for canonical names.)
```

**Critical:** identical content in both files (D-ART6). Use the same block,
copy-paste verbatim.

### 2. GHA workflow `.github/workflows/ui-spec.yml`

```yaml
name: UI-SPEC Lint

on:
  pull_request:
    paths:
      - ".planning/phases/07-frontend-ui-spec/UI-SPEC-*.md"
      - "tools/lint-ui-spec.ts"
      - "tools/lint-ui-spec.test.ts"
      - "tools/lint-ui-spec.config.ts"
      - "tools/lint-ui-spec/fixtures/**"
      - "apps/api/src/routes/**"
      - ".github/workflows/ui-spec.yml"
  push:
    branches: [main]
    paths:
      - ".planning/phases/07-frontend-ui-spec/UI-SPEC-*.md"
      - "tools/lint-ui-spec.ts"
      - "tools/lint-ui-spec.test.ts"
      - "tools/lint-ui-spec.config.ts"
      - "tools/lint-ui-spec/fixtures/**"
      - "apps/api/src/routes/**"

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  lint-ui-spec:
    runs-on: ubuntu-24.04
    steps:
      - uses: step-security/harden-runner@a5ad31d6a139d249332a2605b85202e8c0b78450  # v2.19.1
        with: { egress-policy: audit }
      - uses: actions/checkout@v5
        with: { fetch-depth: 1 }
      - uses: pnpm/action-setup@v4
        with: { version: 11.0.8 }
      - uses: actions/setup-node@v5
        with: { node-version: '24', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint:ui-spec
      - run: pnpm test tools/lint-ui-spec.test.ts --coverage
```

The `--coverage` step enforces the ≥90/90/90/90 floor for the linter
TypeScript code per CLAUDE.md. Add an explicit coverage threshold flag if
the repo's vitest config does not already gate at 90%; check
`vitest.config.ts` / `package.json` `coverage` block before adding flags.

### 3. lefthook hook

Modify `lefthook.yml` — add to the existing `pre-commit` block:

```yaml
pre-commit:
  parallel: true
  commands:
    # ...existing commands above...
    lint-ui-spec:
      glob: "{.planning/phases/07-frontend-ui-spec/UI-SPEC-*.md,tools/lint-ui-spec*.ts,tools/lint-ui-spec/fixtures/**,apps/api/src/routes/**}"
      run: pnpm lint:ui-spec
```

The `glob` predicate keeps the hook fast — it runs only when the staged
changes touch UI-SPEC, the linter, fixtures, or the routes directory.

### 4. package.json `lint:ui-spec` confirmation

Plan 02 added the script. Re-read `package.json` and confirm the line:

```json
"lint:ui-spec": "tsx tools/lint-ui-spec.ts"
```

is present. If absent (e.g., merge conflict), add it.

### 5. Encode all three known design-gap markers (verification only)

These were authored in Plan 04 (A3) and Plan 05 (U1, U4). Verify by grep:

```bash
grep -c "Design gap (tracked):" .planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md     # expect ≥ 1 (A3)
grep -c "Design gap (tracked):" .planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md  # expect ≥ 2 (U1 + U4)
```

If any is missing, fix in this plan by editing the corresponding screen
section (cite which plan's commit introduced the gap and update).

## Acceptance criteria

- Both UI-SPEC files end with an `# Appendix` H1 followed by Appendix A..E
  (identical content across both files; diff -B -w of the appendix blocks
  shows no semantic difference).
- `.github/workflows/ui-spec.yml` exists and parses (use `actionlint` if
  available; otherwise eyeball against `ci.yml`).
- `lefthook.yml` carries the `lint-ui-spec` pre-commit command with the
  expected glob predicate.
- `pnpm lint:ui-spec` exits 0.
- `pnpm test tools/lint-ui-spec.test.ts --coverage` ≥90/90/90/90.
- Three design-gap markers exist: A3 (admin file), U1 + U4 (end-user file).
- All endpoints in Appendix D are either route-file-backed (with file:line)
  or BETTER_AUTH_HANDLER catch-all. Zero new endpoints.
- English only. No emojis.

## Out of scope

- Re-engaging Claude Design (Phase 7.x).
- Writing Russian copy values (Phase 10).
- Scaffolding `apps/web/` (Phase 8).
- Adding new lint rules to the linter.
</task>

<tests>
- `pnpm lint:ui-spec` exits 0.
- `pnpm test tools/lint-ui-spec.test.ts --coverage` ≥90/90/90/90.
- `actionlint .github/workflows/ui-spec.yml` (if installed) returns no errors; else manual review against ci.yml structure.
- `diff <(sed -n '/^# Appendix$/,$p' .planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md) <(sed -n '/^# Appendix$/,$p' .planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md)` produces zero semantic diff (whitespace-only OK).
- `grep -c "Design gap (tracked):" .planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md` returns ≥ 1.
- `grep -c "Design gap (tracked):" .planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md` returns ≥ 2.
- `lefthook run pre-commit` (dry run) does not error.
- `grep "lint:ui-spec" package.json` returns the script line.
</tests>

<commit_message>
chore(07): wire UI-SPEC appendix + GHA workflow + lefthook hook

Appends the identical D-ART6 shared appendix block to both UI-SPEC files
(Appendix A: Design tokens from design/ui.jsx; B: Breakpoint matrix;
C: i18n key index alphabetized; D: API endpoint index with file:line
citations; E: shadcn primitive inventory with `pnpm dlx shadcn add`
block). Wires .github/workflows/ui-spec.yml to run pnpm lint:ui-spec
plus coverage gate on PRs touching UI-SPEC, the linter, fixtures, or
apps/api/src/routes/. Adds a lefthook pre-commit hook with matching
glob predicate so local commits get fast feedback before pushing.

Confirms the three known design-gap markers (U1 forgot-password,
A3 effective-env removal, U4 activity-feed removal) are present.

Refs: UI-SPEC-01, UI-SPEC-02, UI-SPEC-03
</commit_message>
