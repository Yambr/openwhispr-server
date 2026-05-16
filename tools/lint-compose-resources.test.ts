// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 20 / Plan 20-01 — vitest coverage for the SR-20.1 + SR-20.2 guard.
//
// Three cases:
//   1. Live repo state — `auditComposeResources(REPO_ROOT)` must return [].
//      RED on the pre-fix tree (services missing limits + restart); GREEN
//      once the Task-2 mechanical YAML pass lands.
//   2. Synthetic BAD fixture — reproduces every violation code (R1, R2, R3)
//      the lint is designed to catch.
//   3. Synthetic GOOD fixture — post-fix shape; clean.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  auditComposeResources,
  COMPOSE_FILES,
  findRepoRoot,
  MEMORY_FLOORS_BYTES,
  parseMemoryString,
  SHORT_LIVED_ALLOWLIST,
} from "./lint-compose-resources.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const FIXTURE_BAD = resolve(HERE, "__tests__", "fixtures", "compose-resources", "bad");
const FIXTURE_GOOD = resolve(HERE, "__tests__", "fixtures", "compose-resources", "good");

describe("lint-compose-resources — SR-20.1 + SR-20.2 guard", () => {
  it("returns zero violations against the live repo tree (regression sentinel)", () => {
    expect(auditComposeResources(REPO_ROOT)).toEqual([]);
  });

  it("flags R1, R2, R3 codes on the synthetic BAD fixture", () => {
    const violations = auditComposeResources(FIXTURE_BAD);
    const codes = new Set(violations.map((v) => v.code));
    expect(codes.has("R1-MISSING-MEMORY-LIMIT")).toBe(true);
    expect(codes.has("R2-MISSING-RESTART")).toBe(true);
    expect(codes.has("R3-MEMORY-BELOW-FLOOR")).toBe(true);
  });

  it("returns zero violations against the synthetic GOOD fixture", () => {
    expect(auditComposeResources(FIXTURE_GOOD)).toEqual([]);
  });

  it("exports the canonical COMPOSE_FILES, SHORT_LIVED_ALLOWLIST, MEMORY_FLOORS_BYTES", () => {
    expect(COMPOSE_FILES.length).toBe(10);
    expect(COMPOSE_FILES[0]).toBe("docker-compose.yml");
    expect(SHORT_LIVED_ALLOWLIST.has("migrate")).toBe(true);
    expect(SHORT_LIVED_ALLOWLIST.has("postgres")).toBe(false);
    expect(MEMORY_FLOORS_BYTES.postgres).toBe(2 * 1024 ** 3);
    expect(MEMORY_FLOORS_BYTES.web).toBe(384 * 1024 ** 2);
  });

  it("findRepoRoot resolves to a directory containing tools/", () => {
    const root = findRepoRoot();
    expect(root).toMatch(/openwhispr-server$/);
  });

  it("parseMemoryString accepts SI + IEC units and rejects garbage", () => {
    expect(parseMemoryString("512M")).toBe(512 * 1024 ** 2);
    expect(parseMemoryString("2G")).toBe(2 * 1024 ** 3);
    expect(parseMemoryString("1Gi")).toBe(1 * 1024 ** 3);
    expect(parseMemoryString("128MB")).toBe(128 * 1024 ** 2);
    expect(parseMemoryString("1024")).toBe(1024); // bytes (no unit)
    expect(parseMemoryString("256mi")).toBe(256 * 1024 ** 2);
    expect(parseMemoryString("1.5G")).toBe(Math.floor(1.5 * 1024 ** 3));
    expect(() => parseMemoryString("not-a-memory")).toThrow();
  });
});
