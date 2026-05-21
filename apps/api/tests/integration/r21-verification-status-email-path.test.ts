// SPDX-License-Identifier: FSL-1.1-ALv2
// R21 — verification-status email-derived auth path, server-side proof.
//
// Under Better Auth 1.6.9 `requireEmailVerification: true`,
// `POST /sign-up/email` issues NO session (vendored proof: `sign-up.mjs`
// L160-161 / L249 returns `{token:null}` before `createSession`). The
// desktop then polls `GET /api/auth/verification-status?email=<x>` every
// 5s — with no session the OLD cookie-only route 401'd every poll, making
// the sign-up→verify window structurally unsatisfiable.
//
// CRITICAL — this test boots the PRODUCTION `buildApp()` surface, NOT a
// bare Fastify instance. `/api/auth/verification-status` is gated by TWO
// auth layers:
//   1. the app-wide `dualAuthHook` (`onRequest`, registered inside
//      `buildApp()`), which 401s every sessionless request BEFORE the
//      route handler runs, and
//   2. (historically) a route-level `preHandler` — removed in R21.
// A bare Fastify instance registering ONLY `buildVerificationStatusRoutes`
// never installs layer 1, so it cannot observe layer-1 gating and would
// false-PASS even while production 401s. The R21 fix adds `auth: false`
// to the route's `config` so the global `dualAuthHook` skips it; this
// test exercises BOTH layers exactly as production does and is the
// regression guard for that class of bug.
//
// It boots a real Postgres via testcontainers, applies ALL migrations,
// constructs the production `buildAuth()` AND the full production
// `buildApp()` stack, and asserts the 4A contract end to end against a
// real DB:
//
//   (1) real sign-up issues no session token (the R21 trigger condition);
//   (2) `verification-status?email=<signed-up addr>` with NO session
//       cookie → 200 {verified:false} (NOT 401 — the layer-1 regression
//       guard); the email-derived path;
//   (3) after the REAL Better Auth verify-email flow runs (the desktop
//       user clicks the link → `GET /api/auth/verify-email?token=…`,
//       which flips `users.email_verified` to `true`) the SAME poll
//       → 200 {verified:true};
//   (4) an unknown email → 200 {verified:false}, byte-identical to (2) —
//       no enumeration oracle;
//   (5) a valid session cookie still wins — identity is session-derived.
//
// R21 (verification-column fix) — case (3) deliberately drives the REAL
// Better Auth verify-email endpoint, NOT a manual `UPDATE users SET
// email_verified, email_verified_at`. Better Auth flips ONLY the
// `email_verified` boolean; it never writes the `email_verified_at`
// timestamp. The prior manual UPDATE set BOTH columns and so masked the
// bug where the route read the never-written timestamp column. The
// verification token is captured via an in-test `EmailSender` stub wired
// into `buildAuth` (`sendVerificationEmail` forwards a `url` carrying the
// token); the test then injects that token into the real verify-email
// route on the production `buildApp` instance.
//
// Only the Postgres driver (network boundary) and the SMTP transport
// (the email-capture stub — a process/network boundary) are stand-ins;
// nothing of the internal logic is mocked — real `buildAuth` (incl. the
// real verify-email handler) + real `buildApp`.

import { dirname as pathDirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppDb, schema } from "@openwhispr/data";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAuth } from "../../src/auth.js";
import { buildApp } from "../../src/index.js";

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

let container: StartedPostgreSqlContainer;
let ownerPool: Pool;
let appPool: Pool;
// Better Auth's exported AuthInstance type is intentionally narrow
// (apps/api/src/auth.ts) — this integration test drives the raw `api`
// surface (`signUpEmail` / `signInEmail` with `returnHeaders`). Biome's
// `noExplicitAny` does not flag a bare `let` declaration, so no
// suppression is needed.
let auth: any;
let app: FastifyInstance;
let appDb: AppDb;

