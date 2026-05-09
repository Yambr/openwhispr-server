/**
 * Phase 02.4 / G3 — api bundle externals + Dockerfile no-pnpm-deploy.
 *
 * Source-of-record commits: 26eaa69 (tsup external pg/pg-native), 7ccb8bb (Dockerfile multi-stage rewrite without pnpm deploy)
 *
 * Reverts: this test goes RED if either of the following inverse patches is applied:
 *   1. Re-add `RUN pnpm --filter @openwhispr/api --prod deploy /out` to apps/api/Dockerfile
 *      → assertion `expect(dockerfile).not.toMatch(/pnpm\s+deploy/)` fails.
 *   2. Remove `"pg"` from external in apps/api/tsup.config.ts
 *      → assertion `expect(tsupConfig).toMatch(/external:\s*\[[^\]]*"pg"/)` fails.
 *   3. Drop the multi-stage `AS prod-deps` block
 *      → "prod-deps stage exists" assertion fails.
 *
 * No docker build invocation: this is a config-file static-inspection test.
 * Coverage of the build runtime itself is via the existing self-test stack-up suite.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOCKERFILE = join(process.cwd(), "apps", "api", "Dockerfile");
const TSUP_CONFIG = join(process.cwd(), "apps", "api", "tsup.config.ts");

describe("Phase 02.4 G3 — apps/api/Dockerfile build configuration", () => {
  const dockerfile = readFileSync(DOCKERFILE, "utf8");
  // Strip line comments (Dockerfile `#` lines) so historical mentions of
  // `pnpm deploy` in the rationale comments do not satisfy the regex; we
  // only care about actual RUN/CMD invocations.
  const dockerfileCode = dockerfile
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  it("does NOT contain `pnpm deploy` (Phase 02.1 enterprise fix preserved)", () => {
    expect(dockerfileCode).not.toMatch(/pnpm\s+(?:--\S+\s+)*deploy\b/);
  });

  it("uses multi-stage pattern with builder / prod-deps / runtime", () => {
    expect(dockerfile).toMatch(/FROM\s+node:24-alpine\s+AS\s+builder\b/);
    expect(dockerfile).toMatch(/FROM\s+node:24-alpine\s+AS\s+prod-deps\b/);
    expect(dockerfile).toMatch(/FROM\s+node:24-alpine\s+AS\s+runtime\b/);
  });

  it("uses --node-linker=hoisted in prod-deps install (flat tree, copyable across stages)", () => {
    expect(dockerfile).toMatch(/--node-linker=hoisted/);
  });

  it('filters prod install to api transitive deps only (--filter "@openwhispr/api...")', () => {
    expect(dockerfile).toMatch(/--filter\s+"@openwhispr\/api\.\.\."/);
  });
});

describe("Phase 02.4 G3 — apps/api/tsup.config.ts external/noExternal contract", () => {
  const tsupConfig = readFileSync(TSUP_CONFIG, "utf8");

  it("externalizes `pg` (native bindings, cannot be ESM-bundled)", () => {
    expect(tsupConfig).toMatch(/external:\s*\[[^\]]*"pg"/);
  });

  it("externalizes `pg-native` (C addon)", () => {
    expect(tsupConfig).toMatch(/external:\s*\[[^\]]*"pg-native"/);
  });

  it("externalizes `better-auth` (dual ESM/CJS subpath exports)", () => {
    expect(tsupConfig).toMatch(/external:\s*\[[^\]]*"better-auth"/);
  });

  it("inlines @openwhispr/* workspace packages via noExternal", () => {
    expect(tsupConfig).toMatch(/noExternal:\s*\[[^\]]*\/\^@openwhispr\\\//);
  });
});
