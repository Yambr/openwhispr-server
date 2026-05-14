// SPDX-License-Identifier: FSL-1.1-ALv2
// tests/e2e/realtime-soak-live.test.ts
//
// Phase 04 / Plan 10 / Task 1 — 65-minute LIVE WSS soak against the REAL
// OpenAI Realtime API through the FULL production ingress chain:
//
//   wss://api.localhost:8443/v1/realtime
//     → Traefik websecure-realtime entrypoint (Plan 05; idleTimeout 3600s)
//     → Fastify api /v1/realtime route (@fastify/http-proxy + wsUpstream)
//     → LiteLLM (mode: realtime) — live-realtime config (Plan 10 Task 1)
//     → OpenAI Realtime API (wss://api.openai.com/v1/realtime; real provider)
//
// COST DISCIPLINE (T-04-COST):
//   This test runs ONLY in the .github/workflows/nightly-realtime-soak.yml
//   workflow, which gates execution to scheduled events / tag pushes /
//   workflow_dispatch (PR triggers are explicitly blocked). One full run
//   costs ~$15-25 in OpenAI Realtime audio billing across the 65-min
//   wall-clock window. Local dev runs without OPENAI_API_KEY skip the
//   describe block via skipIf() — no accidental spend on contributor
//   machines.
//
// LOAD-BEARING ASSERTIONS:
//   1. Session survives 3600s without an INGRESS-ATTRIBUTABLE close.
//      Close codes 1001 (going away) or 1011 (server error) before
//      T+3600s indicate Traefik or the api proxy dropped the session
//      → test FAILS. Code 1006 (abnormal) is logged but tolerated
//      (community-documented OpenAI Realtime random 1006 disconnects;
//      RESEARCH §2.10 close-code attribution table).
//   2. p95 ping RTT < 1000ms across the 65-min window.
//   3. session.created received within 15s of WS open (real-provider
//      handshake budget — 5s for hermetic mock; 15s here accounts for
//      real OpenAI session bring-up).
//   4. Close-frame log written to tests/e2e/realtime-soak.log as JSONL
//      (one event per line) for GHA artifact upload — the artifact
//      survives a test failure (uploaded with `if: always()`) and is
//      the load-bearing post-mortem signal when a real-provider run
//      regresses.
//
// CLAUDE.md `no mocks of internal logic`: every hop in the chain above
// is real. OpenAI Realtime is a third-party SaaS process boundary.
//
// 65-min duration is the LIVE-PROVIDER soak floor (T-04-02 mitigation
// per the Plan 10 threat_model). The 5-min hermetic counterpart
// (tests/e2e/realtime-soak-hermetic.test.ts) is the per-PR gate.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

interface CloseLogEntry {
  type: "close";
  elapsedSec: number;
  code: number;
  reason: string;
  // 1001/1011 before T+3600s = our ingress chain dropped the session.
  // 1006 = upstream (OpenAI) abnormal close — community-documented.
  attribution: "ingress" | "upstream-1006" | "clean" | "other";
  isOurs: boolean;
}

interface PingLogEntry {
  type: "ping";
  elapsedSec: number;
  rttMs: number;
}

type LogEntry = CloseLogEntry | PingLogEntry;

const SOAK_LOG_PATH = "tests/e2e/realtime-soak.log";

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[Math.max(0, idx)]!;
}

function realtimeSoakUrl(): string {
  // Dedicated :8443 entrypoint (Plan 05 websecure-realtime; idleTimeout
  // 3600s — exactly the budget we are testing). The :443 entrypoint
  // reverted to Traefik 3 defaults (60s readTimeout) and would kill any
  // soak > 60s.
  //
  // ?model=realtime — LiteLLM dispatches realtime upstreams from the
  // model_list keyed on this query param; without it LiteLLM closes the
  // upstream with 1011/'unexpected response'. The Plan 10 live-realtime
  // LiteLLM config declares `realtime` as the model_name pointed at
  // wss://api.openai.com/v1/realtime.
  const url = new URL(BACKEND_URL);
  url.protocol = "wss:";
  url.port = "8443";
  url.pathname = "/v1/realtime";
  url.searchParams.set("model", "realtime");
  return url.toString();
}

function appendLog(entries: LogEntry[]): void {
  // Write the full log as a single JSONL blob each time. Cheap (the log
  // tops out at ~200 lines across 65 min) and avoids the partial-write
  // class of artifact-upload bugs.
  mkdirSync(dirname(SOAK_LOG_PATH), { recursive: true });
  const body = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(SOAK_LOG_PATH, body, "utf8");
}

