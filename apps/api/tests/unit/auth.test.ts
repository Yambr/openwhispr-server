// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 01 / Task 3 — smoke test for buildAuth().
//
// Purpose: pin the env-permutation behaviour for OIDC plugin registration
// (D-02) without spinning up a real DB. Better Auth's `betterAuth()`
// constructor returns synchronously and reflects the registered plugins
// on `auth.options.plugins` — we exercise that surface only.
//
// Lifecycle/integration coverage (handler boot, real Drizzle adapter
// against testcontainers Postgres) lands with Plan 03's wiring.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAuth } from "../../src/auth.js";

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

// ── Phase 8 / Plan 01 ──────────────────────────────────────────────────
// `OPENWHISPR_DISABLE_RATE_LIMIT` load-test switch for Better Auth's
// built-in rate-limiter. Same env var that gates the Fastify limiter in
// apps/api/src/plugins/rate-limit.ts (Task 1) — load-test profiles need
// BOTH surfaces off because Better Auth's limiter buckets the sign-in /
// sign-up / forgot-password routes independently from @fastify/rate-limit.
describe("buildAuth — OPENWHISPR_DISABLE_RATE_LIMIT switch (Phase 8 Plan 01)", () => {
  const originalSwitch = process.env.OPENWHISPR_DISABLE_RATE_LIMIT;
  const originalSecret = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    delete process.env.OPENWHISPR_DISABLE_RATE_LIMIT;
    process.env.BETTER_AUTH_SECRET =
      "0000000000000000000000000000000000000000000000000000000000000000";
  });

  afterEach(() => {
    if (originalSwitch === undefined) delete process.env.OPENWHISPR_DISABLE_RATE_LIMIT;
    else process.env.OPENWHISPR_DISABLE_RATE_LIMIT = originalSwitch;
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
  });

  it("unset → Better Auth rate-limit is NOT explicitly disabled (default-secure)", () => {
    const auth = buildAuth({ db: stubDb }) as unknown as {
      options: { rateLimit?: { enabled?: boolean } };
    };
    // Either no rateLimit block (BA default applies — enabled in prod) or
    // an explicitly enabled:true block. The forbidden state is
    // `enabled:false` while the switch is unset.
    expect(auth.options.rateLimit?.enabled).not.toBe(false);
  });

  it("=1 → Better Auth rate-limit is disabled (rateLimit.enabled === false)", () => {
    process.env.OPENWHISPR_DISABLE_RATE_LIMIT = "1";
    const auth = buildAuth({ db: stubDb }) as unknown as {
      options: { rateLimit?: { enabled?: boolean } };
    };
    expect(auth.options.rateLimit?.enabled).toBe(false);
  });

  it('=true → behaves the same as "1" (accept common truthy form)', () => {
    process.env.OPENWHISPR_DISABLE_RATE_LIMIT = "true";
    const auth = buildAuth({ db: stubDb }) as unknown as {
      options: { rateLimit?: { enabled?: boolean } };
    };
    expect(auth.options.rateLimit?.enabled).toBe(false);
  });

  it("=0 → behaves the same as unset (default-secure)", () => {
    process.env.OPENWHISPR_DISABLE_RATE_LIMIT = "0";
    const auth = buildAuth({ db: stubDb }) as unknown as {
      options: { rateLimit?: { enabled?: boolean } };
    };
    expect(auth.options.rateLimit?.enabled).not.toBe(false);
  });

  it("=1 → buildAuth surfaces a WARN to the injected logger naming the Better Auth surface", () => {
    process.env.OPENWHISPR_DISABLE_RATE_LIMIT = "1";
    const warn = vi.fn();
    const log = { info: vi.fn(), warn };
    buildAuth({ db: stubDb, log });
    // Either a dedicated banner mentioning "Better Auth" or a shared
    // banner that names both subsystems is acceptable. Accept any WARN
    // whose message references "Rate limit DISABLED" or "rate-limit
    // disabled".
    const messages = warn.mock.calls.map((c) => {
      const arg = c[c.length - 1];
      return typeof arg === "string" ? arg : "";
    });
    const hit = messages.find((m) => /rate[- ]limit disabled/i.test(m));
    expect(hit).toBeDefined();
  });
});

describe(".env.example documents OPENWHISPR_DISABLE_RATE_LIMIT (Phase 8 Plan 01)", () => {
  // Walk up from apps/api/tests/unit/auth.test.ts → repo root.
  const envExamplePath = resolve(__dirname, "..", "..", "..", "..", ".env.slim.example");
  const contents = readFileSync(envExamplePath, "utf8");

  it("contains an OPENWHISPR_DISABLE_RATE_LIMIT entry", () => {
    expect(contents).toMatch(/OPENWHISPR_DISABLE_RATE_LIMIT/);
  });

  it("annotates the entry as LOAD-TEST-ONLY", () => {
    // Tolerate either "LOAD-TEST ONLY" or "LOAD-TEST-ONLY" wording.
    expect(contents).toMatch(/LOAD[- ]TEST[- ]ONLY/i);
  });

  it("warns the entry MUST NOT be set in production", () => {
    expect(contents).toMatch(/MUST NOT be set in production/i);
  });
});
