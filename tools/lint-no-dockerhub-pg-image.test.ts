// SPDX-License-Identifier: FSL-1.1-ALv2
// Unit tests for tools/lint-no-dockerhub-pg-image.ts. Pattern mirrors
// tools/lint-dockerfile-tls.test.ts (in-process API exercise + CLI
// smoke via execFileSync).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALLOWLIST_FILE,
  FORBIDDEN,
  findViolations,
  main,
  readAllowlist,
} from "./lint-no-dockerhub-pg-image";

const SCRIPT = join(process.cwd(), "tools", "lint-no-dockerhub-pg-image.ts");

function mkRoot(): string {
  return mkdtempSync(join(tmpdir(), "lint-no-dockerhub-pg-"));
}

function writeFile(root: string, rel: string, body: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}

describe("FORBIDDEN regex", () => {
  it("matches Docker Hub style `openwhispr/postgres:<tag>`", () => {
    expect(FORBIDDEN.test("image: openwhispr/postgres:17.5-pgpartman")).toBe(true);
    expect(FORBIDDEN.test('"openwhispr/postgres:ci"')).toBe(true);
  });

  it("does NOT match GHCR path", () => {
    expect(FORBIDDEN.test("ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1")).toBe(
      false,
    );
  });

  it("does NOT match unrelated repo/postgres slugs", () => {
    expect(FORBIDDEN.test("postgres:17-alpine")).toBe(false);
    expect(FORBIDDEN.test("openwhispr-postgres:17")).toBe(false);
  });
});

describe("findViolations", () => {
  it("returns empty on a clean tree", async () => {
    const root = mkRoot();
    writeFile(root, "docker-compose.yml", "image: postgres:17-alpine\n");
    const result = await findViolations(root);
    expect(result).toEqual([]);
  });

  it("flags Docker Hub references and skips GHCR references", async () => {
    const root = mkRoot();
    writeFile(root, "docker-compose.yml", "image: openwhispr/postgres:17.5-pgpartman\n");
    writeFile(
      root,
      "tests/a.test.ts",
      'const X = "ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1";\n',
    );
    writeFile(root, "tests/b.test.ts", '"openwhispr/postgres:ci"\n');
    const result = await findViolations(root);
    expect(result.map((v) => v.file).sort()).toEqual(["docker-compose.yml", "tests/b.test.ts"]);
  });

  it("honors the allowlist", async () => {
    const root = mkRoot();
    writeFile(root, "docker-compose.yml", "openwhispr/postgres:1\n");
    writeFile(root, "tests/x.test.ts", "openwhispr/postgres:2\n");
    writeFile(root, ALLOWLIST_FILE, "tests/x.test.ts\n");
    const result = await findViolations(root);
    expect(result.map((v) => v.file)).toEqual(["docker-compose.yml"]);
  });

  it("treats blank lines and `#` lines in allowlist as comments", async () => {
    const root = mkRoot();
    writeFile(root, "tests/x.test.ts", "openwhispr/postgres:1\n");
    writeFile(root, ALLOWLIST_FILE, "# comment\n\n   \ntests/x.test.ts\n# trailing\n");
    const result = await findViolations(root);
    expect(result).toEqual([]);
  });
});

describe("readAllowlist", () => {
  it("returns empty set when file does not exist", () => {
    const root = mkRoot();
    expect(readAllowlist(root).size).toBe(0);
  });
});

describe("main", () => {
  it("exits 0 on clean tree", async () => {
    const root = mkRoot();
    writeFile(root, "a.yml", "image: postgres:17-alpine\n");
    expect(await main([root])).toBe(0);
  });

  it("exits 1 when violations present", async () => {
    const root = mkRoot();
    writeFile(root, "a.yml", "openwhispr/postgres:bad\n");
    expect(await main([root])).toBe(1);
  });
});

describe("CLI", () => {
  it("invokes via tsx and reports clean", () => {
    const root = mkRoot();
    writeFile(root, "a.yml", "image: postgres:17-alpine\n");
    const out = execFileSync("pnpm", ["exec", "tsx", SCRIPT, root], {
      encoding: "utf8",
    });
    expect(out).toContain("clean");
  });

  it("invokes via tsx and reports violations + exit 1", () => {
    const root = mkRoot();
    writeFile(root, "a.yml", "openwhispr/postgres:bad\n");
    try {
      execFileSync("pnpm", ["exec", "tsx", SCRIPT, root], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      throw new Error("expected non-zero exit");
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer };
      expect(e.status).toBe(1);
      expect(e.stderr?.toString()).toContain("unpublished-image reference");
    }
  });
});
