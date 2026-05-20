// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 65 / Plan 65-01 — WR-03 + WR-04 regression tests for agent/stream.ts.
//
// WR-03 — the handler's defensive auth re-check must throw the two-arg
// `AuthError("UNAUTHORIZED", ...)` form (code "UNAUTHORIZED"), matching every
// other route. The legacy single-arg form keys `errors.AUTH_ERROR`.
//
// WR-04 — the route declares `schema: { body: AgentStreamRequestSchema }` AND
// the zod-type-provider's validator compiler is attached at the buildApp
// boundary, so Fastify validates the body BEFORE the handler. The inline
// `AgentStreamRequestSchema.parse(req.body)` is therefore redundant — a
// malformed body must already be rejected with the canonical 400 envelope by
// the declarative schema alone. The RED asserts the declarative schema
// rejects a malformed body (so the inline parse can be dropped) and that the
// route source no longer re-parses.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LitellmClient } from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildAgentStreamRoutes } from "../../../../src/routes/agent/stream.js";

const ROUTE_SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "src",
  "routes",
  "agent",
  "stream.ts",
);

function fakeI18n() {
  return {
    t(key: string, opts?: { defaultValue?: string }) {
      if (key === "errors.UNAUTHORIZED") return "I18N_UNAUTHORIZED";
      if (key === "errors.AUTH_ERROR") return "I18N_AUTH_ERROR";
      return opts?.defaultValue ?? key;
    },
  };
}

function fakeDb() {
  return {
    async transaction<T>(cb: (tx: { execute(): Promise<unknown> }) => Promise<T>): Promise<T> {
      return cb({
        async execute() {
          return { rows: [] };
        },
      });
    },
  };
}

const fakeLitellm = { baseUrl: "http://litellm.test:4000" } as unknown as LitellmClient;

// `userPresent: false` lets onRequest pass WITHOUT populating req.user — so
// the handler's own defensive auth re-check (WR-03 site) is exercised.
async function buildTestApp(opts: { userPresent: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { i18n: ReturnType<typeof fakeI18n> }).i18n = fakeI18n();
    if (opts.userPresent) {
      (req as unknown as { user: { id: string; email: string } }).user = {
        id: "11111111-1111-1111-1111-111111111111",
        email: "u1@test.local",
      };
    }
  });
  await app.register(buildAgentStreamRoutes({ db: fakeDb() as never, litellm: fakeLitellm }));
  await app.ready();
  return app;
}

describe("agent/stream — WR-03 canonical AuthError code", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("WR-03: handler defensive auth re-check emits UNAUTHORIZED (not AUTH_ERROR)", async () => {
    app = await buildTestApp({ userPresent: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/stream",
      headers: { "content-type": "application/json" },
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(401);
    const json = res.json() as { error: string };
    // Fake i18n: `errors.UNAUTHORIZED` → "I18N_UNAUTHORIZED".
    expect(json.error).toBe("I18N_UNAUTHORIZED");
  });
});

describe("agent/stream — WR-04 declarative schema validates the body", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("WR-04: a malformed body is rejected by the declarative schema (400)", async () => {
    app = await buildTestApp({ userPresent: true });
    // `messages` is required + `.strict()` — an extra unknown key is malformed.
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/stream",
      headers: { "content-type": "application/json" },
      payload: { messages: [], bogusKey: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("WR-04: the route no longer re-parses the body inside the handler", () => {
    const src = readFileSync(ROUTE_SRC, "utf8");
    // Strip line comments so a comment mentioning the dropped parse does
    // not false-match — the assertion targets executable code only.
    const code = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    // The redundant inline parse is dropped — the declarative schema +
    // attached validator compiler are the single validation point.
    expect(code).not.toMatch(/AgentStreamRequestSchema\.parse\(/);
    expect(code).toMatch(/const\s+body\s*=\s*req\.body/);
  });
});
