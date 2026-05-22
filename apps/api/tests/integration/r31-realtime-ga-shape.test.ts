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
  type StopHandle,
  startMockRealtimeServer,
} from "../../../../tests/e2e/mock-realtime/server.js";
import { buildAuth } from "../../src/auth.js";
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

  container = await new PostgreSqlContainer("openwhispr/postgres:17.5-pgpartman")
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
    // update`; the GA-asserting mock would close 4400 on a Beta frame, so
    // a `session.updated` reply proves the relay translated it to GA
    // `session.update`. The mock echoes the session payload back.
    ws.send(
      JSON.stringify({
        type: "transcription_session.update",
        session: { input_audio_format: "pcm16" },
      }),
    );
    const updated = await awaitFrame(ws, (f) => f.type === "transcription_session.updated");
    expect((updated.session as Record<string, unknown>).type).toBe("transcription");

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

  it("direct mode with no OPENAI_API_KEY refuses the WS upgrade (401)", async () => {
    mock = await startMockRealtimeServer({ port: 0 });
    const booted = await bootRealtimeApp({
      litellm: { baseUrl: "http://litellm.invalid:4000" } as unknown as LitellmClient,
      masterKey: TEST_MASTER_KEY,
      realtimeModel: TEST_REALTIME_MODEL,
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
