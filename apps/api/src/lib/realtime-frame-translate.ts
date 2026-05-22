// SPDX-License-Identifier: FSL-1.1-ALv2
// R31 — OpenAI Realtime Beta↔GA frame translation (pure functions).
//
// Background (debug session r31-realtime-ga-beta-shape):
//   The immutable OpenWhispr desktop client speaks the *Beta* OpenAI
//   Realtime vocabulary — it opens `/v1/realtime?intent=transcription`
//   and waits for a `transcription_session.created` event, and its
//   first outbound frame is `transcription_session.update`. OpenAI
//   retired the Beta API: the GA `/v1/realtime` surface emits
//   `session.created` and consumes `session.update` (with a
//   `session.type: "transcription"` discriminator), and the `?intent=`
//   query param is gone. A transparent payload-opaque WS passthrough
//   cannot bridge that vocabulary gap, so OpenAI replies with
//   `invalid_request_error.beta_api_shape_disabled` and the socket
//   closes 4000.
//
// This module is the FRAME-TRANSLATION half of the fix. It is a set of
// *pure* functions — no sockets, no I/O — so the Beta↔GA mapping can be
// unit-tested exhaustively from a fixture corpus. The frame-aware relay
// in `routes/realtime.ts` calls `translateClientToUpstream` on every
// client→upstream frame and `translateUpstreamToClient` on every
// upstream→client frame.
//
// Translation contract (only the realtime *transcription* path):
//   client → upstream (Beta → GA):
//     * `transcription_session.update` → `session.update` with the
//       payload's `session` re-tagged `{ type: "transcription" }`.
//     * every other frame passes through verbatim.
//   upstream → client (GA → Beta):
//     * `session.created`  → `transcription_session.created`
//     * `session.updated`  → `transcription_session.updated`
//     * every other frame (transcription deltas, errors, etc.) passes
//       through verbatim — the desktop client already speaks those.
//
// Hardening (T-03-07-07): the relay parses untrusted WS payloads. These
// functions therefore accept a raw string and return a discriminated
// result; malformed JSON, oversized payloads, and non-object frames are
// the caller's responsibility (see `parseRealtimeFrame`). The mappers
// themselves never throw.

/** Maximum byte length of a single realtime WS text frame we will parse. */
export const MAX_REALTIME_FRAME_BYTES = 1 * 1024 * 1024; // 1 MiB

/** A successfully parsed realtime frame: a JSON object with a string `type`. */
export interface RealtimeFrame {
  type: string;
  [key: string]: unknown;
}

/** Result of attempting to parse a raw WS payload into a realtime frame. */
export type ParseResult =
  | { ok: true; frame: RealtimeFrame }
  | { ok: false; reason: "too_large" | "not_json" | "not_object" | "no_type" };

/**
 * Parse a raw WS text payload into a {@link RealtimeFrame}.
 *
 * Defensive against the new parse attack surface introduced by the
 * frame-aware relay (T-03-07-07):
 *   * payloads above {@link MAX_REALTIME_FRAME_BYTES} are rejected
 *     without invoking `JSON.parse` (DoS bound),
 *   * non-JSON / non-object / typeless frames are rejected.
 *
 * The relay drops rejected frames (does NOT forward them) and keeps the
 * socket alive — a single malformed frame must not tear down a session.
 */
export function parseRealtimeFrame(raw: string): ParseResult {
  // Byte length, not code-unit length — a multi-byte UTF-8 payload could
  // exceed the cap while `raw.length` (UTF-16 units) understates it.
  if (Buffer.byteLength(raw, "utf8") > MAX_REALTIME_FRAME_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "not_object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== "string") {
    return { ok: false, reason: "no_type" };
  }
  return { ok: true, frame: obj as RealtimeFrame };
}

/**
 * Translate a CLIENT→UPSTREAM frame from the Beta vocabulary the
 * immutable desktop client speaks into the GA vocabulary OpenAI's
 * (or LiteLLM's) GA `/v1/realtime` surface expects.
 *
 * Only `transcription_session.update` is rewritten:
 *   `{ type: "transcription_session.update", session: {...} }`
 *     → `{ type: "session.update", session: { type: "transcription", ...} }`
 *
 * The GA `session.update` frame REQUIRES a `session.type` discriminator;
 * the Beta `transcription_session.update` implied it via the frame name.
 * We inject `type: "transcription"` into the `session` object (preserving
 * every other field the client sent). If the client omitted `session`
 * entirely we synthesize a minimal `{ type: "transcription" }`.
 *
 * Every other frame type is returned UNCHANGED (same object reference).
 */
export function translateClientToUpstream(frame: RealtimeFrame): RealtimeFrame {
  if (frame.type !== "transcription_session.update") {
    return frame;
  }
  const incomingSession =
    typeof frame.session === "object" && frame.session !== null && !Array.isArray(frame.session)
      ? (frame.session as Record<string, unknown>)
      : {};
  // GA `session.update` for the transcription intent: the `session`
  // object carries `type: "transcription"`. Spread the client's session
  // fields first so an explicit client `type` cannot override the GA
  // discriminator we are responsible for.
  const { type: _clientType, ...rest } = frame;
  return {
    ...rest,
    type: "session.update",
    session: { ...incomingSession, type: "transcription" },
  };
}

/**
 * Translate an UPSTREAM→CLIENT frame from the GA vocabulary back into the
 * Beta vocabulary the immutable desktop client waits for.
 *
 *   `session.created` → `transcription_session.created`
 *   `session.updated` → `transcription_session.updated`
 *
 * The preconfigured client blocks its session-startup state machine on
 * `transcription_session.created`; GA never emits that event, so without
 * this rewrite the client hangs until its own timeout. Every other GA
 * frame (input-audio-buffer events, transcription deltas, `error`,
 * `response.*`, etc.) is returned UNCHANGED — the desktop client already
 * understands the GA names for those.
 */
export function translateUpstreamToClient(frame: RealtimeFrame): RealtimeFrame {
  const remap: Record<string, string> = {
    "session.created": "transcription_session.created",
    "session.updated": "transcription_session.updated",
  };
  const mapped = remap[frame.type];
  if (mapped === undefined) {
    return frame;
  }
  return { ...frame, type: mapped };
}

/**
 * Strip the Beta-only `?intent=` query param from a realtime upstream
 * URL. GA `/v1/realtime` rejects `?intent=` (it is the URL-level half of
 * the Beta API shape — see DEFECT 1 in the debug session). Accepts a
 * path+query string (origin-form, e.g. `/v1/realtime?intent=...`) or an
 * absolute URL; returns the same form it was given, with `intent`
 * removed and all other params preserved.
 */
export function stripIntentParam(urlOrPath: string): string {
  // Origin-form path (Fastify raw URL) vs absolute URL. The WHATWG URL
  // parser needs an absolute base for the former; we use a sentinel host
  // and only read back `pathname + search`.
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(urlOrPath);
  if (isAbsolute) {
    const u = new URL(urlOrPath);
    u.searchParams.delete("intent");
    return u.toString();
  }
  const u = new URL(urlOrPath, "http://internal");
  u.searchParams.delete("intent");
  return u.pathname + u.search;
}
