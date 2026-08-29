// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * release-workflow-native-multiarch.test.ts — Quick 260531 (v1.0.17 release),
 * extended 260829 (arm64 decoupling).
 *
 * YAML-shape regression test that pins the NATIVE multi-arch build
 * invariants of `.github/workflows/release.yml` and the reusable
 * `.github/workflows/build-images-arch.yml` it calls.
 *
 * Root cause #1 (260531): the prior `build-image` job built
 * `platforms: linux/amd64,linux/arm64` in a SINGLE job via
 * `docker/setup-qemu-action` — the arm64 leg was QEMU-emulated on an
 * amd64 runner, and the napi-heavy api/worker images (@node-rs/argon2
 * Rust + ~50 @opentelemetry/auto-instrumentations-node pkgs) stalled the
 * emulated build for 90-140min on a cold GHA cache. The fix split the
 * build per-arch onto NATIVE runners building by digest, then a
 * `merge-manifest` job stitched the digests into the multi-arch tag.
 *
 * Root cause #2 (260829): both arches lived in ONE `build-image` matrix,
 * so `merge-manifest`'s `needs: [build-image]` waited for EVERY cell.
 * When GitHub had no `ubuntu-24.04-arm64` capacity the arm64 cells sat
 * `queued` indefinitely, the manifest was never created, and the release
 * tag never appeared in GHCR even though every amd64 build had already
 * succeeded (v1.2.7: 6 amd64 jobs green, 6 arm64 queued 30+ min, no tag).
 * The fix calls the reusable per-arch workflow TWICE — `build-image`
 * (amd64) and `build-image-arm64` — so `merge-manifest` depends on amd64
 * ALONE and publishes the tag immediately; `merge-manifest-multiarch`
 * then re-stitches the tag with the arm64 digest once it lands.
 *
 * Assertions (the durable invariants):
 *   1. The reusable workflow's build job takes its runner from an input
 *      (per-arch native runner), NOT a hardcoded single runner.
 *   2. release.yml calls that reusable workflow twice, pinning both
 *      `ubuntu-24.04` (amd64) and `ubuntu-24.04-arm64` (arm64).
 *   3. NO step uses `docker/setup-qemu-action` (native, not emulated).
 *   4. The per-arch build step pushes BY DIGEST (`push-by-digest=true`)
 *      and builds exactly ONE architecture.
 *   5. `merge-manifest` needs ONLY the amd64 build — never the arm64 one,
 *      which is the whole point of the decoupling — and runs
 *      `docker buildx imagetools create`.
 *   6. `create-image-release.needs` includes `merge-manifest` (the tagged
 *      images only exist after the merge) and NOT the arm64 build.
 *   7. The build job carries a `timeout-minutes`.
 *   8. `merge-manifest-multiarch` exists, needs BOTH builds, and verifies
 *      both arches are present in the final manifest.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const RELEASE_PATH = resolve(process.cwd(), ".github/workflows/release.yml");
const REUSABLE_PATH = resolve(process.cwd(), ".github/workflows/build-images-arch.yml");

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
  uses?: string;
  with?: Record<string, unknown>;
  strategy?: { matrix?: Record<string, unknown> };
  steps?: Step[];
}

function loadJobs(path: string): Record<string, Job> {
  const raw = readFileSync(path, "utf8");
  const doc = parse(raw) as { jobs?: Record<string, Job> };
  expect(doc.jobs, `${path} must declare jobs`).toBeTruthy();
  return doc.jobs as Record<string, Job>;
}

/** The single build job inside the reusable per-arch workflow. */
function reusableBuildJob(): Job {
  const jobs = loadJobs(REUSABLE_PATH);
  const names = Object.keys(jobs);
  expect(names.length, "reusable workflow must declare exactly one job").toBe(1);
  return jobs[names[0] as string] as Job;
}

function needsOf(job: Job | undefined): string[] {
  if (!job) return [];
  return Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];
}

