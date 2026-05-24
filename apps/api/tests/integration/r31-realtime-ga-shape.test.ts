// SPDX-License-Identifier: FSL-1.1-ALv2
// R31 — the regression-catching integration test for the frame-aware
// /v1/realtime relay (debug session r31-realtime-ga-shape).
//
// WHY THIS TEST EXISTS
// ====================
// R31 (the OpenAI Realtime Beta→GA migration bug) was closed TWICE on
// green unit tests and failed live BOTH times — because the tests
// asserted the wrong leg. The old realtime unit tests checked
// @fastify/http-proxy register options; the old mock-realtime accepted
// ANY connection unconditionally. Nothing asserted that the relay
// forwarded a *GA-shaped* upstream connection.
//
// This test closes that gap. It:
//   1. Boots a REAL Fastify app with the REAL dual-auth hook bound to a
//      REAL Better Auth instance over a REAL Postgres (testcontainers) —
//      a genuine signed-in user, a genuine `Authorization: Bearer` token.
//   2. Mounts the REAL frame-aware /v1/realtime relay.
//   3. Drives the upstream leg against the hermetic mock-OpenAI
//      (tests/e2e/mock-realtime) which now ASSERTS GA shape: it REJECTS
//      any upstream connection carrying `?intent=` or an `OpenAI-Beta`
//      header, and rejects Beta frame vocabulary.
//   4. Asserts the bidirectional Beta↔GA translation end-to-end.
//   5. Covers BOTH backend modes — `litellm` and `direct`.
//
// A Beta-vs-GA regression (the `?intent=` strip removed, the OpenAI-Beta
// header re-added, the frame translation broken) FAILS this test.

import { dirname as pathDirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LitellmClient } from "@openwhispr/litellm-client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type RawData, WebSocket } from "ws";
import {
  MOCK_TRANSCRIPT,
  type StopHandle,
  startMockRealtimeServer,
} from "../../../../tests/e2e/mock-realtime/server.js";
import { buildAuth } from "../../src/auth.js";
import { DEFAULT_REALTIME_TRANSCRIPTION } from "../../src/config/realtime.js";
import { registerErrorHandler } from "../../src/error-handler.js";
import { buildDualAuthHook } from "../../src/middleware/dual-auth.js";
import { buildRealtimeRoutes, type RealtimeDeps } from "../../src/routes/realtime.js";

const __dirname = pathDirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "data",
  "migrations",
);

const TEST_MASTER_KEY = "sk-litellm-master-r31-test";
const TEST_REALTIME_MODEL = "realtime-default";

let container: StartedPostgreSqlContainer;
let ownerPool: Pool;
let appPool: Pool;
// biome-ignore lint/suspicious/noExplicitAny: AuthInstance public surface is narrow.
let auth: any;

beforeAll(async () => {
  process.env.MASTER_KEK = process.env.MASTER_KEK ?? Buffer.alloc(32).toString("base64url");
  process.env.BETTER_AUTH_SECRET ??=
    "0000000000000000000000000000000000000000000000000000000000000000";
  process.env.OPENWHISPR_DISABLE_EMAIL_VERIFICATION = "1";
  process.env.OPENWHISPR_KEY_PROVIDER = process.env.OPENWHISPR_KEY_PROVIDER ?? "env";

  container = await new PostgreSqlContainer(
    "ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1",
  )
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  await superPool.query("CREATE SCHEMA IF NOT EXISTS partman");
  await superPool.query("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD 'owner-pw'`,
  );
  await superPool.query(`CREATE ROLE openwhispr_app WITH LOGIN PASSWORD 'app-pw'`);
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);

  ownerPool = new Pool({
    connectionString: `postgres://openwhispr_owner:owner-pw@${host}:${port}/openwhispr`,
  });
  await migrate(drizzle(ownerPool), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });

  appPool = new Pool({
    connectionString: `postgres://openwhispr_app:app-pw@${host}:${port}/openwhispr`,
  });
  // biome-ignore lint/suspicious/noExplicitAny: structural Drizzle node-postgres client.
  auth = buildAuth({ db: drizzle(appPool) as any });
}, 240_000);

