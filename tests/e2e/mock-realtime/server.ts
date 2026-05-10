/**
 * Phase 04 / Plan 01 / Task 3 — STUB ONLY.
 *
 * Wave 2 (plan 04-06) implements the hermetic mock-realtime WS echo server
 * that speaks minimum OpenAI Realtime protocol (`session.created` on
 * connect, `response.done` on demand, transparent ping/pong forwarding)
 * per CONTEXT D-22 and RESEARCH §2.9.
 *
 * This file exists in Wave 0 only to make `@openwhispr/mock-realtime`
 * resolvable from Wave 1 / Wave 3 tests without import-resolution errors.
 * Invoking the default export THROWS so accidental early use surfaces
 * loudly rather than running a partial server.
 */

export interface MockRealtimeServerOptions {
  /** Port to bind. Defaults to 0 (random) when implementation lands. */
  port?: number;
  /** Hostname to bind. Defaults to "127.0.0.1" when implementation lands. */
  host?: string;
}

export default function startMockRealtime(_opts: MockRealtimeServerOptions = {}): never {
  throw new Error(
    "not implemented — Wave 2 (plan 04-06) lands the hermetic mock-realtime WS server"
  );
}
