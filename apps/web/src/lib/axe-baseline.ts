// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.1 / Plan 05 / Task 05-03 — Axe baseline write/read helper
// (D-33). Pure helper extracted from tests/e2e/fixtures/axe.ts so the
// compare/update logic can be unit-tested under vitest (the e2e fixture
// itself runs only inside Playwright, which vitest cannot import).
//
// Behaviour:
//   - mode="update" → write `live` as JSON to `file` (creates the
//     parent baseline directory as needed). Used by `pnpm e2e:axe
//     --update-baseline` during Task 05-04 bake.
//   - mode="compare" → read the stored baseline from `file` and assert
//     `live.passes >= baseline.passes`. Throws `baseline regression`
//     on regress so axe's pass-count never silently drops between
//     CI runs.

export interface AxeBaselineSummary {
  url: string;
  passes: number;
  incomplete: number;
}

export interface CompareOrWriteOptions {
  file: string;
  live: AxeBaselineSummary;
  mode: "update" | "compare";
}

export async function compareOrWriteBaseline(opts: CompareOrWriteOptions): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  if (opts.mode === "update") {
    await fs.mkdir(path.dirname(opts.file), { recursive: true });
    await fs.writeFile(opts.file, JSON.stringify(opts.live, null, 2));
    return;
  }
  // compare
  const baseline = JSON.parse(await fs.readFile(opts.file, "utf8")) as AxeBaselineSummary;
  if (opts.live.passes < baseline.passes) {
    throw new Error(
      `baseline regression at ${opts.file}: live passes ${opts.live.passes} < baseline ${baseline.passes}`,
    );
  }
}
