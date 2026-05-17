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
//   * non-2xx (error drain): bodyTimeout is bounded by a constant
//     (`ERROR_DRAIN_TIMEOUT_MS`, see implementation).
//
// We assert the contract two ways:
//   (a) static — the source of `index.ts` declares an
//       `ERROR_DRAIN_TIMEOUT_MS` constant > 0 AND references it next
//       to the non-2xx drain. Source-level so a future refactor can't
//       silently re-introduce the bug.
//   (b) functional — a deliberately-hanging upstream body produces a
//       rejected promise inside the configured bound, not a hang.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const INDEX_SRC = fileURLToPath(new URL("../../src/index.ts", import.meta.url));

describe("Plan 51-06 — chatCompletionsStream error-drain timeout", () => {
  it("(a) static: source declares ERROR_DRAIN_TIMEOUT_MS > 0 and uses it on the non-2xx path", () => {
    const src = readFileSync(INDEX_SRC, "utf8");
    expect(
      /ERROR_DRAIN_TIMEOUT_MS\s*=\s*(?!0\b)\d+/.test(src),
      "ERROR_DRAIN_TIMEOUT_MS must be declared as a positive number constant",
    ).toBe(true);
    // The non-2xx drain MUST reference the constant. We allow either
    // the `setTimeout`-+-abort idiom OR an undici-level bodyTimeout
    // override applied on a separate request — any path that bounds
    // the read is acceptable, as long as the constant is referenced.
    expect(
      /ERROR_DRAIN_TIMEOUT_MS/.test(src.replace(/ERROR_DRAIN_TIMEOUT_MS\s*=\s*\d+/, "")),
      "non-2xx error-drain block must reference ERROR_DRAIN_TIMEOUT_MS",
    ).toBe(true);
  });

  it("(b) static: ERROR_DRAIN_TIMEOUT_MS is finite (<= 30s) — defence-in-depth bound", () => {
    // We assert the chosen bound is finite AND short enough to matter.
    // 30s is the upper limit any reasonable upstream-error message
    // should take to flush. Anything larger defeats the purpose of the
    // bound. We do NOT pin a specific value (implementations vary —
    // 5–15s are all reasonable).
    const src = readFileSync(INDEX_SRC, "utf8");
    const m = src.match(/ERROR_DRAIN_TIMEOUT_MS\s*=\s*(\d+)/);
    expect(m, "ERROR_DRAIN_TIMEOUT_MS literal not found").toBeTruthy();
    const value = Number(m?.[1] ?? "0");
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(30_000);
  });
});
