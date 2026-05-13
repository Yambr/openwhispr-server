// SPDX-License-Identifier: Apache-2.0
// Phase 08 / Plan 06 — Task 2 GREEN: agent-stream flow.
//
// POSTs to /api/agent/stream and records TWO metrics:
//   * agent_stream_ttfb  — server time-to-first-byte (k6 `timings.waiting`).
//   * agent_stream_total — full request duration (k6 `timings.duration`).
//
// This split is mandatory (RESEARCH.md §Pitfall 6) because the SLO
// review in plan 07 reports TTFB separately from total latency —
// collapsing them into one metric makes a slow-stream-but-fast-TTFB
// (or vice-versa) regression invisible.

import { updateBearer } from "../utils/auth.js";
import { BASE_URL } from "../utils/http.js";
import type { HttpClient } from "../utils/http-client.js";
import type { User } from "./transcribe.js";

/**
 * The minimal Trend surface our flow consumes — k6 ships
 * `new Trend('name')` which has `.add(value)`. The tests inject a
 * vi.fn() so we never depend on the real Trend implementation here.
 */
export interface TrendLike {
  add(value: number): void;
}

export interface AgentStreamDeps {
  messages: ReadonlyArray<{ role: string; content: string }>;
  metrics: {
    ttfb: TrendLike;
    total: TrendLike;
  };
  /** Model id; defaults to the canonical mid-size streaming model. */
  model?: string;
}

const DEFAULT_MODEL = "openrouter/anthropic/claude-haiku-4.5";

export function agentStream(user: User, client: HttpClient, deps: AgentStreamDeps): void {
  // Plan 08.1-01 Task 2 root-cause fix: api/agent/stream reads `req.body`
  // through Fastify's JSON body parser — which fires only when
  // `content-type: application/json` is on the request. The previous
  // envelope omitted the header, so k6 form-urlencoded the body and
  // Fastify treated `req.body` as empty → empty messages → upstream
  // 400 → finish chunk `{finishReason: 'upstream_error'}` on every iter.
  //
  // We also JSON.stringify the body explicitly so the on-wire bytes are
  // deterministic regardless of k6's body-marshaling heuristics.
  const body = JSON.stringify({
    model: deps.model ?? DEFAULT_MODEL,
    messages: deps.messages,
    stream: true,
  });
  const response = client.request("POST", `${BASE_URL}/api/agent/stream`, body, {
    headers: {
      authorization: `Bearer ${user.token}`,
      "content-type": "application/json",
      accept: "application/x-ndjson",
    },
    tags: { endpoint: "agent-stream" },
  });
  updateBearer(user, response);
  deps.metrics.ttfb.add(response.timings.waiting);
  deps.metrics.total.add(response.timings.duration);
}
