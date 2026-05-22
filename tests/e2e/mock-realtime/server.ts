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
//   * DATA PATH (R31 third layer): on `input_audio_buffer.commit` it emits
//     a GA transcription RESULT — an `input_audio_buffer.committed`, a
//     `conversation.item.input_audio_transcription.delta` and a
//     `.completed` carrying a non-empty transcript. It ALSO asserts the
//     GA-shaped `session.update` payload (nested `audio.input.format`
//     OBJECT) — a relay that forwarded the flat Beta payload (DEFECT 4)
//     fails the connection.
//
// ─── R31: WHY THIS MOCK ASSERTS GA SHAPE ────────────────────────────────
// R31 (the OpenAI Realtime Beta→GA migration bug) regressed repeatedly
// because the test layer never asserted what shape reached the upstream.
// The old mock accepted ANY connection unconditionally.
//
// This mock REJECTS (close 4400, in-band `beta_api_shape_disabled` error):
//   * an `OpenAI-Beta` request header — the retired Beta opt-in header,
//   * an upgrade MISSING `?intent=transcription` — GA opens a transcription
//     session ONLY with that param (R31 LIVE-RUN FINDING; a stripped intent
//     makes GA open a conversational session that rejects the transcription
//     `session.update`),
//   * a Beta `transcription_session.*` frame on the upstream leg,
//   * a flat Beta `session.update` payload (DEFECT 4 — GA needs the nested
//     `audio.input.format` object).
// A relay that regresses ANY of these layers FAILS at the test level.
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
 * The transcript the mock emits on a committed audio buffer. The R31
 * data-path test asserts the client receives exactly this — a non-empty
 * transcript proves the append→commit→result data path is bridged.
 */
export const MOCK_TRANSCRIPT = "The quick brown fox jumps over the lazy dog";

/**
 * Detect the flat Beta `session.update` payload shape (R31 DEFECT 4).
 *
 * GA requires `session.audio.input.format` to be an OBJECT; the immutable
 * client sends the flat Beta triplet (`input_audio_format` as a bare
 * string, `input_audio_transcription`, `turn_detection` directly under
 * `session`). A relay that fails to restructure the payload forwards the
 * flat shape and GA answers "Invalid type for 'session.audio.input.format'".
 *
 * Returns a reason string when a Beta-shaped session payload is detected,
 * or `null` when the payload is clean GA (nested) shape. Exported for
 * direct unit-assertion.
 */
export function detectBetaSessionPayload(session: unknown): string | null {
  if (typeof session !== "object" || session === null || Array.isArray(session)) {
    return null;
  }
  const s = session as Record<string, unknown>;
  if ("input_audio_format" in s) {
    return `flat Beta field "input_audio_format" present on session (GA expects audio.input.format object)`;
  }
  if ("input_audio_transcription" in s) {
    return `flat Beta field "input_audio_transcription" present on session (GA expects audio.input.transcription)`;
  }
  // A `turn_detection` directly under `session` (rather than under
  // `audio.input`) is the flat Beta shape too.
  if ("turn_detection" in s) {
    return `flat Beta field "turn_detection" present directly on session (GA expects audio.input.turn_detection)`;
  }
  // GA `audio.input.format`, when present, MUST be an object.
  const audio = s.audio;
  if (typeof audio === "object" && audio !== null) {
    const input = (audio as Record<string, unknown>).input;
    if (typeof input === "object" && input !== null) {
      const format = (input as Record<string, unknown>).format;
      if (format !== undefined && (typeof format !== "object" || format === null)) {
        return `GA audio.input.format is not an object (got ${typeof format})`;
      }
    }
  }
  return null;
}

/**
 * Inspect an upgrade request for the retired OpenAI Realtime *Beta* API
 * shape, OR for a malformed transcription-session connect.
 *
 * Returns a human-readable reason string when a problem is detected, or
 * `null` when the request is a clean GA transcription-session upgrade.
 * Exported so the R31 regression test can unit-assert the detection
 * directly without standing up a server.
 *
 * Two checks:
 *   1. The `OpenAI-Beta` opt-in header — the ONLY upgrade-level Beta
 *      marker. GA rejects it with `beta_api_shape_disabled`.
 *   2. `?intent=transcription` MUST be present (R31 LIVE-RUN FINDING).
 *      GA decides the session TYPE at connect time: `?intent=transcription`
 *      opens a transcription session; its absence opens a conversational
 *      realtime session whose `session.update` rejects a
 *      `session.type:"transcription"` payload with `invalid_parameter`
 *      ("Passing a transcription session update event to a realtime
 *      session is not allowed"). A relay that drops `?intent=` regresses
 *      the fifth R31 layer — the mock fails it here.
 */
