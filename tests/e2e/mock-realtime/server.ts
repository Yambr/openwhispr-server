// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 07 / Task 1 — hermetic mock-realtime WS server.
// R31 — UPGRADED to assert OpenAI Realtime GA shape on the upstream leg.
//
// This server stands in for the REAL OpenAI Realtime upstream (or the
// LiteLLM hop in front of it) in hermetic tests. It speaks the minimum
// subset of OpenAI's *GA* `/v1/realtime` protocol the soak test and the
// R31 regression test need:
//   * `session.created` on connect (with a `sess_<ts>` id)
//   * `session.updated` reply for every `session.update` frame
//   * `response.done` reply for every `response.create` frame
//
// ─── R31: WHY THIS MOCK NOW ASSERTS GA SHAPE ────────────────────────────
// R31 (the OpenAI Realtime Beta→GA migration bug) regressed TWICE because
// the test layer never asserted what shape reached the upstream. The old
// mock accepted ANY connection unconditionally — it never inspected the
// upgrade URL or headers — so a relay that forwarded the retired Beta
// `?intent=` query param or the `OpenAI-Beta: realtime=v1` header passed
// every test and failed live.
//
// This mock now REJECTS any upgrade that carries the Beta API shape:
//   * a `?intent=` query param  → close 4400 (the GA `/v1/realtime`
//     surface removed `?intent=`), OR
//   * an `OpenAI-Beta` request header → close 4400 (GA rejects the Beta
//     opt-in header with `beta_api_shape_disabled`).
// A relay that regresses to the Beta shape now FAILS at the test level.
//
// Topology in the R31 regression test (apps/api ── relay ──> this mock).

import websocket from "@fastify/websocket";
import Fastify from "fastify";

export interface MockRealtimeServerOptions {
  /** Port to bind. Pass 0 for an ephemeral OS-assigned port. */
  port: number;
  /** Hostname to bind. Defaults to "127.0.0.1". */
  host?: string;
  /**
   * R31 — when `false`, the GA-shape assertion is disabled and the mock
   * accepts any upgrade (legacy behaviour). Defaults to `true`: the mock
   * rejects Beta-shaped upgrades. Tests that deliberately exercise the
   * rejection path, or legacy callers, may opt out.
   */
  assertGaShape?: boolean;
}

export interface StopHandle {
  /** Full ws:// URL the test client should dial. */
  url: string;
  /** Closes all open connections + the underlying Fastify HTTP server. */
  stop: () => Promise<void>;
}

/** WS close code used when the mock rejects a Beta-shaped upgrade. */
export const BETA_SHAPE_REJECT_CODE = 4400;

/**
 * Inspect an upgrade request for the retired OpenAI Realtime *Beta* API
 * shape. Returns a human-readable reason string when Beta shape is
 * detected, or `null` when the request is clean GA shape.
 *
 * Exported so the R31 regression test can unit-assert the detection
 * directly without standing up a server.
 */
export function detectBetaShape(
  rawUrl: string | undefined,
  headers: Record<string, string | string[] | undefined>,
): string | null {
  // DEFECT 1 — the Beta-only `?intent=` query param. GA `/v1/realtime`
  // removed it; its presence means a relay forwarded the Beta URL shape.
  if (rawUrl) {
    const u = new URL(rawUrl, "http://internal");
    if (u.searchParams.has("intent")) {
      return `Beta-only "?intent=" query param present (value="${u.searchParams.get("intent")}")`;
    }
  }
  // DEFECT 2 — the `OpenAI-Beta` opt-in header. GA rejects it with
  // `beta_api_shape_disabled`. Header names are case-insensitive; Node
  // lowercases them on `IncomingMessage.headers`.
  if (headers["openai-beta"] !== undefined) {
    return `Beta opt-in header "OpenAI-Beta: ${String(headers["openai-beta"])}" present`;
  }
  return null;
}

/**
 * Start a Fastify-backed mock OpenAI Realtime GA WS server.
 *
 * Returns a {url, stop} handle. `stop()` awaits the underlying Fastify
 * close so the OS port is released before the promise resolves.
 */
export async function startMockRealtimeServer(
  opts: MockRealtimeServerOptions,
): Promise<StopHandle> {
  const host = opts.host ?? "127.0.0.1";
  const assertGaShape = opts.assertGaShape ?? true;
  const app = Fastify({ logger: false });
  await app.register(websocket);

  const openSockets = new Set<{
    close: (code?: number, reason?: string) => void;
  }>();

  app.get("/v1/realtime", { websocket: true }, (socket, req) => {
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));

    // R31 — GA-shape gate. Reject any Beta-shaped upgrade. We send an
    // in-band `error` frame (mirroring how real OpenAI surfaces
    // `beta_api_shape_disabled`) and then close with 4400.
    if (assertGaShape) {
      const betaReason = detectBetaShape(req.raw.url, req.headers);
      if (betaReason !== null) {
        socket.send(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              code: "beta_api_shape_disabled",
              message: `mock-realtime GA assertion: ${betaReason}`,
            },
          }),
        );
        socket.close(BETA_SHAPE_REJECT_CODE, "beta_api_shape_disabled");
        return;
      }
    }

    // Clean GA upgrade — emit the GA opening frame.
    socket.send(
      JSON.stringify({
        type: "session.created",
        session: { id: `sess_${Date.now()}`, object: "realtime.session" },
      }),
    );

    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let msg: { type?: string; session?: unknown };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return; // non-JSON garbage → drop, keep connection alive.
      }
      // R31 — assert the GA frame vocabulary. A relay that failed to
      // translate would forward the Beta `transcription_session.update`;
      // GA only ever sees `session.update`.
      if (
        assertGaShape &&
        typeof msg.type === "string" &&
        msg.type.startsWith("transcription_session.")
      ) {
        socket.send(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              code: "beta_api_shape_disabled",
              message: `mock-realtime GA assertion: Beta frame "${msg.type}" received (GA expects "session.*")`,
            },
          }),
        );
        socket.close(BETA_SHAPE_REJECT_CODE, "beta_api_shape_disabled");
        return;
      }
      if (msg.type === "session.update") {
        // GA acknowledges a session.update with session.updated, echoing
        // the session payload back so the test can assert the translated
        // `{ type: "transcription" }` discriminator round-trips.
        socket.send(
          JSON.stringify({
            type: "session.updated",
            session: msg.session ?? {},
          }),
        );
        return;
      }
      if (msg.type === "response.create") {
        socket.send(
          JSON.stringify({ type: "response.done", response: { id: `resp_${Date.now()}` } }),
        );
      }
      // Any other GA message type is silently ignored.
    });
  });

  const httpUrl = await app.listen({ port: opts.port, host });
  const url = httpUrl.replace(/^http:/, "ws:") + "/v1/realtime";

  return {
    url,
    stop: async () => {
      for (const socket of openSockets) {
        socket.close(1000, "server stopping");
      }
      openSockets.clear();
      await app.close();
    },
  };
}

export default startMockRealtimeServer;