describe("release.yml — native multi-arch build invariants", () => {
  it("(1) the reusable build job takes its runner from an input, not a hardcoded one", () => {
    const build = reusableBuildJob();
    expect(typeof build["runs-on"]).toBe("string");
    expect(build["runs-on"]).toMatch(/inputs\.runner/);
  });

  it("(2) release.yml calls the reusable workflow per arch, pinning both native runners", () => {
    const jobs = loadJobs(RELEASE_PATH);
    const amd = jobs["build-image"];
    const arm = jobs["build-image-arm64"];
    expect(amd, "build-image (amd64) job must exist").toBeTruthy();
    expect(arm, "build-image-arm64 job must exist").toBeTruthy();
    for (const j of [amd, arm]) {
      expect(String(j.uses ?? ""), "must call the reusable per-arch workflow").toMatch(
        /build-images-arch\.yml$/,
      );
    }
    expect(amd.with?.runner).toBe("ubuntu-24.04");
    expect(amd.with?.arch).toBe("amd64");
    expect(arm.with?.runner).toBe("ubuntu-24.04-arm64");
    expect(arm.with?.arch).toBe("arm64");
  });

  it("(3) the build uses NO QEMU emulation (no setup-qemu-action)", () => {
    const steps = reusableBuildJob().steps ?? [];
    const qemu = steps.find((s) => (s.uses ?? "").includes("setup-qemu-action"));
    expect(qemu, "the build must NOT set up QEMU — native runners only").toBeUndefined();
  });

  it("(4) per-arch build pushes BY DIGEST and builds exactly one architecture", () => {
    const steps = reusableBuildJob().steps ?? [];
    const buildStep = steps.find((s) => (s.uses ?? "").includes("build-push-action"));
    expect(buildStep, "build-push-action step must exist").toBeTruthy();
    expect(String(buildStep?.with?.outputs ?? "")).toMatch(/push-by-digest=true/);
    const platforms = String(buildStep?.with?.platforms ?? "");
    expect(platforms).toMatch(/inputs\.arch/);
    // A comma would mean two arches in one job — back to the QEMU trap.
    expect(platforms).not.toMatch(/,/);
  });

  it("(5) merge-manifest depends on the amd64 build ALONE, so arm64 capacity cannot block the tag", () => {
    const jobs = loadJobs(RELEASE_PATH);
    const merge = jobs["merge-manifest"];
    expect(merge, "merge-manifest job must exist").toBeTruthy();
    const needs = needsOf(merge);
    expect(needs).toContain("build-image");
    expect(
      needs,
      "merge-manifest must NOT wait for arm64 — that is the whole point of the split",
    ).not.toContain("build-image-arm64");
    const runText = (merge.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(runText).toMatch(/docker buildx imagetools create/);
  });

  it("(6) create-image-release depends on merge-manifest and not on the arm64 build", () => {
    const jobs = loadJobs(RELEASE_PATH);
    const rel = jobs["create-image-release"];
    expect(rel, "create-image-release job must exist").toBeTruthy();
    const needs = needsOf(rel);
    expect(needs).toContain("merge-manifest");
    expect(needs).not.toContain("build-image-arm64");
  });

  it("(7) the build job has a timeout-minutes guard (fail-fast on a future wedge)", () => {
    const t = reusableBuildJob()["timeout-minutes"];
    expect(typeof t).toBe("number");
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(60);
  });

  it("(8) merge-manifest-multiarch re-stitches the tag once arm64 lands, and verifies both arches", () => {
    const jobs = loadJobs(RELEASE_PATH);
    const multi = jobs["merge-manifest-multiarch"];
    expect(multi, "merge-manifest-multiarch job must exist").toBeTruthy();
    const needs = needsOf(multi);
    expect(needs).toContain("build-image");
    expect(needs).toContain("build-image-arm64");
    const runText = (multi.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(runText).toMatch(/docker buildx imagetools create/);
    expect(runText).toMatch(/linux\/amd64/);
    expect(runText).toMatch(/linux\/arm64/);
  });
});
