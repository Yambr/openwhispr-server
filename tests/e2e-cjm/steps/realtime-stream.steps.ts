// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 29 / Plan 29-01 — @cjm-11.* realtime WSS steps (G4 closure).
//
// Per `feedback_cjm_steps_need_unit_tests`: sibling vitest coverage at
// `__tests__/realtime-stream.steps.test.ts`.

import { Agent, setGlobalDispatcher, WebSocket } from "undici";

import { expect, freshTenant, Given, signedInAs, Then, When } from "../support/fixtures";

// Allow self-signed mkcert certs for *.localhost dev wiring.
setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

interface ScenarioState {
  cookie?: string;
  framesReceived: unknown[];
  closeCode?: number;
  ws?: WebSocket;
}

const state = new Map<string, ScenarioState>();

function stateFor(scenarioTenantId: string): ScenarioState {
  let s = state.get(scenarioTenantId);
  if (!s) {
    s = { framesReceived: [] };
    state.set(scenarioTenantId, s);
  }
  return s;
}

/**
 * Open a WSS to /v1/realtime, optionally with a cookie header, and
 * resolve with `{frames, closeCode}` once the close handler fires or
 * the timeout elapses. The cookie is sent via the WebSocket constructor's
 * `headers` option (undici extension).
 */
export async function openRealtime(
  wssUrl: string,
  cookie: string | undefined,
  opts: { maxWaitMs: number; closeAfterFirstFrame: boolean },
): Promise<{ frames: unknown[]; closeCode: number; firstFrameTimeMs: number }> {
  const frames: unknown[] = [];
  let firstFrameTime = -1;
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    // undici's WebSocket honours a `headers` option (RFC-compliant
    // upgrade); the bare WHATWG type does not. Cast as any only here.
    const ws = new WebSocket(wssUrl, { headers } as never);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* socket already torn down */
      }
      resolve({ frames, closeCode: 4000, firstFrameTimeMs: -1 });
    }, opts.maxWaitMs);
    ws.addEventListener("message", (ev: { data: unknown }) => {
      if (firstFrameTime < 0) firstFrameTime = Date.now() - start;
      try {
        frames.push(JSON.parse(String(ev.data)));
      } catch {
        frames.push(ev.data);
      }
      if (opts.closeAfterFirstFrame) {
        try {
          ws.close(1000, "client-close");
        } catch {
          /* socket already torn down */
        }
      }
    });
    ws.addEventListener("close", (ev: { code: number }) => {
      clearTimeout(timer);
      resolve({ frames, closeCode: ev.code, firstFrameTimeMs: firstFrameTime });
    });
    ws.addEventListener("error", () => {
      // Some clients deliver only `error` without a `close`. Wait for
      // the timeout to surface the failure rather than reject early —
      // close handler is canonical.
    });
  });
}

Given("a signed-in user", async function (this, ctx) {
  const { apiBaseURL, mailpitApiUrl, tenantId } = ctx as {
    apiBaseURL: string;
    mailpitApiUrl: string;
    tenantId: string;
  };
  const s = stateFor(tenantId);
  const id = freshTenant(tenantId);
  s.cookie = await signedInAs(apiBaseURL, mailpitApiUrl, id);
});

When(
  "the user opens wss:\\/\\/api.localhost:8443\\/v1\\/realtime with the session cookie",
  async function (this, ctx) {
    const { tenantId } = ctx as { tenantId: string };
    const s = stateFor(tenantId);
    const res = await openRealtime("wss://api.localhost:8443/v1/realtime", s.cookie, {
      maxWaitMs: 5_000,
      closeAfterFirstFrame: true,
    });
    s.framesReceived = res.frames;
    s.closeCode = res.closeCode;
  },
);

When(
  "wss:\\/\\/api.localhost:8443\\/v1\\/realtime is opened WITHOUT any bearer or cookie",
  async function (this, ctx) {
    const { tenantId } = ctx as { tenantId: string };
    const s = stateFor(tenantId);
    const res = await openRealtime("wss://api.localhost:8443/v1/realtime", undefined, {
      maxWaitMs: 3_000,
      closeAfterFirstFrame: false,
    });
    s.framesReceived = res.frames;
    s.closeCode = res.closeCode;
  },
);

Then(
  "the server sends at least one frame within {int} seconds",
  async function (this, ctx, _seconds: number) {
    const { tenantId } = ctx as { tenantId: string };
    const s = stateFor(tenantId);
    expect(s.framesReceived.length).toBeGreaterThanOrEqual(1);
  },
);

Then("the client closes the session", async function (this, ctx) {
  // The When step already closed; this is a narrative beat.
  const { tenantId } = ctx as { tenantId: string };
  void stateFor(tenantId);
});

Then("the close code is 1000 or 1005", async function (this, ctx) {
  const { tenantId } = ctx as { tenantId: string };
  const code = stateFor(tenantId).closeCode ?? -1;
  expect([1000, 1005]).toContain(code);
});

Then("the connection closes with code 4401 or 4403 or 1008 or 1006", async function (this, ctx) {
  const { tenantId } = ctx as { tenantId: string };
  const code = stateFor(tenantId).closeCode ?? -1;
  expect([4401, 4403, 1008, 1006]).toContain(code);
});

Then("no application frame was received before the close", async function (this, ctx) {
  const { tenantId } = ctx as { tenantId: string };
  expect(stateFor(tenantId).framesReceived.length).toBe(0);
});
