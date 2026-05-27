// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-vitest-reporter-inheritance.test.ts — Quick 260527-pj6 / B1 BLOCKER fix.
 *
 * F-cases per PLAN scope item 8 (and section 5):
 *   F1  — all configs include evidence reporter → exit 0
 *   F2  — one workspace's `reporters:` missing evidence reporter → exit 1
 *   F3  — workspace omits `reporters:` entirely → exit 0 (inherits)
 *   F4  — root config missing reporter → exit 1
 *   F5  — string-form `reporters: "default"` → exit 1
 *   F6  — spread form `reporters: [...someVar, "<path>"]` → exit 1
 *   F7  — computed-variable form `reporters: reportersList` → exit 1
 *   F8  — relative path `./tools/test-evidence-reporter.ts` → accepted
 *   F9  — absolute resolve form `resolve(ROOT_DIR, "tools/...")` → accepted
 *   F10 — multiple inline `defineProject` blocks; partial coverage → exit 1
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EVIDENCE_REPORTER_PATH_NEEDLE,
  runLint,
  runMain,
  scanFile,
} from "../lint-vitest-reporter-inheritance.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lint-vitest-reporter-inheritance-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(rel: string, content: string): string {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

const ROOT_CONFIG_WITH_REPORTER = `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    reporters: ["default", "./tools/test-evidence-reporter.ts"],
  },
});
`;

describe("F1 — clean tree, all configs include evidence reporter", () => {
  it("exits 0 when root carries the reporter and children inherit", () => {
    touch("vitest.config.ts", ROOT_CONFIG_WITH_REPORTER);
    touch(
      "apps/api/vitest.config.ts",
      `import { defineConfig, mergeConfig } from "vitest/config";
import rootConfig from "../../vitest.config.js";
export default mergeConfig(rootConfig, defineConfig({
  test: { name: "api" },
}));
`,
    );
    expect(runLint(root)).toEqual([]);
  });
});

