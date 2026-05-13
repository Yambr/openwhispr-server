// SPDX-License-Identifier: Apache-2.0
// tests/e2e/realtime — host-side e2e for WSS /v1/realtime.
//
// LiteLLM v1.83.x does NOT honor `mock_response` for `mode: realtime`
// model entries — the WSS upgrade short-circuits before the mock layer
// is consulted (verified against litellm_config.contract.yaml comment).
// The hermetic e2e therefore asserts only the auth gate + proxy-hop
// behavior:
//
//   1. WS upgrade WITHOUT a bearer/cookie returns HTTP 401 — the
//      preHandler maps AuthError to the canonical envelope BEFORE the
//      upgrade completes.
//   2. WS upgrade WITH a valid session reaches LiteLLM. The upstream
//      either accepts the upgrade and immediately closes (no real
//      provider behind the mock entry), or rejects with a non-401
//      status. EITHER OUTCOME PROVES the auth + proxy chain is wired —
//      what matters is that auth was NOT the gate.
//
// Live realtime against OpenAI (D-12) is `make e2e-test` territory and
// requires OPENAI_API_KEY in `.env.e2e`.

import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

function realtimeWsUrl(): string {
  const url = new URL("/v1/realtime", BACKEND_URL);
  url.protocol = url.protocol.replace(/^http(s?):$/, "ws$1:");
  return url.toString();
}

interface DialResult {
  status: number;
  opened: boolean;
  closeCode?: number;
}

function dialWs(url: string, headers: Record<string, string>): Promise<DialResult> {
  return new Promise((resolveResult) => {
    const ws = new WebSocket(url, {
      headers,
      rejectUnauthorized: false, // self-signed dev cert at Traefik
    });
    let settled = false;
    let opened = false;
    const settle = (out: DialResult) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolveResult(out);
    };
    ws.on("open", () => {
      opened = true;
      // Don't settle yet — wait for the immediate close so we can
      // capture the upstream close code.
    });
    ws.on("close", (code) => {
      if (opened) settle({ status: 101, opened: true, closeCode: code });
    });
    ws.on("unexpected-response", (_req, res) => {
      settle({ status: res.statusCode ?? 0, opened: false });
    });
    ws.on("error", () => {
      // Network/TLS/abrupt-close-without-status. status:0 distinguishes
      // from a clean HTTP rejection (where status is set on
      // `unexpected-response`).
      if (!opened) settle({ status: 0, opened: false });
    });
    // Watchdog — Traefik streaming idle timeout is 180s but our
    // assertion completes once we observe a definitive outcome.
    setTimeout(() => settle({ status: opened ? 101 : -1, opened }), 15_000);
  });
}

describe("e2e — WSS /v1/realtime (hermetic auth-gate + proxy-hop)", () => {
  it("rejects WS upgrade with HTTP 401 when no bearer/cookie supplied", async () => {
    const result = await dialWs(realtimeWsUrl(), {});
    expect(result.opened).toBe(false);
    expect(result.status).toBe(401);
  });

  it("passes auth gate with a valid session — proxy hop reaches upstream (NOT 401)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const cookie = await jar.jar.getCookieString(BACKEND_URL);
    expect(cookie.length).toBeGreaterThan(0);
    const result = await dialWs(realtimeWsUrl(), { cookie });
    expect(result.status).not.toBe(401);
  });
});
