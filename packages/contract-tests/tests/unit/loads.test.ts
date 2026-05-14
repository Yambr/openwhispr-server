// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { harnessLoaded } from "../../src/index.js";

describe("packages/contract-tests harness", () => {
  it("reports harness loaded", () => {
    expect(harnessLoaded()).toBe(true);
  });
});
