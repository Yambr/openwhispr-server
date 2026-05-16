// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41.g / HI-01 — stub package now exports isPlaceholder() only.
// See packages/i18n/src/index.ts header for rename rationale.
import { describe, expect, it } from "vitest";
import { isPlaceholder } from "../../src/index.js";

describe("@openwhispr/i18n-stub", () => {
  it("isPlaceholder returns true (Stryker mutation target)", () => {
    expect(isPlaceholder()).toBe(true);
  });
});
