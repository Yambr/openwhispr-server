// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { isPlaceholder } from "../../src/index.js";

describe("packages/auth placeholder", () => {
  it("returns true", () => {
    expect(isPlaceholder()).toBe(true);
  });
});
