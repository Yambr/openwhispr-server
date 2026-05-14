// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-02 / Task 2 + Task 4 — public /api/auth/providers tests.
//
// Hermetic — no DB, no testcontainer. Uses an env override on the
// route builder so we never mutate process.env.
//
// Coverage:
//   * 6 sub-tests on the route itself (shape, ETag, Cache-Control, 304).
//   * 3 sub-tests on the D-08 zero-drift contract (Task 4): route
//     output ≡ readOidcProvidersForRegistration mapped to public ids,
//     under 3 env permutations.

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { readOidcProvidersForRegistration } from "../../../../src/lib/oidc-providers.js";
import { buildAuthProvidersRoutes } from "../../../../src/routes/auth-providers.js";

type Env = NodeJS.ProcessEnv;

function envOf(partial: Record<string, string | undefined>): Env {
  return partial as unknown as Env;
}

async function buildAppForEnv(env: Env): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(buildAuthProvidersRoutes({ env }));
  await app.ready();
  return app;
}

describe("GET /api/auth/providers — route behavior", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 200 + {providers:[], emailVerification:{...}} when zero providers configured", async () => {
    app = await buildAppForEnv(envOf({}));
    const res = await app.inject({ method: "GET", url: "/api/auth/providers" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      providers: unknown[];
      emailVerification: { required: boolean; configured: boolean };
    };
    expect(body.providers).toEqual([]);
    expect(body.emailVerification).toEqual({ required: true, configured: false });
  });

  it("returns one OIDC provider when all three OIDC envs are set", async () => {
    app = await buildAppForEnv(
      envOf({
        OIDC_ISSUER_URL: "https://issuer.example.com",
        OIDC_CLIENT_ID: "cid",
        OIDC_CLIENT_SECRET: "secret",
      }),
    );
    const res = await app.inject({ method: "GET", url: "/api/auth/providers" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      providers: Array<{ id: string; name: string; enabled: boolean }>;
    };
    expect(body.providers).toEqual([{ id: "oidc", name: "OIDC", enabled: true }]);
  });

  it("info-leak gate — response keys are EXACTLY ['emailVerification','providers'] and per-provider EXACTLY ['enabled','id','name']", async () => {
    app = await buildAppForEnv(
      envOf({
        OIDC_ISSUER_URL: "https://issuer.example.com",
        OIDC_CLIENT_ID: "cid",
        OIDC_CLIENT_SECRET: "secret",
        GOOGLE_CLIENT_ID: "g-cid",
        GOOGLE_CLIENT_SECRET: "g-secret",
      }),
    );
    const res = await app.inject({ method: "GET", url: "/api/auth/providers" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["emailVerification", "providers"]);
    const providers = body.providers as Array<Record<string, unknown>>;
    for (const p of providers) {
      expect(Object.keys(p).sort()).toEqual(["enabled", "id", "name"]);
    }
    // Belt-and-braces — the serialized body must NOT contain any of the
    // forbidden field names anywhere (T-12.02-01).
    const serialised = JSON.stringify(body);
    expect(serialised).not.toMatch(/secret/i);
    expect(serialised).not.toMatch(/discoveryUrl/i);
    expect(serialised).not.toMatch(/issuer/i);
  });

  it('emits a weak ETag header in W/"<hex>" format', async () => {
    app = await buildAppForEnv(envOf({}));
    const res = await app.inject({ method: "GET", url: "/api/auth/providers" });
    expect(res.statusCode).toBe(200);
    const etag = res.headers.etag;
    expect(etag).toBeDefined();
    expect(typeof etag).toBe("string");
    expect(etag as string).toMatch(/^W\/"[a-f0-9]{16}"$/);
  });

  it("emits Cache-Control: public, max-age=60", async () => {
    app = await buildAppForEnv(envOf({}));
    const res = await app.inject({ method: "GET", url: "/api/auth/providers" });
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("returns 304 when If-None-Match matches the current ETag", async () => {
    app = await buildAppForEnv(envOf({}));
    const first = await app.inject({ method: "GET", url: "/api/auth/providers" });
    const etag = first.headers.etag as string;
    expect(etag).toBeDefined();
    const second = await app.inject({
      method: "GET",
      url: "/api/auth/providers",
      headers: { "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
    expect(second.headers.etag).toBe(etag);
  });
});

// Task 4 — D-08 zero-drift contract test. Asserts the public route
// output is consistent with what readOidcProvidersForRegistration sees
// under the SAME env. If a future refactor renames an env var in one
// helper but not the other, this test goes RED.
describe("D-08 zero-drift contract: route ≡ registration helper", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  const permutations: Array<{ name: string; env: Env; expectedRegIds: string[] }> = [
    { name: "none", env: envOf({}), expectedRegIds: [] },
    {
      name: "oidc-only",
      env: envOf({
        OIDC_ISSUER_URL: "https://issuer.example.com",
        OIDC_CLIENT_ID: "cid",
        OIDC_CLIENT_SECRET: "secret",
      }),
      expectedRegIds: ["oidc"],
    },
    {
      // Google has its own Better Auth provider plugin (not via
      // genericOAuth) so it does NOT appear in
      // readOidcProvidersForRegistration; the public list still
      // includes it. The contract under test is: every entry in the
      // registration helper's output appears in the route output with
      // the same providerId.
      name: "oidc+google",
      env: envOf({
        OIDC_ISSUER_URL: "https://issuer.example.com",
        OIDC_CLIENT_ID: "cid",
        OIDC_CLIENT_SECRET: "secret",
        GOOGLE_CLIENT_ID: "g-cid",
        GOOGLE_CLIENT_SECRET: "g-secret",
      }),
      expectedRegIds: ["oidc"],
    },
  ];

  for (const { name, env, expectedRegIds } of permutations) {
    it(`permutation '${name}': registration helper output is a subset of public route output, with matching providerId/id`, async () => {
      const regList = readOidcProvidersForRegistration(env);
      expect(regList.map((r) => r.providerId)).toEqual(expectedRegIds);

      app = await buildAppForEnv(env);
      const res = await app.inject({ method: "GET", url: "/api/auth/providers" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { providers: Array<{ id: string }> };
      const routeIds = body.providers.map((p) => p.id);

      // Every registration providerId MUST appear in the route's id
      // list with identical relative ordering. (The route may include
      // more — e.g. Google, GitHub via dedicated plugins — but the
      // genericOAuth subset must match exactly.)
      const filtered = routeIds.filter((id) => expectedRegIds.includes(id));
      expect(filtered).toEqual(expectedRegIds);
    });
  }
});
