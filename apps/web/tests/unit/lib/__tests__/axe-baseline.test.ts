// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.1 / Plan 05 / Task 05-03 — RED+GREEN tests for the axe
// baseline helper extracted from tests/e2e/fixtures/axe.ts (D-33).
//
// Surface verified:
//   1. compareOrWriteBaseline writes a JSON summary when
//      AXE_UPDATE_BASELINE=1.
//   2. compareOrWriteBaseline reads a stored summary and asserts the
//      live result has ≥ the baseline passes count.
//   3. A live result with fewer passes than baseline trips an Error.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareOrWriteBaseline } from "../../../../src/lib/axe-baseline";

const TMP_ROOT = path.join(process.cwd(), ".vitest-axe-baseline-tmp");

describe("axe baseline helper (Phase 18.1.1 / Plan 05 / Task 05-03)", () => {
  beforeEach(async () => {
    await fs.mkdir(TMP_ROOT, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(TMP_ROOT, { recursive: true, force: true });
  });

  it("writes a baseline file when update flag is set", async () => {
    const file = path.join(TMP_ROOT, "u1.json");
    await compareOrWriteBaseline({
      file,
      live: { url: "http://x/sign-in", passes: 12, incomplete: 0 },
      mode: "update",
    });
    const written = JSON.parse(await fs.readFile(file, "utf8"));
    expect(written.passes).toBe(12);
    expect(written.url).toBe("http://x/sign-in");
  });

  it("compare mode accepts live passes ≥ baseline passes", async () => {
    const file = path.join(TMP_ROOT, "u2.json");
    await fs.writeFile(
      file,
      JSON.stringify({ url: "http://x/sign-up", passes: 10, incomplete: 0 }),
    );
    await expect(
      compareOrWriteBaseline({
        file,
        live: { url: "http://x/sign-up", passes: 11, incomplete: 0 },
        mode: "compare",
      }),
    ).resolves.toBeUndefined();
  });

  it("compare mode rejects when live passes < baseline passes", async () => {
    const file = path.join(TMP_ROOT, "u3.json");
    await fs.writeFile(
      file,
      JSON.stringify({ url: "http://x/verify-email", passes: 8, incomplete: 0 }),
    );
    await expect(
      compareOrWriteBaseline({
        file,
        live: { url: "http://x/verify-email", passes: 7, incomplete: 0 },
        mode: "compare",
      }),
    ).rejects.toThrow(/baseline regression/i);
  });
});
