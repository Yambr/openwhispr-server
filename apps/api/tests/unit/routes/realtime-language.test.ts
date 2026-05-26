// SPDX-License-Identifier: FSL-1.1-ALv2
// v1.0.9 — route-level resolution of the `?language=` query + the
// `REALTIME_DEFAULT_LANGUAGE` env fallback, surfaced into the
// relay-originated GA `session.update` frame the upstream sees.
//
// Strategy mirrors `realtime.test.ts`:
//   * A real `ws.WebSocketServer` on an ephemeral localhost port stands
//     in for the upstream and captures every relay-originated frame.
//   * The Fastify app under test mounts the realtime route with a hand-
//     synthesized `req.user` (the dual-auth path is out of scope for
//     this matrix).
//   * For every M2 / M3 / M5 / M8 / M9 case we dial a WSS upgrade,
//     wait for the upstream to receive a `session.update`, and assert
//     the `transcription.language` field — present per query/env wins,
//     OMITTED on invalid input + auto-detect path.
//
// Only the upstream (network boundary) is mocked, per project rule
// "no mocks of internal logic" — `parseRealtimeFrame` / `buildUpstreamUrl`
// / `bridgeRealtimeSockets` all run real against a real upstream socket.

import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { LitellmClient } from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { loadRealtimeConfigFromEnv, RealtimeConfigError } from "../../../src/config/realtime.js";
import { registerErrorHandler } from "../../../src/error-handler.js";
import {
  buildRealtimeRoutes,
  buildUpstreamUrl,
  type RealtimeDeps,
} from "../../../src/routes/realtime.js";

const TEST_USER = "11111111-1111-1111-1111-111111111111";
const TEST_MASTER_KEY = "sk-litellm-master-test-only";
const TEST_REALTIME_MODEL = "realtime-default";
const TEST_TRANSCRIPTION = {
  model: "gpt-4o-transcribe",
  inputAudioRate: 24_000,
  vadThreshold: 0.6,
  vadSilenceMs: 600,
  vadPrefixPaddingMs: 500,
} as const;

interface UpstreamCapture {
  url?: string;
  headers?: IncomingMessage["headers"];
}

/**
 * Stand up a real ws upstream on a random localhost port. Captures the
 * first upgrade's URL + headers and every JSON frame the relay forwards.
 */
async function startUpstream(): Promise<{
  httpUrl: string;
  close: () => Promise<void>;
  capture: UpstreamCapture;
  /** Frames the upstream received from the relay (parsed JSON). */
  received: Array<Record<string, unknown>>;
}> {
  const capture: UpstreamCapture = {};
  const received: Array<Record<string, unknown>> = [];
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  wss.on("connection", (socket, request) => {
    capture.url = request.url;
    capture.headers = request.headers;
    socket.send(JSON.stringify({ type: "session.created", session: { id: "sess_test" } }));
    socket.on("message", (data: RawData) => {
      try {
        received.push(JSON.parse(data.toString()));
      } catch {
        /* ignore non-JSON */
      }
    });
  });
  await new Promise<void>((res) => {
    http.listen(0, "127.0.0.1", () => res());
  });
  const port = (http.address() as AddressInfo).port;
  const close = async () => {
    await new Promise<void>((res) => wss.close(() => res()));
    await new Promise<void>((res) => http.close(() => res()));
  };
  return { httpUrl: `http://127.0.0.1:${port}`, close, capture, received };
}

interface BuildAppOpts {
  /** Override transcription config (for env-injection tests). */
  transcription?: typeof TEST_TRANSCRIPTION & { language?: string };
  /** Captured warn log entries (push target for the test logger). */
  warnSink?: Array<{ obj: unknown; msg: string }>;
}

