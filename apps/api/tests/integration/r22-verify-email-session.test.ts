// SPDX-License-Identifier: FSL-1.1-ALv2
// R22 — sign-up → verify must leave the user with a working session.
//
// THE BUG: after a real sign-up → verify-email the Electron client lands
// in the app with NO session. Under Better Auth 1.6.9
// `requireEmailVerification: true`, `POST /sign-up/email` issues no
// session; `GET /verify-email` (plain sign-up token) creates one ONLY
// when `emailVerification.autoSignInAfterVerification` is set — and even
// then the cookie lands in the BROWSER jar, not the Electron client. The
// client's only token-intake channel is its auth-bridge loopback
// listener at `127.0.0.1:5199/oauth/callback`.
//
// THE FIX (Option C): `auth.ts` sets `autoSignInAfterVerification: true`
// AND rewrites the verification link's `callbackURL` to the new
// `GET /api/auth/verify-email-complete` route. Better Auth's verify-email
// handler, on success, creates a session + sets the session cookie, then
// 302-redirects to that route. The route reads the freshly-set session
// cookie and 302-redirects to the desktop bridge with `?bearer_token=`.
//
// CRITICAL — this test boots the PRODUCTION `buildApp()` surface (real
// global hooks incl. `dualAuthHook`) + real `buildAuth()` (real
// verify-email handler) + a real Postgres via testcontainers. It drives
// the FULL chain a desktop user's link-click triggers:
//
//   (1) real sign-up under requireEmailVerification → no session token;
//   (2) the captured verification URL carries
//       `callbackURL=/api/auth/verify-email-complete` (the R22 rewrite);
//   (3) `GET /api/auth/verify-email?token=…&callbackURL=…` → 302 whose
//       Location is the verify-email-complete route AND which sets the
//       Better Auth session cookie;
//   (4) following that 302 with the just-set cookie →
//       `GET /api/auth/verify-email-complete` → 302 whose Location is
//       `http://127.0.0.1:5199/oauth/callback?bearer_token=<token>`;
//   (5) the extracted bearer resolves a real session:
//       `getSession({authorization:'Bearer '+token})` → the verified
//       user — i.e. the desktop client now has a working session.
//
// Only the Postgres driver (network boundary) and the SMTP transport
// (the verification-URL capture stub — a process/network boundary) are
// stand-ins; no internal logic is mocked.

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
// Better Auth's exported AuthInstance type is intentionally narrow; this
// integration test drives the raw `api` surface (`signUpEmail` /
// `getSession`). A bare `let` is not flagged by Biome's noExplicitAny.
let auth: any;
let app: FastifyInstance;
let appDb: AppDb;

