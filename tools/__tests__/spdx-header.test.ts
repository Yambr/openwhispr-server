// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyHeader,
  auditDir,
  fixDir,
  HEADER,
  hasHeader,
  isBinary,
  main,
  shouldSkip,
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
