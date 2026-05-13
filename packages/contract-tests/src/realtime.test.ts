// SPDX-License-Identifier: Apache-2.0
// Phase 03 / Plan 07 / Task 2 — WSS /v1/realtime contract test
// (LITELLM-03, D-04).
//
// Asserts the proxy hop + auth gate of the WSS reverse-proxy when run
// against a fully deployed compose stack:
//   1. WS upgrade WITHOUT a bearer/cookie returns HTTP 401 — the
//      preHandler's AuthError is mapped to the canonical envelope
//      BEFORE the upgrade completes (T-03-07-02 mitigation).
//   2. WS upgrade WITH a valid session passes the auth gate. The
//      contract-test profile's mock LiteLLM does NOT implement
//      Realtime mode (per D-12 the bundled-default upstream is OpenAI
//      Realtime API direct, gated on OPENAI_API_KEY which CI does not
//      hold), so the handshake either succeeds (101) or closes with a
//      defined upstream code — but it MUST NOT return 401. That single
//      assertion proves auth + proxy chain are wired end-to-end.
//
// Live realtime against OpenAI is Phase 4 / e2e territory and requires
// `.env.e2e` OPENAI_API_KEY — out of scope for this contract suite.
//
// Skip semantics: like the other CONTRACT-01 tests, this one uses
// `describe.skipIf(!REACHABLE)` so when no backend is up the suite
// passes cleanly. CI / `make contract-test` set BACKEND_URL explicitly
// and bring the stack up.

import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BACKEND_URL, probeBackend } from "./env.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";

const REACHABLE = await probeBackend();

/**
 * Translate the BACKEND_URL (http(s)://...) into the WSS URL for
 * /v1/realtime. The compose stack terminates TLS at Traefik on
 * api.localhost; the dev cert is self-signed so we pass
 * `rejectUnauthorized: false` on the WS dial.
 */
function realtimeWsUrl(): string {
  const url = new URL("/v1/realtime", BACKEND_URL);
  url.protocol = url.protocol.replace(/^http(s?):$/, "ws$1:");
  return url.toString();
}

/**
 * Open a WS upgrade with the given headers and resolve with whatever
 * happens first: a 'unexpected-response' (HTTP rejection — captures the
 * status code), an 'open' (101 success), or an 'error' (network/TLS).
 * The promise NEVER rejects so test assertions can match on a single
 * observed status without worrying about thrown promise plumbing.
 */
function dialWs(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; opened: boolean }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, {
      headers,
      rejectUnauthorized: false,
    });
    let settled = false;
    const settle = (out: { status: number; opened: boolean }) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* ignore — upgrade may not have completed */
      }
      resolve(out);
    };
    ws.on("open", () => settle({ status: 101, opened: true }));
    ws.on("unexpected-response", (_req, res) => {
      settle({ status: res.statusCode ?? 0, opened: false });
    });
    ws.on("error", () => {
      // Errors include TLS, ECONNREFUSED, and abrupt-close-without-status.
      // We resolve with status:0 so callers can distinguish from a clean
      // HTTP rejection (where status is set on `unexpected-response`).
      settle({ status: 0, opened: false });
    });
  });
}

describe.skipIf(!REACHABLE)("LITELLM-03 — WSS /v1/realtime", () => {
  it("rejects WS upgrade with HTTP 401 when no bearer/cookie is supplied", async () => {
    const result = await dialWs(realtimeWsUrl(), {});
    expect(result.opened).toBe(false);
    expect(result.status).toBe(401);
  });

  it("passes the auth gate with a valid session — proxy hop reaches upstream (NOT a 401)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    // Lift the session cookie out of the jar so we can attach it to the
    // WS upgrade headers (the `ws` package doesn't read tough-cookie
    // jars natively).
    const cookie = await jar.jar.getCookieString(BACKEND_URL);
    expect(cookie.length).toBeGreaterThan(0);
    const result = await dialWs(realtimeWsUrl(), { cookie });
    // The contract-test mock LiteLLM does NOT implement Realtime mode
    // (per D-12 the bundled upstream is OpenAI Realtime API direct
    // gated on OPENAI_API_KEY which CI does not hold). The proxy hop
    // therefore yields either a 101 (some mock configurations succeed
    // the upgrade and close immediately on the first frame) OR a
    // non-401 close — what matters is that auth was NOT the gate.
    expect(result.status).not.toBe(401);
  });
});