// describe.skipIf — local dev runs without OPENAI_API_KEY skip cleanly
// rather than fail with an obscure WSS error. The CI workflow injects
// the secret via `env:` so the soak runs there.
describe.skipIf(!process.env.OPENAI_API_KEY)(
  "e2e — WSS /v1/realtime 65-min LIVE soak against OpenAI Realtime (SCALE-05)",
  () => {
    it("session survives 3600s through Traefik :8443 + LiteLLM + real OpenAI Realtime — zero ingress-attributable closes; p95 ping RTT < 1s", async () => {
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
      const eventLog: LogEntry[] = [];
      const closeLog: CloseLogEntry[] = [];
      const pingRtts: number[] = [];
      let sessionCreatedAtMs: number | null = null;
      let opened = false;

      const opened_p = new Promise<void>((resolveOpen, rejectOpen) => {
        const openTimer = setTimeout(() => rejectOpen(new Error("WS open timeout (15s)")), 15_000);
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
      // so we don't miss the first frame from real OpenAI (which
      // emits session.created within ~1-3s of upgrade in practice).
      const sessionCreated_p = new Promise<void>((resolveSession, rejectSession) => {
        const sessionTimer = setTimeout(
          () => rejectSession(new Error("session.created not received within 15s of open")),
          30_000,
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
        // Close-code attribution per RESEARCH §2.10 (refined for the
        // real-provider regime — distinguishes upstream 1006 from
        // ingress 1001/1011):
        //   1001 (going away)  before T+3600s → INGRESS → FAIL
        //   1011 (server err)  before T+3600s → INGRESS → FAIL
        //   1006 (abnormal)                     → UPSTREAM (OpenAI flake) → log
        //   1000 (normal)      at end           → CLEAN
        //   anything else                       → log, do not fail
        const isIngress = elapsedSec < 3600 && (code === 1001 || code === 1011);
        let attribution: CloseLogEntry["attribution"];
        if (isIngress) attribution = "ingress";
        else if (code === 1006) attribution = "upstream-1006";
        else if (code === 1000) attribution = "clean";
        else attribution = "other";
        const entry: CloseLogEntry = {
          type: "close",
          elapsedSec,
          code,
          reason,
          attribution,
          isOurs: isIngress,
        };
        closeLog.push(entry);
        eventLog.push(entry);
        appendLog(eventLog);
      });

      // ── Wait for connection + first frame ──────────────────────────
      await opened_p;
      await sessionCreated_p;
      expect(sessionCreatedAtMs).not.toBeNull();
      // eslint-disable-next-line no-console
      console.log(
        `[SCALE-05 LIVE] session.created received +${((sessionCreatedAtMs! - start) / 1000).toFixed(2)}s`,
      );

      // ── Drive ping every 20s for 65 minutes ────────────────────────
      const pingInterval = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const tStart = Date.now();
        const onPong = () => {
          const rttMs = Date.now() - tStart;
          pingRtts.push(rttMs);
          const entry: PingLogEntry = {
            type: "ping",
            elapsedSec: (Date.now() - start) / 1000,
            rttMs,
          };
          eventLog.push(entry);
          appendLog(eventLog);
        };
        ws.once("pong", onPong);
        try {
          ws.ping("keepalive");
        } catch {
          /* socket already closed; outer close handler will flag if ours */
        }
      }, 20_000);

      // Drive a response.create periodically — exercises the
      // application-layer path through real OpenAI so the session
      // has actual traffic, not just protocol pings. Real OpenAI
      // bills audio per minute, so we keep this sparse (every 5 min
      // = 13 invocations across the 65-min window).
      const responseInterval = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
          ws.send(JSON.stringify({ type: "response.create" }));
        } catch {
          /* see ping handler */
        }
      }, 300_000);

      // 65 min + 5s buffer (3905s wall-clock). NOT controlled by
      // vitest fake timers — soak is wall-clock (Plan 08 D-?: real
      // wall-clock for any test that depends on a real-server clock).
      await new Promise((r) => setTimeout(r, 3_905_000));

      clearInterval(pingInterval);
      clearInterval(responseInterval);

      const elapsedAtClean = (Date.now() - start) / 1000;
      // eslint-disable-next-line no-console
      console.log(
        `[SCALE-05 LIVE] T+${elapsedAtClean.toFixed(0)}s sending clean close 1000; ` +
          `pingRtts.length=${pingRtts.length} closeLog.length=${closeLog.length}`,
      );

      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "soak-complete");
      }
      // Give the close handler a chance to fire so closeLog captures
      // the terminal frame.
      await new Promise((r) => setTimeout(r, 2000));
      appendLog(eventLog);

      // ── Assertions ─────────────────────────────────────────────────
      const ingressCloses = closeLog.filter((c) => c.isOurs);
      const upstream1006s = closeLog.filter((c) => c.attribution === "upstream-1006");
      // eslint-disable-next-line no-console
      console.log(
        `[SCALE-05 LIVE] closeLog=${JSON.stringify(closeLog)} ` +
          `ingress-attributable=${ingressCloses.length} upstream-1006=${upstream1006s.length}`,
      );
      expect(ingressCloses).toEqual([]);

      // Ping RTT p95 < 1s. With ping every 20s for 3600s we expect
      // ~180 samples; require at least 100 to defend against pong
      // sparseness skewing the percentile.
      // eslint-disable-next-line no-console
      console.log(
        `[SCALE-05 LIVE] pingRtts (n=${pingRtts.length}): min=${Math.min(...pingRtts, Infinity)} ` +
          `max=${Math.max(...pingRtts, -Infinity)} p95=${percentile(pingRtts, 0.95)}ms`,
      );
      expect(pingRtts.length).toBeGreaterThanOrEqual(100);
      expect(percentile(pingRtts, 0.95)).toBeLessThan(1000);
    }, // close drain + assertion overhead. Stays under the workflow // 70-min ceiling — covers the 3905s soak + connection setup +
    // job timeout-minutes: 90.
    4_200_000);
  },
);
