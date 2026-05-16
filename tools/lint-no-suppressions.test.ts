// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWLIST_FILE,
  findViolations,
  main,
  readAllowlist,
  seedAllowlist,
  type Violation,
} from "./lint-no-suppressions.ts";

const SCRIPT = join(process.cwd(), "tools", "lint-no-suppressions.ts");
const FIXTURE_DIR = join(process.cwd(), "tools", "lint-no-suppressions", "fixtures");

function runCli(
  rootDir: string,
  extraArgv: string[] = [],
): {
  code: number;
  stderr: string;
  stdout: string;
} {
  try {
    const stdout = execFileSync("pnpm", ["exec", "tsx", SCRIPT, rootDir, ...extraArgv], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status: number | null; stderr?: Buffer; stdout?: Buffer };
    return {
      code: e.status ?? 1,
      stderr: e.stderr?.toString() ?? "",
      stdout: e.stdout?.toString() ?? "",
    };
  }
}

/**
 * Stage a fixture file under apps/api/src/ inside the tmp scan root so the
 * `apps/**\/src/**` glob picks it up.
 */
function stageFixture(root: string, relTarget: string, fixtureFile: string): string {
  const targetDir = join(root, "apps", "api", "src");
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, relTarget);
  // Fixtures are committed as `*.ts.fixture` so biome (which runs on the
  // real repo tree pre-commit) does NOT rewrite their literal suppression
  // tokens. Stage them with the `.ts` extension into the tmp scan root so
  // the linter's `apps/**\/src/**\/*.{ts,tsx}` glob picks them up.
  copyFileSync(join(FIXTURE_DIR, `${fixtureFile}.fixture`), targetPath);
  return targetPath;
}

describe("lint-no-suppressions — findViolations", () => {
  it("returns 4 forbidden-pattern labels in order on the violates fixture", async () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-violates-"));
    stageFixture(root, "violates.ts", "violates.ts");
    const vs = await findViolations(root);
    const labels = vs.map((v: Violation) => v.label);
    expect(labels).toEqual(["as-any", "as-unknown-as", "ts-ignore", "ts-nocheck"]);
    for (const v of vs) {
      expect(v.file).toBe("apps/api/src/violates.ts");
      expect(v.lineNumber).toBeGreaterThan(0);
      expect(v.lineText.length).toBeGreaterThan(0);
    }
  });

  it("returns zero findings on the clean fixture", async () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-clean-"));
    stageFixture(root, "clean.ts", "clean.ts");
    const vs = await findViolations(root);
    expect(vs).toEqual([]);
  });

  it("allows a properly-formatted @ts-expect-error issue-NNNN: <reason>", async () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-valid-"));
    stageFixture(root, "expect-error-valid.ts", "expect-error-valid.ts");
    const vs = await findViolations(root);
    // The line `42 as unknown as string` legitimately triggers `as-unknown-as`,
    // so the only assertion here is that NO `expect-error-malformed` is emitted.
    expect(vs.map((v) => v.label)).not.toContain("expect-error-malformed");
  });

  it("flags malformed @ts-expect-error (bare + missing issue-id prefix)", async () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-bad-"));
    stageFixture(root, "expect-error-malformed.ts", "expect-error-malformed.ts");
    const vs = await findViolations(root);
    const malformed = vs.filter((v) => v.label === "expect-error-malformed");
    expect(malformed.length).toBe(2);
  });

  it("sorts findings by file then lineNumber across multiple files", async () => {
    // Two source files in two packages → exercises the sort comparator's
    // `a.file !== b.file` branch (both directions).
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-sort-"));
    const a = join(root, "apps", "alpha", "src");
    const b = join(root, "apps", "zeta", "src");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    writeFileSync(join(a, "a.ts"), "const x = 1 as any;\nconst y = 2 as any;\n");
    writeFileSync(join(b, "z.ts"), "const w = 9 as any;\n");
    const vs = await findViolations(root);
    expect(vs.map((v) => `${v.file}:${v.lineNumber}`)).toEqual([
      "apps/alpha/src/a.ts:1",
      "apps/alpha/src/a.ts:2",
      "apps/zeta/src/z.ts:1",
    ]);
  });

  it("scans packages/*/src/** as well as apps/*/src/**", async () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-pkg-"));
    const pkg = join(root, "packages", "data", "src");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "x.ts"), "const x = 1 as any;\n");
    const vs = await findViolations(root);
    expect(vs).toEqual([
      {
        file: "packages/data/src/x.ts",
        lineNumber: 1,
        lineText: "const x = 1 as any;",
        label: "as-any",
      },
    ]);
  });

  it("excludes *.test.ts files from the scan", async () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-testglob-"));
    const dir = join(root, "apps", "api", "src");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "thing.test.ts"), "const x = 1 as any;\n");
    const vs = await findViolations(root);
    expect(vs).toEqual([]);
  });

  it("respects the allowlist (line-granular: file:lineNumber)", async () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-allow-"));
    stageFixture(root, "violates.ts", "violates.ts");
    // Allowlist every line in the staged file.
    mkdirSync(join(root, "tools"), { recursive: true });
    writeFileSync(
      join(root, ALLOWLIST_FILE),
      [
        "apps/api/src/violates.ts:8  # test-allow as-any",
        "apps/api/src/violates.ts:14  # test-allow as-unknown-as",
        "apps/api/src/violates.ts:17  # test-allow ts-ignore",
        "apps/api/src/violates.ts:21  # test-allow ts-nocheck",
      ].join("\n") + "\n",
    );
    const vs = await findViolations(root);
    expect(vs).toEqual([]);
  });

  it("readAllowlist returns empty set when allowlist file is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-no-allow-"));
    const allow = readAllowlist(root);
    expect(allow.size).toBe(0);
  });

  it("readAllowlist skips blank lines and comment-only lines", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-allow-parse-"));
    mkdirSync(join(root, "tools"), { recursive: true });
    writeFileSync(
      join(root, ALLOWLIST_FILE),
      [
        "# header comment",
        "",
        "  # indented comment",
        "apps/api/src/foo.ts:10  # issue-31-debt-suppression",
        "apps/api/src/bar.ts:20",
        "",
      ].join("\n") + "\n",
    );
    const allow = readAllowlist(root);
    expect(allow.has("apps/api/src/foo.ts:10")).toBe(true);
    expect(allow.has("apps/api/src/bar.ts:20")).toBe(true);
    expect(allow.size).toBe(2);
  });
});

