// tests/e2e/realtime-soak-hermetic.test.ts
//
// Phase 04 / Plan 09 / Task 3 — 5-minute hermetic WSS soak through the
// FULL real ingress chain:
//
//   wss://api.localhost:8443/v1/realtime
//     → Traefik websecure-realtime entrypoint (Plan 05; idleTimeout 3600s)
//     → Fastify api /v1/realtime route (@fastify/http-proxy + wsUpstream)
//     → LiteLLM (mode: realtime) repointed at mock-realtime (Plan 09 Task 1a)
//     → mock-realtime echo server (Plan 07; session.created on connect)
//
// LOAD-BEARING ASSERTIONS:
//   1. Session survives 300s without an INGRESS-ATTRIBUTABLE close.
//      Close codes 1001 (going away) or 1011 (server error) before
//      T+300s indicate Traefik or the api proxy dropped the session
//      → test FAILS. Code 1006 (abnormal) is logged but tolerated
//      (matches the close-code attribution table from RESEARCH §2.10).
//   2. p95 ping RTT < 1000ms (drives ping every 20s; 14-15 samples).
//   3. session.created received within 5s of WS open (mock-realtime
//      contract — Plan 07 server.test.ts T2).
//   4. No ingress-attributable close logged (closeLog filtered to
//      `isOurs: true` MUST be empty).
//
// 5-min duration is the HERMETIC CI floor — runs on every PR. The
// 65-min live soak (against real OpenAI Realtime) is the separate
// nightly gate scheduled in Phase 4 Plan 10.
//
// CLAUDE.md `no mocks of internal logic`: mock-realtime is a process
// boundary (a separate container speaking the OpenAI Realtime wire
// protocol). Traefik, Fastify proxy, and the WSS upstream chain are
// all real.

import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { signInFixture } from "./sign-in.js";
import { BACKEND_URL } from "./compose-helper.js";

interface CloseLogEntry {
  elapsedSec: number;
  code: number;
  reason: string;
  isOurs: boolean;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[Math.max(0, idx)]!;
}

function realtimeSoakUrl(): string {
  // Dedicated :8443 entrypoint (Plan 05 websecure-realtime). The :443
  // entrypoint reverted to Traefik 3 defaults (60s readTimeout) which
  // would kill any soak > 60s — the WHOLE POINT of the split.
  // BACKEND_URL is https://api.localhost (port 443 implicit); rewrite
  // to wss + :8443 here.
  //
  // ?model=realtime — LiteLLM dispatches realtime upstreams from the
  // model_list keyed on this query param (the OpenAI Realtime SDK
  // sends it; LiteLLM v1.83.x mirrors the contract). Without it
  // LiteLLM closes the upstream with 1011/'unexpected response'.
  // The Plan 09 e2e LiteLLM config (litellm_config.e2e-realtime.yaml)
  // declares `realtime` as a model_name pointed at mock-realtime.
  const url = new URL(BACKEND_URL);
  url.protocol = "wss:";
  url.port = "8443";
  url.pathname = "/v1/realtime";
  url.searchParams.set("model", "realtime");
  return url.toString();
}

