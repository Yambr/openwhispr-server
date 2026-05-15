// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-dockerfile-tls.test.ts — RED→GREEN coverage for the dev-CA / mkcert
 * leakage regression-guard CLI (Phase 17 / Plan 02 — TLS-05).
 *
 * The guard scans `**\/Dockerfile` files (NOT `Dockerfile*` — explicit
 * narrow glob avoids accidental matches on `.dockerignore` / `Dockerfile.bak`)
 * and flags any line that references known dev-CA / mkcert artefacts. The
 * allowlist suppresses violations whose POSIX path appears in
 * `tools/lint-dockerfile-tls.allowlist.txt`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALLOWLIST_FILE, findViolations, main, readAllowlist } from "../lint-dockerfile-tls.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lint-dockerfile-tls-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

const GOOD_DOCKERFILE = [
  "# SPDX-License-Identifier: FSL-1.1-ALv2",
  "FROM traefik:v3.6",
  "COPY --chmod=0755 fd-probe.sh /usr/local/bin/fd-probe.sh",
  "HEALTHCHECK --interval=10s CMD wget -q -O- http://localhost:8080/ping || exit 1",
  "",
].join("\n");

const BAD_DOCKERFILE = [
  "FROM debian:stable-slim",
  "COPY rootCA.pem /usr/local/share/ca-certificates/",
  "COPY root-ca.crt /etc/ssl/certs/",
  "COPY root-ca.key /etc/ssl/private/",
  "RUN mkcert -install",
  "COPY compose/traefik/certs/ /certs/",
  "COPY api.localhost.pem /certs/",
  "COPY api.localhost.key /certs/",
  "COPY local.crt /certs/",
  "COPY local.key /certs/",
  "",
].join("\n");

describe("findViolations", () => {
  it("F1: good fixture (clean Dockerfile) → zero violations", async () => {
    touch("compose/x/Dockerfile", GOOD_DOCKERFILE);
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("F2: bad fixture → at least one violation per forbidden token", async () => {
    touch("compose/x/Dockerfile", BAD_DOCKERFILE);
    const violations = await findViolations(root);
    // Expect at least one match per forbidden category: rootCA.pem, root-ca.crt,
    // root-ca.key, mkcert, compose/traefik/certs/, *.localhost.pem,
    // *.localhost.key, local.crt, local.key  →  9 categories.
    const labels = new Set(violations.map((v) => v.label));
    expect(labels.has("rootCA*.pem")).toBe(true);
    expect(labels.has("root-ca.crt")).toBe(true);
    expect(labels.has("root-ca.key")).toBe(true);
    expect(labels.has("mkcert")).toBe(true);
    expect(labels.has("compose/traefik/certs/")).toBe(true);
    expect(labels.has("*.localhost.pem")).toBe(true);
    expect(labels.has("*.localhost.key")).toBe(true);
    expect(labels.has("local.crt")).toBe(true);
    expect(labels.has("local.key")).toBe(true);
    expect(violations.length).toBeGreaterThanOrEqual(9);
  });

  it("F3: files inside node_modules are NOT scanned", async () => {
    touch("node_modules/some/pkg/Dockerfile", BAD_DOCKERFILE);
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("F4: `.dockerignore` is NOT scanned even if it contains forbidden tokens", async () => {
    // Glob is `**/Dockerfile` exact — `.dockerignore` (which is the file we
    // are protecting via THIS lint) must not be re-flagged for containing
    // the same tokens as exclusion entries.
    touch(".dockerignore", "**/rootCA*.pem\n**/local.crt\nmkcert\n");
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("F5: allowlist entry suppresses violations for that POSIX path", async () => {
    touch("compose/x/Dockerfile", "FROM scratch\nCOPY rootCA.pem /\n");
    touch(ALLOWLIST_FILE, "compose/x/Dockerfile\n");
    const violations = await findViolations(root);
    expect(violations).toEqual([]);
  });

  it("F8: violations sorted by file then by lineNumber", async () => {
    touch("compose/b/Dockerfile", "FROM scratch\nCOPY rootCA.pem /\nCOPY local.crt /\n");
    touch("compose/a/Dockerfile", "FROM scratch\nCOPY mkcert /\n");
    const violations = await findViolations(root);
    expect(violations.map((v) => `${v.file}:${v.lineNumber}`)).toEqual([
      "compose/a/Dockerfile:2",
      "compose/b/Dockerfile:2",
      "compose/b/Dockerfile:3",
    ]);
  });
});

describe("readAllowlist", () => {
  it("F6a: returns an empty Set when the allowlist file does not exist", () => {
    expect(readAllowlist(root).size).toBe(0);
  });

  it("F6b: strips lines beginning with `#` and blank lines; returns trimmed POSIX paths", () => {
    touch(
      ALLOWLIST_FILE,
      "# header comment\n\ncompose/x/Dockerfile\n  compose/y/Dockerfile  \n# tail\n",
    );
    const set = readAllowlist(root);
    expect([...set].sort()).toEqual(["compose/x/Dockerfile", "compose/y/Dockerfile"]);
  });

  it("F6c: returns a fresh empty Set per call when allowlist file is absent", () => {
    const a = readAllowlist(root);
    const b = readAllowlist(root);
    expect(a.size).toBe(0);
    expect(b.size).toBe(0);
    expect(a).not.toBe(b);
  });
});

describe("main — CLI dispatch (F7 + exit codes)", () => {
  it("F7a: main([root]) returns 1 on dirty tree", async () => {
    touch("compose/x/Dockerfile", "FROM scratch\nCOPY rootCA.pem /\n");
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main([root]);
    errSpy.mockRestore();
    expect(code).toBe(1);
  });

  it("F7b: main([root]) returns 0 on clean tree", async () => {
    touch("compose/x/Dockerfile", "FROM scratch\nCOPY fd-probe.sh /\n");
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main([root]);
    outSpy.mockRestore();
    expect(code).toBe(0);
  });

  it("F7c: main([]) defaults rootDir to process.cwd()", async () => {
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main([]);
    outSpy.mockRestore();
    errSpy.mockRestore();
    // Either clean (0) or dirty (1) is acceptable; what matters is no throw.
    expect([0, 1]).toContain(code);
  });

  it("F7d: main returns 2 and writes to stderr when findViolations throws", async () => {
    // Force readAllowlist (called from findViolations) to throw by placing a
    // DIRECTORY at the allowlist path — existsSync returns true so the
    // empty-set shortcut is skipped, but readFileSync then throws EISDIR.
    mkdirSync(join(root, ALLOWLIST_FILE), { recursive: true });
    const errChunks: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      errChunks.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });
    const code = await main([root]);
    errSpy.mockRestore();
    expect(code).toBe(2);
    expect(errChunks.join("")).toMatch(/lint-dockerfile-tls:/);
  });
});
