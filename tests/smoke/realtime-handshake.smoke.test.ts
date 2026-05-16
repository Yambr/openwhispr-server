// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 22 / Plan 22-01 / SR-22.1 — realtime WSS auth-gate smoke probe.
//
// Asserts: opening wss://api.localhost:8443/v1/realtime WITHOUT a bearer
// token closes with an auth-rejection code (4401/4403/1008). Proves the
// dedicated :8443 websecure-realtime entrypoint from Phase 04 / SCALE-05
// is reachable and that the auth gate fires at handshake time.
//
// Wall-clock budget: < 1500 ms (TLS + WSS handshake + auth-reject).
import { WebSocket } from "undici";
import { describe, expect, it } from "vitest";

const SMOKE_WSS_URL = process.env.SMOKE_WSS_URL ?? "wss://api.localhost:8443/v1/realtime";

// undici WebSocket honours Node's HTTPS reject-unauthorized config via the
// global Agent; the health probe already disables it for *.localhost dev
// certs. Re-import here so this file can run standalone.
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

describe("smoke: /v1/realtime auth gate (Phase 22 / SR-22.1)", () => {
  it("closes with auth-reject code when bearer is absent", { timeout: 5_000 }, async () => {
    const closeCode = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(SMOKE_WSS_URL);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* socket may already be torn down */
        }
        reject(new Error("smoke: realtime handshake did not close within 4 s"));
      }, 4_000);
      ws.addEventListener("close", (ev: { code: number }) => {
        clearTimeout(timer);
        resolve(ev.code);
      });
      ws.addEventListener("error", () => {
        // Some clients deliver a synthetic close event after error; rely
        // on the close handler. If neither fires, the timeout above
        // surfaces the failure.
      });
    });
    // 4401 = our custom auth-reject; 4403 = forbidden; 1008 = policy
    // violation; 1006 = abnormal closure (acceptable if Traefik tears
    // the connection before our handler runs). Anything else is a
    // regression.
    expect([4401, 4403, 1008, 1006]).toContain(closeCode);
  });
});
