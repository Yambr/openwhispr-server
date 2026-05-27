// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260528-370 — unit tests for apps/api/src/config/build-info.ts
//
// Covers PLAN.md §5.1 (6 cases U1..U6):
//   U1 - all three env vars present, valid values
//   U2 - all three env vars absent (returns BUILD_INFO_UNKNOWN triplet)
//   U3 - partial: only OPENWHISPR_BUILD_VERSION present
//   U4 - all three whitespace-only / empty (treated as unset)
//   U5 - explicit empty-string for OPENWHISPR_BUILD_VERSION
//   U6 - over-length input is truncated to 120 chars (LOCKER-05 defense-in-depth)
//
// Pure unit test — no testcontainers, no Fastify boot, no process.env mutation.
// `parseBuildInfoFromEnv(envSnapshot)` is invoked with explicit object literals.

import { describe, expect, it } from "vitest";
import { BUILD_INFO_UNKNOWN, parseBuildInfoFromEnv } from "../../../../src/config/build-info.js";

describe("parseBuildInfoFromEnv (U1..U6 matrix)", () => {
  it("U1: returns all three values when env vars are populated", () => {
    const out = parseBuildInfoFromEnv({
      OPENWHISPR_BUILD_VERSION: "1.0.14",
      OPENWHISPR_BUILD_SHA: "84b90245abcdef84b90245abcdef84b90245abcd",
      OPENWHISPR_IMAGE_TAG: "1.0.14",
    });
    expect(out).toEqual({
      version: "1.0.14",
      commitSha: "84b90245abcdef84b90245abcdef84b90245abcd",
      imageTag: "1.0.14",
    });
  });

  it("U2: returns the BUILD_INFO_UNKNOWN triplet when all three env vars are absent", () => {
    const out = parseBuildInfoFromEnv({});
    expect(out).toEqual({
      version: BUILD_INFO_UNKNOWN,
      commitSha: BUILD_INFO_UNKNOWN,
      imageTag: BUILD_INFO_UNKNOWN,
    });
    // Defense-in-depth: BUILD_INFO_UNKNOWN must be the documented sentinel,
    // not an arbitrary other string. Operators grep for the literal.
    expect(BUILD_INFO_UNKNOWN).toBe("unknown");
  });

  it("U3: returns partial — only OPENWHISPR_BUILD_VERSION populated, other two fall back to unknown", () => {
    const out = parseBuildInfoFromEnv({
      OPENWHISPR_BUILD_VERSION: "1.0.14",
    });
    expect(out).toEqual({
      version: "1.0.14",
      commitSha: BUILD_INFO_UNKNOWN,
      imageTag: BUILD_INFO_UNKNOWN,
    });
  });

  it("U4: treats whitespace-only env vars as unset (BUILD_INFO_UNKNOWN triplet)", () => {
    const out = parseBuildInfoFromEnv({
      OPENWHISPR_BUILD_VERSION: "   ",
      OPENWHISPR_BUILD_SHA: "\t\n",
      OPENWHISPR_IMAGE_TAG: "  \r\n  ",
    });
    expect(out).toEqual({
      version: BUILD_INFO_UNKNOWN,
      commitSha: BUILD_INFO_UNKNOWN,
      imageTag: BUILD_INFO_UNKNOWN,
    });
  });

  it("U5: treats an explicit empty-string env var as unset", () => {
    const out = parseBuildInfoFromEnv({
      OPENWHISPR_BUILD_VERSION: "",
      OPENWHISPR_BUILD_SHA: "",
      OPENWHISPR_IMAGE_TAG: "",
    });
    expect(out).toEqual({
      version: BUILD_INFO_UNKNOWN,
      commitSha: BUILD_INFO_UNKNOWN,
      imageTag: BUILD_INFO_UNKNOWN,
    });
  });

  it("U6: truncates per-field input to exactly 120 chars (LOCKER-05 defense-in-depth)", () => {
    const longValue = "a".repeat(200);
    const out = parseBuildInfoFromEnv({
      OPENWHISPR_BUILD_VERSION: longValue,
      OPENWHISPR_BUILD_SHA: longValue,
      OPENWHISPR_IMAGE_TAG: longValue,
    });
    expect(out.version.length).toBe(120);
    expect(out.version).toBe("a".repeat(120));
    expect(out.commitSha.length).toBe(120);
    expect(out.imageTag.length).toBe(120);
  });

  it("does not capture process.env at module scope (calling with default arg uses live process.env)", () => {
    // Smoke check — verifies that omitting the env arg works (defaults to
    // process.env), without mutating the surrounding process.env. We assert
    // only the SHAPE (three string fields), not the values, because the
    // host environment may or may not have OPENWHISPR_* set.
    const out = parseBuildInfoFromEnv();
    expect(typeof out.version).toBe("string");
    expect(typeof out.commitSha).toBe("string");
    expect(typeof out.imageTag).toBe("string");
  });
});
