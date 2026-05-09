// Phase 2 / Plan 06 — CONTRACT-01 fixture seeder.
//
// Idempotently creates the conformance fixture users by POSTing to the
// running Better Auth sign-up endpoint, then patches the verified ones
// to email_verified_at = now() via the owner DB pool (DDL-grade access).
//
// Why HTTP rather than calling buildAuth() in-process:
//   * `@openwhispr/data` cannot depend on `@openwhispr/api` (apps depend
//     on packages, never the reverse — circular workspace risk).
//   * The sign-up flow runs Better Auth's password-hash + account-row +
//     verification-token side effects which we'd otherwise have to
//     replicate by hand.
//
// Canonical seed-time env: invoke with `SMTP_HOST=` (empty string) so
// Better Auth's `sendVerificationEmail` hook routes through the no-op
// dev-fallback path (Plan 04 makeEmailService stub) — avoids
// connection-refused failures when mailpit isn't in the running profile.
//
// Run as: `pnpm -F @openwhispr/data run seed:conformance`
//   env: AUTH_URL (default http://api.localhost), DATABASE_URL_OWNER.
import { Pool } from "pg";

export const FIXTURE_PASSWORD = "test-PW-12345!";

interface FixtureUser {
  email: string;
  name: string;
  /** When true, post-creation we mark email_verified=true + email_verified_at=now(). */
  verified: boolean;
}

export const CONFORMANCE_FIXTURES: readonly FixtureUser[] = [
  { email: "fixture@conformance.test", name: "Fixture User", verified: true },
  { email: "verified@conformance.test", name: "Verified User", verified: true },
  { email: "pending@conformance.test", name: "Pending User", verified: false },
  { email: "rotation-test@local", name: "Rotation Test", verified: true },
  { email: "poll@conformance.test", name: "Polling User", verified: true },
] as const;

interface SeedResult {
  email: string;
  created: boolean;
  verifiedPatched: boolean;
}

