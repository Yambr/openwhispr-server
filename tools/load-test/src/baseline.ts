// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 08.5-02 / Task 2 — k6 entrypoint for the realistic-profile Mac
// baseline (and the operator H100 re-run).
//
// Diverges from src/main.ts ONLY in the options block + N_USERS source:
//   * options = buildOptions(__ENV) — env-driven, Mac-safe defaults
//     (100 VU × 12m = 5m + 5m + 2m), operator H100 sets BASELINE_VUS=1000
//     + BASELINE_DURATION_SUSTAIN=20m to get the H100 plateau shape.
//   * N_USERS = BASELINE_VUS (NOT the locked 1000 from k6.config.ts —
//     Mac shape pre-provisions 100 users; H100 re-run pre-provisions 1000).
//
// 08.5-RESEARCH §G8 — operator H100 re-run path: same bundle, same
// flows, same setup/teardown; only env values change. Do not refactor
// shared code between this file and main.ts — diff is intentional.
//
// 08.5-RESEARCH §G14 — under real OpenAI Realtime the first inbound
// WS frame is `session.created` emitted by the server immediately on
// upgrade. realtime_ws_roundtrip_ms semantically becomes
// "upgrade-to-first-server-frame" under the realistic profile, but no
// behavioural change is needed — the metric is still a legitimate SLO
// signal.

/* c8 ignore start */
// k6 runtime imports — resolved by k6 at script init, not by Node.
import * as http from "k6/http";
import { Trend } from "k6/metrics";
import { WebSocket } from "k6/websockets";

import { buildOptions } from "./baseline-options.js";
import { agentStream } from "./flows/agent-stream.js";
import { realtimeWs } from "./flows/realtime-ws.js";
import { reason } from "./flows/reason.js";
import { transcribe, type User } from "./flows/transcribe.js";
import { METRIC_NAMES } from "./k6.config.js";
import { pick } from "./scenario-picker.js";
import { type ProvisionedUser, provisionUsers } from "./setup.js";
import { BASE_URL } from "./utils/http.js";
import type { HttpClient, RequestOptions, WsParams, WsSocket } from "./utils/http-client.js";

// k6 injects __ENV at runtime as Record<string, string>. We pass it
// through to buildOptions which returns the full options object below.
declare const __ENV: Record<string, string>;
declare const __VU: number;
declare const __ITER: number;

export const options = buildOptions(__ENV as Record<string, string | undefined>);

// Mac-safe default; operator H100 re-run sets BASELINE_VUS=1000.
const BASELINE_VUS = Number.parseInt(__ENV.BASELINE_VUS ?? "100", 10);

// Per-iteration custom metrics (matching main.ts so Mimir/k6 summaries
// use identical labels — operator H100 numbers can be compared apples-
// to-apples against Mac).
const ttfb = new Trend(METRIC_NAMES.agentStreamTtfb);
const total = new Trend(METRIC_NAMES.agentStreamTotal);
const realtimeWsRoundtripMs = new Trend(METRIC_NAMES.realtimeWsRoundtripMs);

const WAV_BYTES = open("./fixtures/sample-5s-16k.wav", "b") as unknown as Uint8Array;
const PROMPTS = JSON.parse(open("./fixtures/prompt-strings.json")) as string[];
const HISTORY = JSON.parse(open("./fixtures/conversation-history.json")) as Array<{
  role: string;
  content: string;
}>;

function k6Adapter(): HttpClient {
  return {
    request(method: string, url: string, body: unknown, opts?: RequestOptions) {
      const params = {
        headers: opts?.headers ?? {},
        tags: opts?.tags ?? {},
      };
      return http.request(
        method,
        url,
        body as unknown as Parameters<typeof http.request>[2],
        params,
      ) as unknown as ReturnType<HttpClient["request"]>;
    },
    ws(url: string, params: WsParams, handler: (socket: WsSocket) => void) {
      const sock = new WebSocket(url, undefined, params) as unknown as WsSocket;
      handler(sock);
      return { status: 101 };
    },
    httpFile(bytes: Uint8Array, filename: string, contentType: string) {
      return http.file(bytes.buffer as ArrayBuffer, filename, contentType) as unknown as ReturnType<
        HttpClient["httpFile"]
      >;
    },
  };
}

export function setup(): { users: ProvisionedUser[] } {
  function k6Http(
    url: string,
    body: unknown,
  ): { status: number; body: unknown; headers: Record<string, string> } {
    const HttpAny = http as unknown as { CookieJar: new () => unknown };
    const jar = new HttpAny.CookieJar();
    const r = http.post(url, JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      jar: jar as Parameters<typeof http.post>[2] extends infer P
        ? P extends { jar?: infer J }
          ? J
          : never
        : never,
    });
    let parsed: unknown = r.body;
    try {
      parsed = typeof r.body === "string" ? JSON.parse(r.body) : r.body;
    } catch {
      // body might be a non-JSON error envelope — return raw.
    }
    return { status: r.status, body: parsed, headers: r.headers as Record<string, string> };
  }
  function k6Sleep(_ms: number): void {
    // setup() runs once; intra-loop sleep not required.
  }
  const users = provisionUsers({
    backend: BASE_URL,
    count: BASELINE_VUS,
    httpClient: k6Http,
    sleep: k6Sleep,
    paceMs: 50,
  });
  return { users };
}

export function teardown(data: { users: ProvisionedUser[] }): void {
  for (const user of data.users) {
    http.del(`${BASE_URL}/api/auth/delete-account`, undefined, {
      headers: { authorization: `Bearer ${user.token}` },
      tags: { endpoint: "teardown" },
    });
  }
}

const adapter = k6Adapter();

export default function (data: { users: ProvisionedUser[] }): void {
  const vu = __VU;
  const iter = __ITER;
  const fallback = data.users[0];
  const user: User = data.users[(vu - 1) % data.users.length] ?? (fallback as User);
  const endpoint = pick();
  switch (endpoint) {
    case "transcribe":
      transcribe(user, adapter, { wavBytes: WAV_BYTES });
      return;
    case "reason":
      reason(user, adapter, { prompts: PROMPTS, iteration: iter });
      return;
    case "agent-stream":
      agentStream(user, adapter, {
        messages: HISTORY,
        metrics: { ttfb, total },
      });
      return;
    case "realtime-ws":
      realtimeWs(user, adapter, { roundtripMs: realtimeWsRoundtripMs });
      return;
  }
}
/* c8 ignore stop */
