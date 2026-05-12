/**
 * lint-ui-spec.test.ts — Phase 07 / Plan 02 (TDD RED).
 *
 * Failing test suite for the UI-SPEC linter (tools/lint-ui-spec.ts). Plan 02
 * lands these tests in RED state; Plan 03 implements the linter and turns
 * them GREEN.
 *
 * The import below resolves to a module that does NOT YET EXIST. That import
 * failure is the canonical RED signal per CLAUDE.md's constitutional TDD rule.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// Plan 03 has implemented the linter — the GREEN phase commit.
import { findProjectRoot, lint, listFastifyRoutes, main } from "./lint-ui-spec";
import {
  BETTER_AUTH_PATHS,
  COPY_KEY_REGEX,
  ENDPOINT_REGEX,
  REQUIRED_SUBSECTIONS,
  WIP_ENDPOINTS,
} from "./lint-ui-spec.config";

const FIXTURES = resolve(__dirname, "lint-ui-spec/fixtures");
const ROUTES_DIR = resolve(__dirname, "../apps/api/src/routes");

function fixture(relPath: string): string {
  return resolve(FIXTURES, relPath);
}

describe("lint-ui-spec / required-subsections rule", () => {
  it("passes when every required subsection is present on the screen", async () => {
    const diags = await lint([fixture("pass/screen-ok.md")], ROUTES_DIR);
    expect(diags.filter((d: { rule: string }) => d.rule === "required-subsections")).toEqual([]);
  });

  it("fails when the 'Purpose' subsection is missing", async () => {
    const diags = await lint([fixture("fail-missing-subsection/screen-no-purpose.md")], ROUTES_DIR);
    expect(
      diags.some(
        (d: { rule: string; message: string }) =>
          d.rule === "required-subsections" && /Purpose/.test(d.message),
      ),
    ).toBe(true);
  });
});

describe("lint-ui-spec / endpoint-exists rule", () => {
  it("accepts an endpoint registered via app.<verb>(path, ...) shorthand", async () => {
    // pass/screen-ok.md cites GET /api/desktop-signin/:provider — registered
    // via app.get<{Params}>("/api/desktop-signin/:provider", ...).
    const diags = await lint([fixture("pass/screen-ok.md")], ROUTES_DIR);
    expect(diags.filter((d: { rule: string }) => d.rule === "endpoint-exists")).toEqual([]);
  });

  it("accepts an endpoint registered via app.route({method, url}) object form (regression guard)", async () => {
    // pass/screen-ok.md ALSO cites POST /api/notes/search — registered via
    // app.route({ method: "POST", url: "/api/notes/search", ... }). This is
    // the explicit regression guard against the app.route() blind spot
    // documented in Plan 03 step 4e.
    const diags = await lint([fixture("pass/screen-ok.md")], ROUTES_DIR);
    expect(diags.filter((d: { rule: string }) => d.rule === "endpoint-exists")).toEqual([]);
  });

  it("accepts Better Auth catch-all paths from the BETTER_AUTH_PATHS allowlist", async () => {
    // pass/screen-ok.md cites POST /api/auth/sign-out, served by the
    // app.all("/api/auth/*", ...) catch-all in better-auth-handler.ts.
    const diags = await lint([fixture("pass/screen-ok.md")], ROUTES_DIR);
    expect(diags.filter((d: { rule: string }) => d.rule === "endpoint-exists")).toEqual([]);
  });

  it("flags an endpoint that has no matching Fastify route file", async () => {
    const diags = await lint([fixture("fail-unknown-endpoint/screen-bad-endpoint.md")], ROUTES_DIR);
    expect(
      diags.some(
        (d: { rule: string; message: string }) =>
          d.rule === "endpoint-exists" && /\/api\/this-endpoint-does-not-exist/.test(d.message),
      ),
    ).toBe(true);
  });
});

describe("lint-ui-spec / copy-key rules", () => {
  it("flags the same copy key declared in two UI-SPEC files (uniqueness)", async () => {
    const diags = await lint(
      [fixture("fail-duplicate-copy-key/file-a.md"), fixture("fail-duplicate-copy-key/file-b.md")],
      ROUTES_DIR,
    );
    expect(
      diags.some(
        (d: { rule: string; message: string }) =>
          d.rule === "copy-key-uniqueness" && /admin\.shared\.example\.label\.text/.test(d.message),
      ),
    ).toBe(true);
  });

  it("flags a malformed copy key that violates the 5-level dotted schema", async () => {
    const diags = await lint([fixture("fail-duplicate-copy-key/file-a.md")], ROUTES_DIR);
    expect(diags.some((d: { rule: string }) => d.rule === "copy-key-schema")).toBe(true);
  });
});

describe("lint-ui-spec / visual-ref-resolves rule", () => {
  it("flags a 'See visual:' line pointing to a non-existent JSX function", async () => {
    const diags = await lint([fixture("fail-broken-visual-ref/screen-bad-ref.md")], ROUTES_DIR);
    expect(
      diags.some(
        (d: { rule: string; message: string }) =>
          d.rule === "visual-ref-resolves" && /DoesNotExistComponent/.test(d.message),
      ),
    ).toBe(true);
  });
});

describe("lint-ui-spec / wireframe-monospace rule", () => {
  it("accepts a wireframe whose line lengths fall within tolerance", async () => {
    const diags = await lint([fixture("pass/screen-ok.md")], ROUTES_DIR);
    expect(diags.filter((d: { rule: string }) => d.rule === "wireframe-monospace")).toEqual([]);
  });

  it("flags a wireframe whose lines deviate beyond tolerance and lack the visual-only sentinel", async () => {
    const diags = await lint([fixture("fail-broken-wireframe/screen-jagged.md")], ROUTES_DIR);
    expect(diags.some((d: { rule: string }) => d.rule === "wireframe-monospace")).toBe(true);
  });
});

describe("lint-ui-spec / config sanity", () => {
  it("declares exactly 10 required subsection labels (D-ART7)", () => {
    expect(REQUIRED_SUBSECTIONS.length).toBe(10);
  });

  it("includes 'shadcn primitives' as the 10th subsection (post-D-ART5 expansion)", () => {
    expect(REQUIRED_SUBSECTIONS).toContain("shadcn primitives");
  });

  it("exposes a non-empty BETTER_AUTH_PATHS allowlist", () => {
    expect(BETTER_AUTH_PATHS.length).toBeGreaterThan(0);
  });

  it("BETTER_AUTH_PATHS entries are well-formed VERB /api/auth/... strings", () => {
    for (const entry of BETTER_AUTH_PATHS) {
      expect(entry).toMatch(/^(GET|POST|PATCH|DELETE|PUT) \/api\/auth\//);
    }
  });

  it("starts Phase 7 with an empty WIP_ENDPOINTS escape hatch (Plan 07 enforces empty at close)", () => {
    expect(WIP_ENDPOINTS).toEqual([]);
  });

  it("copy-key regex accepts a valid 5-level dotted key", () => {
    expect(COPY_KEY_REGEX.test("admin.config.stt.table.header")).toBe(true);
    expect(COPY_KEY_REGEX.test("end-user.trx.detail.metadata.duration")).toBe(true);
  });

  it("copy-key regex rejects keys with too few or too many segments", () => {
    expect(COPY_KEY_REGEX.test("admin.config.stt.header")).toBe(false);
    expect(COPY_KEY_REGEX.test("admin.config.stt.table.header.extra")).toBe(false);
    expect(COPY_KEY_REGEX.test("bad_key")).toBe(false);
  });

  it("endpoint regex parses 'METHOD /api/path' into capture groups", () => {
    const m = "POST /api/notes/search".match(ENDPOINT_REGEX);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("POST");
    expect(m?.[2]).toBe("/api/notes/search");
  });
});

describe("lint-ui-spec / coverage supplements", () => {
  it("listFastifyRoutes detects BOTH shorthand and app.route() registrations", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "lint-ui-spec-routes-"));
    writeFileSync(
      resolve(dir, "shorthand.ts"),
      'app.get<{Params:{}}>("/api/shorthand", async () => {})\napp.all("/api/auth/*", h)\n',
    );
    writeFileSync(
      resolve(dir, "object-method-first.ts"),
      'app.route({\n  method: "POST",\n  url: "/api/object-mf",\n  handler: async () => {}\n})\n',
    );
    writeFileSync(
      resolve(dir, "object-url-first.ts"),
      'app.route({\n  url: "/api/object-uf",\n  method: "PATCH",\n  handler: async () => {}\n})\n',
    );
    writeFileSync(resolve(dir, "x.test.ts"), 'app.get("/api/should-not-be-detected", ()=>{})');
    const routes = listFastifyRoutes(dir);
    expect(routes.has("GET /api/shorthand")).toBe(true);
    expect(routes.has("POST /api/object-mf")).toBe(true);
    expect(routes.has("PATCH /api/object-uf")).toBe(true);
    // app.all catch-all is NOT added — relies on BETTER_AUTH_PATHS.
    expect([...routes].some((r) => r.includes("/api/auth/*"))).toBe(false);
    // *.test.ts is excluded.
    expect(routes.has("GET /api/should-not-be-detected")).toBe(false);
  });

  it("listFastifyRoutes returns empty set for non-existent directory", () => {
    expect(listFastifyRoutes("/nonexistent/path/does-not-exist").size).toBe(0);
  });

  it("findProjectRoot walks up to repo root from a nested path", () => {
    const root = findProjectRoot(__dirname);
    expect(root).toMatch(/openwhispr-server$/);
  });

  it("findProjectRoot falls back to cwd when no package.json found", () => {
    const root = findProjectRoot("/");
    expect(typeof root).toBe("string");
  });

  it("accepts a screen using h3 ### subsection headings (instead of bold lead-ins)", async () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "lint-ui-spec-h3-"));
    const file = resolve(tmp, "h3.md");
    writeFileSync(
      file,
      `# H3 fixture\n\n## U4 — Usage dashboard\n\nSee visual: design/screens-user.jsx#ScreenUsage\n\n### Purpose\nText.\n\n### Roles\nText.\n\n### Route\nText.\n\n### Data\nText.\n\n### Actions\nText.\n\n### States\nText.\n\n### User journey\nText.\n\n### Copy keys\n\n| Key | Description |\n| --- | --- |\n| \`end-user.usage.kpi.h3.label\` | Label |\n\n### Wireframe\n\n\`\`\`text\n+---+\n| A |\n+---+\n\`\`\`\n\n### shadcn primitives\nCard.\n`,
    );
    const routes = resolve(__dirname, "../apps/api/src/routes");
    const diags = await lint([file], routes);
    expect(diags.filter((d: { rule: string }) => d.rule === "required-subsections")).toEqual([]);
  });

  it("skips non-screen ## headings (no Rule-1 fire on 'API Reference')", async () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "lint-ui-spec-noscreen-"));
    const file = resolve(tmp, "x.md");
    writeFileSync(
      file,
      "# Spec\n\n## API Reference (verified)\n\nNo screen sections.\n\n## Assumptions resolved\n\nNothing.\n",
    );
    const diags = await lint([file], resolve(__dirname, "../apps/api/src/routes"));
    expect(diags).toEqual([]);
  });

  it("flags a visual-ref pointing to a non-existent JSX file", async () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "lint-ui-spec-badfile-"));
    const file = resolve(tmp, "x.md");
    writeFileSync(
      file,
      "# spec\n\nSome paragraph. See visual: design/does-not-exist.jsx#Foo here.\n",
    );
    const diags = await lint([file], resolve(__dirname, "../apps/api/src/routes"));
    expect(
      diags.some(
        (d: { rule: string; message: string }) =>
          d.rule === "visual-ref-resolves" && /does-not-exist/.test(d.message),
      ),
    ).toBe(true);
  });

  it("matches Better Auth wildcard segments (e.g., /sign-in/social/:provider style)", async () => {
    // Reference an endpoint whose path component matches a `:provider`
    // style entry. The pass fixture already covers literal matches; this
    // test exercises the segmentsMatch fallback.
    const tmp = mkdtempSync(resolve(tmpdir(), "lint-ui-spec-ba-"));
    const file = resolve(tmp, "x.md");
    writeFileSync(
      file,
      "# spec\n\nParagraph cites `GET /api/auth/sign-in/social/google` which is on the literal allowlist.\n",
    );
    const diags = await lint([file], resolve(__dirname, "../apps/api/src/routes"));
    expect(diags.filter((d: { rule: string }) => d.rule === "endpoint-exists")).toEqual([]);
  });

  it("rejects unknown /api/auth/... endpoint not on allowlist", async () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "lint-ui-spec-baunk-"));
    const file = resolve(tmp, "x.md");
    writeFileSync(file, "# spec\n\nCites `POST /api/auth/does-not-exist`.\n");
    const diags = await lint([file], resolve(__dirname, "../apps/api/src/routes"));
    expect(
      diags.some(
        (d: { rule: string; message: string }) =>
          d.rule === "endpoint-exists" && /\/api\/auth\/does-not-exist/.test(d.message),
      ),
    ).toBe(true);
  });

  it("flags duplicate copy keys within a single file (same file uniqueness)", async () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "lint-ui-spec-dup1-"));
    const file = resolve(tmp, "x.md");
    writeFileSync(
      file,
      `# spec\n\n## U1 — A\n\nSee visual: design/screens-user.jsx#ScreenUsage\n\n**Purpose.** x.\n\n**Roles.** x.\n\n**Route.** x.\n\n**Data.** x.\n\n**Actions.** x.\n\n**States.** x.\n\n**User journey.** x.\n\n**Copy keys.**\n\n| Key | Desc |\n| --- | --- |\n| \`end-user.dup.key.label.text\` | one |\n\n**Wireframe.**\n\n\`\`\`text\n+--+\n| x|\n+--+\n\`\`\`\n\n**shadcn primitives.** Card.\n\n## U2 — B\n\nSee visual: design/screens-user.jsx#ScreenUsage\n\n**Purpose.** x.\n\n**Roles.** x.\n\n**Route.** x.\n\n**Data.** x.\n\n**Actions.** x.\n\n**States.** x.\n\n**User journey.** x.\n\n**Copy keys.**\n\n| Key | Desc |\n| --- | --- |\n| \`end-user.dup.key.label.text\` | two |\n\n**Wireframe.**\n\n\`\`\`text\n+--+\n| x|\n+--+\n\`\`\`\n\n**shadcn primitives.** Card.\n`,
    );
    const diags = await lint([file], resolve(__dirname, "../apps/api/src/routes"));
    expect(diags.some((d: { rule: string }) => d.rule === "copy-key-uniqueness")).toBe(true);
  });

  it("ignores wireframe rule when screen lacks a Wireframe subsection", async () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "lint-ui-spec-nowire-"));
    const file = resolve(tmp, "x.md");
    writeFileSync(
      file,
      "# spec\n\n## U9 — No wireframe screen\n\nSee visual: design/screens-user.jsx#ScreenUsage\n\n**Purpose.** x.\n",
    );
    const diags = await lint([file], resolve(__dirname, "../apps/api/src/routes"));
    expect(diags.some((d: { rule: string }) => d.rule === "wireframe-monospace")).toBe(false);
  });

  it("CLI main() returns 0 against project Plan-01 stubs", async () => {
    const code = await main([]);
    expect(code).toBe(0);
  });

  it("CLI main() returns 1 when given a failing fixture file as argv", async () => {
    const code = await main([
      resolve(__dirname, "lint-ui-spec/fixtures/fail-missing-subsection/screen-no-purpose.md"),
    ]);
    expect(code).toBe(1);
  });

  it("accepts visual-only sentinel in wireframe block", async () => {
    const diags = await lint(
      [resolve(__dirname, "lint-ui-spec/fixtures/pass/screen-visual-only.md")],
      resolve(__dirname, "../apps/api/src/routes"),
    );
    expect(diags.filter((d: { rule: string }) => d.rule === "wireframe-monospace")).toEqual([]);
  });

  it("handles wireframe subsection with no code block (no diagnostic)", async () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "lint-ui-spec-nocode-"));
    const file = resolve(tmp, "x.md");
    writeFileSync(
      file,
      "# spec\n\n## U1 — Screen\n\nSee visual: design/screens-user.jsx#ScreenUsage\n\n**Wireframe.**\n\nNo fenced block here, only prose.\n\n**shadcn primitives.** Card.\n",
    );
    const diags = await lint([file], resolve(__dirname, "../apps/api/src/routes"));
    expect(diags.some((d: { rule: string }) => d.rule === "wireframe-monospace")).toBe(false);
  });

  it("handles wireframe with multiple code blocks (uses first)", async () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "lint-ui-spec-multi-"));
    const file = resolve(tmp, "x.md");
    writeFileSync(
      file,
      `# spec\n\n## U1 — Screen\n\nSee visual: design/screens-user.jsx#ScreenUsage\n\n**Wireframe.**\n\n\`\`\`text\n+--+\n|x |\n+--+\n\`\`\`\n\n\`\`\`text\nsecond block ignored\n\`\`\`\n`,
    );
    const diags = await lint([file], resolve(__dirname, "../apps/api/src/routes"));
    expect(diags.some((d: { rule: string }) => d.rule === "wireframe-monospace")).toBe(false);
  });

  it("handles a screen with duplicate subsection markers (only first counts)", async () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "lint-ui-spec-dupsub-"));
    const file = resolve(tmp, "x.md");
    writeFileSync(
      file,
      "# spec\n\n## U1 — Screen\n\nSee visual: design/screens-user.jsx#ScreenUsage\n\n**Purpose.** first.\n\n**Purpose.** repeated — should be tolerated.\n",
    );
    const diags = await lint([file], resolve(__dirname, "../apps/api/src/routes"));
    // Purpose IS found, so it should not be in the missing list.
    expect(
      diags.some(
        (d: { rule: string; message: string }) =>
          d.rule === "required-subsections" && /Purpose/.test(d.message),
      ),
    ).toBe(false);
  });

  it("accepts subsection bold-lead-in with trailing text after the period", async () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "lint-ui-spec-trailing-"));
    const file = resolve(tmp, "x.md");
    writeFileSync(
      file,
      "# spec\n\n## U1 — Screen\n\nSee visual: design/screens-user.jsx#ScreenUsage\n\n### Purpose extras text\n\nbody\n",
    );
    const diags = await lint([file], resolve(__dirname, "../apps/api/src/routes"));
    expect(
      diags.some(
        (d: { rule: string; message: string }) =>
          d.rule === "required-subsections" && /missing subsection: Purpose/.test(d.message),
      ),
    ).toBe(false);
  });
});
