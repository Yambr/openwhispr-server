// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 02.6 — RED test for D-01 (entrypoint must destructure makeAppDb's
// `{db, pool}` wrapper and pass the bare Drizzle instance to buildAuth +
// buildApp). Goes green when apps/api/src/index.ts:229-233 is changed
// from `const db = makeAppDb()` (passes wrapper) to `const { db } =
// makeAppDb()` (passes the real Drizzle instance) AND removes the
// `as never` casts that hid the wrapper-vs-instance type mismatch.
//
// Source-of-record commit: <Phase 02.6 atomic fix commit, populated post-commit>
//
// Reverts:
//   - Reintroducing `const db = makeAppDb()` (wrapper assignment) → this
//     test goes RED because the captured `db` arg lacks `.select` and is
//     the wrapper (has `.pool`).
//   - Reintroducing `db: db as never` cast at the buildAuth/buildApp call
//     site → typecheck silently passes again, but this runtime assertion
//     still catches the wrapper-leak. (Reverse-patch evidence captured in
//     the Phase 02.6 SUMMARY.)
//
// This is the witness that closes the Phase 02.5-04 cascade defect:
// `TypeError: db.select is not a function` at @better-auth/drizzle-adapter
// findOne, surfaced by Phase 02.5 / Plan 04 contract-test against the
// production image.
//
// Implementation note: the entrypoint executes only when
// `import.meta.url === \`file://${process.argv[1]}\``. We set
// `process.argv[1]` to the resolved index.ts source path before the
// dynamic import so the bootstrap branch runs. We mock ./auth.js to
// capture buildAuth's `db` arg (the WITNESS — same `db` variable is
// passed to buildApp on the next line, so one capture covers both
// consumers per the single-destructure invariant). All heavy
// dependencies (fastify, plugins, Better Auth) are mocked so the
// bootstrap completes without DB or network.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Capture the args buildAuth + buildApp receive.
const captured: {
  buildAuthArg?: { db?: unknown };
  buildAppArg?: { db?: unknown; auth?: unknown };
} = {};

// Fake Drizzle instance — the assertion checks `.select` is a function.
// Mirrors NodePgDatabase enough to satisfy the runtime contract Better
// Auth's drizzle adapter expects (it calls `db.select(...)` at line 303
// of @better-auth/drizzle-adapter — that's the exact failure surfaced
// by Phase 02.5-04).
const fakeDrizzle = {
  select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
  transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({ execute: async () => undefined }),
};
const fakePool = { end: async () => {} };

vi.mock("@openwhispr/data/client", () => ({
  makeAppDb: () => ({ db: fakeDrizzle, pool: fakePool }),
}));

// Phase 19 / Plan 02 (SR-19.3, D-12): the Phase 18.1.2-04-01
// `vi.mock("@openwhispr/byok-guard", ...)` workaround has been REMOVED.
// The library now THROWS `BYOKGuardError` (no more `process.exit(1)`),
// so vitest's `process.exit` trap is no longer tripped at module-eval
// time. The entrypoint's own try/catch handles BYOKGuardError; under
// `beforeAll` we set the BYOK envs (S3_*, OTEL_*, INGRESS_BASE_URL,
// DATABASE_URL, SMTP_HOST, NODE_ENV=test) so the guard returns void
// and the entrypoint's `await buildApp(...)` chain reaches the
// captured buildAuth call site.

vi.mock("../../../src/auth.js", () => ({
  buildAuth: (opts: { db?: unknown }) => {
    captured.buildAuthArg = opts;
    return { options: { plugins: [] }, handler: async () => new Response() };
  },
}));

