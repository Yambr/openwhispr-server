// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 14 / Plan 02 / Task 3 — docs/operations.md BYOK matrix section.
 *
 * Asserts the byte-level shape of the new `## BYOK Environment Matrix`
 * section per `14-02-PLAN.md` Task 3 behaviors, CONTEXT.md decision 2
 * (loud-fail codes), and decision 6 (Helm toggles).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");
const DOC_PATH = join(REPO_ROOT, "docs", "operations.md");
const docText = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, "utf8") : "";

/** Locate the slice of docText between `## BYOK Environment Matrix` and
 *  the next `## ` heading (or EOF). Lets us scope assertions to the new
 *  section without false-matching against unrelated parts of the file. */
function byokMatrixSlice(): string {
  const heading = "## BYOK Environment Matrix";
  const start = docText.indexOf(heading);
  if (start < 0) return "";
  const after = docText.slice(start + heading.length);
  const nextH2 = after.search(/\n## /);
  return nextH2 === -1 ? after : after.slice(0, nextH2);
}

describe("Phase 14 / Plan 02 — docs/operations.md BYOK matrix", () => {
  it("Test 1: contains the literal `## BYOK Environment Matrix` H2 heading", () => {
    expect(docText).toContain("## BYOK Environment Matrix");
  });

  it("Test 2: matrix has the expected header-row columns", () => {
    const slice = byokMatrixSlice();
    expect(slice).toContain("Overlay");
    expect(slice).toContain("BYOK env(s) when OFF");
    expect(slice).toContain("Loud-fail code");
    expect(slice).toContain("Compose overlay file");
    expect(slice).toContain("Helm toggle");
    // And it must be a single header row — at least one `|---|` separator
    // line directly under the header row (markdown table marker).
    expect(slice).toMatch(/\|\s*-+\s*\|/);
  });

  it("Test 3: every overlay row carries its CONTEXT decision-2 loud-fail code", () => {
    const slice = byokMatrixSlice();
    const codes = [
      "BYOK_STORAGE_REQUIRED",
      "BYOK_OBSERVABILITY_REQUIRED",
      "BYOK_INGRESS_REQUIRED",
      "BYOK_DATABASE_REQUIRED",
      "BYOK_SMTP_REQUIRED",
    ];
    for (const code of codes) {
      expect(slice, `loud-fail code ${code}`).toContain(code);
    }
  });

  it("Test 4: every overlay row references compose/docker-compose.<overlay>.yml", () => {
    const slice = byokMatrixSlice();
    const overlayFiles = [
      "compose/docker-compose.storage.yml",
      "compose/docker-compose.observability.yml",
      "compose/docker-compose.ingress.yml",
      "compose/docker-compose.pgbouncer.yml",
      "compose/docker-compose.dev-tools.yml",
    ];
    for (const path of overlayFiles) {
      expect(slice, `overlay path ${path}`).toContain(path);
    }
  });

  it("Test 5: every overlay row carries its CONTEXT decision-6 Helm toggle", () => {
    const slice = byokMatrixSlice();
    const toggles = [
      "storage.enabled",
      "observability.enabled",
      "tls.enabled",
      "pooler.enabled",
      "mailpit.enabled",
    ];
    for (const toggle of toggles) {
      expect(slice, `Helm toggle ${toggle}`).toContain(toggle);
    }
  });

  it("Test 6: a paragraph BEFORE the matrix links to apps/api/src/lib/byok-guard.ts", () => {
    const heading = "## BYOK Environment Matrix";
    const start = docText.indexOf(heading);
    expect(start, "BYOK matrix heading located").toBeGreaterThan(-1);
    // The slice from the heading to the first `| Overlay |` row should
    // contain the byok-guard.ts pointer. Using the heading-to-table
    // window catches both "paragraph above table" and "paragraph right
    // under heading" placements (the plan says "BEFORE the matrix").
    const after = docText.slice(start);
    const tableIdx = after.indexOf("| Overlay |");
    expect(tableIdx, "matrix table located").toBeGreaterThan(-1);
    const intro = after.slice(0, tableIdx);
    expect(intro).toContain("apps/api/src/lib/byok-guard.ts");
  });
});
