// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 08.5-02 / Task 2 — k6 baseline scenario options builder.
//
// Pure helper: no k6/* imports so vitest can drive it directly. baseline.ts
// (the k6 entrypoint) imports `buildOptions` and passes `__ENV as
// Record<string, string>`.
//
// Operator H100 re-run contract: the same buildOptions() output drives
// either the Mac shape (BASELINE_VUS=100, durations 5m/5m/2m total 12m)
// or the H100 plateau (BASELINE_VUS=1000, BASELINE_DURATION_SUSTAIN=20m).
// No production code or k6 bundle changes — only env values.

export interface BaselineStage {
  duration: string;
  target: number;
}

export interface BaselineThresholdEntry {
  threshold: string;
  abortOnFail: boolean;
}

export interface BaselineOptions {
  scenarios: {
    main: {
      executor: "ramping-vus";
      startVUs: number;
      stages: BaselineStage[];
      gracefulRampDown: string;
      gracefulStop: string;
    };
  };
  thresholds: Record<string, BaselineThresholdEntry[]>;
  insecureSkipTLSVerify: boolean;
  noVUConnectionReuse: boolean;
}

export function buildOptions(env: Record<string, string | undefined>): BaselineOptions {
  const vus = Number.parseInt(env.BASELINE_VUS ?? "100", 10);
  const rampup = env.BASELINE_DURATION_RAMPUP ?? "5m";
  const sustain = env.BASELINE_DURATION_SUSTAIN ?? "5m";
  const rampdown = env.BASELINE_DURATION_RAMPDOWN ?? "2m";

  return {
    scenarios: {
      main: {
        executor: "ramping-vus",
        startVUs: 0,
        stages: [
          { duration: rampup, target: vus },
          { duration: sustain, target: vus },
          { duration: rampdown, target: 0 },
        ],
        gracefulRampDown: "30s",
        gracefulStop: "30s",
      },
    },
    thresholds: {
      // Advisory ceilings per user directive — Mac numbers are
      // proof-of-wiring, not SLO targets. abortOnFail:false everywhere
      // so the run produces a complete summary even when CPU-bound
      // transcribe blows past the ceiling. Operator H100 re-run reads
      // the same thresholds and they are still valid (H100 always
      // beats Mac on transcribe; other flows are network-bound).
      //
      // 08.5-RESEARCH §Mac feasibility: Mac transcribe p95 in 8–20 s
      // range; 60 s ceiling catches "Speaches queue saturated" but
      // ignores normal CPU slowness.
      "http_req_duration{endpoint:transcribe}": [{ threshold: "p(95)<60000", abortOnFail: false }],
      "http_req_duration{endpoint:reason}": [{ threshold: "p(95)<10000", abortOnFail: false }],
      "http_req_duration{endpoint:agent-stream}": [
        { threshold: "p(95)<15000", abortOnFail: false },
      ],
      // 08.5-RESEARCH §G14: under real OpenAI Realtime the first
      // inbound frame is `session.created` (sent by server immediately
      // on upgrade, before client send). realtime_ws_roundtrip_ms
      // becomes semantically "upgrade-to-first-server-frame" — still a
      // legitimate SLO signal but documented as such.
      "realtime_ws_roundtrip_ms{endpoint:realtime-ws}": [
        { threshold: "p(95)<5000", abortOnFail: false },
      ],
      http_req_failed: [{ threshold: "rate<0.20", abortOnFail: false }],
    },
    insecureSkipTLSVerify: true,
    noVUConnectionReuse: false,
  };
}