// Process-boundary stub for the SMTP transport. Better Auth's
// `sendVerificationEmail` hook (apps/api/src/auth.ts) calls `email.send`
// with a `url` that carries the verification token. We capture the most
// recent `url` per recipient address so the test can drive the REAL
// `GET /api/auth/verify-email?token=…` route — exercising exactly what a
// desktop user's link click does in production. No internal logic is
// mocked: the verify-email handler, the DB write, and the column it
// flips are all real.
const sentVerificationUrls = new Map<string, string>();
const captureEmailSender = {
  async send({ to, html, text }: { to: string; html?: string; text?: string }) {
    const haystack = `${html ?? ""} ${text ?? ""}`;
    const match = haystack.match(/https?:\/\/[^\s"'<>]+/);
    if (match) sentVerificationUrls.set(to.toLowerCase(), match[0]);
    return { delivered: true };
  },
};

/**
 * Drive the REAL Better Auth verify-email flow for `email`: pull the
 * token from the captured verification URL and inject it into the
 * production verify-email route on `buildApp`. Asserts the route flips
 * the user to verified (2xx/3xx — Better Auth may redirect on success).
 */
async function verifyEmailViaRealFlow(email: string): Promise<void> {
  const url = sentVerificationUrls.get(email.toLowerCase());
  if (!url) {
    throw new Error(
      `no verification URL captured for ${email} — sendVerificationEmail hook did not fire`,
    );
  }
  const token = new URL(url).searchParams.get("token");
  if (!token) {
    throw new Error(`captured verification URL has no ?token= param: ${url}`);
  }
  const res = await app.inject({
    method: "GET",
    url: `/api/auth/verify-email?token=${encodeURIComponent(token)}`,
  });
  // Better Auth's verify-email returns 200 (or 302 to a callback URL) on
  // success; anything 4xx/5xx means the token did not verify the user.
  expect(
    res.statusCode,
    `verify-email must succeed, got ${res.statusCode}: ${res.body}`,
  ).toBeLessThan(400);
}

beforeAll(async () => {
  process.env.MASTER_KEK = process.env.MASTER_KEK ?? Buffer.alloc(32).toString("base64url");
  process.env.BETTER_AUTH_SECRET ??=
    "0000000000000000000000000000000000000000000000000000000000000000";
  // R21 trigger condition: email verification ENABLED → sign-up issues
  // no session (this is the exact production posture the bug lives in).
  process.env.OPENWHISPR_DISABLE_EMAIL_VERIFICATION = "0";
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
  appDb = drizzle(appPool, { schema });
  // Wire the email-capture stub so the verification token is observable
  // in-test. `enqueueEmail` is intentionally left unset → the inline
  // `email.send` path runs (apps/api/src/auth.ts), which is what feeds
  // `captureEmailSender`.
  auth = buildAuth({ db: appDb, email: captureEmailSender as never });

  // The PRODUCTION app surface: `buildApp` registers the app-wide
  // `dualAuthHook` (`onRequest`) BEFORE routes — so this test now goes
  // through BOTH the global auth hook AND the verification-status route,
  // exactly like the deployed binary. No mocks of internal logic: real
  // db + real auth.
  app = await buildApp({ db: appDb as never, auth: auth as never });
  await app.ready();
}, 240_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await ownerPool?.end();
  await container?.stop();
}, 60_000);

describe("R21 — verification-status resolves email-derived identity with no session", () => {
  it("real sign-up under requireEmailVerification issues NO session token", async () => {
    const email = `r21-nosession-${Date.now()}@example.test`;
    const res = await auth.api.signUpEmail({
      body: { email, password: "R21!Str0ngPass", name: "R21 No Session" },
      returnHeaders: true,
    });
    // The R21 trigger: Better Auth returns {token:null} before createSession.
    expect(res.response?.token ?? null).toBeNull();
  }, 60_000);

  it("REGRESSION GUARD: sessionless ?email= poll returns 200, NOT 401 (layer-1 dualAuthHook bypass)", async () => {
    // This is the assertion the prior bare-Fastify test could NOT make:
    // the global `dualAuthHook` 401s every sessionless request unless the
    // route opts out via `config.auth = false`. A 401 here means the R21
    // fix regressed.
    const email = `r21-guard-${Date.now()}@example.test`;
    await auth.api.signUpEmail({
      body: { email, password: "R21!Str0ngPass", name: "R21 Guard" },
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/auth/verification-status?email=${encodeURIComponent(email)}`,
    });
    expect(res.statusCode, "global dualAuthHook must NOT gate this route").not.toBe(401);
    expect(res.statusCode).toBe(200);
  }, 60_000);

  it("sign-up → poll ?email= (no cookie) → {verified:false}; verify → {verified:true}", async () => {
    const email = `r21-window-${Date.now()}@example.test`;
    await auth.api.signUpEmail({
      body: { email, password: "R21!Str0ngPass", name: "R21 Window" },
    });

    // Poll with NO session cookie — the desktop's exact request shape.
    const before = await app.inject({
      method: "GET",
      url: `/api/auth/verification-status?email=${encodeURIComponent(email)}`,
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ verified: false });

    // Click the verification link — drive the REAL Better Auth
    // verify-email flow (token captured from the sendVerificationEmail
    // hook, injected into `GET /api/auth/verify-email`). This is what a
    // desktop user's click does in production: Better Auth flips ONLY
    // `users.email_verified` (the boolean), never `email_verified_at`.
    // A manual `UPDATE … email_verified_at` here would mask the bug the
    // R21 column fix closes — the route now reads `email_verified`.
    await verifyEmailViaRealFlow(email);

    // Poll again — same request, now verified.
    const after = await app.inject({
      method: "GET",
      url: `/api/auth/verification-status?email=${encodeURIComponent(email)}`,
    });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toEqual({ verified: true });
  }, 60_000);

  it("unknown email → 200 {verified:false}, byte-identical to a known-unverified poll", async () => {
    const unknownEmail = `r21-ghost-${Date.now()}@nowhere.test`;
    const knownEmail = `r21-pending-${Date.now()}@example.test`;
    await auth.api.signUpEmail({
      body: { email: knownEmail, password: "R21!Str0ngPass", name: "R21 Pending" },
    });

    const unknown = await app.inject({
      method: "GET",
      url: `/api/auth/verification-status?email=${encodeURIComponent(unknownEmail)}`,
    });
    const known = await app.inject({
      method: "GET",
      url: `/api/auth/verification-status?email=${encodeURIComponent(knownEmail)}`,
    });

    // No enumeration oracle: identical status code AND identical body.
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.json()).toEqual(known.json());
    expect(unknown.json()).toEqual({ verified: false });
  }, 60_000);

  it("malformed ?email= → 400 from the Zod schema", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=not-an-email",
    });
    expect(res.statusCode).toBe(400);
  }, 30_000);

  it("a valid session cookie still wins — identity is session-derived", async () => {
    // Sign up, then verify the email so `signInEmail` will issue a real
    // session (Better Auth refuses sessions for unverified users under
    // requireEmailVerification).
    const email = `r21-cookie-${Date.now()}@example.test`;
    const password = "R21!Str0ngPass";
    await auth.api.signUpEmail({ body: { email, password, name: "R21 Cookie" } });
    // Verify via the REAL verify-email flow so Better Auth will issue a
    // session on sign-in (it refuses sessions for unverified users under
    // requireEmailVerification). No manual UPDATE — same rationale as the
    // window test above.
    await verifyEmailViaRealFlow(email);

    // Real sign-in → a real session; capture the Set-Cookie headers.
    const signIn = await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    });
    const setCookie = signIn.headers?.get("set-cookie");
    expect(setCookie, "sign-in must issue a session cookie").toBeTruthy();
    // Reduce a possibly-multi Set-Cookie string to the `name=value` pairs.
    const cookieHeader = String(setCookie)
      .split(/,(?=[^;]+?=)/)
      .map((c: string) => c.split(";")[0]?.trim())
      .filter(Boolean)
      .join("; ");

    // Poll with the session cookie and NO ?email= — identity is
    // session-derived; the verified user resolves to {verified:true}.
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status",
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ verified: true });
  }, 60_000);
});