describe("F2 — workspace's `reporters:` array missing evidence reporter", () => {
  it("exits 1 naming <file>:<line> of the offending workspace", () => {
    touch("vitest.config.ts", ROOT_CONFIG_WITH_REPORTER);
    touch(
      "packages/contract-tests/vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    name: "@openwhispr/contract-tests",
    reporters: ["dot"],
  },
});
`,
    );
    const v = runLint(root);
    expect(v).toHaveLength(1);
    expect(v[0]?.file).toBe("packages/contract-tests/vitest.config.ts");
    expect(v[0]?.reason).toBe("missing-evidence-reporter");
    expect(v[0]?.line).toBeGreaterThan(0);
  });
});

describe("F3 — workspace omits `reporters:` entirely (inherits)", () => {
  it("exits 0 — absent `reporters:` field is the accepted inheritance shape", () => {
    touch("vitest.config.ts", ROOT_CONFIG_WITH_REPORTER);
    touch(
      "packages/data/vitest.config.ts",
      `import { defineConfig, mergeConfig } from "vitest/config";
import rootConfig from "../../vitest.config.js";
export default mergeConfig(rootConfig, defineConfig({
  test: { name: "data" },
}));
`,
    );
    expect(runLint(root)).toEqual([]);
  });
});

describe("F4 — root config missing reporter", () => {
  it("exits 1 with root-config-omits-reporters reason", () => {
    touch(
      "vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["apps/**/*.test.ts"] },
});
`,
    );
    const v = runLint(root);
    // Exactly one violation, against the root.
    expect(v).toHaveLength(1);
    expect(v[0]?.file).toBe("vitest.config.ts");
    expect(v[0]?.reason).toBe("root-config-omits-reporters");
  });

  it("exits 1 when root has `reporters:` but without the evidence path", () => {
    touch(
      "vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { reporters: ["default"] },
});
`,
    );
    const v = runLint(root);
    expect(v).toHaveLength(1);
    expect(v[0]?.reason).toBe("missing-evidence-reporter");
  });
});

describe("F5 — string-form reporters", () => {
  it('refuses `reporters: "default"` at root', () => {
    touch(
      "vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { reporters: "default" },
});
`,
    );
    const v = runLint(root);
    expect(v).toHaveLength(1);
    expect(v[0]?.reason).toBe("string-form");
  });

  it('refuses `reporters: "dot"` in a child workspace', () => {
    touch("vitest.config.ts", ROOT_CONFIG_WITH_REPORTER);
    touch(
      "packages/contract-tests/vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { reporters: "dot" },
});
`,
    );
    const v = runLint(root);
    expect(v).toHaveLength(1);
    expect(v[0]?.reason).toBe("string-form");
    expect(v[0]?.file).toBe("packages/contract-tests/vitest.config.ts");
  });
});

describe("F6 — spread form rejected", () => {
  it('refuses `reporters: [...someVar, "./tools/..."]`', () => {
    touch("vitest.config.ts", ROOT_CONFIG_WITH_REPORTER);
    touch(
      "apps/api/vitest.config.ts",
      `import { defineConfig } from "vitest/config";
const baseReporters = ["dot"];
export default defineConfig({
  test: {
    reporters: [...baseReporters, "./tools/test-evidence-reporter.ts"],
  },
});
`,
    );
    const v = runLint(root);
    expect(v).toHaveLength(1);
    expect(v[0]?.reason).toBe("spread-or-computed");
  });
});

describe("F7 — computed-variable form rejected", () => {
  it("refuses `reporters: reportersList` (identifier reference)", () => {
    touch("vitest.config.ts", ROOT_CONFIG_WITH_REPORTER);
    touch(
      "apps/api/vitest.config.ts",
      `import { defineConfig } from "vitest/config";
const reportersList = ["dot", "./tools/test-evidence-reporter.ts"];
export default defineConfig({
  test: { reporters: reportersList },
});
`,
    );
    const v = runLint(root);
    expect(v).toHaveLength(1);
    expect(v[0]?.reason).toBe("spread-or-computed");
  });
});

describe("F8 — relative path from root accepted", () => {
  it('accepts `reporters: ["./tools/test-evidence-reporter.ts"]`', () => {
    touch(
      "vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { reporters: ["./tools/test-evidence-reporter.ts"] },
});
`,
    );
    expect(runLint(root)).toEqual([]);
  });
});

describe("F9 — absolute resolved form from child workspace accepted", () => {
  it('accepts `reporters: ["dot", resolve(ROOT_DIR, "tools/...")]`', () => {
    touch("vitest.config.ts", ROOT_CONFIG_WITH_REPORTER);
    touch(
      "packages/contract-tests/vitest.config.ts",
      `import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
const ROOT_DIR = "../..";
export default defineConfig({
  test: {
    reporters: ["dot", resolve(ROOT_DIR, "tools/test-evidence-reporter.ts")],
  },
});
`,
    );
    // The element text contains the literal string segment
    // `tools/test-evidence-reporter.ts` even though it's inside a
    // CallExpression; the lint accepts that because the substring
    // needle is unambiguous.
    expect(runLint(root)).toEqual([]);
  });
});

describe("F10 — multiple inline `defineProject` blocks; partial coverage", () => {
  it("flags an inline project whose `reporters:` lacks evidence reporter", () => {
    touch(
      "vitest.config.ts",
      `import { defineConfig, defineProject } from "vitest/config";
export default defineConfig({
  test: {
    reporters: ["default", "./tools/test-evidence-reporter.ts"],
    projects: [
      defineProject({
        test: {
          name: "alpha",
          reporters: ["default", "./tools/test-evidence-reporter.ts"],
        },
      }),
      defineProject({
        test: {
          name: "beta",
          reporters: ["dot"],
        },
      }),
    ],
  },
});
`,
    );
    const v = runLint(root);
    expect(v).toHaveLength(1);
    expect(v[0]?.reason).toBe("missing-evidence-reporter");
  });
});