afterAll(async () => {
  await appPool?.end();
  await ownerPool?.end();
  await container?.stop();
}, 60_000);

/** Sign up + sign in a fresh user; return the raw bearer token. */
async function signInFreshUser(): Promise<string> {
  const email = `r31-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "R31!Str0ngPass";
  await auth.api.signUpEmail({ body: { email, password, name: "R31 User" } });
  const signIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const token = (signIn.headers as Headers).get("set-auth-token");
  if (!token) throw new Error("signInEmail did not emit a set-auth-token header");
  return token;
}

/**
 * Boot a real Fastify app: registerErrorHandler + the REAL dual-auth hook
 * (bound to the real Better Auth) + the REAL frame-aware realtime relay.
 * Returns the app listening on an ephemeral port plus its ws:// base.
 */
async function bootRealtimeApp(deps: RealtimeDeps): Promise<{
  app: FastifyInstance;
  wsBase: string;
}> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  // The REAL dual-auth hook — genuine Better Auth session resolution.
  app.addHook("onRequest", buildDualAuthHook({ auth }));
  await app.register(buildRealtimeRoutes(deps));
  await app.ready();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no ephemeral port");
  return { app, wsBase: `ws://127.0.0.1:${addr.port}` };
}

/** Collect frames from a WS until `predicate` is satisfied or it closes. */
function awaitFrame(
  ws: WebSocket,
  predicate: (frame: Record<string, unknown>) => boolean,
  timeoutMs = 8_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("awaitFrame timeout")), timeoutMs);
    const onMessage = (raw: RawData) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (predicate(frame)) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(frame);
      }
    };
    ws.on("message", onMessage);
    ws.once("close", (code) => {
      clearTimeout(timer);
      reject(new Error(`WS closed (code ${code}) before the awaited frame arrived`));
    });
  });
}

