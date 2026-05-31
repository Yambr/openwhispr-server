// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-trivyignore.test.ts — TDD contract for the scoped trivy-fs suppression
 * file and its linter. fix 260530-rqk.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractIds, lintTrivyignore } from "./lint-trivyignore.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const TRIVYIGNORE_PATH = join(REPO_ROOT, ".trivyignore");

describe("lintTrivyignore (pure)", () => {
  it("accepts a justified, scoped CVE + GHSA pair", () => {
    const body = [
      "# tmp path traversal, dev-only, zero prod exposure",
      "CVE-2026-44705",
      "GHSA-ph9p-34f9-6g65",
    ].join("\n");
    expect(lintTrivyignore(body)).toEqual([]);
  });

  it("accepts an `exp:` expiry token", () => {
    const body = ["# justified", "CVE-2026-44705 exp:2026-08-31"].join("\n");
    expect(lintTrivyignore(body)).toEqual([]);
  });

  it("rejects a severity-class suppression", () => {
    const body = ["# blanket", "HIGH"].join("\n");
    const f = lintTrivyignore(body);
    expect(f.some((x) => /severity-class/.test(x.reason))).toBe(true);
  });

  it("rejects a wildcard suppression", () => {
    const body = ["# blanket", "*"].join("\n");
    const f = lintTrivyignore(body);
    expect(f.some((x) => /wildcard/.test(x.reason))).toBe(true);
  });

  it("rejects a bare ID with no justification comment above it", () => {
    const body = ["CVE-2026-44705"].join("\n");
    const f = lintTrivyignore(body);
    expect(f.some((x) => /no justification/.test(x.reason))).toBe(true);
  });

  it("rejects a blank line breaking the justification block", () => {
    const body = ["# justified", "", "CVE-2026-44705"].join("\n");
    const f = lintTrivyignore(body);
    expect(f.some((x) => /no justification/.test(x.reason))).toBe(true);
  });

  it("rejects an unrecognized token", () => {
    const body = ["# justified", "not-an-advisory-id"].join("\n");
    const f = lintTrivyignore(body);
    expect(f.some((x) => /not a recognized advisory ID/.test(x.reason))).toBe(true);
  });

  it("rejects a malformed exp token", () => {
    const body = ["# justified", "CVE-2026-44705 exp:soon"].join("\n");
    const f = lintTrivyignore(body);
    expect(f.some((x) => /exp:YYYY-MM-DD/.test(x.reason))).toBe(true);
  });

  it("extractIds returns only valid CVE/GHSA tokens", () => {
    const body = ["# c", "CVE-2026-44705", "GHSA-ph9p-34f9-6g65", "# trailing comment"].join("\n");
    expect(extractIds(body)).toEqual(["CVE-2026-44705", "GHSA-ph9p-34f9-6g65"]);
  });
});

describe("live .trivyignore", () => {
  const body = readFileSync(TRIVYIGNORE_PATH, "utf8");

  it("is structurally valid and fully scoped", () => {
    expect(lintTrivyignore(body)).toEqual([]);
  });

  it("suppresses the Dependabot #33 tmp advisory (both CVE and GHSA forms)", () => {
    const ids = extractIds(body);
    expect(ids).toContain("CVE-2026-44705");
    expect(ids).toContain("GHSA-ph9p-34f9-6g65");
  });

  it("contains no severity-class or wildcard suppression", () => {
    expect(body).not.toMatch(/^\s*(\*|CRITICAL|HIGH|MEDIUM|LOW|UNKNOWN)\s*$/im);
  });
});
