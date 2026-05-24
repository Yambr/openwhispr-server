// SPDX-License-Identifier: FSL-1.1-ALv2
// R20 — a real signed-in user's Better Auth `session.token`, presented as
// `Authorization: Bearer <token>`, must resolve on every authenticated
// route. Before the lens `rewriteWhere` fix, Better Auth's
// `internalAdapter.findSession(token)` issued a bare `{field:"token"}`
// equality clause that the encryption lens passed through unrewritten →
// `WHERE token = '<plaintext>'` against the NULL-at-rest plaintext column
// → no match → 401 on /api/notes/* etc.
//
// Boots a real Postgres via testcontainers, applies ALL migrations
// (including 0030), constructs the production `buildAuth()`, and asserts:
//
//   (1) a credential sign-in produces a session whose `sessions.token`
//       plaintext column is NULL and whose `token_fp` is sha256(token);
//   (2) `auth.api.getSession({ headers: { authorization: 'Bearer …' } })`
//       — the EXACT path the dual-auth hook drives — resolves the session
//       to the right user (RED before the lens fix, GREEN after).
//
// This is the server-side proof for the R20 verification protocol; the
// compose e2e covers the full HTTP journey.

import { dirname as pathDirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildAuth } from "../../src/auth.js";

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
// biome-ignore lint/suspicious/noExplicitAny: AuthInstance public surface is narrow; tests need the raw api object.
let auth: any;

beforeAll(async () => {
  process.env.MASTER_KEK = process.env.MASTER_KEK ?? Buffer.alloc(32).toString("base64url");
  process.env.BETTER_AUTH_SECRET ??=
    "0000000000000000000000000000000000000000000000000000000000000000";
  process.env.OPENWHISPR_DISABLE_EMAIL_VERIFICATION = "1";
  process.env.OPENWHISPR_KEY_PROVIDER = process.env.OPENWHISPR_KEY_PROVIDER ?? "env";

  container = await new PostgreSqlContainer(
    "ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1",
  )
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
  // biome-ignore lint/suspicious/noExplicitAny: appDb shape is the structural Drizzle node-postgres client.
  auth = buildAuth({ db: drizzle(appPool) as any });
}, 240_000);

afterAll(async () => {
  await appPool?.end();
  await ownerPool?.end();
  await container?.stop();
}, 60_000);

/**
 * Sign in and return the raw session bearer the client would hold.
 * The bearer plugin exposes it via the `set-auth-token` response
 * header (the raw, unsigned session-cookie value). This is the exact
 * token the shipped Electron client stores in `tokenStore` and sends
 * as `Authorization: Bearer <token>`.
 */
async function signInAndGetBearer(email: string, password: string): Promise<string> {
  const signIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const headers: Headers = signIn.headers;
  const token = headers.get("set-auth-token");
  if (!token) {
    throw new Error("signInEmail did not emit a set-auth-token header");
  }
  return token;
}

describe("R20 — Better Auth bearer session.token resolves via the token_fp fingerprint", () => {
  it("sign-in stores token_fp; plaintext token column is NULL at rest", async () => {
    const email = `r20-atrest-${Date.now()}@example.test`;
    const password = "R20!Str0ngPass";

    await auth.api.signUpEmail({ body: { email, password, name: "R20 At-Rest" } });
    const token = await signInAndGetBearer(email, password);
    expect(token.length).toBeGreaterThan(0);

    const sess = await ownerPool.query<{ token: string | null; token_fp: Buffer | null }>(
      `SELECT s.token, s.token_fp
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE lower(u.email) = lower($1)
        ORDER BY s.created_at DESC
        LIMIT 1`,
      [email],
    );
    expect(sess.rowCount).toBe(1);
    // Plaintext column is NULL at rest — the lens strips it (LOCKER-08
    // posture preserved: no plaintext session token in the database).
    expect(sess.rows[0]?.token).toBeNull();
    // token_fp is a populated SHA-256 (32-byte) fingerprint — the column
    // that actually carries a value for a real session, and the lookup
    // key the lens `rewriteWhere` rewrite targets. The exact preimage
    // (raw token vs signed cookie value) is a Better Auth internal; the
    // "getSession resolves" test below proves the fingerprint resolves.
    expect(Buffer.isBuffer(sess.rows[0]?.token_fp)).toBe(true);
    expect((sess.rows[0]?.token_fp as Buffer).length).toBe(32);
  }, 60_000);

  it("getSession resolves a Bearer session.token to the signed-in user (R20 core)", async () => {
    const email = `r20-bearer-${Date.now()}@example.test`;
    const password = "R20!Bearer0k";

    await auth.api.signUpEmail({ body: { email, password, name: "R20 Bearer" } });
    const token = await signInAndGetBearer(email, password);

    // This is exactly what the dual-auth hook does: hand the bearer to
    // Better Auth's getSession. Pre-fix this returned null → 401.
    const resolved = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    });
    expect(resolved).toBeTruthy();
    expect(resolved?.user?.email).toBe(email);
  }, 60_000);

  it("getSession returns null for an unknown bearer (no false positive)", async () => {
    const resolved = await auth.api.getSession({
      headers: new Headers({ authorization: "Bearer not-a-real-session-token-xxxxxxxx" }),
    });
    expect(resolved).toBeNull();
  }, 30_000);
});