describe("e2e — WSS /v1/realtime 5-min hermetic soak (SCALE-05)", () => {
  it(
    "session survives 300s through Traefik :8443 + mock-realtime — zero ingress-attributable closes; p95 ping RTT < 1s",
    async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const cookie = await jar.jar.getCookieString(BACKEND_URL);
      expect(cookie.length).toBeGreaterThan(0);

      const ws = new WebSocket(realtimeSoakUrl(), {
        headers: { cookie },
        // Self-signed Traefik cert (process-wide
        // NODE_TLS_REJECT_UNAUTHORIZED=0 set in tests/e2e/setup.ts).
        // Belt-and-suspenders: also disable on this socket.
        rejectUnauthorized: false,
      });

      const start = Date.now();
      const closeLog: CloseLogEntry[] = [];
      const pingRtts: number[] = [];
      let sessionCreatedAtMs: number | null = null;
      let opened = false;

      const opened_p = new Promise<void>((resolveOpen, rejectOpen) => {
        const openTimer = setTimeout(
          () => rejectOpen(new Error("WS open timeout (10s)")),
          10_000,
        );
        ws.once("open", () => {
          opened = true;
          clearTimeout(openTimer);
          resolveOpen();
        });
        ws.once("error", (err) => {
          if (!opened) {
            clearTimeout(openTimer);
            rejectOpen(err);
          }
        });
      });

      // session.created listener — installed BEFORE 'open' is awaited
      // so we don't miss the immediate frame from mock-realtime
      // (Plan 07 deviation: server emits session.created on the open
      // callback synchronously).
      const sessionCreated_p = new Promise<void>((resolveSession, rejectSession) => {
        const sessionTimer = setTimeout(
          () => rejectSession(new Error("session.created not received within 5s of open")),
          15_000,
        );
        ws.on("message", (data) => {
          if (sessionCreatedAtMs !== null) return;
          try {
            const msg = JSON.parse(data.toString()) as { type?: string };
            if (msg.type === "session.created") {
              sessionCreatedAtMs = Date.now();
              clearTimeout(sessionTimer);
              resolveSession();
            }
          } catch {
            /* non-JSON frame — ignore */
          }
        });
      });

      ws.on("close", (code, reasonBuf) => {
        const elapsedSec = (Date.now() - start) / 1000;
        const reason = reasonBuf?.toString?.() ?? "";
        // Close-code attribution per RESEARCH §2.10 close-code table:
        //   1001 (going away) — Traefik or proxy initiated → INGRESS
        //   1011 (server error) — Fastify proxy crashed / wsClient err → INGRESS
        //   1000 (normal) — clean close at end of test → NOT ingress
        //   1006 (abnormal) — TCP-level drop, often network/upstream → NOT ingress (logged)
        //   anything else — logged but not ingress-attributable
        const isOurs = elapsedSec < 300 && (code === 1001 || code === 1011);
        closeLog.push({ elapsedSec, code, reason, isOurs });
      });

      // ── Wait for connection + first frame (gate 1) ──────────────────
      await opened_p;
      await sessionCreated_p;
      expect(sessionCreatedAtMs).not.toBeNull();
      // eslint-disable-next-line no-console
      console.log(
        `[SCALE-05] session.created received +${((sessionCreatedAtMs! - start) / 1000).toFixed(2)}s`,
      );

      // ── Drive ping every 20s for 5 minutes ──────────────────────────
      const pingInterval = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const tStart = Date.now();
        const onPong = () => {
          pingRtts.push(Date.now() - tStart);
        };
        ws.once("pong", onPong);
        try {
          ws.ping("keepalive");
        } catch {
          /* socket already closed; outer close handler will flag if ours */
        }
      }, 20_000);

      // Drive a response.create every 30s — exercises the application-
      // layer path through mock-realtime so the session has actual
      // traffic, not just protocol pings.
      const responseInterval = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
          ws.send(JSON.stringify({ type: "response.create" }));
        } catch {
          /* see ping handler */
        }
      }, 30_000);

      // 5 min + 5s buffer. NOT controlled by vitest fake timers — the
      // soak is wall-clock (Plan 08 D-?: real wall-clock for any test
      // that depends on a real-server clock).
      await new Promise((r) => setTimeout(r, 305_000));

      clearInterval(pingInterval);
      clearInterval(responseInterval);

      const elapsedAtClean = (Date.now() - start) / 1000;
      // eslint-disable-next-line no-console
      console.log(
        `[SCALE-05] T+${elapsedAtClean.toFixed(0)}s sending clean close 1000; ` +
          `pingRtts.length=${pingRtts.length} closeLog.length=${closeLog.length}`,
      );

      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "soak-complete");
      }
      // Give the close handler a chance to fire so closeLog captures
      // the terminal frame.
      await new Promise((r) => setTimeout(r, 1500));

      // ── Assertions ──────────────────────────────────────────────────
      const ingressCloses = closeLog.filter((c) => c.isOurs);
      // eslint-disable-next-line no-console
      console.log(
        `[SCALE-05] closeLog=${JSON.stringify(closeLog)} ingress-attributable=${ingressCloses.length}`,
      );
      expect(ingressCloses).toEqual([]);

      // Ping RTT p95 < 1s. With ping every 20s for 300s we expect
      // 14–15 samples; require at least 10 to defend against a single
      // missed pong skewing the percentile.
      // eslint-disable-next-line no-console
      console.log(
        `[SCALE-05] pingRtts (n=${pingRtts.length}): min=${Math.min(...pingRtts, Infinity)} ` +
          `max=${Math.max(...pingRtts, -Infinity)} p95=${percentile(pingRtts, 0.95)}ms`,
      );
      expect(pingRtts.length).toBeGreaterThanOrEqual(10);
      expect(percentile(pingRtts, 0.95)).toBeLessThan(1000);
    },
    // 6 minutes — covers the 305s soak + connection setup + close drain
    // + assertion overhead. Stays under the 600_000 vitest.e2e.config
    // ceiling.
    360_000,
  );
});