describe("lint-no-suppressions — CLI (subprocess smoke)", () => {
  it("exits 0 on a clean tree via the real binary", () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-cli-clean-"));
    stageFixture(root, "clean.ts", "clean.ts");
    const r = runCli(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/clean/);
  });
});

describe("lint-no-suppressions — main() in-process", () => {
  it("returns 0 on a clean tree", async () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-main-clean-"));
    stageFixture(root, "clean.ts", "clean.ts");
    expect(await main([root])).toBe(0);
  });

  it("returns 1 on a tree with violations", async () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-main-bad-"));
    stageFixture(root, "violates.ts", "violates.ts");
    expect(await main([root])).toBe(1);
  });

  it("returns 0 + writes allowlist on --seed-allowlist", async () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-main-seed-"));
    stageFixture(root, "violates.ts", "violates.ts");
    expect(await main([root, "--seed-allowlist"])).toBe(0);
    const txt = readFileSync(join(root, ALLOWLIST_FILE), "utf8");
    expect(txt).toMatch(/apps\/api\/src\/violates\.ts:\d+\s+# issue-31-debt-suppression/);
    // After seeding, a normal scan returns 0.
    expect(await main([root])).toBe(0);
  });

  it("accepts --seed-allowlist in either argv position", async () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-main-seed-flag-"));
    stageFixture(root, "violates.ts", "violates.ts");
    expect(await main(["--seed-allowlist", root])).toBe(0);
  });

  it("defaults rootDir to process.cwd() when no positional argv", async () => {
    // Just exercise the default-path branch; we expect either 0 (real
    // repo is clean against its own allowlist) or 1, never a throw.
    const code = await main([]);
    expect([0, 1]).toContain(code);
  });
});

describe("lint-no-suppressions — seedAllowlist direct", () => {
  it("writes 0 entries on a clean tree", async () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-seed-clean-"));
    stageFixture(root, "clean.ts", "clean.ts");
    const r = await seedAllowlist(root);
    expect(r.count).toBe(0);
    expect(r.path.endsWith("lint-no-suppressions.allowlist.txt")).toBe(true);
  });

  it("writes N entries equal to findViolations count", async () => {
    const root = mkdtempSync(join(tmpdir(), "lint-no-supp-seed-bad-"));
    stageFixture(root, "violates.ts", "violates.ts");
    const vs = await findViolations(root);
    const r = await seedAllowlist(root);
    expect(r.count).toBe(vs.length);
  });
});
