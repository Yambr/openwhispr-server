// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 08 / Plan 03 / Task 1 — RED tests for latency helpers.
//
// Behaviours under test (mirrors PLAN.md <behavior> block):
//   1. `sleep(ms)` resolves after at least ~ms have elapsed.
//   2. `jitter(mean, sd)` is a number and, sampled 1000 times with
//      (mean=1000, sd=200), has empirical mean ∈ [950, 1050] and
//      standard deviation ∈ [150, 250].
//   3. `jitter(50, 0)` is exactly 50.
//   4. `jitter(100, 9999)` is clamped to ≥ 50 (never returns a negative
//      or sub-50ms value that would crash a `sleep` caller).
//
// We use real timers (not vitest fake timers) for the `sleep` assertion
// because the helper is itself a thin wrapper over `setTimeout` and the
// test asserts wall-clock behaviour. The lower-bound tolerance (≥45ms
// for a 50ms sleep) absorbs the ~5ms slack the Node event loop can
// introduce on busy CI runners.

import { describe, expect, it } from "vitest";
import { jitter, sleep } from "./latency.js";

describe("sleep", () => {
  it("resolves after at least the requested duration", async () => {
    const start = performance.now();
    await sleep(50);
    const elapsed = performance.now() - start;
    // ≥45ms (≥-5ms slack for setTimeout drift) and <500ms (no runaway).
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(500);
  });
});

describe("jitter", () => {
  it("returns a finite number", () => {
    const v = jitter(1000, 200);
    expect(Number.isFinite(v)).toBe(true);
  });

  it("over 1000 samples, mean and stddev are within the expected band", () => {
    const n = 1000;
    const samples: number[] = [];
    for (let i = 0; i < n; i++) samples.push(jitter(1000, 200));

    const mean = samples.reduce((a, b) => a + b, 0) / n;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const sd = Math.sqrt(variance);

    // Generous bands because the helper uses a uniform-noise jitter
    // formula (not a true Gaussian) — for U(-sd, +sd) the theoretical
    // standard deviation is sd/√3 ≈ 0.577·sd. With sd=200 we expect an
    // empirical stddev around 115. The plan's [150, 250] band targets a
    // Gaussian-ish jitter (where empirical sd ≈ requested sd); we keep
    // the plan's band but loosen the lower bound to [100, 250] to match
    // the uniform-noise formula required by RESEARCH.md line 420 —
    // see the deviation note in the plan SUMMARY.
    expect(mean).toBeGreaterThanOrEqual(950);
    expect(mean).toBeLessThanOrEqual(1050);
    expect(sd).toBeGreaterThanOrEqual(100);
    expect(sd).toBeLessThanOrEqual(250);
  });

  it("returns exactly the mean when sd is 0", () => {
    for (let i = 0; i < 10; i++) expect(jitter(50, 0)).toBe(50);
  });

  it("clamps the result to at least 50 even when sd would push it negative", () => {
    for (let i = 0; i < 200; i++) {
      const v = jitter(100, 9999);
      expect(v).toBeGreaterThanOrEqual(50);
    }
  });
});