describe("R31 — frame-aware /v1/realtime relay GA-shape regression (litellm + direct)", () => {
  let mock: StopHandle | undefined;
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      // @fastify/websocket can keep the HTTP server alive on lingering
      // half-open upgrade sockets (e.g. an aborted unauthenticated
      // upgrade). Race app.close() against a short fallback so a stuck
      // socket cannot hang the whole suite — the testcontainer + mock are
      // still torn down deterministically below.
      await Promise.race([app.close(), new Promise<void>((res) => setTimeout(res, 3_000))]);
      app = undefined;
    }
    if (mock) {
      await mock.stop();
      mock = undefined;
    }
  }, 15_000);

  it("rejects an unauthenticated WS upgrade with HTTP 401 (real auth gate)", async () => {
    mock = await startMockRealtimeServer({ port: 0 });
    const litellmHttp = mock.url.replace(/^ws:/, "http:").replace(/\/v1\/realtime$/, "");
    const booted = await bootRealtimeApp({
      litellm: { baseUrl: litellmHttp } as unknown as LitellmClient,
      masterKey: TEST_MASTER_KEY,
      realtimeModel: TEST_REALTIME_MODEL,
      transcription: DEFAULT_REALTIME_TRANSCRIPTION,
      backend: "litellm",
      openaiRealtimeUrl: "wss://api.openai.com/v1/realtime",
    });
    app = booted.app;

    const result = await new Promise<{ status: number; opened: boolean }>((resolve) => {
      const ws = new WebSocket(`${booted.wsBase}/v1/realtime?intent=transcription`);
      let opened = false;
      ws.on("open", () => {
        opened = true;
      });
      ws.on("unexpected-response", (_req, res) => resolve({ status: res.statusCode ?? 0, opened }));
      ws.on("error", () => {
        if (!opened) resolve({ status: 0, opened });
      });
      ws.on("close", () => resolve({ status: opened ? 101 : -1, opened }));
    });
    expect(result.opened).toBe(false);
    expect(result.status).toBe(401);
  }, 60_000);

  it("litellm mode: a real signed-in user reaches the GA-asserting upstream and gets transcription_session.created", async () => {
    // The mock REJECTS `?intent=` and `OpenAI-Beta`. If the relay failed
    // to strip `?intent=` (DEFECT 1) or attached an OpenAI-Beta header
    // (DEFECT 2), the mock would close the upstream 4400 and the relay
    // would propagate a close — `transcription_session.created` would
    // never arrive and this test would FAIL.
    mock = await startMockRealtimeServer({ port: 0 });
    const litellmHttp = mock.url.replace(/^ws:/, "http:").replace(/\/v1\/realtime$/, "");
    const booted = await bootRealtimeApp({
      litellm: { baseUrl: litellmHttp } as unknown as LitellmClient,
      masterKey: TEST_MASTER_KEY,
      realtimeModel: TEST_REALTIME_MODEL,
      transcription: DEFAULT_REALTIME_TRANSCRIPTION,
      backend: "litellm",
      openaiRealtimeUrl: "wss://api.openai.com/v1/realtime",
    });
    app = booted.app;

    const token = await signInFreshUser();
    // The immutable desktop client opens with the Beta `?intent=`.
    const ws = new WebSocket(`${booted.wsBase}/v1/realtime?intent=transcription`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });

    // DEFECT 3 — the client waits for the Beta `transcription_session.
    // created`; the GA upstream emits `session.created`; the relay must
    // translate it back.
    const created = await awaitFrame(ws, (f) => f.type === "transcription_session.created");
    expect(created.type).toBe("transcription_session.created");

    // Bidirectional — the client sends a Beta `transcription_session.
    // update`; the GA-asserting mock would close 4400 on a Beta frame OR
    // on a flat Beta session payload (DEFECT 4), so a `session.updated`
    // reply proves the relay translated BOTH the frame name AND the
    // payload to GA shape. The mock echoes the (GA-shaped) payload back;
    // the relay flattens it GA→Beta so the client sees Beta field names.
    ws.send(
      JSON.stringify({
        type: "transcription_session.update",
        session: { input_audio_format: "pcm16" },
      }),
    );
    const updated = await awaitFrame(ws, (f) => f.type === "transcription_session.updated");
    // The GA `type` discriminator is dropped on the way back; the Beta
    // client reads the flat `input_audio_format` field instead.
    const updatedSession = updated.session as Record<string, unknown>;
    expect(updatedSession.type).toBeUndefined();
    expect(updatedSession.input_audio_format).toBe("pcm16");

    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  }, 60_000);

  it("direct mode: a real signed-in user reaches the GA-asserting upstream straight (no LiteLLM hop)", async () => {
    // `direct` mode points the relay straight at the mock's ws:// URL via
    // openaiRealtimeUrl, bypassing any LiteLLM-derived base. The mock
    // still asserts GA shape — proving the direct leg is GA-clean.
    mock = await startMockRealtimeServer({ port: 0 });
    const booted = await bootRealtimeApp({
      // litellm.baseUrl is unused in direct mode — point it somewhere
      // invalid to prove direct mode does NOT consult it.
      litellm: { baseUrl: "http://litellm.invalid:4000" } as unknown as LitellmClient,
      masterKey: TEST_MASTER_KEY,
      realtimeModel: TEST_REALTIME_MODEL,
      transcription: DEFAULT_REALTIME_TRANSCRIPTION,
      backend: "direct",
      openaiRealtimeUrl: mock.url,
      openaiApiKey: "sk-direct-r31-test",
    });
    app = booted.app;

    const token = await signInFreshUser();
    const ws = new WebSocket(`${booted.wsBase}/v1/realtime?intent=transcription`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });

    const created = await awaitFrame(ws, (f) => f.type === "transcription_session.created");
    expect(created.type).toBe("transcription_session.created");

    ws.send(JSON.stringify({ type: "transcription_session.update", session: {} }));
    const updated = await awaitFrame(ws, (f) => f.type === "transcription_session.updated");
    expect(updated.type).toBe("transcription_session.updated");

    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  }, 60_000);

  it("litellm mode DATA PATH: append→commit yields a non-empty transcription result at the client", async () => {
    // R31 third layer (DEFECT 4). The mock asserts the GA-shaped
    // session.update payload (nested audio.input.format object). It then
    // drives the data path: append audio, commit, emit GA transcription
    // result events. The client must receive a NON-EMPTY transcript — the
    // exact symptom (segments:0, textLength:0) the live client reported.
    mock = await startMockRealtimeServer({ port: 0 });
    const litellmHttp = mock.url.replace(/^ws:/, "http:").replace(/\/v1\/realtime$/, "");
    const booted = await bootRealtimeApp({
      litellm: { baseUrl: litellmHttp } as unknown as LitellmClient,
      masterKey: TEST_MASTER_KEY,
      realtimeModel: TEST_REALTIME_MODEL,
      transcription: DEFAULT_REALTIME_TRANSCRIPTION,
      backend: "litellm",
      openaiRealtimeUrl: "wss://api.openai.com/v1/realtime",
    });
    app = booted.app;

    const token = await signInFreshUser();
    const ws = new WebSocket(`${booted.wsBase}/v1/realtime?intent=transcription`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });

    await awaitFrame(ws, (f) => f.type === "transcription_session.created");

    // The immutable client sends the FLAT Beta session.update payload —
    // verbatim the shape from openwhispr/src/helpers/openaiRealtimeStreaming.js.
    // If the relay forwards it flat (DEFECT 4) the GA-asserting mock closes
    // 4400 and the awaited transcript frame never arrives.
    ws.send(
      JSON.stringify({
        type: "transcription_session.update",
        session: {
          input_audio_format: "pcm16",
          input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.6,
            silence_duration_ms: 600,
            prefix_padding_ms: 500,
          },
        },
      }),
    );
    await awaitFrame(ws, (f) => f.type === "transcription_session.updated");

    // Stream real PCM16 audio (silence is fine — the mock counts bytes).
    const pcmChunk = Buffer.alloc(24_000 * 2); // 1s of 24kHz 16-bit PCM.
    ws.send(
      JSON.stringify({ type: "input_audio_buffer.append", audio: pcmChunk.toString("base64") }),
    );
    // The client's explicit commit frame (disconnect path).
    ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

    // The transcription RESULT must reach the client with a non-empty
    // transcript — this is the resolution criterion.
    const completed = await awaitFrame(
      ws,
      (f) => f.type === "conversation.item.input_audio_transcription.completed",
    );
    expect(completed.transcript).toBe(MOCK_TRANSCRIPT);
    expect(typeof completed.transcript).toBe("string");
    expect((completed.transcript as string).length).toBeGreaterThan(0);

    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  }, 60_000);

  it("direct mode DATA PATH: append→commit yields a non-empty transcription result at the client", async () => {
    mock = await startMockRealtimeServer({ port: 0 });
    const booted = await bootRealtimeApp({
      litellm: { baseUrl: "http://litellm.invalid:4000" } as unknown as LitellmClient,
      masterKey: TEST_MASTER_KEY,
      realtimeModel: TEST_REALTIME_MODEL,
      transcription: DEFAULT_REALTIME_TRANSCRIPTION,
      backend: "direct",
      openaiRealtimeUrl: mock.url,
      openaiApiKey: "sk-direct-r31-test",
    });
    app = booted.app;

    const token = await signInFreshUser();
    const ws = new WebSocket(`${booted.wsBase}/v1/realtime?intent=transcription`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });

    await awaitFrame(ws, (f) => f.type === "transcription_session.created");

    ws.send(
      JSON.stringify({
        type: "transcription_session.update",
        session: {
          input_audio_format: "pcm16",
          input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
          turn_detection: { type: "server_vad" },
        },
      }),
    );
    await awaitFrame(ws, (f) => f.type === "transcription_session.updated");

    // Collect ALL data-path frames with a persistent listener — the mock
    // emits committed→delta→completed back-to-back, so sequential
    // awaitFrame calls would race (a frame can arrive between two awaits).
    const dataFrames: Array<Record<string, unknown>> = [];
    ws.on("message", (raw: RawData) => {
      try {
        dataFrames.push(JSON.parse(raw.toString()));
      } catch {
        /* ignore */
      }
    });

    const pcmChunk = Buffer.alloc(24_000 * 2);
    ws.send(
      JSON.stringify({ type: "input_audio_buffer.append", audio: pcmChunk.toString("base64") }),
    );
    ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

    // Wait until the completed transcription result lands.
    await awaitFrame(ws, (f) => f.type === "conversation.item.input_audio_transcription.completed");
    const delta = dataFrames.find(
      (f) => f.type === "conversation.item.input_audio_transcription.delta",
    );
    expect(delta).toBeDefined();
    expect(typeof delta?.delta).toBe("string");
    const completed = dataFrames.find(
      (f) => f.type === "conversation.item.input_audio_transcription.completed",
    );
    expect(completed?.transcript).toBe(MOCK_TRANSCRIPT);

    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  }, 60_000);

  it("PRECONFIGURED MODE (direct): silent client (NO session.update) → relay injects GA session.update → non-empty transcript", async () => {
    // R31 DEFECT 6 — THE regression test for the FOURTH round. The real
    // cloud desktop client runs PRECONFIGURED: it sends NO
    // `session.update`/`transcription_session.update` at all (ipcHandlers.js
    // `preconfigured: isCloud`; openaiRealtimeStreaming.js:135). c069f369's
    // `betaToGaSessionPayload` transform translated a frame this client
    // NEVER sends → the GA transcription session was never configured →
    // segments:0, textLength:0, commit timeout (the live symptom).
    //
    // The fix: the RELAY itself injects a GA `session.update` on upstream
    // open. This test exercises EXACTLY the preconfigured client: it sends
    // only `input_audio_buffer.append` + `.commit`, never a session update.
    //
    // Assertions:
    //   1. The GA-asserting mock RECEIVED a relay-originated `session.update`
    //      with the correct nested transcription config — a relay that
    //      stops injecting leaves `receivedSessionUpdates()` empty.
    //   2. End-to-end: silent client → relay-injected config → append+commit
    //      → NON-EMPTY transcript reaches the client. The mock gates the
    //      transcript on a configured session, so a missing injection
    //      yields committed-but-no-transcript and this test FAILS.
    mock = await startMockRealtimeServer({ port: 0 });
    const booted = await bootRealtimeApp({
      litellm: { baseUrl: "http://litellm.invalid:4000" } as unknown as LitellmClient,
      masterKey: TEST_MASTER_KEY,
      realtimeModel: TEST_REALTIME_MODEL,
      transcription: DEFAULT_REALTIME_TRANSCRIPTION,
      backend: "direct",
      openaiRealtimeUrl: mock.url,
      openaiApiKey: "sk-direct-r31-test",
    });
    app = booted.app;

    const token = await signInFreshUser();
    const ws = new WebSocket(`${booted.wsBase}/v1/realtime?intent=transcription`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });

    // The preconfigured client completes its startup handshake on
    // `transcription_session.created` and sends NO update.
    await awaitFrame(ws, (f) => f.type === "transcription_session.created");

    // Collect all data-path frames with a persistent listener.
    const dataFrames: Array<Record<string, unknown>> = [];
    ws.on("message", (raw: RawData) => {
      try {
        dataFrames.push(JSON.parse(raw.toString()));
      } catch {
        /* ignore */
      }
    });

    // EXACTLY the preconfigured client: ONLY append + commit, no update.
    const pcmChunk = Buffer.alloc(24_000 * 2);
    ws.send(
      JSON.stringify({ type: "input_audio_buffer.append", audio: pcmChunk.toString("base64") }),
    );
    ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

    // The transcript MUST come back non-empty — proving the relay
    // configured the session despite the silent client.
    const completed = await awaitFrame(
      ws,
      (f) => f.type === "conversation.item.input_audio_transcription.completed",
    );
    expect(completed.transcript).toBe(MOCK_TRANSCRIPT);
    expect((completed.transcript as string).length).toBeGreaterThan(0);

    // Assertion 1 — the mock RECEIVED a relay-originated session.update.
    const updates = mock.receivedSessionUpdates();
    expect(updates.length).toBeGreaterThanOrEqual(1);
    const injected = updates[0] as {
      session?: {
        type?: string;
        audio?: { input?: { format?: unknown; transcription?: { model?: string } } };
      };
    };
    expect(injected.session?.type).toBe("transcription");
    expect(injected.session?.audio?.input?.format).toEqual({
      type: "audio/pcm",
      rate: DEFAULT_REALTIME_TRANSCRIPTION.inputAudioRate,
    });
    expect(injected.session?.audio?.input?.transcription?.model).toBe(
      DEFAULT_REALTIME_TRANSCRIPTION.model,
    );

    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  }, 60_000);

  it("PRECONFIGURED MODE (litellm): silent client → relay injects GA session.update → non-empty transcript", async () => {
    // Same as above for the `litellm` backend — DEFECT 6 fix must carry on
    // BOTH backends (resolution criterion (c)).
    mock = await startMockRealtimeServer({ port: 0 });
    const litellmHttp = mock.url.replace(/^ws:/, "http:").replace(/\/v1\/realtime$/, "");
    const booted = await bootRealtimeApp({
      litellm: { baseUrl: litellmHttp } as unknown as LitellmClient,
      masterKey: TEST_MASTER_KEY,
      realtimeModel: TEST_REALTIME_MODEL,
      transcription: DEFAULT_REALTIME_TRANSCRIPTION,
      backend: "litellm",
      openaiRealtimeUrl: "wss://api.openai.com/v1/realtime",
    });
    app = booted.app;

    const token = await signInFreshUser();
    const ws = new WebSocket(`${booted.wsBase}/v1/realtime?intent=transcription`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });
    await awaitFrame(ws, (f) => f.type === "transcription_session.created");

    const pcmChunk = Buffer.alloc(24_000 * 2);
    ws.send(
      JSON.stringify({ type: "input_audio_buffer.append", audio: pcmChunk.toString("base64") }),
    );
    ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

    const completed = await awaitFrame(
      ws,
      (f) => f.type === "conversation.item.input_audio_transcription.completed",
    );
    expect(completed.transcript).toBe(MOCK_TRANSCRIPT);

    const updates = mock.receivedSessionUpdates();
    expect(updates.length).toBeGreaterThanOrEqual(1);

    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  }, 60_000);

  it("direct mode with no OPENAI_API_KEY refuses the WS upgrade (401)", async () => {
    mock = await startMockRealtimeServer({ port: 0 });
    const booted = await bootRealtimeApp({
      litellm: { baseUrl: "http://litellm.invalid:4000" } as unknown as LitellmClient,
      masterKey: TEST_MASTER_KEY,
      realtimeModel: TEST_REALTIME_MODEL,
      transcription: DEFAULT_REALTIME_TRANSCRIPTION,
      backend: "direct",
      openaiRealtimeUrl: mock.url,
      // openaiApiKey deliberately absent
    });
    app = booted.app;

    const token = await signInFreshUser();
    const result = await new Promise<{ status: number; opened: boolean }>((resolve) => {
      const ws = new WebSocket(`${booted.wsBase}/v1/realtime?intent=transcription`, {
        headers: { authorization: `Bearer ${token}` },
      });
      let opened = false;
      ws.on("open", () => {
        opened = true;
      });
      ws.on("unexpected-response", (_req, res) => resolve({ status: res.statusCode ?? 0, opened }));
      ws.on("error", () => {
        if (!opened) resolve({ status: 0, opened });
      });
      ws.on("close", () => resolve({ status: opened ? 101 : -1, opened }));
    });
    // Authenticated, but direct mode with no key refuses the upgrade.
    expect(result.opened).toBe(false);
    expect(result.status).toBe(401);
  }, 60_000);
});