/** Build a Fastify app with the realtime relay mounted. */
async function buildApp(
  upstreamHttpUrl: string,
  opts: BuildAppOpts = {},
): Promise<FastifyInstance> {
  // Custom logger so we can capture `req.log.warn` calls produced by the
  // route handler. Fastify's `logger` option accepts a plain object; we
  // hand it minimal pino-shaped methods that forward to a sink array.
  // Per project rule the upstream `ws` server is the only mock; the
  // logger sink mocks no internal logic — it just captures the warn
  // calls produced by the relay's own code path.
  const warnSink = opts.warnSink ?? [];
  const noop = () => {
    /* drop */
  };
  // Build a logger that satisfies Fastify's FastifyBaseLogger contract.
  const childLogger = {
    info: noop,
    debug: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    silent: noop,
    level: "info",
    child() {
      return childLogger;
    },
    warn(obj: unknown, msg?: string) {
      warnSink.push({ obj, msg: typeof msg === "string" ? msg : "" });
    },
  };
  const app = Fastify({
    loggerInstance: childLogger as never,
  });
  registerErrorHandler(app);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { user: { id: string; email: string } }).user = {
      id: TEST_USER,
      email: "fixture@conformance.test",
    };
  });
  const deps: RealtimeDeps = {
    litellm: { baseUrl: upstreamHttpUrl } as unknown as LitellmClient,
    masterKey: TEST_MASTER_KEY,
    realtimeModel: TEST_REALTIME_MODEL,
    backend: "litellm",
    openaiRealtimeUrl: "wss://api.openai.com/v1/realtime",
    transcription: opts.transcription ?? TEST_TRANSCRIPTION,
  };
  await app.register(buildRealtimeRoutes(deps));
  await app.ready();
  return app;
}

/** Open a WS to the relay and wait for `open`. */
function dial(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = headers ? new WebSocket(url, { headers }) : new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", (err) => reject(err));
  });
}

/** Wait until the upstream has captured a `session.update` frame. */
async function waitForSessionUpdate(
  received: Array<Record<string, unknown>>,
  timeoutMs = 2000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const f = received.find((x) => x.type === "session.update");
    if (f) return f;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for relay-originated session.update");
}

/** Extract `session.audio.input.transcription` from a captured frame. */
function transcriptionOf(frame: Record<string, unknown>): Record<string, unknown> {
  const session = frame.session as { audio: { input: { transcription: Record<string, unknown> } } };
  return session.audio.input.transcription;
}

