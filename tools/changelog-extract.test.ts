// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * changelog-extract.test.ts — RED→GREEN coverage for the CHANGELOG section
 * extractor CLI (Quick 260605-ikx — version→changelog release bind).
 *
 * The extractor prints to stdout the body lines BETWEEN a `## [VERSION]`
 * header (exclusive) and the next `## [` header (exclusive), trimmed of
 * leading/trailing blank lines, and returns 0. A missing section returns 1
 * with the exact gate message on stderr; fewer than 2 argv returns 2.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractSection, main } from "./changelog-extract.js";

let root: string;
let changelogPath: string;

const FIXTURE = [
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
  "- Web download links on login and post-login screens.",
  "- `/api/embeddings` and `/api/rerank` passthrough.",
  "",
  "## [1.2.2] - 2026-06-04",
  "",
  "### Added",
  "",
  "- End-user email header for the diarization branch.",
  "",
  "## [1.0.14] - 2026-05-28",
  "",
  "### Added",
  "",
  "- Pre-push gate tip-only validation.",
  "",
  "[Unreleased]: https://example.invalid/compare/v1.2.3...HEAD",
  "[1.2.3]: https://example.invalid/compare/v1.2.2...v1.2.3",
  "[1.2.2]: https://example.invalid/compare/v1.0.14...v1.2.2",
  "[1.0.14]: https://example.invalid/releases/tag/v1.0.14",
  "",
].join("\n");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "changelog-extract-"));
  changelogPath = join(root, "CHANGELOG.md");
  writeFileSync(changelogPath, FIXTURE, "utf8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("extractSection", () => {
  it("returns only the body of the top section, not the header or next section", () => {
    const body = extractSection(FIXTURE, "1.2.3");
    expect(body).toBe(
      [
        "### Added",
        "",
        "- Web download links on login and post-login screens.",
        "- `/api/embeddings` and `/api/rerank` passthrough.",
      ].join("\n"),
    );
    expect(body).not.toContain("## [1.2.3]");
    expect(body).not.toContain("diarization");
  });

  it("stops a middle version at the next `## [` header", () => {
    const body = extractSection(FIXTURE, "1.2.2");
    expect(body).toContain("End-user email header for the diarization branch.");
    expect(body).not.toContain("Pre-push gate");
  });

  it("stops the oldest version at the footer link references", () => {
    const body = extractSection(FIXTURE, "1.0.14");
    expect(body).toContain("Pre-push gate tip-only validation.");
    expect(body).not.toContain("[1.0.14]:");
    expect(body).not.toContain("https://example.invalid");
  });

  it("returns null when the version section is absent", () => {
    expect(extractSection(FIXTURE, "9.9.9")).toBeNull();
  });

  it("returns an empty string for a section with only blank body lines", () => {
    const text = ["## [2.0.0] - 2026-07-01", "", "", "## [1.9.9] - 2026-06-30"].join("\n");
    expect(extractSection(text, "2.0.0")).toBe("");
  });

  it("runs to EOF when the section is last and has no footer", () => {
    const text = ["## [3.0.0] - 2026-08-01", "", "- final entry", ""].join("\n");
    expect(extractSection(text, "3.0.0")).toBe("- final entry");
  });
});

describe("main", () => {
  it("prints the section body to stdout and returns 0", async () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main([changelogPath, "1.2.3"]);
    expect(code).toBe(0);
    expect(out).toHaveBeenCalledTimes(1);
    const printed = out.mock.calls[0]?.[0] as string;
    expect(printed).toContain("Web download links");
    expect(printed).not.toContain("## [1.2.3]");
  });

  it("returns 1 and writes the exact gate message on a missing section", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main([changelogPath, "9.9.9"]);
    expect(code).toBe(1);
    expect(err).toHaveBeenCalledWith(
      "CHANGELOG.md has no section for 9.9.9 — add it before tagging\n",
    );
  });

  it("returns 2 when fewer than 2 argv are supplied", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await main([])).toBe(2);
    expect(await main([changelogPath])).toBe(2);
    expect(err).toHaveBeenCalled();
  });
});
