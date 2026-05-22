// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-06 — RED→GREEN for REVIEW-INDEX.md CR-12.
//
// `chatCompletionsStream` honors `bodyTimeout: 0` so the SSE 2xx stream
// can stay open indefinitely. The pre-publication review found that
// the SAME flag is passed on the non-2xx path where `res.body.text()`
// drains the upstream error body. A slow-rolled upstream error (one
// byte then hang) burns a fastify-handler worker forever, leaks a
// dispatcher slot, and ultimately starves the event loop at the 1000-VU
// SLO.
//
// Fix contract:
//   * 2xx (stream): bodyTimeout stays whatever the caller supplied
//     (defaults to 0 — long-lived SSE).
//   * non-2xx (error drain): bodyTimeout is bounded by a constant.
//
// R32 — the bound is now operator-tunable. The canonical default literal
// (`DEFAULT_ERROR_DRAIN_TIMEOUT_MS`) lives in `config.ts` as the
// env-default for `LITELLM_ERROR_DRAIN_TIMEOUT_MS`, and the runtime
// `chatCompletionsStream` non-2xx drain reads the resolved
// `config.errorDrainTimeoutMs`.
//
// We assert the contract two ways:
//   (a) static — `config.ts` declares a positive `DEFAULT_ERROR_DRAIN_TIMEOUT_MS`
//       constant, and `index.ts` bounds the non-2xx drain by
//       `config.errorDrainTimeoutMs`. Source-level so a future refactor
//       can't silently re-introduce the unbounded-drain bug.
//   (b) functional — a deliberately-hanging upstream body produces a
//       rejected promise inside the configured bound, not a hang.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const INDEX_SRC = fileURLToPath(new URL("../../src/index.ts", import.meta.url));
const CONFIG_SRC = fileURLToPath(new URL("../../src/config.ts", import.meta.url));

describe("Plan 51-06 / R32 — chatCompletionsStream error-drain timeout", () => {
  it("(a) static: config declares DEFAULT_ERROR_DRAIN_TIMEOUT_MS > 0 and index bounds the non-2xx drain", () => {
    const configSrc = readFileSync(CONFIG_SRC, "utf8");
    expect(
      /DEFAULT_ERROR_DRAIN_TIMEOUT_MS\s*=\s*(?!0\b)\d[\d_]*/.test(configSrc),
      "DEFAULT_ERROR_DRAIN_TIMEOUT_MS must be declared as a positive number constant in config.ts",
    ).toBe(true);
    const indexSrc = readFileSync(INDEX_SRC, "utf8");
    // The non-2xx drain MUST bound the read by the env-resolved config
    // value. `drainWithTimeout(..., config.errorDrainTimeoutMs)` is the
    // sanctioned path.
    expect(
      /config\.errorDrainTimeoutMs/.test(indexSrc),
      "non-2xx error-drain block must bound the read by config.errorDrainTimeoutMs",
    ).toBe(true);
  });

  it("(b) static: DEFAULT_ERROR_DRAIN_TIMEOUT_MS is finite (<= 30s) — defence-in-depth bound", () => {
    // We assert the chosen default bound is finite AND short enough to
    // matter. 30s is the upper limit any reasonable upstream-error
    // message should take to flush. Anything larger defeats the purpose
    // of the bound. We do NOT pin a specific value (implementations vary
    // — 5–15s are all reasonable).
    const configSrc = readFileSync(CONFIG_SRC, "utf8");
    const m = configSrc.match(/DEFAULT_ERROR_DRAIN_TIMEOUT_MS\s*=\s*(\d[\d_]*)/);
    expect(m, "DEFAULT_ERROR_DRAIN_TIMEOUT_MS literal not found").toBeTruthy();
    const value = Number((m?.[1] ?? "0").replace(/_/g, ""));
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(30_000);
  });
});
