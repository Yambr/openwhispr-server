// Phase 08.5-02 / Task 1 — RED: baseline scenario shape assertions.
//
// baseline-options.ts is a thin pure helper (no k6/* imports) that
// computes the k6 options object from __ENV. baseline.ts (Wave 2 Task 2)
// passes `__ENV as Record<string, string>` to it and exports the result.
//
// Operator H100 re-run contract: setting BASELINE_VUS=1000 and
// BASELINE_DURATION_SUSTAIN=20m produces the H100 plateau shape from
// the same TypeScript source as the Mac shape — only env values change.
import { describe, expect, it } from "vitest";

import { buildOptions } from "./baseline-options.js";

const EMPTY: Record<string, string | undefined> = {};

interface K6StageLike {
  duration: string;
  target: number;
}

interface ThresholdEntry {
  threshold: string;
  abortOnFail: boolean;
}

interface BaselineOptions {
  scenarios: {
    main: {
      executor: string;
      stages: K6StageLike[];
    };
  };
  thresholds: Record<string, ThresholdEntry[]>;
}

function parseDuration(s: string): number {
  // Supports "5m", "30s", "2m" — same shapes the k6 stages use.
  const match = /^(\d+)([sm])$/.exec(s);
  if (!match) throw new Error(`unparseable duration: ${s}`);
  const n = Number(match[1]);
  return match[2] === "m" ? n * 60 : n;
}

describe("baseline-options — Phase 08.5-02", () => {
  it("uses the ramping-vus executor", () => {
    const opts = buildOptions(EMPTY) as BaselineOptions;
    expect(opts.scenarios.main.executor).toBe("ramping-vus");
  });

  it("default stages sum to 12 minutes (5m + 5m + 2m)", () => {
    const opts = buildOptions(EMPTY) as BaselineOptions;
    expect(opts.scenarios.main.stages).toHaveLength(3);
    const totalSec = opts.scenarios.main.stages
      .map((s) => parseDuration(s.duration))
      .reduce((a, b) => a + b, 0);
    expect(totalSec).toBe(12 * 60);
  });

  it("default plateau target is 100 VUs (mac-safe baseline)", () => {
    const opts = buildOptions(EMPTY) as BaselineOptions;
    // First stage ramps to plateau; second stage holds; third ramps to 0.
    expect(opts.scenarios.main.stages[0]?.target).toBe(100);
    expect(opts.scenarios.main.stages[1]?.target).toBe(100);
    expect(opts.scenarios.main.stages[2]?.target).toBe(0);
  });

  it("transcribe threshold is advisory (abortOnFail:false, ceiling ≥ 60000 ms)", () => {
    const opts = buildOptions(EMPTY) as BaselineOptions;
    const key = "http_req_duration{endpoint:transcribe}";
    const entries = opts.thresholds[key];
    expect(entries).toBeDefined();
    expect(entries?.[0]?.abortOnFail).toBe(false);
    // Mac transcribe p95 can land in the 8–20 s range (08.5-RESEARCH
    // §Mac feasibility) — ceiling MUST be generous so the run does not
    // abort on normal CPU slowness.
    const ceilingMs = Number(/p\(95\)<(\d+)/.exec(entries?.[0]?.threshold ?? "")?.[1] ?? "0");
    expect(ceilingMs).toBeGreaterThanOrEqual(60000);
  });

  it("operator H100 shape: BASELINE_VUS=1000, BASELINE_DURATION_SUSTAIN=20m", () => {
    const opts = buildOptions({
      BASELINE_VUS: "1000",
      BASELINE_DURATION_SUSTAIN: "20m",
    }) as BaselineOptions;
    expect(opts.scenarios.main.stages[0]?.target).toBe(1000);
    expect(opts.scenarios.main.stages[1]?.target).toBe(1000);
    expect(opts.scenarios.main.stages[1]?.duration).toBe("20m");
    expect(opts.scenarios.main.stages[2]?.target).toBe(0);
  });

  it("all four flow thresholds are advisory (abortOnFail:false)", () => {
    const opts = buildOptions(EMPTY) as BaselineOptions;
    for (const key of [
      "http_req_duration{endpoint:transcribe}",
      "http_req_duration{endpoint:reason}",
      "http_req_duration{endpoint:agent-stream}",
      "realtime_ws_roundtrip_ms{endpoint:realtime-ws}",
    ]) {
      const entries = opts.thresholds[key];
      expect(entries, `threshold ${key} present`).toBeDefined();
      expect(entries?.[0]?.abortOnFail).toBe(false);
    }
  });
});
