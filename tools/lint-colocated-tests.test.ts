// SPDX-License-Identifier: Apache-2.0
/**
 * lint-colocated-tests.test.ts — RED→GREEN coverage for the lint guard.
 *
 * Phase 15 STRUCT-01 forbids co-located `*.test.ts` siblings of source
 * files under apps/<app>/src/** and packages/<pkg>/src/**. This guard
 * is the CLI-pivot path chosen by Task 0 (no ESLint config exists in
 * this repo; lint stack is Biome). It mirrors tools/lint-tdd.ts shape:
 * exit 0 on clean tree, 1 on violations, 2 on internal error.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findViolations,
  isAllowed,
  LEGACY_ALLOWLIST_FILE,
  readLegacyAllowlist,
} from "./lint-colocated-tests.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lint-colocated-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(rel: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, "", "utf8");
}

describe("isAllowed (allow-list predicate)", () => {
  it("treats tools/load-test/** as allowed (dev tooling exemption)", () => {
    expect(isAllowed("tools/load-test/src/scenario.test.ts")).toBe(true);
  });

  it("treats tests/** (root e2e/conformance/infra) as allowed", () => {
    expect(isAllowed("tests/e2e-cjm/journey.test.ts")).toBe(true);
    expect(isAllowed("tests/conformance/ui-spec.test.ts")).toBe(true);
  });

  it("treats canonical tests/unit/** paths as allowed", () => {
    expect(isAllowed("apps/api/tests/unit/lib/foo.test.ts")).toBe(true);
    expect(isAllowed("packages/data/tests/unit/x.test.ts")).toBe(true);
  });

  it("treats co-located src tests as NOT allowed", () => {
    expect(isAllowed("apps/api/src/lib/foo.test.ts")).toBe(false);
    expect(isAllowed("packages/byok-guard/src/__tests__/g.test.ts")).toBe(false);
  });
});

describe("findViolations (real tmpdir glob)", () => {
  it("flags apps/<app>/src/**/*.test.ts as a violation (positive case 1)", async () => {
    touch("apps/api/src/foo.test.ts");
    const violations = await findViolations(root);
    expect(violations).toEqual(["apps/api/src/foo.test.ts"]);
  });

  it("does NOT flag apps/<app>/tests/unit/**/*.test.ts (negative case 2)", async () => {
    touch("apps/api/tests/unit/foo.test.ts");
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("does NOT flag tools/load-test/**/*.test.ts (exempt allow-list, case 3)", async () => {
    touch("tools/load-test/src/foo.test.ts");
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("does NOT flag tests/e2e-cjm/**/*.test.ts (root tests exempt, case 4)", async () => {
    touch("tests/e2e-cjm/foo.test.ts");
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("flags packages/<pkg>/src/**/*.test.ts the same as apps/<app>/src/**", async () => {
    touch("packages/byok-guard/src/__tests__/guard.test.ts");
    const violations = await findViolations(root);
    expect(violations).toEqual(["packages/byok-guard/src/__tests__/guard.test.ts"]);
  });

  it("returns sorted unique violation paths", async () => {
    touch("apps/api/src/b.test.ts");
    touch("apps/api/src/a.test.ts");
    const violations = await findViolations(root);
    expect(violations).toEqual(["apps/api/src/a.test.ts", "apps/api/src/b.test.ts"]);
  });

  it("skips paths listed in the legacy allow-list file (15-01 -> 15-02 transition)", async () => {
    touch("apps/api/src/legacy.test.ts");
    touch("apps/api/src/new.test.ts");
    const listPath = join(root, LEGACY_ALLOWLIST_FILE);
    mkdirSync(join(listPath, ".."), { recursive: true });
    writeFileSync(listPath, "# legacy allow-list\napps/api/src/legacy.test.ts\n\n", "utf8");
    const violations = await findViolations(root);
    expect(violations).toEqual(["apps/api/src/new.test.ts"]);
  });
});

describe("readLegacyAllowlist", () => {
  it("returns an empty Set when the file does not exist", () => {
    expect(readLegacyAllowlist(root).size).toBe(0);
  });

  it("ignores blank lines and comments", () => {
    const listPath = join(root, LEGACY_ALLOWLIST_FILE);
    mkdirSync(join(listPath, ".."), { recursive: true });
    writeFileSync(
      listPath,
      "# header comment\n\napps/api/src/a.test.ts\n  apps/api/src/b.test.ts  \n",
      "utf8",
    );
    const set = readLegacyAllowlist(root);
    expect([...set].sort()).toEqual(["apps/api/src/a.test.ts", "apps/api/src/b.test.ts"]);
  });
});
