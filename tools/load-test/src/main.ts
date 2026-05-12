// Phase 08 / Plan 06 — Task 3: k6 entrypoint.
//
// This file is excluded from vitest coverage (vitest.config.ts) because
// it imports k6 runtime globals (`k6/http`, `k6/websockets`, `k6/metrics`,
// `k6/encoding`) that Node cannot resolve. Its constituents — the
// scenario picker, flows, setup, http-client adapter — are all covered
// individually by their own unit-tested modules.
//
// The bundle produced by tsup is what k6 actually loads at runtime.
// tsup keeps the `k6/*` modules as bare imports (configured in
// tsup.config.ts `external: [...]`) so k6's VM injects them at script
// init.

/* c8 ignore start */
// k6 runtime imports — resolved by k6 at script init, not by Node.
import * as http from "k6/http";
import { Trend } from "k6/metrics";
import { WebSocket } from "k6/websockets";

import { agentStream } from "./flows/agent-stream.js";
import { realtimeWs } from "./flows/realtime-ws.js";
import { reason } from "./flows/reason.js";
import { transcribe, type User } from "./flows/transcribe.js";
import { METRIC_NAMES, N_USERS, STAGES, THRESHOLDS } from "./k6.config.js";
import { pick } from "./scenario-picker.js";
import { type ProvisionedUser, provisionUsers } from "./setup.js";
import { BASE_URL } from "./utils/http.js";
import type { HttpClient, RequestOptions, WsParams, WsSocket } from "./utils/http-client.js";

// Locked k6 options. The ramping-vus executor matches D-LOAD-2; the
// per-endpoint thresholds tag-filter on `endpoint:<name>`. `insecureSkipTLSVerify`
// is scoped to the load-test harness only (CONTEXT.md D-TLS-1).
export const options = {
  scenarios: {
    main: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: STAGES,
      gracefulRampDown: "30s",
      gracefulStop: "30s",
    },
  },
  thresholds: THRESHOLDS,
  insecureSkipTLSVerify: true,
  noVUConnectionReuse: false,
};

// Per-iteration metrics for the streaming flow (RESEARCH.md §Pitfall 6).
const ttfb = new Trend(METRIC_NAMES.agentStreamTtfb);
const total = new Trend(METRIC_NAMES.agentStreamTotal);

// WAV fixture loaded once at script init. k6's `open()` is a build-time
// API — the file is embedded into the bundle's runtime closure. The
// global is declared by @types/k6 so no cast is needed.
const WAV_BYTES = open("./fixtures/sample-5s-16k.wav", "b") as unknown as Uint8Array;
const PROMPTS = JSON.parse(open("./fixtures/prompt-strings.json")) as string[];
const HISTORY = JSON.parse(open("./fixtures/conversation-history.json")) as Array<{
  role: string;
  content: string;
}>;

/** The k6-runtime HTTP/WS adapter. Lives inline so tsup keeps the
 * `k6/http` + `k6/websockets` imports as the bundle's externals. */
function k6Adapter(): HttpClient {
  return {
    request(method: string, url: string, body: unknown, opts?: RequestOptions) {
      const params = {
        headers: opts?.headers ?? {},
        tags: opts?.tags ?? {},
      };
      // k6's http.request signature: (method, url, body, params)
      // The body shape is widened to `unknown` because k6's RequestBody
      // type forbids `unknown` but accepts Uint8Array | string | object.
      return http.request(
        method,
        url,
        body as unknown as Parameters<typeof http.request>[2],
        params,
      ) as unknown as ReturnType<HttpClient["request"]>;
    },
    ws(url: string, params: WsParams, handler: (socket: WsSocket) => void) {
      // k6's WebSocket constructor: new WebSocket(url, protocols?, params?).
      // We pass an undefined protocols list to fall through to params.
      const sock = new WebSocket(url, undefined, params) as unknown as WsSocket;
      handler(sock);
      return { status: 101 };
    },
  };
}

/**
 * k6 setup() — runs once on the runner before VUs spin up. Pre-creates
 * N_USERS via Better Auth so the steady-state plateau never spawns a
 * sign-up storm.
 */
export function setup(): { users: ProvisionedUser[] } {
  function k6Http(
    url: string,
    body: unknown,
  ): { status: number; body: unknown; headers: Record<string, string> } {
    const r = http.post(url, JSON.stringify(body), {
      headers: { "content-type": "application/json" },
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
    // k6's `sleep(seconds)` lives on the global; we don't bind it here
    // because setup() runs only once and 1000 * 50 ms = 50 s is fine
    // even without intra-loop sleep. The provisioner sleeps anyway
    // via its injected hook.
  }
  const users = provisionUsers({
    backend: BASE_URL,
    count: N_USERS,
    httpClient: k6Http,
    sleep: k6Sleep,
    paceMs: 50,
  });
  return { users };
}

/**
 * k6 teardown() — runs once after the last VU iteration. Best-effort
 * delete of every provisioned account so a re-run does not leave
 * thousands of orphan users in the database (T-08-03).
 */
export function teardown(data: { users: ProvisionedUser[] }): void {
  for (const user of data.users) {
    http.del(`${BASE_URL}/api/auth/delete-account`, undefined, {
      headers: { authorization: `Bearer ${user.token}` },
      tags: { endpoint: "teardown" },
    });
  }
}

const adapter = k6Adapter();

/** k6 default function — invoked per VU iteration. */
export default function (data: { users: ProvisionedUser[] }): void {
  // k6's @types/k6 declares __VU and __ITER as `var` on the global.
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
      realtimeWs(user, adapter);
      return;
  }
}
/* c8 ignore stop */
