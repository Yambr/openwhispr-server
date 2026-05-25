// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 04 / Task 2 — GET /api/stt-config plugin tests.
//
// Mirror of streaming-usage.test.ts strategy: hand-rolled fake
// TransactionalDb that records executed SQL; dualAuthHook stubbed via
// onRequest. Full chain semantics covered by
// apps/api/src/lib/__tests__/settings-resolver.test.ts — this file
// asserts the route wire-shape: 200 + zod-parsed body, 401 on missing
// auth, RLS contract (both tables touched within the same
// withTenant transaction), env-driven availableProviders.

import { SttConfigResponseSchema } from "@openwhispr/wire-schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSttSettingsConfigFromEnv } from "../../../../src/config/stt-settings.js";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildSttConfigRoutes } from "../../../../src/routes/stt-config.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "22222222-2222-2222-2222-222222222222";

interface Recorded {
  sql: string;
  params: unknown[];
}

interface FakeDbOpts {
  tenantStt?: unknown;
  userStt?: unknown;
}

function makeFakeDb(opts: FakeDbOpts = {}): {
  db: Parameters<typeof buildSttConfigRoutes>[0]["db"];
  recorded: Recorded[];
} {
  const recorded: Recorded[] = [];
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const parts: string[] = [];
      const params: unknown[] = [];
      for (const c of chunks) {
        if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
            parts.push((v as string[]).join(""));
          } else {
            parts.push("?");
            params.push(v);
          }
        } else {
          parts.push("?");
          params.push(c);
        }
      }
      const sqlText = parts.join("");
      recorded.push({ sql: sqlText, params });
      if (/FROM tenant_settings/i.test(sqlText)) {
        return { rows: [{ stt_config: opts.tenantStt ?? {} }] };
      }
      if (/FROM user_settings/i.test(sqlText)) {
        return { rows: [{ stt_overrides: opts.userStt ?? {} }] };
      }
      return { rows: [] };
    },
  };
  const db = {
    async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
  return { db, recorded };
}

// AUDIT-LIB-02 — the route now consumes a resolved `sttSettingsConfig`
// (env-default tier) injected as a dependency. `buildApp` resolves it from
// an optional env snapshot via the same `config/` loader production uses,
// so the tests exercise real env validation without mutating `process.env`.
function buildApp(
  deps: { db: Parameters<typeof buildSttConfigRoutes>[0]["db"] },
  opts?: { authed?: boolean; env?: Record<string, string> },
): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.register(zodTypeProvider);
  if (opts?.authed !== false) {
    app.addHook("onRequest", async (req) => {
      req.user = { id: TEST_USER, email: "stt-config@test" };
      req.tenant = TEST_TENANT;
    });
  }
  app.register(
    buildSttConfigRoutes({
      db: deps.db,
      sttSettingsConfig: loadSttSettingsConfigFromEnv((opts?.env ?? {}) as NodeJS.ProcessEnv),
    }),
  );
  return app;
}

const ENV_KEYS = [
  "STT_DEFAULT_MODEL",
  "STT_DEFAULT_LANGUAGE",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "ASSEMBLYAI_API_KEY",
  "DEEPGRAM_API_KEY",
] as const;
const SNAPSHOT: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    SNAPSHOT[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SNAPSHOT[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = SNAPSHOT[k];
    }
    delete SNAPSHOT[k];
  }
});

