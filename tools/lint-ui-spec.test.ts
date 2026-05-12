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
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// Intentional RED: tools/lint-ui-spec.ts is implemented in Plan 03.
// @ts-expect-error — module is created in Plan 03 (TDD GREEN phase).
import { lint } from "./lint-ui-spec";
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