// Process-boundary stub for the SMTP transport. Better Auth's
// `sendVerificationEmail` hook (apps/api/src/auth.ts) calls `email.send`
// with a `url` that — post-R22 — carries the rewritten `callbackURL`.
// We capture the most recent `url` per recipient so the test can drive
// the REAL verify-email route exactly as a desktop user's click does.
const sentVerificationUrls = new Map<string, string>();
const captureEmailSender = {
  async send({ to, html, text }: { to: string; html?: string; text?: string }) {
    const haystack = `${html ?? ""} ${text ?? ""}`;
    const match = haystack.match(/https?:\/\/[^\s"'<>]+/);
    if (match) sentVerificationUrls.set(to.toLowerCase(), match[0]);
    return { delivered: true };
  },
};

/** Reduce a (possibly multi-) Set-Cookie header to a `name=value; …` jar. */
function setCookieToJar(raw: string | string[] | undefined): string {
  if (!raw) return "";
  const parts = Array.isArray(raw) ? raw : [raw];
  return parts
    .map((c) => c.split(";")[0]?.trim())
    .filter((v): v is string => Boolean(v))
    .join("; ");
}

beforeAll(async () => {
  process.env.MASTER_KEK = process.env.MASTER_KEK ?? Buffer.alloc(32).toString("base64url");
  process.env.BETTER_AUTH_SECRET ??=
    "0000000000000000000000000000000000000000000000000000000000000000";
  // R22 trigger condition: email verification ENABLED → sign-up issues
  // no session (the exact production posture the bug lives in).
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
  // Wire the verification-URL capture stub. `enqueueEmail` is left unset
  // so the inline `email.send` path runs — which is what feeds the stub.
  auth = buildAuth({ db: appDb, email: captureEmailSender as never });

  // The PRODUCTION app surface — `buildApp` registers the app-wide
  // `dualAuthHook` (`onRequest`) BEFORE routes, exactly like the deployed
  // binary. No mocks of internal logic: real db + real auth.
  app = await buildApp({ db: appDb as never, auth: auth as never });
  await app.ready();
}, 240_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await ownerPool?.end();
  await container?.stop();
}, 60_000);

describe("R22 — sign-up → verify leaves the desktop client with a working session", () => {
  it("real sign-up under requireEmailVerification issues NO session token", async () => {
    const email = `r22-nosession-${Date.now()}@example.test`;
    const res = await auth.api.signUpEmail({
      body: { email, password: "R22!Str0ngPass", name: "R22 No Session" },
      returnHeaders: true,
    });
    // The R22 trigger: Better Auth returns {token:null} before createSession.
    expect(res.response?.token ?? null).toBeNull();
  }, 60_000);

  it("the verification link carries the rewritten verify-email-complete callbackURL", async () => {
    const email = `r22-callbackurl-${Date.now()}@example.test`;
    await auth.api.signUpEmail({
      body: { email, password: "R22!Str0ngPass", name: "R22 CallbackURL" },
    });
    const url = sentVerificationUrls.get(email.toLowerCase());
    expect(url, "sendVerificationEmail hook must have fired").toBeTruthy();
    const cb = new URL(url as string).searchParams.get("callbackURL");
    // R22 rewrite — the link points the post-verify 302 at our route.
    expect(cb).toBe("/api/auth/verify-email-complete");
  }, 60_000);

  it("verify-email → verify-email-complete → loopback bridge yields a WORKING bearer", async () => {
    const email = `r22-fullcircle-${Date.now()}@example.test`;
    await auth.api.signUpEmail({
      body: { email, password: "R22!Str0ngPass", name: "R22 Full Circle" },
    });

    // (1) Pull the real verification URL captured from the email hook.
    const verificationUrl = sentVerificationUrls.get(email.toLowerCase());
    expect(verificationUrl, "no verification URL captured").toBeTruthy();
    const parsedVerification = new URL(verificationUrl as string);
    const token = parsedVerification.searchParams.get("token");
    const callbackURL = parsedVerification.searchParams.get("callbackURL");
    expect(token).toBeTruthy();
    expect(callbackURL).toBe("/api/auth/verify-email-complete");

    // (2) Drive the REAL verify-email route — exactly the desktop click.
    const verifyRes = await app.inject({
      method: "GET",
      url: `/api/auth/verify-email?token=${encodeURIComponent(
        token as string,
      )}&callbackURL=${encodeURIComponent(callbackURL as string)}`,
    });
    // Better Auth's verify-email 302s to the callbackURL on success AND
    // sets the session cookie on this response.
    expect(verifyRes.statusCode, `verify-email body: ${verifyRes.body}`).toBe(302);
    expect(verifyRes.headers.location).toBe("/api/auth/verify-email-complete");
    const sessionJar = setCookieToJar(verifyRes.headers["set-cookie"]);
    expect(sessionJar, "verify-email must set a session cookie").toContain(
      "openwhispr.session_token=",
    );

    // (3) Follow the 302 to verify-email-complete carrying the cookie.
    const completeRes = await app.inject({
      method: "GET",
      url: "/api/auth/verify-email-complete",
      headers: { cookie: sessionJar },
    });
    expect(completeRes.statusCode, `complete body: ${completeRes.body}`).toBe(302);

    // (4) The final redirect is the SERVER-FIXED desktop-bridge loopback
    // URL carrying the session bearer.
    const finalLocation = completeRes.headers.location as string;
    expect(finalLocation).toMatch(/^http:\/\/127\.0\.0\.1:5199\/oauth\/callback\?bearer_token=.+$/);
    const bearer = new URL(finalLocation).searchParams.get("bearer_token");
    expect(bearer).toBeTruthy();

    // (5) The bearer resolves a REAL session — the verified user. This
    // is the proof the desktop client now has a working session.
    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${bearer}` }),
    });
    expect(session, "the bridged bearer must resolve a session").toBeTruthy();
    expect(session?.user?.email?.toLowerCase()).toBe(email.toLowerCase());
    expect(session?.user?.emailVerified).toBe(true);
  }, 90_000);

  it("verify-email-complete with NO session cookie → clean 401, never 500/hang", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verify-email-complete",
    });
    expect(res.statusCode).toBe(401);
    // Canonical single-key envelope, not an HTML error page.
    expect(res.json()).toHaveProperty("error");
    expect(res.headers.location).toBeUndefined();
  }, 30_000);
});