describe("GET /api/stt-config", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 200 + zod-parsed canonical SttConfigResponse on the happy path", async () => {
    const { db } = makeFakeDb();
    app = buildApp({ db });
    const res = await app.inject({ method: "GET", url: "/api/stt-config" });
    expect(res.statusCode).toBe(200);
    const parsed = SttConfigResponseSchema.parse(res.json());
    expect(parsed.defaultModel).toBe("openwhispr-default");
    expect(parsed.defaultLanguage).toBe("auto");
    expect(parsed.availableProviders).toEqual([]);
  });

  // LEAK 1 regression (2026-05-25, peer wd6g78xz openwhispr client v1.7.8).
  // The previous default was `whisper-1` (OpenAI upstream alias) which
  // leaked through to lockdown-branded desktop builds as the displayed
  // STT model. The server now hands out the canonical `openwhispr-*`
  // namespace; operators that wire a non-bundled upstream override
  // STT_DEFAULT_MODEL, and the alias mapping stays in their LiteLLM
  // config out of view of the client.
  it("LEAK 1: defaultModel carries the canonical openwhispr-* prefix (no upstream-name leak)", async () => {
    const { db } = makeFakeDb();
    app = buildApp({ db });
    const res = await app.inject({ method: "GET", url: "/api/stt-config" });
    expect(res.statusCode).toBe(200);
    const parsed = SttConfigResponseSchema.parse(res.json());
    expect(parsed.defaultModel).toMatch(/^openwhispr-/);
    // Sanity: the previous-default upstream alias must NOT come through
    // by default (operator override via STT_DEFAULT_MODEL is still
    // permitted and exercised by the user/tenant override tests).
    expect(parsed.defaultModel).not.toBe("whisper-1");
  });

  it("returns 401 envelope when req.user is absent (defensive guard)", async () => {
    const { db } = makeFakeDb();
    app = buildApp({ db }, { authed: false });
    const res = await app.inject({ method: "GET", url: "/api/stt-config" });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBeTruthy();
  });

  it("queries BOTH tenant_settings AND user_settings under withTenant (RLS contract)", async () => {
    const { db, recorded } = makeFakeDb();
    app = buildApp({ db });
    const res = await app.inject({ method: "GET", url: "/api/stt-config" });
    expect(res.statusCode).toBe(200);
    const sqls = recorded.map((r) => r.sql).join("\n");
    // withTenant binds the GUC, then resolver SELECTs both tables.
    expect(sqls).toMatch(/set_config\('app\.tenant_id'/);
    expect(sqls).toMatch(/FROM tenant_settings/);
    expect(sqls).toMatch(/FROM user_settings/);
    const params = recorded.flatMap((r) => r.params);
    expect(params).toContain(TEST_TENANT);
    expect(params).toContain(TEST_USER);
  });

  it("user override wins over tenant + config-tier env in the rendered response", async () => {
    const { db } = makeFakeDb({
      tenantStt: { defaultModel: "large-v3" },
      userStt: { defaultModel: "tiny" },
    });
    app = buildApp({ db }, { env: { STT_DEFAULT_MODEL: "whisper-1" } });
    const res = await app.inject({ method: "GET", url: "/api/stt-config" });
    expect(res.statusCode).toBe(200);
    const parsed = SttConfigResponseSchema.parse(res.json());
    expect(parsed.defaultModel).toBe("tiny");
  });

  it("availableProviders reflects the provider keys resolved at boot (D-19)", async () => {
    // AUDIT-LIB-02 — provider-key presence is resolved once at the config
    // boundary (LOCKER-01) and threaded in. In the Docker deployment model
    // process env is fixed for a container's lifetime, so boot-time
    // resolution is equivalent to the former per-request read.
    const { db: emptyDb } = makeFakeDb();
    app = buildApp({ db: emptyDb });
    let res = await app.inject({ method: "GET", url: "/api/stt-config" });
    expect(SttConfigResponseSchema.parse(res.json()).availableProviders).toEqual([]);
    await app.close();

    const { db: keyedDb } = makeFakeDb();
    app = buildApp({ db: keyedDb }, { env: { OPENAI_API_KEY: "sk-x", GROQ_API_KEY: "gsk-x" } });
    res = await app.inject({ method: "GET", url: "/api/stt-config" });
    expect(SttConfigResponseSchema.parse(res.json()).availableProviders).toEqual([
      "openai",
      "groq",
    ]);
  });

  it("ignores availableProviders set in tenant/user JSONB (sourced from env only, D-19)", async () => {
    const { db } = makeFakeDb({
      tenantStt: { availableProviders: ["tenant-bogus"] },
      userStt: { availableProviders: ["user-bogus"] },
    });
    app = buildApp({ db });
    const res = await app.inject({ method: "GET", url: "/api/stt-config" });
    const parsed = SttConfigResponseSchema.parse(res.json());
    expect(parsed.availableProviders).not.toContain("tenant-bogus");
    expect(parsed.availableProviders).not.toContain("user-bogus");
  });
});
