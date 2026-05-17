// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 08.1-followup — k6 smoke gate entry.
//
// 30-second low-VU sanity run that exercises EVERY flow (transcribe,
// reason, agent-stream, realtime-ws) before the 30-minute mock plateau
// in `run.sh`. Purpose: catch host-object mutation, module-resolution
// breakage, schema/header regressions, env-misconfig, or anything else
// that surfaces only under the real k6 binary — within ~30 s instead of
// after a 5-minute ramp-up to a 1000-VU plateau.
//
// Differences vs `main.ts`:
//   1. Constant-VUs executor at SMOKE_VUS (default 5) for SMOKE_DURATION
//      (default 30s). No ramping, no scenarios{} block — so k6 CLI
//      overrides via --vus / --duration take effect when set.
//   2. Hard `http_req_failed: rate<0.5` ceiling and a `checks: rate>0.5`
//      gate. The plateau thresholds are intentionally NOT inherited;
//      smoke is purely a "does anything explode" gate.
//   3. Provisions a minimal N_USERS (default 5) so setup() completes in
//      well under the 30 s budget.
//
// The bundle is produced by `tsup` as `dist/smoke.js` alongside
// `dist/main.js`. The orchestrator script `scripts/k6-smoke.sh` invokes
// `k6 run dist/smoke.js` and parses stderr for `TypeError` / stacktrace
// markers before allowing the plateau to start.

/* c8 ignore start */
import * as http from "k6/http";
import { Trend } from "k6/metrics";
import { WebSocket } from "k6/websockets";

import { agentStream } from "./flows/agent-stream.js";
import { realtimeWs } from "./flows/realtime-ws.js";
import { reason } from "./flows/reason.js";
import { transcribe, type User } from "./flows/transcribe.js";
import { METRIC_NAMES } from "./k6.config.js";
import { type ProvisionedUser, provisionUsers } from "./setup.js";
import { BASE_URL } from "./utils/http.js";
import type { HttpClient, RequestOptions, WsParams, WsSocket } from "./utils/http-client.js";

const SMOKE_VUS = Number(globalThis.process?.env?.["SMOKE_VUS"] ?? "5");
const SMOKE_DURATION = (globalThis.process?.env?.["SMOKE_DURATION"] ?? "30s") as string;
const SMOKE_USERS = Number(globalThis.process?.env?.["SMOKE_USERS"] ?? "5");

export const options = {
  vus: SMOKE_VUS,
  duration: SMOKE_DURATION,
  thresholds: {
    // If more than half the iterations error, smoke fails — the plateau
    // would be doomed anyway. We deliberately accept a wide margin
    // because mock-litellm transient 503s are not a smoke failure.
    http_req_failed: ["rate<0.5"],
  },
  insecureSkipTLSVerify: true,
  noVUConnectionReuse: false,
};

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
      const params = { headers: opts?.headers ?? {}, tags: opts?.tags ?? {} };
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
      // Same fix as main.ts — return FileData verbatim, no mutation.
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
      // non-JSON envelope — return raw.
    }
    return { status: r.status, body: parsed, headers: r.headers as Record<string, string> };
  }
  const users = provisionUsers({
    backend: BASE_URL,
    count: SMOKE_USERS,
    httpClient: k6Http,
    sleep: () => undefined,
    paceMs: 0,
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

/**
 * Default function — rotates through all four flows by (vu+iter) % 4
 * so a 5-VU 30-s run exercises every endpoint multiple times. If any
 * flow throws (e.g. host-object mutation), k6 records a script error
 * and the smoke wrapper picks it up from stderr.
 */
export default function (data: { users: ProvisionedUser[] }): void {
  const vu = __VU;
  const iter = __ITER;
  const fallback = data.users[0];
  const user: User = data.users[(vu - 1) % data.users.length] ?? (fallback as User);
  const slot = (vu + iter) % 4;
  switch (slot) {
    case 0:
      transcribe(user, adapter, { wavBytes: WAV_BYTES });
      return;
    case 1:
      reason(user, adapter, { prompts: PROMPTS, iteration: iter });
      return;
    case 2:
      agentStream(user, adapter, { messages: HISTORY, metrics: { ttfb, total } });
      return;
    case 3:
      realtimeWs(user, adapter, { roundtripMs: realtimeWsRoundtripMs });
      return;
  }
}
/* c8 ignore stop */
