// SPDX-License-Identifier: Apache-2.0
// Phase 08 / Plan 03 / Task 1 — latency primitives for the mock-litellm
// upstream simulator.
//
// The mock-litellm service stands in for the real LiteLLM proxy under
// the `load-test-mock` docker-compose profile (wired in Wave 1, plan
// 08-05). Per D-PROF-1 it MUST simulate upstream latency so the k6
// load test exercises connection-pool, queue, and timeout behaviour in
// the api the same way the real LiteLLM would.
//
// The jitter formula matches RESEARCH.md line 420
// (`Math.max(50, mean + (Math.random() * 2 - 1) * sd)`):
//   * Uniform noise in U(-sd, +sd) around the mean.
//   * Hard floor of 50ms to avoid negative-sleep panics when sd > mean.
//
// We deliberately do NOT use a Gaussian (Box–Muller) generator here —
// uniform noise is sufficient for load-shape simulation, has no
// transcendental cost on the hot path, and the floor clamp makes the
// behaviour deterministic enough for property tests.

/**
 * Resolve after `ms` milliseconds. Thin wrapper over `setTimeout` so
 * the call sites in `server.ts` read as `await sleep(jitter(mean, sd))`.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Return a single jittered millisecond value around `mean` with
 * half-width `sd`. Clamped to ≥ 50ms.
 *
 * For `sd === 0` this returns exactly `mean` (degenerate case used by
 * tests that need deterministic timing). For very large `sd` (e.g.
 * `sd > mean`) the 50ms floor prevents callers from passing a
 * negative duration to `setTimeout`.
 */
export function jitter(mean: number, sd: number): number {
  const noise = (Math.random() * 2 - 1) * sd;
  return Math.max(50, mean + noise);
}
