// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 19b / SR-19b.1 — vitest coverage for the STRUCT-05 routing guard.
//
// Three cases:
//   1. Live repo state — `auditTraefikRoutes(REPO_ROOT)` must return [].
//      RED on the pre-fix tree; GREEN once Commit 2 lands.
//   2. Synthetic BAD fixture — reproduces every violation (V1..V5) the
//      lint is designed to catch; assertions GREEN as proof the lint
//      logic is sound.
//   3. Synthetic GOOD fixture — post-fix layout; assertion GREEN.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditTraefikRoutes } from "./lint-traefik-routes.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const FIXTURE_BAD = resolve(HERE, "__tests__", "fixtures", "traefik-routes", "bad");
const FIXTURE_GOOD = resolve(HERE, "__tests__", "fixtures", "traefik-routes", "good");

describe("lint-traefik-routes — STRUCT-05 guard", () => {
  it("returns zero violations against the live repo tree (regression sentinel)", () => {
    expect(auditTraefikRoutes(REPO_ROOT)).toEqual([]);
  });

  it("flags every violation class on the synthetic BAD fixture", () => {
    const violations = auditTraefikRoutes(FIXTURE_BAD);
    const codes = new Set(violations.map((v) => v.code));
    // V1: docker-label router on Host(api.localhost) targets web-svc.
    expect(codes.has("V1")).toBe(true);
    // V2: at least one router targeting web-svc lacks Host(web.localhost).
    expect(codes.has("V2")).toBe(true);
    // V3: dynamic.dev.yml web-svc upstream points at :3001 instead of :3000.
    expect(codes.has("V3")).toBe(true);
    // V5: ingress overlay pins --providers.file.filename= and does not
    // mount dynamic.dev.yml.
    expect(codes.has("V5")).toBe(true);
  });

  it("returns zero violations against the synthetic GOOD fixture (post-fix shape)", () => {
    const violations = auditTraefikRoutes(FIXTURE_GOOD);
    expect(violations).toEqual([]);
  });
});
