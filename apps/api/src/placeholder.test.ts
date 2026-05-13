// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { isPlaceholder } from "./placeholder.js";

describe("apps/api placeholder", () => {
  it("returns true", () => {
    expect(isPlaceholder()).toBe(true);
  });
});
