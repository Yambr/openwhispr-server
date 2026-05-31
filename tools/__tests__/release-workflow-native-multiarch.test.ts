// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * release-workflow-native-multiarch.test.ts — Quick 260531 (v1.0.17 release).
 *
 * YAML-shape regression test that pins the NATIVE multi-arch build
 * invariants of `.github/workflows/release.yml`.
 *
 * Root cause this guards against (260531): the prior `build-image` job
 * built `platforms: linux/amd64,linux/arm64` in a SINGLE job via
 * `docker/setup-qemu-action` — the arm64 leg was QEMU-emulated on an
 * amd64 runner, and the napi-heavy api/worker images (@node-rs/argon2
 * Rust + ~50 @opentelemetry/auto-instrumentations-node pkgs) stalled the
 * emulated build for 90-140min on a cold GHA cache. The fix splits the
 * build per-arch onto NATIVE runners (amd64 → ubuntu-24.04, arm64 →
 * ubuntu-24.04-arm64, free GA on public repos) building by digest, then a
 * `merge-manifest` job stitches the digests into the multi-arch tag.
 *
 * Assertions (the durable invariants — if a future edit reverts to
 * QEMU-emulated arm64, these FAIL):
 *   1. `build-image.runs-on` is matrix-driven (per-arch native runner),
 *      NOT a hardcoded single runner.
 *   2. The build-image matrix declares a `platform` axis pinning both
 *      `ubuntu-24.04` (amd64) and `ubuntu-24.04-arm64` (arm64).
 *   3. NO step in build-image uses `docker/setup-qemu-action` (the whole
 *      point — native, not emulated).
 *   4. The per-arch build step pushes BY DIGEST (`push-by-digest=true`).
 *   5. A `merge-manifest` job exists, `needs: [build-image]`, and runs
 *      `docker buildx imagetools create`.
 *   6. `create-image-release.needs` includes `merge-manifest` (the tagged
 *      images only exist after the merge).
 *   7. `build-image` carries a `timeout-minutes` (defence-in-depth so a
 *      future wedge fails fast instead of crawling to the 6h ceiling).
 *
 * Style mirrors tools/__tests__/lint-lefthook-stdin-config.test.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const RELEASE_PATH = resolve(process.cwd(), ".github/workflows/release.yml");

interface Step {
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  name?: string;
}
interface Job {
  "runs-on"?: unknown;
  "timeout-minutes"?: number;
  needs?: string[] | string;
  strategy?: { matrix?: Record<string, unknown> };
  steps?: Step[];
}

function loadJobs(): Record<string, Job> {
  const raw = readFileSync(RELEASE_PATH, "utf8");
  const doc = parse(raw) as { jobs?: Record<string, Job> };
  expect(doc.jobs, "release.yml must declare jobs").toBeTruthy();
  return doc.jobs as Record<string, Job>;
}

describe("release.yml — native multi-arch build invariants", () => {
  it("(1) build-image.runs-on is matrix-driven per-arch, not a hardcoded single runner", () => {
    const jobs = loadJobs();
    const build = jobs["build-image"];
    expect(build, "build-image job must exist").toBeTruthy();
    expect(typeof build["runs-on"]).toBe("string");
    // Matrix-driven runner references the platform axis.
    expect(build["runs-on"]).toMatch(/matrix\.platform\.runner/);
  });

  it("(2) build-image matrix pins both native runners (amd64 + arm64)", () => {
    const jobs = loadJobs();
    const matrix = jobs["build-image"].strategy?.matrix as
      | { platform?: Array<{ arch?: string; runner?: string }> }
      | undefined;
    expect(matrix?.platform, "matrix.platform axis must exist").toBeTruthy();
    const runners = (matrix?.platform ?? []).map((p) => p.runner);
    expect(runners).toContain("ubuntu-24.04");
    expect(runners).toContain("ubuntu-24.04-arm64");
    const arches = (matrix?.platform ?? []).map((p) => p.arch);
    expect(arches).toContain("amd64");
    expect(arches).toContain("arm64");
  });

  it("(3) build-image uses NO QEMU emulation (no setup-qemu-action)", () => {
    const jobs = loadJobs();
    const steps = jobs["build-image"].steps ?? [];
    const qemu = steps.find((s) => (s.uses ?? "").includes("setup-qemu-action"));
    expect(qemu, "build-image must NOT set up QEMU — native runners only").toBeUndefined();
  });

  it("(4) per-arch build pushes BY DIGEST (push-by-digest=true)", () => {
    const jobs = loadJobs();
    const steps = jobs["build-image"].steps ?? [];
    const buildStep = steps.find((s) => (s.uses ?? "").includes("build-push-action"));
    expect(buildStep, "build-push-action step must exist").toBeTruthy();
    const outputs = String(buildStep?.with?.outputs ?? "");
    expect(outputs).toMatch(/push-by-digest=true/);
    // Single-arch per job — platforms must be one arch from the matrix.
    expect(String(buildStep?.with?.platforms ?? "")).toMatch(/matrix\.platform\.arch/);
    expect(String(buildStep?.with?.platforms ?? "")).not.toMatch(/,/);
  });

  it("(5) merge-manifest job exists, needs build-image, runs imagetools create", () => {
    const jobs = loadJobs();
    const merge = jobs["merge-manifest"];
    expect(merge, "merge-manifest job must exist").toBeTruthy();
    const needs = Array.isArray(merge.needs) ? merge.needs : [merge.needs];
    expect(needs).toContain("build-image");
    const runText = (merge.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(runText).toMatch(/docker buildx imagetools create/);
  });

  it("(6) create-image-release depends on merge-manifest", () => {
    const jobs = loadJobs();
    const rel = jobs["create-image-release"];
    expect(rel, "create-image-release job must exist").toBeTruthy();
    const needs = Array.isArray(rel.needs) ? rel.needs : [rel.needs];
    expect(needs).toContain("merge-manifest");
  });

  it("(7) build-image has a timeout-minutes guard (fail-fast on a future wedge)", () => {
    const jobs = loadJobs();
    const t = jobs["build-image"]["timeout-minutes"];
    expect(typeof t).toBe("number");
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(60);
  });
});