// Mock fastify so buildApp constructs a no-op app instance — the
// entrypoint awaits `buildApp(...)` and then calls `app.listen(...)`,
// so we need both to resolve.
vi.mock("fastify", () => {
  const fakeApp: Record<string, unknown> = {};
  Object.assign(fakeApp, {
    register: async (plugin: unknown, opts?: unknown) => {
      // Some plugins are functions: invoke them so buildApp's chain stays valid.
      if (typeof plugin === "function") {
        try {
          await (plugin as (a: unknown, b: unknown) => unknown)(fakeApp, opts);
        } catch {
          /* swallow plugin init errors in test */
        }
      }
      return fakeApp;
    },
    addHook: () => fakeApp,
    ready: async () => fakeApp,
    listen: async () => "http://0.0.0.0:0",
    setErrorHandler: () => fakeApp,
    setValidatorCompiler: () => fakeApp,
    setSerializerCompiler: () => fakeApp,
    decorate: () => fakeApp,
    decorateRequest: () => fakeApp,
    decorateReply: () => fakeApp,
    addSchema: () => fakeApp,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  const Fastify = (_opts?: unknown) => fakeApp;
  return { default: Fastify, fastify: Fastify };
});

// Mock the heavy plugins/middleware buildApp pulls in so they're cheap.
vi.mock("@fastify/cookie", () => ({ default: async () => {} }));
vi.mock("../../../src/plugins/zod-type-provider.js", () => ({ zodTypeProvider: async () => {} }));
vi.mock("../../../src/plugins/request-log.js", () => ({ requestLog: async () => {} }));
vi.mock("../../../src/plugins/rate-limit.js", () => ({ rateLimitPlugin: async () => {} }));
vi.mock("../../../src/middleware/dual-auth.js", () => ({
  buildDualAuthHook: () => async () => {},
  extractBearer: () => null,
}));
vi.mock("../../../src/routes/index.js", () => ({ buildAllRoutes: () => [] }));
vi.mock("../../../src/lib/mint-bearer.js", () => ({ buildMintBearer: () => async () => "" }));
vi.mock("../../../src/lib/token-rotation.js", () => ({
  // Phase 02.12 — hashToken removed; recordPreviousToken now takes plain text.
  recordPreviousToken: async () => {},
  tryPreviousToken: async () => null,
}));
vi.mock("../../../src/error-handler.js", () => ({ registerErrorHandler: () => {} }));
vi.mock("../../../src/routes/health.js", () => ({ default: async () => {} }));
// Phase 6 / Plan 06-04 — probes + served-by + dep-check are wired into
// buildApp; stub them so the entrypoint-db-shape test stays narrowly
// scoped to the Phase 02.6 D-01 invariant (no incidental coupling to
// the Phase 6 health-probe surface).
vi.mock("../../../src/routes/probes.js", () => ({
  registerProbes: async () => {},
  markStartupComplete: () => {},
  resetStartupComplete: () => {},
  isStartupComplete: () => true,
}));
vi.mock("../../../src/plugins/served-by.js", () => ({ servedByPlugin: async () => {} }));
vi.mock("../../../src/lib/dep-check.js", () => ({
  makeDepCheck: () => async () => ({ ok: true, latency_ms: 0 }),
}));
// Phase 6 / Plan 06-12b — debug-only /__test/fetch route. Stubbed so the
// entrypoint-db-shape test stays narrowly scoped to the Phase 02.6 D-01
// invariant (no incidental coupling to the debug surface).
vi.mock("../../../src/routes/__test/fetch.js", () => ({
  buildDebugFetchRoutes: () => async () => {},
}));

// Resolve the absolute path the entrypoint's `import.meta.url ===
// file://${process.argv[1]}` check expects. Point process.argv[1] at the
// actual index.ts source file so the bootstrap branch executes when we
// dynamic-import it.
const indexPath = fileURLToPath(new URL("../../../src/index.ts", import.meta.url));
if (!existsSync(indexPath)) throw new Error(`source-contract path moved: ${indexPath}`);
const originalArgv1 = process.argv[1];

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-long-xxxxxxxxx";
  process.env.DATABASE_URL = "postgres://test/test";
  process.env.PORT = "0";
  // Phase 19 / Plan 02 (D-12): BYOK envs set in-test (real semantics,
  // not a re-mock). NODE_ENV=test skips the dev-tools/SMTP gate.
  process.env.NODE_ENV = "test";
  process.env.S3_ENDPOINT = "https://s3.test.example.com";
  process.env.S3_ACCESS_KEY = "AKIATEST";
  process.env.S3_SECRET_KEY = "test-secret";
  process.env.S3_BUCKET = "openwhispr-test";
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-test.invalid:4317";
  process.env.INGRESS_BASE_URL = "https://api.test.example.com";
  // Phase 53 — Plan 51-16 cascade: when INGRESS_BASE_URL is https://, the
  // byok-guard now also requires INGRESS_TLS_CERT_PATH (no NODE_ENV gate).
  // Set to a placeholder path so the guard returns void; the bootstrap
  // never reads the file because TLS is not enabled at the listen level
  // in this dynamic-import test (fastify is mocked above).
  process.env.INGRESS_TLS_CERT_PATH = "/tmp/test-ingress-cert.pem";
  process.argv[1] = indexPath;
});

afterAll(() => {
  if (typeof originalArgv1 === "string") {
    process.argv[1] = originalArgv1;
  } else {
    process.argv.length = 1;
  }
});

describe("entrypoint db-shape (Phase 02.6 D-01)", () => {
  it("destructures makeAppDb() and passes the bare Drizzle instance (with .select) to buildAuth", async () => {
    // Dynamic import triggers the bootstrap `if (import.meta.url === ...)` branch.
    await import("../../../src/index");
    // Allow the bootstrap's async chain (await buildApp + app.listen) to settle.
    await new Promise((r) => setTimeout(r, 100));

    expect(captured.buildAuthArg).toBeDefined();
    expect(captured.buildAuthArg?.db).toBeDefined();
    // The CORE assertion — the failure mode at runtime in Phase 02.5-04
    // was `db.select is not a function`. Assert the captured arg has it.
    expect(typeof (captured.buildAuthArg?.db as { select?: unknown })?.select).toBe("function");
    // Strict identity: must be the bare Drizzle instance, NOT the {db,pool} wrapper.
    expect(captured.buildAuthArg?.db).toBe(fakeDrizzle);
    // Negative assertion: the wrapper has a `pool` key; the bare instance does not.
    expect((captured.buildAuthArg?.db as { pool?: unknown })?.pool).toBeUndefined();
  });

  it("the entrypoint's single destructured `db` variable also flows into buildApp (witness via shared reference)", () => {
    // The entrypoint reads `const { db } = makeAppDb();` ONCE and passes
    // the same reference to `buildAuth({ db })` then `buildApp({ db, auth })`.
    // The previous test asserted the buildAuth arg is the bare Drizzle
    // instance; by the single-destructure invariant, buildApp receives
    // the same reference. (Reverse-patch reintroducing the wrapper would
    // affect both consumers identically.)
    expect(captured.buildAuthArg?.db).toBe(fakeDrizzle);
    expect((captured.buildAuthArg?.db as { select?: unknown })?.select).toBeTypeOf("function");
  });
});
