// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 02.7 / Plan 02.7-02 / D-01 — end-to-end channel-scheme test
// covering the real mintBearer adapter wired into the auth-callback route.
//
// Source-of-record commit: <filled at commit time>
//
// Reverts: restoring the auth.handler('/api/auth/oauth2/callback/...')
// delegation in mint-bearer.ts → state_not_found 400 from Better Auth's
// callbackOAuth route → mintBearer throws → 500 envelope (NOT 302) →
// final Location header missing or wrong shape → this test RED.
//
// What this test pins (per AUTH-02 wire contract from oauth-redirect.test.ts:82):
//   final 302 Location matches /^openwhispr-dev:\/\/\?bearer_token=/
//
// Mock strategy (per RESEARCH §D-01 + auth-trusted-origins.test.ts pattern):
//   - vi.stubGlobal('fetch', ...) for IdP token + userinfo exchange
//   - Fake auth.$context with internalAdapter spies
//   - Fake DB matching auth-callback.test.ts pattern (queryChunks SQL)
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { _resetDefaultTenantCacheForTesting } from "../../../src/lib/default-tenant.js";
import { buildMintBearer } from "../../../src/lib/mint-bearer.js";
import { buildAuthCallbackRoutes } from "../../../src/routes/auth-callback.js";

const STATE_ID = "11111111-2222-3333-4444-555555555555";
const FAKE_TOKEN = "b".repeat(32);

interface FakeStateRow {
  id: string;
  scheme: string;
  code_verifier: string;
  consumed_at: string | null;
  expires_at: string;
}

type FakeTx = { execute(query: unknown): Promise<unknown> };

function chunksToText(query: unknown): { text: string; params: unknown[] } {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const c of chunks) {
    if (typeof c === "string") {
      parts.push("?");
      params.push(c);
    } else if (typeof c === "number" || typeof c === "boolean") {
      parts.push("?");
      params.push(c);
    } else if (c && typeof c === "object" && "value" in c) {
      const v = (c as { value: unknown }).value;
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
        parts.push((v as string[]).join(""));
      } else {
        parts.push("?");
        params.push(v);
      }
    } else {
      parts.push(String(c));
    }
  }
  return { text: parts.join(""), params };
}

function makeFakeDb(rows: Map<string, FakeStateRow>): {
  db: Parameters<typeof buildAuthCallbackRoutes>[0]["db"];
} {
  const tx: FakeTx = {
    async execute(query: unknown): Promise<unknown> {
      const { text, params } = chunksToText(query);
      if (/set_config/i.test(text)) return { rows: [] };
      if (/UPDATE\s+oauth_state/i.test(text)) {
        const id = params[0] as string;
        const row = rows.get(id);
        if (!row) return { rows: [] };
        if (row.consumed_at !== null) return { rows: [] };
        const expMs = Date.parse(row.expires_at);
        if (Number.isFinite(expMs) && expMs <= Date.now()) {
          return { rows: [] };
        }
        const updated = { ...row, consumed_at: new Date().toISOString() };
        rows.set(id, updated);
        return { rows: [updated] };
      }
      if (/FROM\s+oauth_state/i.test(text)) {
        const id = params[0] as string;
        const row = rows.get(id);
        return row ? { rows: [row] } : { rows: [] };
      }
      return { rows: [] };
    },
  };
  const db = {
    async transaction<T>(cb: (tx: FakeTx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
  return { db: db as Parameters<typeof buildAuthCallbackRoutes>[0]["db"] };
}

const ORIGINAL_ENV = { ...process.env };

describe("Phase 02.7 / D-01 end-to-end: desktop-callback → real mintBearer → channel-scheme 302", () => {
  let app: FastifyInstance | null = null;

  beforeEach(() => {
    _resetDefaultTenantCacheForTesting();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.env = { ...ORIGINAL_ENV };
    vi.stubEnv("OIDC_CLIENT_ID", "client-id-fixture");
    vi.stubEnv("OIDC_CLIENT_SECRET", "client-secret-fixture");
    vi.stubEnv("OIDC_TOKEN_URL", "https://idp.test/token");
    vi.stubEnv("OIDC_USERINFO_URL", "https://idp.test/userinfo");
    vi.stubEnv("AUTH_URL", "https://api.localhost");
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.env = { ...ORIGINAL_ENV };
  });

  it("emits 302 Location matching /^openwhispr-dev:\\/\\/\\?bearer_token=/", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      user: { id: "u1" },
      accounts: [],
    });
    const createOAuthUser = vi.fn();
    const createSession = vi.fn().mockResolvedValue({ token: FAKE_TOKEN, userId: "u1" });
    const auth = {
      $context: Promise.resolve({
        internalAdapter: { findUserByEmail, createOAuthUser, createSession },
      }),
    };

    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://idp.test/token") {
        return new Response(JSON.stringify({ access_token: "AT", id_token: "IDT" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ sub: "sub-1", email: "user@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const mintBearer = buildMintBearer({ auth });
    const rows = new Map<string, FakeStateRow>([
      [
        STATE_ID,
        {
          id: STATE_ID,
          scheme: "openwhispr-dev",
          code_verifier: "verifier-from-row",
          consumed_at: null,
          expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      ],
    ]);
    const { db } = makeFakeDb(rows);

    app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(buildAuthCallbackRoutes({ db, mintBearer }));

    const res = await app.inject({
      method: "GET",
      url: `/api/auth/desktop-callback/oidc?state=${STATE_ID}&code=auth-code-fixture`,
    });

    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc).toMatch(/^openwhispr-dev:\/\/\?bearer_token=/);
    // Token URL-encodes verbatim for the FAKE_TOKEN alphabet ([b]+).
    expect(loc).toContain(`bearer_token=${FAKE_TOKEN}`);

    // mintBearer was actually invoked through the real adapter:
    expect(fetchSpy).toHaveBeenCalled();
    expect(findUserByEmail).toHaveBeenCalledWith("user@example.com");
    expect(createSession).toHaveBeenCalledWith("u1", false);
  });
});
