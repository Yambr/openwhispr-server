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

async function signUp(
  authUrl: string,
  user: FixtureUser,
): Promise<{ created: boolean }> {
  const url = `${authUrl.replace(/\/+$/, "")}/api/auth/sign-up/email`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      password: FIXTURE_PASSWORD,
      name: user.name,
    }),
  });
  if (res.ok) return { created: true };
  // Better Auth returns 4xx with `{message:"User with this email already exists"}`
  // (or similar) when the row exists. Treat as idempotent success.
  if (res.status === 422 || res.status === 400 || res.status === 409) {
    return { created: false };
  }
  const text = await res.text();
  throw new Error(
    `seed: signUp(${user.email}) failed: HTTP ${res.status} body=${text.slice(0, 200)}`,
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
  const authUrl =
    opts?.authUrl ?? process.env.AUTH_URL ?? "http://api.localhost";
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
    return results;
  } finally {
    await pool.end();
  }
}

// CLI entry point.
if (import.meta.url === `file://${process.argv[1]}`) {
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
