// Phase 2 / Plan 05 / Task 2 — `/api/auth/desktop-callback/:provider` tests.
//
// Coverage matrix (per 02-05-PLAN.md Task 2 done criteria):
//   * Happy path 4-scheme matrix: each scheme echoed in final 302
//     Location matching `^<scheme>://\?bearer_token=[A-Za-z0-9_\-%.]+$`.
//   * State already consumed → 400 + envelope.
//   * State expired → 400 + envelope.
//   * State missing (unknown UUID) → 400 + envelope.
//   * Missing query params → 400 + envelope.
//   * IdP-side error param → 400 + envelope.
//   * Unsupported provider → 400 + envelope.
//   * mintBearer unset → 503 + envelope.
//   * mintBearer is invoked with (code, codeVerifier, scheme) extracted
//     from the consumed oauth_state row.
import Fastify, { type FastifyInstance } from "fastify";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import { registerErrorHandler } from "../error-handler.js";
import { _resetDefaultTenantCacheForTesting } from "../lib/default-tenant.js";
import {
  buildAuthCallbackRoutes,
  type MintBearer,
} from "./auth-callback.js";

const VALID_STATE_ID = "11111111-2222-3333-4444-555555555555";
const UNKNOWN_STATE_ID = "99999999-9999-9999-9999-999999999999";

interface FakeStateRow {
  id: string;
  scheme: string;
  code_verifier: string;
  consumed_at: string | null;
  expires_at: string;
}

type FakeTx = { execute(query: unknown): Promise<unknown> };

interface RecordedQuery {
  sql: string;
  params: readonly unknown[];
}

