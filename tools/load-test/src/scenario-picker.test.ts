// SPDX-License-Identifier: Apache-2.0
// Phase 08 / Plan 02 — Task 1 RED: scenario-picker distribution tests.
//
// The k6 load test mixes four endpoints in a locked 50/25/15/10 ratio
// (D-LOAD-3). The picker is a pure weighted RNG so it is unit-testable
// outside k6's runtime. These tests pin:
//   1. boundary behaviour (rng=0 -> first bucket, rng~1 -> last bucket)
//   2. statistical distribution within ±2% over 10,000 draws using a
//      seeded Mulberry32 PRNG (well-known, deterministic, dependency-free)
//   3. weight sanity (sum == 100)
//   4. endpoint string fidelity (must match apps/api routes; typos here
//      would silently route load to nothing)
import { describe, expect, it } from "vitest";

import { type Endpoint, pick, pickWith, WEIGHTS } from "./scenario-picker.js";

/**
 * Mulberry32 — small, fast, deterministic PRNG. Inlined to keep the
 * load-test workspace dependency-free at runtime.
 * Reference: https://stackoverflow.com/a/47593316 (public domain).
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("scenario-picker", () => {
  it("returns the first bucket when rng is 0", () => {
    expect(pickWith(() => 0)).toBe<Endpoint>("transcribe");
  });

  it("returns the last bucket when rng is ~1", () => {
    expect(pickWith(() => 0.999999)).toBe<Endpoint>("realtime-ws");
  });

  it("distributes 10,000 iterations within +/-2% of the 50/25/15/10 mix", () => {
    const rng = mulberry32(0xc0ffee);
    const counts: Record<Endpoint, number> = {
      transcribe: 0,
      reason: 0,
      "agent-stream": 0,
      "realtime-ws": 0,
    };
    const N = 10_000;
    for (let i = 0; i < N; i += 1) {
      counts[pickWith(rng)] += 1;
    }
    const tolerance = 0.02; // ±2% absolute
    expect(counts.transcribe / N).toBeGreaterThanOrEqual(0.5 - tolerance);
    expect(counts.transcribe / N).toBeLessThanOrEqual(0.5 + tolerance);
    expect(counts.reason / N).toBeGreaterThanOrEqual(0.25 - tolerance);
    expect(counts.reason / N).toBeLessThanOrEqual(0.25 + tolerance);
    expect(counts["agent-stream"] / N).toBeGreaterThanOrEqual(0.15 - tolerance);
    expect(counts["agent-stream"] / N).toBeLessThanOrEqual(0.15 + tolerance);
    expect(counts["realtime-ws"] / N).toBeGreaterThanOrEqual(0.1 - tolerance);
    expect(counts["realtime-ws"] / N).toBeLessThanOrEqual(0.1 + tolerance);
  });

  it("WEIGHTS sums to exactly 100", () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("endpoint keys exactly match the locked 4-endpoint union", () => {
    // Literal-union snapshot — any drift (typos, new endpoints,
    // renames) flips this test. apps/api routes must agree.
    const keys = Object.keys(WEIGHTS).sort();
    expect(keys).toEqual(["agent-stream", "realtime-ws", "reason", "transcribe"]);
    // pick() — the Math.random-bound convenience — must return one of
    // the locked endpoints. Loop a few times so we exercise the binding,
    // not the distribution.
    for (let i = 0; i < 20; i += 1) {
      expect(keys).toContain(pick());
    }
  });
});
