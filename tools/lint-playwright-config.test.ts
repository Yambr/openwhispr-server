// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 21 / Plan 21-02 / SR-21.2 — RED→GREEN tests for tools/lint-playwright-config.ts.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  collectPlaywrightConfigs,
  collectTestFiles,
  lintNoRetries,
  lintNoSkipOrOnlyOutsideTests,
  lintWorkersBound,
  run,
} from "./lint-playwright-config";

const SCRIPT = join(process.cwd(), "tools", "lint-playwright-config.ts");

function runLint(args: string[], cwd?: string): { code: number; stderr: string; stdout: string } {
  try {
    const stdout = execFileSync("pnpm", ["exec", "tsx", SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status: number | null; stderr?: Buffer; stdout?: Buffer };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

// ──────────────────────────────────────────────────────────────────
// Pure-function tests.
// ──────────────────────────────────────────────────────────────────

describe("lintNoRetries", () => {
  it("flags retries: 1, retries: 2, retries: N>0", () => {
    for (const n of [1, 2, 5]) {
      const offenders = lintNoRetries(
        new Map([["pw.config.ts", `export default defineConfig({\n  retries: ${n},\n});`]]),
      );
      expect(offenders).toHaveLength(1);
      expect(offenders[0].message).toMatch(/retries/i);
    }
  });

  it("accepts retries: 0", () => {
    const offenders = lintNoRetries(
      new Map([["pw.config.ts", "export default defineConfig({\n  retries: 0,\n});"]]),
    );
    expect(offenders).toEqual([]);
  });

  it("accepts files with no retries key at all", () => {
    const offenders = lintNoRetries(
      new Map([["pw.config.ts", "export default defineConfig({\n  workers: 1,\n});"]]),
    );
    expect(offenders).toEqual([]);
  });

  it("flags process.env-based dynamic retry expressions as suspicious", () => {
    // `retries: process.env.CI ? 2 : 0` — the > 0 path is forbidden.
    const offenders = lintNoRetries(
      new Map([
        ["pw.config.ts", "export default defineConfig({\n  retries: process.env.CI ? 2 : 0,\n});"],
      ]),
    );
    expect(offenders).toHaveLength(1);
  });
});

describe("lintWorkersBound", () => {
  it("flags workers > 1 in the e2e-cjm config", () => {
    const offenders = lintWorkersBound(
      new Map([
        ["tests/e2e-cjm/playwright.config.ts", "export default defineConfig({\n  workers: 4,\n});"],
      ]),
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0].message).toMatch(/workers/i);
  });

  it("ignores workers > 1 in other playwright configs (only e2e-cjm is sequential)", () => {
    const offenders = lintWorkersBound(
      new Map([
        ["apps/web/playwright.config.ts", "export default defineConfig({\n  workers: 4,\n});"],
      ]),
    );
    expect(offenders).toEqual([]);
  });

  it("accepts workers: 1 in the e2e-cjm config", () => {
    const offenders = lintWorkersBound(
      new Map([
        ["tests/e2e-cjm/playwright.config.ts", "export default defineConfig({\n  workers: 1,\n});"],
      ]),
    );
    expect(offenders).toEqual([]);
  });
});

describe("lintNoSkipOrOnlyOutsideTests", () => {
  it("flags test.skip / test.only / test.fixme in test source (static-title form)", () => {
    const cases = [
      "test.skip('foo', () => {});",
      "test.only('foo', () => {});",
      "test.fixme('foo', () => {});",
      "it.skip('foo', () => {});",
      "describe.only('foo', () => {});",
    ];
    for (const body of cases) {
      const offenders = lintNoSkipOrOnlyOutsideTests(
        new Map([["a.test.ts", `import { test } from "@playwright/test";\n${body}\n`]]),
      );
      expect(offenders.length).toBeGreaterThan(0);
    }
  });

  it("ALLOWS the runtime-conditional test.skip(condition, reason?) form", () => {
    // Playwright's `test.skip(condition, reason?)` is a runtime-conditional
    // skip — equivalent to an early `return` guarded by an environment
    // probe. NOT a static skip; not a flake-masker.
    const offenders = lintNoSkipOrOnlyOutsideTests(
      new Map([
        [
          "a.test.ts",
          [
            "test('feature', async ({ page }) => {",
            "  const resp = await page.goto('/setup');",
            "  if (!resp?.ok()) {",
            "    test.skip(true, 'setup already completed');",
            "    return;",
            "  }",
            "});",
          ].join("\n"),
        ],
      ]),
    );
    expect(offenders).toEqual([]);
  });

  it("ignores files under **/__tests__/** (where fixtures legitimately exercise these directives)", () => {
    const offenders = lintNoSkipOrOnlyOutsideTests(
      new Map([["tests/__tests__/fixture.test.ts", "test.only('focused', () => {});\n"]]),
    );
    expect(offenders).toEqual([]);
  });

  it("does NOT flag the well-known 'skip' identifier outside a test.x pattern", () => {
    const offenders = lintNoSkipOrOnlyOutsideTests(
      new Map([["a.test.ts", "const skip = false; if (skip) return;\n"]]),
    );
    expect(offenders).toEqual([]);
  });

  it("skips the linter's own test file (fixture-literal carve-out)", () => {
    const offenders = lintNoSkipOrOnlyOutsideTests(
      new Map([["tools/lint-playwright-config.test.ts", "test.only('foo', () => {});\n"]]),
    );
    expect(offenders).toEqual([]);
  });

  it("ignores tokens that appear inside line and block comments", () => {
    const body = [
      "// test.only('this is a comment', () => {});",
      "/* test.skip('block-comment', () => {}); */",
      "const x = 1;",
    ].join("\n");
    const offenders = lintNoSkipOrOnlyOutsideTests(new Map([["a.test.ts", body]]));
    expect(offenders).toEqual([]);
  });
});

describe("lintNoRetries and lintWorkersBound (comment carve-out)", () => {
  it("does NOT flag `retries:` inside a block comment", () => {
    const offenders = lintNoRetries(
      new Map([
        [
          "pw.config.ts",
          "/* old: retries: 3 — replaced */\nexport default defineConfig({ retries: 0 });",
        ],
      ]),
    );
    expect(offenders).toEqual([]);
  });

  it("does NOT flag `workers:` inside a line comment in e2e-cjm config", () => {
    const offenders = lintWorkersBound(
      new Map([
        [
          "tests/e2e-cjm/playwright.config.ts",
          "// workers: 4 is what we want eventually\nexport default defineConfig({ workers: 1 });",
        ],
      ]),
    );
    expect(offenders).toEqual([]);
  });
});

describe("collectPlaywrightConfigs", () => {
  it("returns the empty array on a tree with no playwright configs", () => {
    const dir = mkdtempSync(join(tmpdir(), "lpc-collect-"));
    expect(collectPlaywrightConfigs(dir)).toEqual([]);
  });

  it("finds playwright.config.ts files recursively, skipping node_modules", () => {
    const dir = mkdtempSync(join(tmpdir(), "lpc-collect2-"));
    mkdirSync(join(dir, "a"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
    writeFileSync(join(dir, "a", "playwright.config.ts"), "export default {};");
    writeFileSync(join(dir, "node_modules", "x", "playwright.config.ts"), "export default {};");
    const out = collectPlaywrightConfigs(dir);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/a\/playwright\.config\.ts$/);
  });
});

describe("collectTestFiles", () => {
  it("finds *.test.ts and *.spec.ts files but excludes node_modules + dist", () => {
    const dir = mkdtempSync(join(tmpdir(), "lpc-tests-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "src", "a.test.ts"), "");
    writeFileSync(join(dir, "src", "b.spec.ts"), "");
    writeFileSync(join(dir, "node_modules", "x", "c.test.ts"), "");
    writeFileSync(join(dir, "dist", "d.test.ts"), "");
    const out = collectTestFiles(dir);
    expect(out).toHaveLength(2);
  });

  it("returns empty on missing dir", () => {
    expect(collectTestFiles(join(tmpdir(), "definitely-not-here-lpc"))).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// run() opts-injection.
// ──────────────────────────────────────────────────────────────────

describe("parseArgs edge cases (via run)", () => {
  it("defaults --root to '.' when not supplied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lpc-no-root-"));
    let out = "";
    const code = await run({
      argv: [],
      cwd: dir,
      stdout: (s) => {
        out += s;
      },
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out).toMatch(/passed/i);
  });

  it("--root with no following value falls back to default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lpc-bare-root-"));
    const code = await run({
      argv: ["--root"],
      cwd: dir,
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
  });
});

describe("run (in-process)", () => {
  it("exits 0 on an empty fixture repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lpc-empty-"));
    let out = "";
    let err = "";
    const code = await run({
      argv: ["--root", dir],
      cwd: dir,
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
    });
    expect(code).toBe(0);
    expect(out).toMatch(/passed/i);
    expect(err).toBe("");
  });

  it("exits 1 aggregating all three lint rules", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lpc-bad-"));
    mkdirSync(join(dir, "tests", "e2e-cjm"), { recursive: true });
    mkdirSync(join(dir, "apps", "x"), { recursive: true });
    writeFileSync(
      join(dir, "tests", "e2e-cjm", "playwright.config.ts"),
      "export default defineConfig({\n  retries: 3,\n  workers: 8,\n});\n",
    );
    writeFileSync(
      join(dir, "apps", "x", "a.test.ts"),
      "import { test } from '@playwright/test';\ntest.only('foo', () => {});\n",
    );
    let err = "";
    const code = await run({
      argv: ["--root", dir],
      cwd: dir,
      stdout: () => {},
      stderr: (s) => {
        err += s;
      },
    });
    expect(code).toBe(1);
    expect(err).toMatch(/retries/i);
    expect(err).toMatch(/workers/i);
    expect(err).toMatch(/test\.only/i);
  });
});

// ──────────────────────────────────────────────────────────────────
// CLI subprocess.
// ──────────────────────────────────────────────────────────────────

describe("lint-playwright-config (CLI)", () => {
  it("exits 0 against the in-repo tree (sanity)", () => {
    const r = runLint([]);
    expect(r.code).toBe(0);
  });

  it("exits 1 on an isolated bad fixture", () => {
    const dir = mkdtempSync(join(tmpdir(), "lpc-cli-bad-"));
    mkdirSync(join(dir, "tests", "e2e-cjm"), { recursive: true });
    writeFileSync(
      join(dir, "tests", "e2e-cjm", "playwright.config.ts"),
      "export default defineConfig({ retries: 2 });\n",
    );
    const r = runLint(["--root", dir]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/retries/i);
  });
});
