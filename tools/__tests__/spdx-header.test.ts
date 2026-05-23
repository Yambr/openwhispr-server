// SPDX-License-Identifier: FSL-1.1-ALv2
// REUSE-IgnoreStart
import {
  readFileSync as _readFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve as _resolve, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyHeader,
  applyHeaderHash,
  auditDir,
  auditDirHash,
  fixDir,
  fixDirHash,
  HASH_HEADER,
  HEADER,
  hasHashHeader,
  hasHeader,
  isBinary,
  main,
  shouldSkip,
  shouldSkipHash,
} from "../spdx-header.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "spdx-header-test-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function write(rel: string, content: string): string {
  const full = join(workDir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

describe("HEADER constant", () => {
  it("is the FSL-1.1-ALv2 SPDX short-form line", () => {
    expect(HEADER).toBe("// SPDX-License-Identifier: FSL-1.1-ALv2");
  });
});

describe("hasHeader", () => {
  it("returns true when first non-shebang line is the SPDX header", () => {
    expect(hasHeader("// SPDX-License-Identifier: FSL-1.1-ALv2\nexport {};\n")).toBe(true);
  });

  it("returns true when shebang precedes header on line 2", () => {
    expect(
      hasHeader("#!/usr/bin/env node\n// SPDX-License-Identifier: FSL-1.1-ALv2\nexport {};\n"),
    ).toBe(true);
  });

  it("returns false when no header present", () => {
    expect(hasHeader("export const x = 1;\n")).toBe(false);
  });

  it("returns false when shebang present but no header on line 2", () => {
    expect(hasHeader("#!/usr/bin/env node\nexport {};\n")).toBe(false);
  });

  it("returns false when a stale Apache-2.0 header is on line 1", () => {
    expect(hasHeader("// SPDX-License-Identifier: Apache-2.0\nexport {};\n")).toBe(false);
  });

  it("returns false when a stale Apache-2.0 header is on line 2 after shebang", () => {
    expect(
      hasHeader("#!/usr/bin/env node\n// SPDX-License-Identifier: Apache-2.0\nexport {};\n"),
    ).toBe(false);
  });
});

describe("applyHeader", () => {
  it("inserts header on line 1 for plain file", () => {
    const out = applyHeader("export const x = 1;\n");
    expect(out).toBe("// SPDX-License-Identifier: FSL-1.1-ALv2\nexport const x = 1;\n");
  });

  it("inserts header on line 2 when shebang on line 1", () => {
    const out = applyHeader("#!/usr/bin/env node\nconsole.log(1);\n");
    expect(out).toBe(
      "#!/usr/bin/env node\n// SPDX-License-Identifier: FSL-1.1-ALv2\nconsole.log(1);\n",
    );
  });

  it("is idempotent — second application is a no-op", () => {
    const once = applyHeader("export const x = 1;\n");
    const twice = applyHeader(once);
    expect(twice).toBe(once);
  });

  it("idempotent with shebang", () => {
    const once = applyHeader("#!/usr/bin/env node\nx;\n");
    const twice = applyHeader(once);
    expect(twice).toBe(once);
  });

  it("preserves trailing newline", () => {
    const out = applyHeader("a\nb\n");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("handles shebang without trailing newline", () => {
    const out = applyHeader("#!/usr/bin/env node");
    expect(out).toBe("#!/usr/bin/env node\n// SPDX-License-Identifier: FSL-1.1-ALv2\n");
  });

  it("handles empty input", () => {
    const out = applyHeader("");
    expect(out).toBe("// SPDX-License-Identifier: FSL-1.1-ALv2\n");
  });

  it("does not introduce stray blank line after header", () => {
    const out = applyHeader("export {};\n");
    const lines = out.split("\n");
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe("export {};");
    expect(lines[1]).not.toBe("");
  });

  it("rewrites stale Apache-2.0 header on line 1 to FSL-1.1-ALv2", () => {
    const out = applyHeader("// SPDX-License-Identifier: Apache-2.0\nexport const x = 1;\n");
    expect(out).toBe("// SPDX-License-Identifier: FSL-1.1-ALv2\nexport const x = 1;\n");
  });

  it("rewrites stale Apache-2.0 header on line 2 after shebang to FSL-1.1-ALv2", () => {
    const out = applyHeader(
      "#!/usr/bin/env node\n// SPDX-License-Identifier: Apache-2.0\nconsole.log(1);\n",
    );
    expect(out).toBe(
      "#!/usr/bin/env node\n// SPDX-License-Identifier: FSL-1.1-ALv2\nconsole.log(1);\n",
    );
  });

  it("rewriting a stale Apache-2.0 header is idempotent on second application", () => {
    const once = applyHeader("// SPDX-License-Identifier: Apache-2.0\nexport {};\n");
    const twice = applyHeader(once);
    expect(twice).toBe(once);
    expect(once.startsWith("// SPDX-License-Identifier: FSL-1.1-ALv2\n")).toBe(true);
  });

  it("rewrites a stale Apache-2.0 header with no trailing newline", () => {
    const out = applyHeader("// SPDX-License-Identifier: Apache-2.0");
    expect(out).toBe("// SPDX-License-Identifier: FSL-1.1-ALv2\n");
  });

  it("rewrites a stale Apache-2.0 header on line 2 after shebang with no trailing newline", () => {
    const out = applyHeader("#!/usr/bin/env node\n// SPDX-License-Identifier: Apache-2.0");
    expect(out).toBe("#!/usr/bin/env node\n// SPDX-License-Identifier: FSL-1.1-ALv2\n");
  });
});

describe("shouldSkip", () => {
  it("skips node_modules", () => {
    expect(shouldSkip("apps/api/node_modules/foo.ts")).toBe(true);
  });

  it("skips dist", () => {
    expect(shouldSkip("apps/api/dist/index.js")).toBe(true);
  });

  it("skips .next", () => {
    expect(shouldSkip("apps/web/.next/server/x.js")).toBe(true);
  });

  it("skips generated migrations", () => {
    expect(shouldSkip("packages/data/src/migrations/0001_init.generated.ts")).toBe(true);
  });

  it("skips JSON", () => {
    expect(shouldSkip("packages/foo/package.json")).toBe(true);
  });

  it("skips packages/i18n/locales", () => {
    expect(shouldSkip("packages/i18n/locales/en/common.json")).toBe(true);
  });

  it("skips coverage directories", () => {
    expect(shouldSkip("apps/api/coverage/lcov.info")).toBe(true);
  });

  it("does NOT skip ordinary .ts files", () => {
    expect(shouldSkip("apps/api/src/index.ts")).toBe(false);
  });

  it("does NOT skip ordinary .tsx files", () => {
    expect(shouldSkip("apps/web/src/page.tsx")).toBe(false);
  });

  it("skips locales at top-level prefix", () => {
    expect(shouldSkip("locales/en/common.ts")).toBe(true);
  });

  it("skips files with no extension", () => {
    expect(shouldSkip("apps/api/Makefile")).toBe(true);
  });

  it("skips files with unsupported extension", () => {
    expect(shouldSkip("apps/api/README.txt")).toBe(true);
  });

  it("skips skip-dirs at top-level prefix", () => {
    expect(shouldSkip("dist/app.js")).toBe(true);
  });

  it("normalizes windows-style backslashes", () => {
    expect(shouldSkip("apps\\api\\node_modules\\foo.ts")).toBe(true);
  });
});

describe("isBinary", () => {
  it("returns true for buffers containing NUL bytes", () => {
    expect(isBinary(Buffer.from([0x00, 0x01, 0x02]))).toBe(true);
  });

  it("returns false for utf8 text", () => {
    expect(isBinary(Buffer.from("export const x = 1;\n", "utf8"))).toBe(false);
  });
});

describe("auditDir", () => {
  it("reports files missing header", async () => {
    write("a.ts", "// SPDX-License-Identifier: FSL-1.1-ALv2\nexport {};\n");
    write("b.ts", "export const x = 1;\n");
    write("c.ts", "#!/usr/bin/env node\nconsole.log(1);\n");
    const missing = await auditDir(workDir);
    expect(missing.sort()).toEqual(["b.ts", "c.ts"]);
  });

  it("flags files still carrying a stale Apache-2.0 header", async () => {
    write("a.ts", "// SPDX-License-Identifier: FSL-1.1-ALv2\nexport {};\n");
    write("stale.ts", "// SPDX-License-Identifier: Apache-2.0\nexport const x = 1;\n");
    const missing = await auditDir(workDir);
    expect(missing).toEqual(["stale.ts"]);
  });

  it("ignores JSON, node_modules, dist, coverage", async () => {
    write("pkg.json", "{}");
    write("node_modules/foo.ts", "junk\n");
    write("dist/x.ts", "junk\n");
    write("coverage/x.ts", "junk\n");
    const missing = await auditDir(workDir);
    expect(missing).toEqual([]);
  });

  it("ignores binary files when auditing", async () => {
    const p = join(workDir, "blob.ts");
    writeFileSync(p, Buffer.from([0x00, 0x01, 0x02]));
    const missing = await auditDir(workDir);
    expect(missing).toEqual([]);
  });

  it("returns empty array when all files have headers", async () => {
    write("a.ts", "// SPDX-License-Identifier: FSL-1.1-ALv2\nexport {};\n");
    write("b.tsx", "// SPDX-License-Identifier: FSL-1.1-ALv2\nexport const x = 1;\n");
    const missing = await auditDir(workDir);
    expect(missing).toEqual([]);
  });
});

describe("fixDir", () => {
  it("inserts headers and is idempotent", async () => {
    const p1 = write("a.ts", "export const x = 1;\n");
    const p2 = write("b.ts", "#!/usr/bin/env node\nconsole.log(1);\n");
    const count1 = await fixDir(workDir);
    expect(count1).toBe(2);
    expect(readFileSync(p1, "utf8")).toBe(
      "// SPDX-License-Identifier: FSL-1.1-ALv2\nexport const x = 1;\n",
    );
    expect(readFileSync(p2, "utf8")).toBe(
      "#!/usr/bin/env node\n// SPDX-License-Identifier: FSL-1.1-ALv2\nconsole.log(1);\n",
    );
    const count2 = await fixDir(workDir);
    expect(count2).toBe(0);
    const snap1 = readFileSync(p1, "utf8");
    const count3 = await fixDir(workDir);
    expect(count3).toBe(0);
    expect(readFileSync(p1, "utf8")).toBe(snap1);
  });

  it("rewrites stale Apache-2.0 headers in-place to FSL-1.1-ALv2", async () => {
    const p1 = write("a.ts", "// SPDX-License-Identifier: Apache-2.0\nexport {};\n");
    const p2 = write(
      "b.ts",
      "#!/usr/bin/env node\n// SPDX-License-Identifier: Apache-2.0\nconsole.log(1);\n",
    );
    const count = await fixDir(workDir);
    expect(count).toBe(2);
    expect(readFileSync(p1, "utf8")).toBe("// SPDX-License-Identifier: FSL-1.1-ALv2\nexport {};\n");
    expect(readFileSync(p2, "utf8")).toBe(
      "#!/usr/bin/env node\n// SPDX-License-Identifier: FSL-1.1-ALv2\nconsole.log(1);\n",
    );
    const count2 = await fixDir(workDir);
    expect(count2).toBe(0);
  });

  it("skips files under excluded directories", async () => {
    write("node_modules/foo.ts", "junk\n");
    write("dist/x.ts", "junk\n");
    write("apps/api/src/index.ts", "export {};\n");
    const count = await fixDir(workDir);
    expect(count).toBe(1);
    expect(readFileSync(join(workDir, "node_modules/foo.ts"), "utf8")).toBe("junk\n");
    expect(readFileSync(join(workDir, "dist/x.ts"), "utf8")).toBe("junk\n");
  });

  it("throws on binary file", async () => {
    const p = join(workDir, "blob.ts");
    writeFileSync(p, Buffer.from([0x00, 0x01, 0x02]));
    await expect(fixDir(workDir)).rejects.toThrow(/binary/);
  });

  it("silently skips binary-flagged files that already carry the FSL header", async () => {
    const p = join(workDir, "with-nul.ts");
    const buf = Buffer.concat([
      Buffer.from("// SPDX-License-Identifier: FSL-1.1-ALv2\n", "utf8"),
      Buffer.from([
        0x63, 0x6f, 0x6e, 0x73, 0x74, 0x20, 0x78, 0x20, 0x3d, 0x20, 0x22, 0x00, 0x22, 0x3b, 0x0a,
      ]),
    ]);
    writeFileSync(p, buf);
    const count = await fixDir(workDir);
    expect(count).toBe(0);
    expect(readFileSync(p)).toEqual(buf);
  });

  it("rewrites a stale Apache-2.0 header on a binary-flagged source file via byte-splice", async () => {
    const p = join(workDir, "with-nul-apache.ts");
    const buf = Buffer.concat([
      Buffer.from("// SPDX-License-Identifier: Apache-2.0\n", "utf8"),
      Buffer.from([
        0x63, 0x6f, 0x6e, 0x73, 0x74, 0x20, 0x78, 0x20, 0x3d, 0x20, 0x22, 0x00, 0x22, 0x3b, 0x0a,
      ]),
    ]);
    writeFileSync(p, buf);
    const count = await fixDir(workDir);
    expect(count).toBe(1);
    const after = readFileSync(p);
    expect(after.subarray(0, 41).toString("utf8")).toBe(
      "// SPDX-License-Identifier: FSL-1.1-ALv2\n",
    );
    expect(after.includes(0x00)).toBe(true);
  });
});

describe("main CLI", () => {
  it("audit returns 0 when clean", async () => {
    write("a.ts", "// SPDX-License-Identifier: FSL-1.1-ALv2\nexport {};\n");
    const code = await main(["node", "spdx-header.ts", "audit", workDir]);
    expect(code).toBe(0);
  });

  it("audit returns 1 when files are missing the header", async () => {
    write("a.ts", "export {};\n");
    const code = await main(["node", "spdx-header.ts", "audit", workDir]);
    expect(code).toBe(1);
  });

  it("fix returns 0 and modifies files", async () => {
    write("a.ts", "export {};\n");
    const code = await main(["node", "spdx-header.ts", "fix", workDir]);
    expect(code).toBe(0);
  });

  it("returns 2 for unknown subcommand", async () => {
    const code = await main(["node", "spdx-header.ts", "nope", workDir]);
    expect(code).toBe(2);
  });

  it("returns 2 when no subcommand provided", async () => {
    const code = await main(["node", "spdx-header.ts"]);
    expect(code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// HI-01 regression — hash-comment-style SPDX headers (.yml/.yaml/.sh).
//
// After Phase 15-03 the TS/JS codemod is the contractual sweep tool, but
// three files (compose/traefik/dynamic.dev.yml + 2 GitHub workflows) carry
// an inline `# SPDX-License-Identifier: Apache-2.0` line that fell outside
// the .ts/.js include patterns. These tests assert the codemod gains a
// parallel hash-style audit + fix pair so the next sweep is byte-clean.
// ---------------------------------------------------------------------------

describe("HASH_HEADER constant (HI-01)", () => {
  it("is the FSL-1.1-ALv2 SPDX short-form line with # comment prefix", () => {
    expect(HASH_HEADER).toBe("# SPDX-License-Identifier: FSL-1.1-ALv2");
  });
});

describe("hasHashHeader (HI-01)", () => {
  it("returns true when first non-shebang line is the # SPDX header", () => {
    expect(hasHashHeader("# SPDX-License-Identifier: FSL-1.1-ALv2\nfoo:\n")).toBe(true);
  });

  it("returns true when shebang precedes # header on line 2", () => {
    expect(
      hasHashHeader("#!/usr/bin/env bash\n# SPDX-License-Identifier: FSL-1.1-ALv2\necho hi\n"),
    ).toBe(true);
  });

  it("returns false when no header present", () => {
    expect(hasHashHeader("foo:\n")).toBe(false);
  });

  it("returns false when a stale Apache-2.0 # header is on line 1", () => {
    expect(hasHashHeader("# SPDX-License-Identifier: Apache-2.0\nfoo:\n")).toBe(false);
  });

  it("returns false when a stale Apache-2.0 # header is on line 2 after shebang", () => {
    expect(
      hasHashHeader("#!/usr/bin/env bash\n# SPDX-License-Identifier: Apache-2.0\necho hi\n"),
    ).toBe(false);
  });
});

describe("applyHeaderHash (HI-01)", () => {
  it("inserts # header on line 1 for plain yaml file", () => {
    const out = applyHeaderHash("foo: bar\n");
    expect(out).toBe("# SPDX-License-Identifier: FSL-1.1-ALv2\nfoo: bar\n");
  });

  it("inserts # header on line 2 when shebang on line 1 (sh file)", () => {
    const out = applyHeaderHash("#!/usr/bin/env bash\necho hi\n");
    expect(out).toBe("#!/usr/bin/env bash\n# SPDX-License-Identifier: FSL-1.1-ALv2\necho hi\n");
  });

  it("appends header on a fresh line when the file is a shebang with no trailing newline", () => {
    // Edge case: a script file that is literally just the shebang line
    // with no LF — readFileSync returns "#!/usr/bin/env bash" with no \n.
    // The codemod must still produce a valid two-line file rather than
    // gluing the header onto the shebang line.
    const out = applyHeaderHash("#!/usr/bin/env bash");
    expect(out).toBe("#!/usr/bin/env bash\n# SPDX-License-Identifier: FSL-1.1-ALv2\n");
  });

  it("is idempotent — second application is a no-op", () => {
    const once = applyHeaderHash("foo:\n");
    const twice = applyHeaderHash(once);
    expect(twice).toBe(once);
  });

  it("rewrites stale Apache-2.0 # header on line 1 to FSL-1.1-ALv2", () => {
    const out = applyHeaderHash("# SPDX-License-Identifier: Apache-2.0\nfoo:\n");
    expect(out).toBe("# SPDX-License-Identifier: FSL-1.1-ALv2\nfoo:\n");
  });

  it("rewrites stale Apache-2.0 # header on line 2 after shebang to FSL-1.1-ALv2", () => {
    const out = applyHeaderHash(
      "#!/usr/bin/env bash\n# SPDX-License-Identifier: Apache-2.0\necho hi\n",
    );
    expect(out).toBe("#!/usr/bin/env bash\n# SPDX-License-Identifier: FSL-1.1-ALv2\necho hi\n");
  });

  it("rewriting a stale Apache-2.0 # header is idempotent on second application", () => {
    const once = applyHeaderHash("# SPDX-License-Identifier: Apache-2.0\nfoo:\n");
    const twice = applyHeaderHash(once);
    expect(twice).toBe(once);
    expect(once.startsWith("# SPDX-License-Identifier: FSL-1.1-ALv2\n")).toBe(true);
  });
});

describe("shouldSkipHash (HI-01)", () => {
  it("does NOT skip ordinary .yml files", () => {
    expect(shouldSkipHash("compose/traefik/dynamic.dev.yml")).toBe(false);
  });

  it("does NOT skip ordinary .yaml files", () => {
    expect(shouldSkipHash("infra/values.yaml")).toBe(false);
  });

  it("does NOT skip ordinary .sh files", () => {
    expect(shouldSkipHash("tools/foo.sh")).toBe(false);
  });

  it("does NOT skip github workflow yml under .github/workflows", () => {
    expect(shouldSkipHash(".github/workflows/conformance-axe.yml")).toBe(false);
    expect(shouldSkipHash(".github/workflows/e2e-cjm.yml")).toBe(false);
  });

  it("skips .ts files (handled by the TS-style codemod)", () => {
    expect(shouldSkipHash("apps/api/src/index.ts")).toBe(true);
  });

  it("skips node_modules", () => {
    expect(shouldSkipHash("node_modules/foo/foo.yml")).toBe(true);
  });

  it("skips dist", () => {
    expect(shouldSkipHash("dist/x.yml")).toBe(true);
  });
});

describe("auditDirHash + fixDirHash (HI-01)", () => {
  it("flags .yml / .yaml / .sh files still carrying a stale Apache-2.0 # header", async () => {
    write("a.yml", "# SPDX-License-Identifier: FSL-1.1-ALv2\nfoo: bar\n");
    write("b.yaml", "# SPDX-License-Identifier: Apache-2.0\nfoo: bar\n");
    write("c.sh", "#!/usr/bin/env bash\n# SPDX-License-Identifier: Apache-2.0\necho hi\n");
    write("d.yml", "foo: bar\n");
    const missing = await auditDirHash(workDir);
    expect(missing.sort()).toEqual(["b.yaml", "c.sh", "d.yml"]);
  });

  it("rewrites stale Apache-2.0 # headers in-place to FSL-1.1-ALv2", async () => {
    const p1 = write("a.yml", "# SPDX-License-Identifier: Apache-2.0\nfoo: bar\n");
    const p2 = write(
      "b.sh",
      "#!/usr/bin/env bash\n# SPDX-License-Identifier: Apache-2.0\necho hi\n",
    );
    const count = await fixDirHash(workDir);
    expect(count).toBe(2);
    expect(_readFileSync(p1, "utf8")).toBe("# SPDX-License-Identifier: FSL-1.1-ALv2\nfoo: bar\n");
    expect(_readFileSync(p2, "utf8")).toBe(
      "#!/usr/bin/env bash\n# SPDX-License-Identifier: FSL-1.1-ALv2\necho hi\n",
    );
    const count2 = await fixDirHash(workDir);
    expect(count2).toBe(0);
  });

  it("inserts # header into files missing it entirely", async () => {
    const p = write("fresh.yml", "foo: bar\n");
    const count = await fixDirHash(workDir);
    expect(count).toBe(1);
    expect(_readFileSync(p, "utf8")).toBe("# SPDX-License-Identifier: FSL-1.1-ALv2\nfoo: bar\n");
  });

  it("CLI: audit-hash returns 0 when clean", async () => {
    write("a.yml", "# SPDX-License-Identifier: FSL-1.1-ALv2\nfoo:\n");
    const code = await main(["node", "spdx-header.ts", "audit-hash", workDir]);
    expect(code).toBe(0);
  });

  it("CLI: audit-hash returns 1 when files are stale or missing", async () => {
    write("stale.yml", "# SPDX-License-Identifier: Apache-2.0\nfoo:\n");
    const code = await main(["node", "spdx-header.ts", "audit-hash", workDir]);
    expect(code).toBe(1);
  });

  it("CLI: fix-hash returns 0 and modifies files", async () => {
    write("stale.yml", "# SPDX-License-Identifier: Apache-2.0\nfoo:\n");
    const code = await main(["node", "spdx-header.ts", "fix-hash", workDir]);
    expect(code).toBe(0);
  });
});

describe("HI-01 regression — three specific paths must carry FSL hash header", () => {
  // These three paths were flagged by gsd-code-reviewer (HI-01) as still
  // carrying inline `# SPDX-License-Identifier: Apache-2.0`. After the fix
  // they MUST be `# SPDX-License-Identifier: FSL-1.1-ALv2`.
  const REPO_ROOT = _resolve(__dirname, "..", "..");
  const PATHS = [
    "compose/traefik/dynamic.dev.yml",
    ".github/workflows/conformance-axe.yml",
    ".github/workflows/e2e-cjm.yml",
  ] as const;

  for (const rel of PATHS) {
    it(`${rel} carries # SPDX-License-Identifier: FSL-1.1-ALv2 as the first SPDX line`, () => {
      const full = _resolve(REPO_ROOT, rel);
      const text = _readFileSync(full, "utf8");
      // Must contain the FSL hash header.
      expect(text.includes("# SPDX-License-Identifier: FSL-1.1-ALv2")).toBe(true);
      // Must NOT contain the stale Apache-2.0 hash header.
      expect(text.includes("# SPDX-License-Identifier: Apache-2.0")).toBe(false);
    });
  }
});
// REUSE-IgnoreEnd
