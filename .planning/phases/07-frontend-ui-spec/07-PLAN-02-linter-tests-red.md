---
phase: 07-frontend-ui-spec
plan: 02
type: execute
wave: 0
depends_on: [01]
files_modified:
  - tools/lint-ui-spec.test.ts
  - tools/lint-ui-spec.config.ts
  - tools/lint-ui-spec/fixtures/pass/*.md
  - tools/lint-ui-spec/fixtures/fail-missing-subsection/*.md
  - tools/lint-ui-spec/fixtures/fail-unknown-endpoint/*.md
  - tools/lint-ui-spec/fixtures/fail-duplicate-copy-key/*.md
  - tools/lint-ui-spec/fixtures/fail-broken-visual-ref/*.md
  - tools/lint-ui-spec/fixtures/fail-broken-wireframe/*.md
  - package.json
autonomous: true
requirements: [UI-SPEC-01, UI-SPEC-02, UI-SPEC-03]
must_haves:
  truths:
    - "tools/lint-ui-spec.test.ts exists with at least one failing test per linter rule (5 rules → ≥5 RED tests)"
    - "tools/lint-ui-spec.config.ts exports BETTER_AUTH_PATHS, WIP_ENDPOINTS, REQUIRED_SUBSECTIONS, COPY_KEY_REGEX, ENDPOINT_REGEX"
    - "Fixture markdown files exist for each pass/fail case the linter must distinguish"
    - "package.json carries devDependency entries for unified, remark-parse, @types/mdast and the lint:ui-spec script"
    - "`pnpm test tools/lint-ui-spec.test.ts` runs and fails with the expected RED diagnostics (the production lint module does not yet exist — import failure or assertion failure is acceptable RED)"
  artifacts:
    - path: "tools/lint-ui-spec.test.ts"
      provides: "Vitest test suite covering all 5 lint rules"
    - path: "tools/lint-ui-spec.config.ts"
      provides: "BETTER_AUTH_PATHS allowlist + regex constants + required-subsections list"
    - path: "tools/lint-ui-spec/fixtures/"
      provides: "Markdown fixtures (pass + 5 fail cases)"
    - path: "package.json"
      provides: "lint:ui-spec script + unified/remark/mdast devDeps"
  key_links:
    - from: "tools/lint-ui-spec.test.ts"
      to: "tools/lint-ui-spec.ts (not yet existing — RED phase)"
      via: "import { lint } from './lint-ui-spec'"
      pattern: "import.+from.+lint-ui-spec"
---

<role>
You are a GSD executor in TDD-RED mode. You write failing tests and fixtures
for the spec linter described in 07-CONTEXT.md § D-ART7 and 07-RESEARCH.md §
"Code Examples / Spec linter skeleton". The implementation (Plan 03) does not
yet exist; your tests must fail at import time or assertion time — that failure
is the RED phase per CLAUDE.md constitutional TDD rule.
</role>

<context>
@/Users/dev/openwhispr-server/CLAUDE.md
@/Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-CONTEXT.md
@/Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-RESEARCH.md
</context>

<files_to_read>
- /Users/dev/openwhispr-server/tools/lint-docs-headings.ts (style + structure reference for tools/ idioms)
- /Users/dev/openwhispr-server/tools/lint-docs-headings.test.ts
- /Users/dev/openwhispr-server/tools/lint-english.ts
- /Users/dev/openwhispr-server/tools/lint-english.test.ts
- /Users/dev/openwhispr-server/package.json
- /Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md (created by Plan 01 — used as a real-world fixture seed)
- /Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md (same)
- /Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/design/screens-admin.jsx (to anchor See-visual ref fixtures against real function names)
- /Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/design/screens-user.jsx
</files_to_read>

<files_to_modify>
- /Users/dev/openwhispr-server/tools/lint-ui-spec.test.ts (CREATE)
- /Users/dev/openwhispr-server/tools/lint-ui-spec.config.ts (CREATE)
- /Users/dev/openwhispr-server/tools/lint-ui-spec/fixtures/pass/screen-ok.md (CREATE)
- /Users/dev/openwhispr-server/tools/lint-ui-spec/fixtures/fail-missing-subsection/screen-no-purpose.md (CREATE)
- /Users/dev/openwhispr-server/tools/lint-ui-spec/fixtures/fail-unknown-endpoint/screen-bad-endpoint.md (CREATE)
- /Users/dev/openwhispr-server/tools/lint-ui-spec/fixtures/fail-duplicate-copy-key/file-a.md (CREATE)
- /Users/dev/openwhispr-server/tools/lint-ui-spec/fixtures/fail-duplicate-copy-key/file-b.md (CREATE)
- /Users/dev/openwhispr-server/tools/lint-ui-spec/fixtures/fail-broken-visual-ref/screen-bad-ref.md (CREATE)
- /Users/dev/openwhispr-server/tools/lint-ui-spec/fixtures/fail-broken-wireframe/screen-jagged.md (CREATE)
- /Users/dev/openwhispr-server/package.json (modify: add devDeps + script)
</files_to_modify>

<task>
## Objective

Establish the TDD RED phase for the UI-SPEC linter. Land:

1. A test file with ≥1 failing test per linter rule (5 rules total → 5+ tests).
2. A config file exporting the constants the linter and tests share.
3. A fixtures tree exercising every pass-and-fail case.
4. `package.json` updates: devDeps (`unified`, `remark-parse`, `@types/mdast`)
   and the `lint:ui-spec` script.

## Step-by-step

### 1. Add devDependencies and script

Modify `/Users/dev/openwhispr-server/package.json`:

```jsonc
{
  "scripts": {
    // ...existing scripts above...
    "lint:ui-spec": "tsx tools/lint-ui-spec.ts"
  },
  "devDependencies": {
    // ...existing deps above (preserve order; add alphabetically into the existing block)...
    "@types/mdast": "^4.0.4",
    "remark-parse": "^11.0.0",
    "unified": "^11.0.5"
  }
}
```

Versions: pin to what RESEARCH § Standard Stack verified (unified 11.0.5,
remark-parse 11.x, @types/mdast 4.x). Then `pnpm install` to update the lockfile.

### 2. Author `tools/lint-ui-spec.config.ts`

Export the constants the linter consumes:

```ts
// tools/lint-ui-spec.config.ts
export const REQUIRED_SUBSECTIONS = [
  "Purpose",
  "Roles",
  "Route",
  "Data",
  "Actions",
  "States",
  "User journey",
  "Copy keys",
  "Wireframe",
  "shadcn primitives",
] as const;

export const COPY_KEY_REGEX = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){4}$/;

export const ENDPOINT_REGEX =
  /^(GET|POST|PATCH|DELETE|PUT)\s+(\/api\/[a-zA-Z0-9/_:.-]+)$/;

// From Plan 01: verified Better Auth catch-all paths handled by app.all("/api/auth/*", ...).
export const BETTER_AUTH_PATHS: ReadonlyArray<string> = [
  "POST /api/auth/sign-in/email",
  "POST /api/auth/sign-up/email",
  "POST /api/auth/sign-out",
  "POST /api/auth/verify-email",
  "GET /api/auth/get-session",
  "GET /api/auth/list-sessions",
  "POST /api/auth/revoke-session",
  "POST /api/auth/revoke-other-sessions",
  "DELETE /api/auth/delete-account",
  "GET /api/auth/sign-in/social/:provider",
];

// Endpoints named by UI-SPEC but not yet implemented in apps/api/src/routes/.
// Must be empty before phase 7 closes (Plan 07 enforces).
export const WIP_ENDPOINTS: ReadonlyArray<string> = [];

// Wireframe monospace tolerance: a non-empty line's length may deviate from the
// longest line in the block by at most this many characters.
export const WIREFRAME_LENGTH_TOLERANCE = 2;

// Sentinel line accepted inside a Wireframe code block when ASCII rendering is impractical.
export const WIREFRAME_VISUAL_ONLY_SENTINEL = "(visual-only — see See visual: line)";
```

### 3. Author `tools/lint-ui-spec.test.ts`

Use Vitest. Structure: one `describe` per rule, ≥1 fail-case + ≥1 pass-case per
rule. The test file MUST `import { lint } from "./lint-ui-spec"` even though
that module does not yet exist — this is the RED phase; the test run will fail
with an import error or assertion error, which is the expected RED state.

Pattern:

```ts
import { describe, it, expect } from "vitest";
import { lint } from "./lint-ui-spec";
import {
  BETTER_AUTH_PATHS,
  COPY_KEY_REGEX,
  REQUIRED_SUBSECTIONS,
} from "./lint-ui-spec.config";

const FIXTURES = new URL("./lint-ui-spec/fixtures/", import.meta.url).pathname;
const ROUTES_DIR = new URL(
  "../apps/api/src/routes/",
  import.meta.url,
).pathname;

describe("lint-ui-spec / required subsections", () => {
  it("passes when every required subsection is present", async () => {
    const diags = await lint([`${FIXTURES}/pass/screen-ok.md`], ROUTES_DIR);
    expect(diags.filter((d) => d.rule === "required-subsections")).toEqual([]);
  });

  it("fails when 'Purpose' subsection is missing", async () => {
    const diags = await lint(
      [`${FIXTURES}/fail-missing-subsection/screen-no-purpose.md`],
      ROUTES_DIR,
    );
    expect(diags.some((d) =>
      d.rule === "required-subsections" && /Purpose/.test(d.message)
    )).toBe(true);
  });
});

describe("lint-ui-spec / endpoint existence", () => {
  it("accepts Better Auth catch-all paths from the allowlist", async () => {
    const diags = await lint([`${FIXTURES}/pass/screen-ok.md`], ROUTES_DIR);
    expect(diags.filter((d) => d.rule === "endpoint-exists")).toEqual([]);
  });

  it("flags an endpoint that has no matching Fastify route file", async () => {
    const diags = await lint(
      [`${FIXTURES}/fail-unknown-endpoint/screen-bad-endpoint.md`],
      ROUTES_DIR,
    );
    expect(diags.some((d) =>
      d.rule === "endpoint-exists" && /GET \/api\/this-endpoint-does-not-exist/.test(d.message)
    )).toBe(true);
  });
});

describe("lint-ui-spec / copy-key uniqueness", () => {
  it("flags the same copy key declared in two UI-SPEC files", async () => {
    const diags = await lint(
      [
        `${FIXTURES}/fail-duplicate-copy-key/file-a.md`,
        `${FIXTURES}/fail-duplicate-copy-key/file-b.md`,
      ],
      ROUTES_DIR,
    );
    expect(diags.some((d) =>
      d.rule === "copy-key-uniqueness" && /admin\.shared\.example\.label\.text/.test(d.message)
    )).toBe(true);
  });

  it("enforces 5-level dotted schema for copy keys", async () => {
    // Sample key in a fixture violates the regex; rule should fire.
    const diags = await lint(
      [`${FIXTURES}/fail-duplicate-copy-key/file-a.md`],
      ROUTES_DIR,
    );
    expect(diags.some((d) => d.rule === "copy-key-schema")).toBe(true);
  });
});

describe("lint-ui-spec / See visual references", () => {
  it("flags a See visual: line that points to a non-existent JSX function", async () => {
    const diags = await lint(
      [`${FIXTURES}/fail-broken-visual-ref/screen-bad-ref.md`],
      ROUTES_DIR,
    );
    expect(diags.some((d) =>
      d.rule === "visual-ref-resolves" && /DoesNotExistComponent/.test(d.message)
    )).toBe(true);
  });
});

describe("lint-ui-spec / wireframe monospace tolerance", () => {
  it("accepts a wireframe whose line lengths fall within tolerance", async () => {
    const diags = await lint([`${FIXTURES}/pass/screen-ok.md`], ROUTES_DIR);
    expect(diags.filter((d) => d.rule === "wireframe-monospace")).toEqual([]);
  });

  it("flags a wireframe whose lines deviate beyond tolerance and lacks the sentinel", async () => {
    const diags = await lint(
      [`${FIXTURES}/fail-broken-wireframe/screen-jagged.md`],
      ROUTES_DIR,
    );
    expect(diags.some((d) => d.rule === "wireframe-monospace")).toBe(true);
  });

  it("accepts the visual-only sentinel inside the wireframe block", async () => {
    // Sentinel-bearing fixture lives in pass/.
    // Asserted by absence of any wireframe-monospace diagnostic for that file.
  });
});

describe("lint-ui-spec / config sanity", () => {
  it("declares all 10 required subsection labels", () => {
    expect(REQUIRED_SUBSECTIONS.length).toBe(10);
  });
  it("exposes a non-empty BETTER_AUTH_PATHS allowlist", () => {
    expect(BETTER_AUTH_PATHS.length).toBeGreaterThan(0);
  });
  it("copy-key regex matches a 5-level dotted key", () => {
    expect(COPY_KEY_REGEX.test("admin.config.stt.table.header")).toBe(true);
    expect(COPY_KEY_REGEX.test("admin.config.stt.header")).toBe(false);
  });
});
```

### 4. Author fixtures

Each fixture is a minimal markdown snippet under
`tools/lint-ui-spec/fixtures/<case>/<file>.md`.

- `pass/screen-ok.md`: one screen section with all 10 required subsections,
  one endpoint that resolves (use a real route from apps/api/src/routes/,
  e.g., `GET /api/usage` — Plan 01 verified this), one valid 5-level copy key,
  one `See visual: design/screens-user.jsx#UsageDashboard` line (must match a
  real function exported from screens-user.jsx — read the file to choose a
  real export name), and a wireframe block whose lines are within tolerance.

- `fail-missing-subsection/screen-no-purpose.md`: same as pass but with the
  "Purpose" subsection deleted.

- `fail-unknown-endpoint/screen-bad-endpoint.md`: one screen referencing
  `GET /api/this-endpoint-does-not-exist`.

- `fail-duplicate-copy-key/file-a.md` and `file-b.md`: both declare the same
  key `admin.shared.example.label.text` AND file-a.md additionally declares
  one malformed key (e.g., `bad_key`) to exercise the schema check.

- `fail-broken-visual-ref/screen-bad-ref.md`: contains
  `See visual: design/screens-user.jsx#DoesNotExistComponent`.

- `fail-broken-wireframe/screen-jagged.md`: wireframe block whose longest line
  is 60 chars, with at least one non-empty line at 30 chars (deviation > 2)
  and no sentinel.

**Important:** Every fixture must declare its endpoints using real routes from
the actual `apps/api/src/routes/` tree (so the endpoint-exists check passes
when the rule is not the subject of the test). Use `GET /api/usage`,
`GET /api/notes/list`, etc. — verified by Plan 01.

### 5. Run tests (expect RED)

```
pnpm install
pnpm test tools/lint-ui-spec.test.ts
```

Expected: failure at import time (`Cannot find module './lint-ui-spec'`) or,
if you stub `lint-ui-spec.ts` with an empty `export async function lint() { return []; }`,
assertion failures because no diagnostics are emitted. Either is the RED state.

DO NOT implement the linter body. That work is Plan 03.

## Acceptance criteria

- All files in `files_to_modify` exist.
- `pnpm test tools/lint-ui-spec.test.ts` exits non-zero (RED).
- `package.json` has the `lint:ui-spec` script and `unified` / `remark-parse` /
  `@types/mdast` in devDependencies.
- The fixtures directory has all 7 fixture files listed above.
- Every fixture is plain English markdown; no emojis.
- `tools/lint-ui-spec.config.ts` exports the named constants.
- Biome `pnpm lint` (the existing repo lint) passes on the new TypeScript files.

## Out of scope

- Implementing `tools/lint-ui-spec.ts` (Plan 03).
- Wiring the GHA workflow (Plan 06).
- Wiring lefthook (Plan 06).
- Writing screen bodies in the real UI-SPEC files (Plan 04, 05).
</task>

<tests>
- `pnpm install` succeeds.
- `pnpm test tools/lint-ui-spec.test.ts` exits non-zero (RED phase — failure expected).
- `pnpm lint` (biome) passes on the new TypeScript files.
- `pnpm typecheck` produces no new errors in tools/ scope.
- `ls tools/lint-ui-spec/fixtures/{pass,fail-missing-subsection,fail-unknown-endpoint,fail-duplicate-copy-key,fail-broken-visual-ref,fail-broken-wireframe}` lists at least one .md file in each directory.
</tests>

<commit_message>
test(07): RED — lint-ui-spec tests + fixtures (no implementation yet)

Land the failing test suite for the UI-SPEC linter (D-ART7) per the
constitutional TDD RED phase. Includes:

- tools/lint-ui-spec.test.ts: ≥1 failing test per linter rule (5 rules)
- tools/lint-ui-spec.config.ts: shared constants (BETTER_AUTH_PATHS,
  REQUIRED_SUBSECTIONS, COPY_KEY_REGEX, ENDPOINT_REGEX, WIP_ENDPOINTS)
- tools/lint-ui-spec/fixtures/: pass + 5 fail-case markdown fixtures
- package.json: unified/remark-parse/@types/mdast devDeps,
  `lint:ui-spec` script

`pnpm test tools/lint-ui-spec.test.ts` currently RED (module not yet
implemented). Plan 03 turns this GREEN.

Refs: UI-SPEC-01, UI-SPEC-02, UI-SPEC-03
</commit_message>