async function signUp(authUrl: string, user: FixtureUser): Promise<{ created: boolean }> {
  const baseUrl = authUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/api/auth/sign-up/email`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Phase 02.3 — Better Auth's CSRF protection rejects requests whose
      // Origin header is absent or not in `trustedOrigins`. Server-to-server
      // fetch() doesn't auto-set Origin; we forward AUTH_URL as Origin so
      // the request matches `trustedOrigins: [AUTH_URL, OPENWHISPR_API_URL]`
      // declared in apps/api/src/auth.ts.
      origin: baseUrl,
    },
    body: JSON.stringify({
      email: user.email,
      password: FIXTURE_PASSWORD,
      name: user.name,
    }),
  });
  if (res.ok) return { created: true };
  // Phase 02.7 / D-03 Layer A — distinguish "already exists" (idempotent OK)
  // from any other 4xx (real validation/CSRF/rate-limit/server failure).
  // Previously this helper swallowed ALL of {400, 409, 422} as "exists",
  // which masked real signup defects and silently left the contract-test DB
  // without the canonical fixture row — making `check-user` correctly
  // return {exists:false} for an apparently "seeded" address.
  //
  // Better Auth's canonical duplicate signal is HTTP 422 with body
  // `{code: "USER_ALREADY_EXISTS", message: "User with this email already exists"}`.
  // We accept either the explicit code OR a /already exists/i message match
  // (the legacy code-less variant) as the idempotent signal. Anything else
  // — including 400 (CSRF), 422 with any other code, 429 (rate limit),
  // and all 5xx — surfaces loudly with status + body slice (max 300 chars).
  const text = await res.text();
  let parsed: { code?: string; message?: string } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    /* non-JSON body — fall through; isDuplicate will be false */
  }
  const isDuplicate =
    parsed.code === "USER_ALREADY_EXISTS" || /already exists/i.test(parsed.message ?? "");
  if (isDuplicate) return { created: false };
  throw new Error(
    `seed: signUp(${user.email}) failed: HTTP ${res.status} body=${text.slice(0, 300)}`,
  );
}

async function patchVerified(pool: Pool, email: string): Promise<boolean> {
  // owner pool BYPASSes RLS; we touch the default-tenant row only.
  const r = await pool.query(
    `UPDATE users
       SET email_verified_at = now(), email_verified = true
     WHERE email = $1
     RETURNING id`,
    [email],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function seedConformanceFixtures(opts?: {
  authUrl?: string;
  ownerUrl?: string;
}): Promise<SeedResult[]> {
  const authUrl = opts?.authUrl ?? process.env.AUTH_URL ?? "http://api.localhost";
  const ownerUrl = opts?.ownerUrl ?? process.env.DATABASE_URL_OWNER;
  if (!ownerUrl) {
    throw new Error(
      "seedConformanceFixtures: DATABASE_URL_OWNER not set — cannot patch email_verified_at",
    );
  }
  const pool = new Pool({ connectionString: ownerUrl, max: 2 });
  try {
    const results: SeedResult[] = [];
    for (const user of CONFORMANCE_FIXTURES) {
      const { created } = await signUp(authUrl, user);
      let verifiedPatched = false;
      if (user.verified) {
        verifiedPatched = await patchVerified(pool, user.email);
      }
      results.push({ email: user.email, created, verifiedPatched });
    }
    // Phase 02.7 / D-03 Layer A — fail-fast diagnostic. After the signUp
    // loop completes, assert the canonical contract-test fixture row landed.
    // Converts the previously silent failure mode (signup quietly skipped →
    // contract test sees {exists:false} → 13/26 RED with no breadcrumb) into
    // a clear seed-time error pointing at the actual upstream problem.
    //
    // Uses lower(email) so the query works against the existing
    // case-sensitive unique index TODAY (sequential one-row scan, fine for
    // a one-shot diagnostic) AND against Plan 02.7-05's incoming functional
    // index `users_tenant_email_lower_unique` (becomes index lookup).
    // Forward-compatible with both schemas.
    const preflight = await pool.query(
      `SELECT count(*)::int AS n FROM users WHERE lower(email) = $1`,
      ["fixture@conformance.test"],
    );
    if ((preflight.rows[0]?.n ?? 0) === 0) {
      throw new Error(
        "seed: preflight failed — fixture@conformance.test row not present after signUp loop",
      );
    }
    return results;
  } finally {
    await pool.end();
  }
}

// CLI entry point.
// Phase 02.3 — dual ESM/CJS detect: tsx (ESM dev mode) sets import.meta.url,
// while the tsup CJS bundle for the compose `seed` service has no
// import.meta and falls back to the require.main check. Wrapping import.meta
// access in a typeof guard avoids ReferenceError under CJS evaluation.
const isEsmEntry =
  typeof import.meta !== "undefined" &&
  // biome-ignore lint/suspicious/noExplicitAny: import.meta typing differs across module systems
  (import.meta as any).url === `file://${process.argv[1]}`;
const isCjsEntry =
  typeof require !== "undefined" &&
  typeof module !== "undefined" &&
  // biome-ignore lint/suspicious/noExplicitAny: require typing differs across module systems
  (require as any).main === module;

/* v8 ignore start */
// CLI bootstrap — unreachable from in-process test runners. Functional
// behavior is exercised by the docker-compose `seed` service in CI, not
// by unit tests. Same rationale as packages/data/src/migrate.ts CLI tail.
if (isEsmEntry || isCjsEntry) {
  seedConformanceFixtures()
    .then((results) => {
      // eslint-disable-next-line no-console
      console.log("seed: conformance fixtures complete");
      for (const r of results) {
        // eslint-disable-next-line no-console
        console.log(`  ${r.email} created=${r.created} verifiedPatched=${r.verifiedPatched}`);
      }
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
/* v8 ignore stop */
