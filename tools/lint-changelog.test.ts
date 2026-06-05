// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-changelog.test.ts — RED→GREEN coverage for the CHANGELOG well-formedness
 * + appVersion-parity lint CLI (Quick 260605-ikx — version→changelog bind).
 *
 * main([changelogPath, chartYamlPath]) returns 0 when the CHANGELOG is
 * Keep-a-Changelog-shaped (an `## [Unreleased]` section, ≥1 released
 * `## [SemVer] - YYYY-MM-DD` section, a `[ver]:` footer link for every released
 * version) AND its TOP released section version equals Chart.yaml appVersion;
 * returns 1 otherwise with a per-failure summary on stderr.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main, parseAppVersion, parseReleasedVersions } from "./lint-changelog.js";

let root: string;

const GOOD_CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "_Nothing yet._",
  "",
  "## [1.2.3] - 2026-06-05",
  "",
  "### Added",
  "",
  "- A real entry.",
  "",
  "## [1.0.14] - 2026-05-28",
  "",
  "### Added",
  "",
  "- An older entry.",
  "",
  "[Unreleased]: https://example.invalid/compare/v1.2.3...HEAD",
  "[1.2.3]: https://example.invalid/compare/v1.0.14...v1.2.3",
  "[1.0.14]: https://example.invalid/releases/tag/v1.0.14",
  "",
].join("\n");

function write(rel: string, content: string): string {
  const full = join(root, rel);
  writeFileSync(full, content, "utf8");
  return full;
}

function chart(version: string): string {
  return write(
    "Chart.yaml",
    `apiVersion: v2\nname: x\nversion: "1.0.0"\nappVersion: "${version}"\n`,
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lint-changelog-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("parseAppVersion", () => {
  it("reads a quoted appVersion line", () => {
    expect(parseAppVersion('appVersion: "1.2.3"\n')).toBe("1.2.3");
  });
  it("reads an unquoted appVersion line", () => {
    expect(parseAppVersion("appVersion: 1.2.3\n")).toBe("1.2.3");
  });
  it("returns null when no appVersion line is present", () => {
    expect(parseAppVersion("name: x\n")).toBeNull();
  });
});

describe("parseReleasedVersions", () => {
  it("returns released versions in file order, ignoring Unreleased", () => {
    expect(parseReleasedVersions(GOOD_CHANGELOG)).toEqual(["1.2.3", "1.0.14"]);
  });
});

describe("main", () => {
  it("returns 0 for a well-formed changelog whose top section matches appVersion", async () => {
    const cl = write("CHANGELOG.md", GOOD_CHANGELOG);
    const code = await main([cl, chart("1.2.3")]);
    expect(code).toBe(0);
  });

  it("returns 1 when there is no Unreleased section", async () => {
    const cl = write("CHANGELOG.md", GOOD_CHANGELOG.replace("## [Unreleased]", "## [recent]"));
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await main([cl, chart("1.2.3")])).toBe(1);
    expect(err).toHaveBeenCalled();
  });

  it("returns 1 when there is no released section", async () => {
    const cl = write(
      "CHANGELOG.md",
      ["# Changelog", "", "## [Unreleased]", "", "_Nothing yet._", ""].join("\n"),
    );
    expect(await main([cl, chart("1.2.3")])).toBe(1);
  });

  it("returns 1 on a released header with a malformed date", async () => {
    const cl = write(
      "CHANGELOG.md",
      GOOD_CHANGELOG.replace("## [1.2.3] - 2026-06-05", "## [1.2.3] - June 5"),
    );
    expect(await main([cl, chart("1.2.3")])).toBe(1);
  });

  it("returns 1 when a released version has no footer link", async () => {
    const cl = write(
      "CHANGELOG.md",
      GOOD_CHANGELOG.replace("[1.0.14]: https://example.invalid/releases/tag/v1.0.14\n", ""),
    );
    expect(await main([cl, chart("1.2.3")])).toBe(1);
  });

  it("returns 1 and names both versions when the top section != appVersion", async () => {
    const cl = write("CHANGELOG.md", GOOD_CHANGELOG);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await main([cl, chart("1.2.4")])).toBe(1);
    const allStderr = err.mock.calls.map((c) => String(c[0])).join("");
    expect(allStderr).toContain("1.2.3");
    expect(allStderr).toContain("1.2.4");
  });

  it("returns 1 when Chart.yaml has no appVersion line", async () => {
    const cl = write("CHANGELOG.md", GOOD_CHANGELOG);
    const badChart = write("Chart.yaml", "apiVersion: v2\nname: x\n");
    expect(await main([cl, badChart])).toBe(1);
  });

  it("returns 2 when fewer than 2 argv are supplied", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await main([])).toBe(2);
    expect(err).toHaveBeenCalled();
  });
});