export function detectBetaShape(
  rawUrl: string | undefined,
  headers: Record<string, string | string[] | undefined>,
): string | null {
  // The `OpenAI-Beta` opt-in header — header names are case-insensitive;
  // Node lowercases them on `IncomingMessage.headers`.
  if (headers["openai-beta"] !== undefined) {
    return `Beta opt-in header "OpenAI-Beta: ${String(headers["openai-beta"])}" present`;
  }
  // GA transcription session requires ?intent=transcription on the URL.
  const intent = rawUrl ? new URL(rawUrl, "http://internal").searchParams.get("intent") : null;
  if (intent !== "transcription") {
    return `?intent=transcription missing (got intent=${JSON.stringify(intent)}) — GA would open a conversational realtime session that rejects the transcription session.update`;
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

    // R31 data path — count audio bytes appended so a `commit` with a
    // non-empty buffer yields a transcript and an empty buffer does not.
    let appendedAudioBytes = 0;

    const rejectBeta = (reason: string): void => {
      socket.send(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            code: "beta_api_shape_disabled",
            message: `mock-realtime GA assertion: ${reason}`,
          },
        }),
      );
      socket.close(BETA_SHAPE_REJECT_CODE, "beta_api_shape_disabled");
    };

    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[], isBinary?: boolean) => {
      // Binary frames are audio payloads — count their bytes, no JSON.
      if (isBinary) {
        appendedAudioBytes += Buffer.isBuffer(raw)
          ? raw.length
          : Buffer.from(raw as ArrayBuffer).byteLength;
        return;
      }
      let msg: { type?: string; session?: unknown; audio?: unknown };
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
        rejectBeta(`Beta frame "${msg.type}" received (GA expects "session.*")`);
        return;
      }
      if (msg.type === "session.update") {
        // R31 DEFECT 4 — assert the session PAYLOAD is GA-shaped (nested
        // audio.input.format object), not the flat Beta triplet. A relay
        // that renamed the frame but left the payload flat fails here.
        if (assertGaShape) {
          const betaPayload = detectBetaSessionPayload(msg.session);
          if (betaPayload !== null) {
            rejectBeta(`session.update payload is Beta-shaped — ${betaPayload}`);
            return;
          }
        }
        // GA acknowledges a session.update with session.updated, echoing
        // the session payload back so the test can assert the translated
        // GA shape round-trips.
        socket.send(
          JSON.stringify({
            type: "session.updated",
            session: msg.session ?? {},
          }),
        );
        return;
      }
      if (msg.type === "input_audio_buffer.append") {
        // GA `input_audio_buffer.append` carries base64 audio in `audio`.
        // No server confirmation event (matches real OpenAI GA).
        if (typeof msg.audio === "string") {
          appendedAudioBytes += Buffer.from(msg.audio, "base64").length;
        }
        return;
      }
      if (msg.type === "input_audio_buffer.commit") {
        // GA: committing triggers transcription. With an empty buffer GA
        // emits an `input_audio_buffer_commit_empty` error; with audio it
        // emits committed → transcription delta → transcription completed.
        if (appendedAudioBytes === 0) {
          socket.send(
            JSON.stringify({
              type: "error",
              error: {
                type: "invalid_request_error",
                code: "input_audio_buffer_commit_empty",
                message: "buffer too small to commit",
              },
            }),
          );
          return;
        }
        const itemId = `item_${Date.now()}`;
        socket.send(JSON.stringify({ type: "input_audio_buffer.committed", item_id: itemId }));
        // GA streams the transcript word-by-word as deltas, then a final
        // completed event. Beta consumes these event names verbatim.
        socket.send(
          JSON.stringify({
            type: "conversation.item.input_audio_transcription.delta",
            item_id: itemId,
            delta: MOCK_TRANSCRIPT,
          }),
        );
        socket.send(
          JSON.stringify({
            type: "conversation.item.input_audio_transcription.completed",
            item_id: itemId,
            transcript: MOCK_TRANSCRIPT,
          }),
        );
        appendedAudioBytes = 0;
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