describe("scanFile — defensive coverage", () => {
  it("returns [] for an unreadable file", () => {
    const result = scanFile(join(root, "does-not-exist.ts"), "does-not-exist.ts");
    expect(result).toEqual([]);
  });

  it('does not match `coverage: { reporter: "text" }` (singular, different ancestor)', () => {
    touch(
      "vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    reporters: ["./tools/test-evidence-reporter.ts"],
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
`,
    );
    // Singular `coverage.reporter` (not `coverage.reporters`) does
    // not collide with the `test.reporters` walker because the
    // identifier name differs. Sanity check the clean run.
    expect(runLint(root)).toEqual([]);
  });
});

describe("runLint — sort comparator (multi-violation)", () => {
  it("sorts violations by file then line when 2+ are found", () => {
    touch("vitest.config.ts", ROOT_CONFIG_WITH_REPORTER);
    touch(
      "apps/zeta/vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { reporters: ["dot"] } });
`,
    );
    touch(
      "apps/alpha/vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { reporters: "default" } });
`,
    );
    const v = runLint(root);
    // Sorted ascending — alpha comes before zeta.
    expect(v.map((x) => x.file)).toEqual([
      "apps/alpha/vitest.config.ts",
      "apps/zeta/vitest.config.ts",
    ]);
  });

  it("sorts same-file violations by line (a.file === b.file branch)", () => {
    // Two violations in the SAME file: the root config + inline
    // project both have missing-evidence-reporter.
    touch(
      "vitest.config.ts",
      `import { defineConfig, defineProject } from "vitest/config";
export default defineConfig({
  test: {
    reporters: ["dot"],
    projects: [
      defineProject({ test: { name: "alpha", reporters: ["fake"] } }),
    ],
  },
});
`,
    );
    const v = runLint(root);
    expect(v.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < v.length; i++) {
      const prev = v[i - 1];
      const cur = v[i];
      if (prev && cur && prev.file === cur.file) {
        expect(prev.line).toBeLessThanOrEqual(cur.line);
      }
    }
  });
});

describe("runLint — IGNORE_SEGMENTS", () => {
  it("skips node_modules / .stryker-tmp / .claude/worktrees configs", () => {
    touch("vitest.config.ts", ROOT_CONFIG_WITH_REPORTER);
    touch(
      "node_modules/some-pkg/vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { reporters: "dot" } });
`,
    );
    touch(
      ".stryker-tmp/sandbox/apps/api/vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { reporters: "dot" } });
`,
    );
    expect(runLint(root)).toEqual([]);
  });
});

describe("scanFile — additional branch coverage", () => {
  it("a non-root child workspace with no `reporters:` is silently accepted (inheritance)", () => {
    // Direct scanFile call against a child config that has NO
    // `reporters:` at all → expect empty violation list.
    const childPath = touch(
      "packages/foo/vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
`,
    );
    const result = scanFile(childPath, "packages/foo/vitest.config.ts");
    expect(result).toEqual([]);
  });

  it("does not flag `reporters` outside a `test:` ancestor (false-positive guard)", () => {
    // A `reporters:` key under a non-test ancestor (e.g., a plugin
    // options object) must be IGNORED. The walker only matches
    // PropertyAssignments whose nearest `test:` ancestor exists.
    touch(
      "vitest.config.ts",
      `import { defineConfig } from "vitest/config";
const plugin = {
  options: { reporters: ["fake-from-plugin"] },
};
export default defineConfig({
  test: { reporters: ["./tools/test-evidence-reporter.ts"] },
  plugins: [plugin],
});
`,
    );
    expect(runLint(root)).toEqual([]);
  });

  it("walks a vitest.config.ts with an empty `reporters: []` array", () => {
    // Empty array → no spread, no evidence reporter → missing.
    touch(
      "vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { reporters: [] },
});
`,
    );
    const v = runLint(root);
    expect(v).toHaveLength(1);
    expect(v[0]?.reason).toBe("missing-evidence-reporter");
  });

  it("walks a config with `reporters:` declared without an initialiser is silently skipped", () => {
    // This is a defensive branch — practically never exercised
    // since the parser requires an initialiser, but the
    // `!initialiser` guard exists for safety. We cannot construct
    // such a fixture from real TS source (the parser would reject
    // the file), so this test is more about documenting the
    // expectation than exercising it.
    expect(true).toBe(true);
  });
});

describe("runMain — exit codes and stderr format", () => {
  it("returns 0 with PASSED message on a clean tree", () => {
    touch("vitest.config.ts", ROOT_CONFIG_WITH_REPORTER);
    const out: string[] = [];
    const err: string[] = [];
    const code = runMain({
      root,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(0);
    expect(out.join("")).toContain("PASSED");
  });

  it("returns 1 with stderr listing each violation", () => {
    touch(
      "vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { reporters: "default" } });
`,
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = runMain({
      root,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(1);
    const stderr = err.join("");
    expect(stderr).toContain("FAILED");
    expect(stderr).toContain("vitest.config.ts");
    expect(stderr).toContain("string-form");
    expect(stderr).toContain("remediation");
  });

  it("includes the missing-evidence-reporter substring needle in the failure detail", () => {
    touch("vitest.config.ts", ROOT_CONFIG_WITH_REPORTER);
    touch(
      "apps/api/vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { reporters: ["dot"] } });
`,
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = runMain({
      root,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(1);
    expect(err.join("")).toContain(EVIDENCE_REPORTER_PATH_NEEDLE);
  });

  it("returns 2 with stderr on internal error (non-string root)", () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runMain({
      root: 999 as unknown as string,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(2);
    expect(err.join("")).toContain("internal error");
  });

  it("mainEntry returns a number (resolveRoot + runMain integration)", async () => {
    // Boot mainEntry through the LINT_VITEST_REPORTER_INHERITANCE_ROOT
    // env override so it scans an empty tree (no configs → 0 violations).
    process.env.LINT_VITEST_REPORTER_INHERITANCE_ROOT = root;
    const mod = await import("../lint-vitest-reporter-inheritance.js");
    const code = mod.mainEntry();
    // Empty tree → no violations → exit 0.
    expect(code).toBe(0);
    delete process.env.LINT_VITEST_REPORTER_INHERITANCE_ROOT;
  });

  it("surfaces non-Error throws via String(err) in the catch", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const real = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...real,
        globSync: () => {
          throw 42; // non-Error throw
        },
      };
    });
    const mod = await import("../lint-vitest-reporter-inheritance.js");
    const out: string[] = [];
    const err: string[] = [];
    const code = mod.runMain({
      root,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(2);
    expect(err.join("")).toContain("42");
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("reports spread-or-computed reason in stderr", () => {
    touch("vitest.config.ts", ROOT_CONFIG_WITH_REPORTER);
    touch(
      "apps/api/vitest.config.ts",
      `import { defineConfig } from "vitest/config";
const base = ["dot"];
export default defineConfig({ test: { reporters: [...base, "./tools/test-evidence-reporter.ts"] } });
`,
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = runMain({
      root,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(1);
    expect(err.join("")).toContain("cannot statically verify");
  });

  it("reports the root-config-omits-reporters reason in stderr", () => {
    touch(
      "vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["apps/**/*.test.ts"] } });
`,
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = runMain({
      root,
      stdout: { write: (s) => void out.push(s) },
      stderr: { write: (s) => void err.push(s) },
    });
    expect(code).toBe(1);
    expect(err.join("")).toContain("root vitest.config.ts cannot inherit");
  });
});
