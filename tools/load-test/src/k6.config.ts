// SPDX-License-Identifier: Apache-2.0
// Phase 08 / Plan 06 — Task 3: k6 run-time configuration constants.
//
// Pure constants imported by main.ts. Keeping them here (a non-runtime
// file from k6's point of view — just plain ES module exports) means
// other config can be tweaked without touching the main.ts options /
// scenarios / default function logic.
//
// Values flow from CONTEXT.md decisions:
//   * D-LOAD-1   — 1000 concurrent VUs at the steady-state plateau.
//   * D-LOAD-2   — 5 m ramp-up / 20 m sustained / 5 m ramp-down.
//   * D-SLO-1    — Generous baseline thresholds; the *enforcement* SLO
//                  table lives in plan 07 and is computed FROM the run,
//                  not pre-asserted by k6.
//   * D-USERS    — 1000 pre-provisioned users (one per VU).

import { BASE_URL } from "./utils/http.js";

/** Number of pre-provisioned users (one per VU at steady state). */
export const N_USERS = 1000;

/** Re-export so all main.ts logic can pull constants from one place. */
export { BASE_URL };

/** Stage definitions for k6's ramping-vus executor. */
export const STAGES = [
  { duration: "5m", target: 1000 },
  { duration: "20m", target: 1000 },
  { duration: "5m", target: 0 },
] as const;

/**
 * Threshold map per endpoint. Values are GENEROUS baselines that act as
 * "did anything catastrophically regress?" smoke gates — they MUST NOT
 * be used to assert the production SLO budget (that is plan 07's job).
 * The thresholds tag-filter on `endpoint:<name>` so per-endpoint p95 is
 * attributed independently in Mimir.
 */
export const THRESHOLDS = {
  "http_req_duration{endpoint:transcribe}": ["p(95)<10000"],
  "http_req_duration{endpoint:reason}": ["p(95)<10000"],
  "http_req_duration{endpoint:agent-stream}": ["p(95)<15000"],
  agent_stream_ttfb: ["p(95)<3000"],
  // realtime-ws does not emit http_req_duration; we publish a custom Trend
  // `realtime_ws_roundtrip_ms` from the flow because the auto-emitted
  // iteration_duration captures the callback-return moment, not the
  // round-trip (k6/websockets addEventListener is async — plan 08-07
  // recorded p95=0 for this metric). Plan 08.1-01 Task 3 fix.
  "realtime_ws_roundtrip_ms{endpoint:realtime-ws}": ["p(95)<5000"],
  // Global error-rate guard rail.
  http_req_failed: ["rate<0.05"],
};

/** k6 metric names so the flows + main agree on the label. */
export const METRIC_NAMES = {
  agentStreamTtfb: "agent_stream_ttfb",
  agentStreamTotal: "agent_stream_total",
  realtimeWsRoundtripMs: "realtime_ws_roundtrip_ms",
} as const;