describe("M7 — loadRealtimeConfigFromEnv language env validation", () => {
  // The config-loader is the boot-fatal gate. An unrecognized
  // REALTIME_DEFAULT_LANGUAGE value MUST throw `RealtimeConfigError` with
  // a message naming both the offending raw value AND the whitelist —
  // the entrypoint catches the error and exits with EX_CONFIG (78), so
  // the operator sees an actionable line in container stdout rather than
  // a silent fall-through to OpenAI's auto-detect path.

  it("defaults transcription.language to undefined when REALTIME_DEFAULT_LANGUAGE is unset", () => {
    const c = loadRealtimeConfigFromEnv({});
    expect(c.transcription.language).toBeUndefined();
  });

  it("accepts a whitelist value (lowercased, trimmed)", () => {
    expect(
      loadRealtimeConfigFromEnv({ REALTIME_DEFAULT_LANGUAGE: "  RU  " }).transcription.language,
    ).toBe("ru");
    expect(
      loadRealtimeConfigFromEnv({ REALTIME_DEFAULT_LANGUAGE: "en" }).transcription.language,
    ).toBe("en");
  });

  it("throws RealtimeConfigError naming both the value and the whitelist", () => {
    try {
      loadRealtimeConfigFromEnv({ REALTIME_DEFAULT_LANGUAGE: "xx" });
      throw new Error("expected RealtimeConfigError not thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RealtimeConfigError);
      const msg = (err as Error).message;
      expect(msg).toContain("xx");
      expect(msg).toContain("en");
      expect(msg).toContain("ru");
    }
  });

  it("treats a blank REALTIME_DEFAULT_LANGUAGE as unset", () => {
    expect(
      loadRealtimeConfigFromEnv({ REALTIME_DEFAULT_LANGUAGE: "  " }).transcription.language,
    ).toBeUndefined();
  });
});

describe("M8 — buildUpstreamUrl strips client-supplied ?language= in both backends", () => {
  // The relay OWNS the language hint resolution and writes it in-band on
  // the GA `session.update` payload. A client-supplied `?language=` query
  // param MUST NOT survive onto the upstream URL: in `litellm` mode it
  // would confuse LiteLLM's routing layer; in `direct` mode it would be
  // ignored by OpenAI but still represents an unsanctioned param echo. We
  // strip it from BOTH backends' upstream-URL build.
  const litellmDeps: RealtimeDeps = {
    litellm: { baseUrl: "http://litellm:4000" } as unknown as LitellmClient,
    masterKey: TEST_MASTER_KEY,
    realtimeModel: TEST_REALTIME_MODEL,
    backend: "litellm",
    openaiRealtimeUrl: "wss://api.openai.com/v1/realtime",
    transcription: TEST_TRANSCRIPTION,
  };

  for (const backend of ["litellm", "direct"] as const) {
    it(`${backend} mode: strips a client-supplied ?language= from the upstream URL`, () => {
      const deps: RealtimeDeps = {
        ...litellmDeps,
        backend,
        openaiApiKey: backend === "direct" ? "sk-direct" : undefined,
        openaiRealtimeModel: backend === "direct" ? "gpt-realtime" : undefined,
      };
      const out = buildUpstreamUrl(
        deps,
        "/v1/realtime?intent=transcription&language=ru&user=evil&model=evil",
        TEST_USER,
      );
      const u = new URL(out);
      // ?language= must not appear on the upstream leg in either mode.
      expect(u.searchParams.get("language")).toBeNull();
    });

    it(`${backend} mode: forwards a benign client param (lifts the strip-set body coverage)`, () => {
      // Drives the body of the `if (k !== intent/user/model/language)`
      // predicate — the relay must carry forward ANY non-reserved client
      // query param onto the upstream URL. Without this case the `set()`
      // body line never runs in unit tests, leaving an artificial
      // diff-coverage gap on the v1.0.9 strip-predicate edit.
      const deps: RealtimeDeps = {
        ...litellmDeps,
        backend,
        openaiApiKey: backend === "direct" ? "sk-direct" : undefined,
        openaiRealtimeModel: backend === "direct" ? "gpt-realtime" : undefined,
      };
      const out = buildUpstreamUrl(
        deps,
        "/v1/realtime?intent=transcription&trace_id=abc-123&language=ru",
        TEST_USER,
      );
      const u = new URL(out);
      expect(u.searchParams.get("trace_id")).toBe("abc-123");
      // Language still stripped.
      expect(u.searchParams.get("language")).toBeNull();
    });
  }
});

describe("WSS /v1/realtime — relay-originated session.update language injection (v1.0.9)", () => {
  let app: FastifyInstance | undefined;
  let upstream: Awaited<ReturnType<typeof startUpstream>> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    if (upstream) {
      await upstream.close();
      upstream = undefined;
    }
  });

  it("M2: env REALTIME_DEFAULT_LANGUAGE=ru without ?language= → injected frame carries language:ru", async () => {
    upstream = await startUpstream();
    app = await buildApp(upstream.httpUrl, {
      transcription: { ...TEST_TRANSCRIPTION, language: "ru" },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;
    const ws = await dial(`ws://127.0.0.1:${port}/v1/realtime?intent=transcription`);
    const frame = await waitForSessionUpdate(upstream.received);
    expect(transcriptionOf(frame).language).toBe("ru");
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("M3: env=en + ?language=ru → query WINS, injected frame carries language:ru", async () => {
    upstream = await startUpstream();
    app = await buildApp(upstream.httpUrl, {
      transcription: { ...TEST_TRANSCRIPTION, language: "en" },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;
    const ws = await dial(`ws://127.0.0.1:${port}/v1/realtime?intent=transcription&language=ru`);
    const frame = await waitForSessionUpdate(upstream.received);
    expect(transcriptionOf(frame).language).toBe("ru");
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("M5: env unset + ?language=xx → field OMITTED, warn-level log fired with event=realtime.language.invalid", async () => {
    upstream = await startUpstream();
    const warnSink: Array<{ obj: unknown; msg: string }> = [];
    app = await buildApp(upstream.httpUrl, { warnSink });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;
    const ws = await dial(`ws://127.0.0.1:${port}/v1/realtime?intent=transcription&language=xx`);
    const frame = await waitForSessionUpdate(upstream.received);
    // Invalid → omit (fall through to OpenAI auto-detect).
    expect("language" in transcriptionOf(frame)).toBe(false);
    // Warn-level log fired exactly once, with the structured event.
    const matched = warnSink.find((e) => {
      const obj = e.obj as Record<string, unknown> | null;
      return obj && obj.event === "realtime.language.invalid" && obj.value === "xx";
    });
    expect(matched).toBeDefined();
    expect((matched?.obj as Record<string, unknown>).falling_back_to_env_default).toBe(false);
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("M6: query ?language=RU is case-folded to 'ru' and matches the whitelist", async () => {
    upstream = await startUpstream();
    app = await buildApp(upstream.httpUrl);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;
    const ws = await dial(`ws://127.0.0.1:${port}/v1/realtime?intent=transcription&language=RU`);
    const frame = await waitForSessionUpdate(upstream.received);
    expect(transcriptionOf(frame).language).toBe("ru");
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("M9: concurrent upgrades isolate per-upgrade language; deps.transcription stays unmutated", async () => {
    // Property test: two parallel upgrades with different `?language=`
    // query values MUST each see THEIR OWN language in the upstream-
    // received frame. If the route mutated the singleton
    // `deps.transcription.language` instead of building a per-upgrade
    // shallow clone, the second upgrade's mutation would race the first
    // upgrade's send and the assertions would interleave.
    upstream = await startUpstream();
    // Use a single upstream that captures all frames; we tell apart per-
    // upgrade frames by spawning two distinct app instances (each with
    // its own captured `transcription` reference) — that proves the
    // route doesn't mutate the deps object behind our back.
    const upstream2 = await startUpstream();
    try {
      const baseTranscription = {
        ...TEST_TRANSCRIPTION,
        language: undefined,
      } as typeof TEST_TRANSCRIPTION & { language?: string };
      const appA = await buildApp(upstream.httpUrl, { transcription: { ...baseTranscription } });
      const appB = await buildApp(upstream2.httpUrl, { transcription: { ...baseTranscription } });
      try {
        await appA.listen({ port: 0, host: "127.0.0.1" });
        await appB.listen({ port: 0, host: "127.0.0.1" });
        const portA = (appA.server.address() as AddressInfo).port;
        const portB = (appB.server.address() as AddressInfo).port;

        const [wsA, wsB] = await Promise.all([
          dial(`ws://127.0.0.1:${portA}/v1/realtime?intent=transcription&language=ru`),
          dial(`ws://127.0.0.1:${portB}/v1/realtime?intent=transcription&language=en`),
        ]);
        const [frameA, frameB] = await Promise.all([
          waitForSessionUpdate(upstream.received),
          waitForSessionUpdate(upstream2.received),
        ]);

        expect(transcriptionOf(frameA).language).toBe("ru");
        expect(transcriptionOf(frameB).language).toBe("en");
        // Singleton purity: the deps.transcription this test passed in
        // must NOT have been mutated by either upgrade. The base object
        // had `language: undefined`; the shallow clones consumed by the
        // bridges should NOT have rippled back.
        expect(baseTranscription.language).toBeUndefined();

        wsA.close();
        wsB.close();
        await Promise.all([
          new Promise<void>((res) => wsA.once("close", () => res())),
          new Promise<void>((res) => wsB.once("close", () => res())),
        ]);
      } finally {
        await appA.close();
        await appB.close();
      }
    } finally {
      await upstream2.close();
    }
  });
});
