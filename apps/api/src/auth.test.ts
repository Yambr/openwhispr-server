// Phase 2 / Plan 01 / Task 3 — smoke test for buildAuth().
//
// Purpose: pin the env-permutation behaviour for OIDC plugin registration
// (D-02) without spinning up a real DB. Better Auth's `betterAuth()`
// constructor returns synchronously and reflects the registered plugins
// on `auth.options.plugins` — we exercise that surface only.
//
// Lifecycle/integration coverage (handler boot, real Drizzle adapter
// against testcontainers Postgres) lands with Plan 03's wiring.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuth } from "./auth.js";

// Minimal AppDb stub — buildAuth doesn't query during construction.
const stubDb = {} as unknown as Parameters<typeof buildAuth>[0]["db"];

describe("buildAuth — OIDC env permutations (D-02)", () => {
  const originalIssuer = process.env.OIDC_ISSUER_URL;
  const originalClientId = process.env.OIDC_CLIENT_ID;
  const originalClientSecret = process.env.OIDC_CLIENT_SECRET;
  const originalSecret = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    process.env.BETTER_AUTH_SECRET =
      "0000000000000000000000000000000000000000000000000000000000000000";
  });

  afterEach(() => {
    if (originalIssuer === undefined) delete process.env.OIDC_ISSUER_URL;
    else process.env.OIDC_ISSUER_URL = originalIssuer;
    if (originalClientId === undefined) delete process.env.OIDC_CLIENT_ID;
    else process.env.OIDC_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.OIDC_CLIENT_SECRET;
    else process.env.OIDC_CLIENT_SECRET = originalClientSecret;
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
  });

  it("registers exactly 1 plugin (bearer only) when OIDC env vars are unset", () => {
    const auth = buildAuth({ db: stubDb });
    const plugins = auth.options.plugins ?? [];
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.id).toBe("bearer");
  });

  it("registers bearer only when OIDC_ISSUER_URL is missing but the others are present", () => {
    process.env.OIDC_CLIENT_ID = "client-id";
    process.env.OIDC_CLIENT_SECRET = "client-secret";
    const auth = buildAuth({ db: stubDb });
    expect(auth.options.plugins ?? []).toHaveLength(1);
  });

  it("registers bearer + genericOAuth when all three OIDC env vars are present", () => {
    process.env.OIDC_ISSUER_URL = "https://idp.example.com";
    process.env.OIDC_CLIENT_ID = "client-id";
    process.env.OIDC_CLIENT_SECRET = "client-secret";
    const auth = buildAuth({ db: stubDb });
    const plugins = auth.options.plugins ?? [];
    expect(plugins).toHaveLength(2);
    const ids = plugins.map((p) => p.id).sort();
    expect(ids).toEqual(["bearer", "generic-oauth"].sort());
  });
});