function chunksToText(query: unknown): {
  text: string;
  params: unknown[];
} {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const c of chunks) {
    if (typeof c === "string") {
      // Primitive strings appearing inside `queryChunks` are bind
      // parameters from `${...}` interpolation — NOT template-literal
      // text. (StringChunks are objects with a `.value` string[].)
      parts.push("?");
      params.push(c);
    } else if (typeof c === "number" || typeof c === "boolean") {
      parts.push("?");
      params.push(c);
    } else if (c && typeof c === "object" && "value" in c) {
      const v = (c as { value: unknown }).value;
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
        // StringChunk — interleaved template-literal pieces.
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

/**
 * Fake DB whose state is keyed by row.id; returns the configured row
 * shape on UPDATE (with consumed_at filtering) or SELECT.
 */
function makeFakeDb(rows: Map<string, FakeStateRow>): {
  db: Parameters<typeof buildAuthCallbackRoutes>[0]["db"];
  recorded: RecordedQuery[];
} {
  const recorded: RecordedQuery[] = [];
  const tx: FakeTx = {
    async execute(query: unknown): Promise<unknown> {
      const { text, params } = chunksToText(query);
      recorded.push({ sql: text, params });
      // set_config (tenant binding) — params: [tenantId]
      if (/set_config/i.test(text)) return { rows: [] };
      // UPDATE oauth_state ... RETURNING
      if (/UPDATE\s+oauth_state/i.test(text)) {
        const id = params[0] as string;
        const row = rows.get(id);
        if (!row) return { rows: [] };
        if (row.consumed_at !== null) return { rows: [] };
        const expMs = Date.parse(row.expires_at);
        if (Number.isFinite(expMs) && expMs <= Date.now()) {
          return { rows: [] };
        }
        // Mark consumed in fixture.
        const updated = { ...row, consumed_at: new Date().toISOString() };
        rows.set(id, updated);
        return { rows: [updated] };
      }
      // Probe SELECT after CAS miss
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
  return { db, recorded };
}

function buildApp(
  deps: Parameters<typeof buildAuthCallbackRoutes>[0],
): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.register(buildAuthCallbackRoutes(deps));
  return app;
}

function freshRow(scheme: string): FakeStateRow {
  return {
    id: VALID_STATE_ID,
    scheme,
    code_verifier: `verifier-for-${scheme}`,
    consumed_at: null,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

describe("GET /api/auth/desktop-callback/:provider", () => {
  beforeEach(() => {
    _resetDefaultTenantCacheForTesting();
  });

  afterEach(() => {
    /* noop */
  });

  describe("happy path: 4-scheme matrix", () => {
    const matrix = [
      "openwhispr",
      "openwhispr-dev",
      "openwhispr-staging",
      "mycorp-whispr",
    ];
    for (const scheme of matrix) {
      it(`echoes scheme '${scheme}' in the final redirect`, async () => {
        const rows = new Map<string, FakeStateRow>([
          [VALID_STATE_ID, freshRow(scheme)],
        ]);
        const mintBearer: MintBearer = vi
          .fn<MintBearer>()
          .mockResolvedValue("opaque-token-abcDEF_-123");
        const { db } = makeFakeDb(rows);
        const app = buildApp({ db, mintBearer });
        const res = await app.inject({
          method: "GET",
          url: `/api/auth/desktop-callback/oidc?state=${VALID_STATE_ID}&code=auth-code-fixture`,
        });
        expect(res.statusCode).toBe(302);
        const loc = res.headers.location as string;
        // The URL-encoded form means `_` and `-` survive verbatim;
        // alphanumerics survive verbatim. We assert the prefix and a
        // permissive token alphabet.
        expect(loc).toMatch(
          new RegExp(`^${scheme}://\\?bearer_token=[A-Za-z0-9_\\-%.]+$`),
        );
        // mintBearer was invoked with the correct scheme + verifier.
        expect(mintBearer).toHaveBeenCalledTimes(1);
        const arg = (mintBearer as unknown as { mock: { calls: unknown[][] } })
          .mock.calls[0]?.[0] as {
          scheme: string;
          codeVerifier: string;
          code: string;
        };
        expect(arg.scheme).toBe(scheme);
        expect(arg.codeVerifier).toBe(`verifier-for-${scheme}`);
        expect(arg.code).toBe("auth-code-fixture");
        await app.close();
      });
    }
  });

  describe("state lifecycle errors", () => {
    it("state already consumed → 400 + envelope", async () => {
      const row = freshRow("openwhispr");
      row.consumed_at = new Date(Date.now() - 60_000).toISOString();
      const rows = new Map([[VALID_STATE_ID, row]]);
      const mintBearer = vi.fn();
      const { db } = makeFakeDb(rows);
      const app = buildApp({
        db,
        mintBearer: mintBearer as unknown as MintBearer,
      });
      const res = await app.inject({
        method: "GET",
        url: `/api/auth/desktop-callback/oidc?state=${VALID_STATE_ID}&code=c`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "state already consumed" });
      expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
      expect(mintBearer).not.toHaveBeenCalled();
      await app.close();
    });

    it("state expired → 400 + envelope", async () => {
      const row = freshRow("openwhispr");
      row.expires_at = new Date(Date.now() - 60_000).toISOString();
      const rows = new Map([[VALID_STATE_ID, row]]);
      const { db } = makeFakeDb(rows);
      const mintBearer = vi.fn();
      const app = buildApp({
        db,
        mintBearer: mintBearer as unknown as MintBearer,
      });
      const res = await app.inject({
        method: "GET",
        url: `/api/auth/desktop-callback/oidc?state=${VALID_STATE_ID}&code=c`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "state expired" });
      expect(mintBearer).not.toHaveBeenCalled();
      await app.close();
    });

    it("state missing (unknown UUID) → 400 + envelope", async () => {
      const rows = new Map<string, FakeStateRow>();
      const { db } = makeFakeDb(rows);
      const mintBearer = vi.fn();
      const app = buildApp({
        db,
        mintBearer: mintBearer as unknown as MintBearer,
      });
      const res = await app.inject({
        method: "GET",
        url: `/api/auth/desktop-callback/oidc?state=${UNKNOWN_STATE_ID}&code=c`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "invalid state" });
      await app.close();
    });
  });

  describe("query param validation", () => {
    it("missing state → 400", async () => {
      const { db } = makeFakeDb(new Map());
      const app = buildApp({ db, mintBearer: vi.fn() as unknown as MintBearer });
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/desktop-callback/oidc?code=c",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "missing state or code" });
      await app.close();
    });

    it("missing code → 400", async () => {
      const { db } = makeFakeDb(new Map());
      const app = buildApp({ db, mintBearer: vi.fn() as unknown as MintBearer });
      const res = await app.inject({
        method: "GET",
        url: `/api/auth/desktop-callback/oidc?state=${VALID_STATE_ID}`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "missing state or code" });
      await app.close();
    });

    it("IdP error param surfaces as 400", async () => {
      const { db } = makeFakeDb(new Map());
      const app = buildApp({ db, mintBearer: vi.fn() as unknown as MintBearer });
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/desktop-callback/oidc?error=access_denied",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "idp error: access_denied" });
      await app.close();
    });

    it("unsupported provider → 400", async () => {
      const { db } = makeFakeDb(new Map());
      const app = buildApp({ db, mintBearer: vi.fn() as unknown as MintBearer });
      const res = await app.inject({
        method: "GET",
        url: `/api/auth/desktop-callback/saml?state=${VALID_STATE_ID}&code=c`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "unsupported provider" });
      await app.close();
    });
  });

  describe("CR-01 — diagnostic ordering when row is both expired and consumed", () => {
    it("returns 'state expired' when row is both expired and consumed", async () => {
      // Per code review CR-01 (02-REVIEW.md) and 02-VERIFICATION.md gap 3:
      // a row with consumed_at != NULL AND expires_at < now() must be
      // diagnosed as 'expired' (the more authoritative time-based signal),
      // NOT as 'already consumed'. The CAS UPDATE rejects the row (both
      // conditions in the WHERE clause fail) and the diagnostic probe
      // checks expires_at FIRST.
      const row = freshRow("openwhispr");
      row.consumed_at = new Date(Date.now() - 11 * 60_000).toISOString();
      row.expires_at = new Date(Date.now() - 60_000).toISOString();
      const rows = new Map([[VALID_STATE_ID, row]]);
      const { db } = makeFakeDb(rows);
      const mintBearer = vi.fn();
      const app = buildApp({
        db,
        mintBearer: mintBearer as unknown as MintBearer,
      });
      const res = await app.inject({
        method: "GET",
        url: `/api/auth/desktop-callback/oidc?state=${VALID_STATE_ID}&code=c`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "state expired" });
      await app.close();
    });
  });

  describe("operator-misconfigured (no mintBearer adapter)", () => {
    it("returns 503 when mintBearer is unset and state is valid", async () => {
      const rows = new Map([[VALID_STATE_ID, freshRow("openwhispr")]]);
      const { db } = makeFakeDb(rows);
      const app = buildApp({ db });
      const res = await app.inject({
        method: "GET",
        url: `/api/auth/desktop-callback/oidc?state=${VALID_STATE_ID}&code=c`,
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: "oauth callback not configured" });
      await app.close();
    });
  });
});
