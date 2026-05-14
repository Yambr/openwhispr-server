// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 08 / Plan 02 — Task 1 GREEN: scenario picker.
//
// Weighted RNG over the 4-endpoint load-test mix locked by D-LOAD-3.
// The shape is intentionally pure (rng injected) so the picker is
// unit-testable outside k6's runtime — Wave 2 (plan 06) wraps `pick()`
// inside the k6 default export.
//
// Distribution is enforced by scenario-picker.test.ts (±2% over 10k
// draws using a seeded Mulberry32 PRNG).

/** The four endpoints exercised by the k6 load test. */
export type Endpoint = "transcribe" | "reason" | "agent-stream" | "realtime-ws";

/**
 * Locked endpoint mix (D-LOAD-3). Values are percentages and MUST sum
 * to exactly 100 — a sanity gate test pins this.
 */
export const WEIGHTS: Record<Endpoint, number> = {
  transcribe: 50,
  reason: 25,
  "agent-stream": 15,
  "realtime-ws": 10,
};

// Iteration order matters: pickWith() walks this in fixed sequence and
// the boundary tests (rng=0 -> first, rng~1 -> last) depend on it.
const ORDER: readonly Endpoint[] = ["transcribe", "reason", "agent-stream", "realtime-ws"];

/**
 * Pick an endpoint using the injected RNG. The RNG must return a value
 * in [0, 1). With rng=0 the function returns the first bucket; with rng
 * approaching 1 it returns the last.
 */
export function pickWith(rng: () => number): Endpoint {
  const r = rng() * 100;
  let cumulative = 0;
  for (const endpoint of ORDER) {
    cumulative += WEIGHTS[endpoint];
    if (r < cumulative) {
      return endpoint;
    }
  }
  // Defensive fallback — only reachable if rng() returns >=1, which
  // violates the contract. Return the last bucket to keep callers safe.
  return ORDER[ORDER.length - 1] as Endpoint;
}

/** Convenience binding to Math.random for k6 runtime use. */
export const pick = (): Endpoint => pickWith(Math.random);
