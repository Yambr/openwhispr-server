// Phase 2 / Plan 01 / Task 3 — Better Auth instance factory.
//
// Source of truth: 02-RESEARCH-AUTH.md § Pattern: Better Auth instance.
//
// CRITICAL: the Drizzle adapter binds to Phase 1's `appDb` (PgBouncer,
// RLS-subject), NEVER `ownerDb`. Every Better Auth query runs as
// openwhispr_app and is RLS-policed. Passing ownerDb here would defeat
// tenant isolation across the entire auth surface.
//
// OIDC is silently disabled when any of OIDC_ISSUER_URL / OIDC_CLIENT_ID
// / OIDC_CLIENT_SECRET is unset (D-02). genericOAuth is registered only
// when all three are present; the smoke test pins both env permutations.
//
// AUTH-A1 (genericOAuth.onSuccess redirect rewriting) is Plan 05's
// concern and is intentionally NOT wired here. Plan 05 hooks the OAuth
// callback to consume the oauth_state row and emit the channel-scheme
// custom-protocol redirect. This factory only stands up the auth
// instance; no callback rewriting yet.

import type { AppDb } from "@openwhispr/data/client";
// Phase 02.5 / Plan 03 / D-01 — Explicit Better-Auth-canonical schema map.
//
// Better Auth's drizzle adapter looks up models by their canonical (singular)
// names: user / session / account / verification. Our drizzle exports are
// pluralized (users / sessions / accounts / verifications). Renaming the
// exports would ripple through TENANT_SCOPED_TABLES, the Plan 05 RLS lint,
// every consumer of `@openwhispr/data/schema`, and the migration test fixtures
// — not worth the blast radius for a name-mapping problem.
//
// Instead, bind the canonical names to the pluralized table objects below,
// scoped only to the drizzleAdapter call. The drizzle exports keep their
// pluralized names everywhere else.
import { accounts, sessions, users, verifications } from "@openwhispr/data/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { type EmailService, makeEmailService } from "./email.js";
import { cookieDomainConfig } from "./lib/cookie-domain.js";

/**
 * Structural return type for buildAuth. Better Auth's full instance type
 * generic-leaks zod-internals (`$strip` from zod's v4 core) which TS6
 * cannot serialise across package boundaries. We expose only the surface
 * Plan 03+ actually consumes (handler + getSession via api + options
 * for smoke-testing); concrete typing happens at the call site via
 * direct usage of the Better Auth functions/values.
 *
 * Internal callers cast through this minimum. Do NOT widen it; if a
 * future plan needs more surface, prefer importing the relevant Better
 * Auth helper directly over enriching this interface.
 */
export interface AuthInstance {
  readonly options: {
    plugins?: ReadonlyArray<{ id: string }>;
  };
}

export interface BuildAuthOptions {
  db: AppDb;
  /** Optional logger; not consumed by Better Auth itself but available for hooks. */
  log?: { info: (msg: unknown) => void; warn: (msg: unknown) => void };
  /**
   * Email transport for verification flows (Plan 04). When omitted we
   * construct one from `process.env.SMTP_*`; the dev-fallback path
   * (SMTP_HOST unset) returns a stub that resolves without sending.
   * Pitfall #4 (Better Auth swallowing nodemailer errors) is mitigated
   * by `makeEmailService` re-throwing on transport failure — Better
   * Auth then leaves the account unverified.
   */
  email?: EmailService;
}

interface OidcProviderConfig {
  providerId: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
}

function readOidcProviders(): OidcProviderConfig[] {
  const issuer = process.env.OIDC_ISSUER_URL;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) return [];
  return [
    {
      providerId: "oidc",
      discoveryUrl: `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
      clientId,
      clientSecret,
    },
  ];
}

/**
 * Build a Better Auth instance bound to the given `appDb`.
 *
 * Return type is intentionally `ReturnType<typeof betterAuth>`; the
 * concrete type leaks zod-internals through Better Auth's plugin
 * generics, which TS6 cannot serialise across package boundaries
 * without a `$strip` import. We rely on Better Auth's own type export
 * (re-exported below) for downstream type narrowing.
 *
 * @throws if BETTER_AUTH_SECRET validation fails inside Better Auth (we
 *         deliberately do not pre-validate; let Better Auth's own check
 *         emit the canonical error).
 */
export function buildAuth(opts: BuildAuthOptions): AuthInstance {
  const { db } = opts;
  const oidcProviders = readOidcProviders();
  // Email service: caller can inject for tests; production path
  // constructs the nodemailer-backed service from env. The dev fallback
  // (SMTP_HOST unset) inside makeEmailService preserves the < 5 min
  // OSS first-launch SLO without requiring an SMTP relay.
  const fallbackLog = {
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    trace: () => {},
    debug: () => {},
    silent: () => {},
    level: "info" as const,
    child() {
      return this;
    },
  };
  const email: EmailService = opts.email ?? makeEmailService((opts.log ?? fallbackLog) as never);

  const plugins = [
    // Bearer plugin: emits opaque tokens + set-auth-token rotation header.
    // Per AUTH-04 we will layer a 5-minute overlap window on top via the
    // sessions.previous_token_hash columns added in 0001_better_auth.sql.
    // The DB-touching helpers for that overlap land in a Wave 2 plan.
    bearer(),
    ...(oidcProviders.length > 0
      ? [
          genericOAuth({
            // Plan 05 wires onSuccess for the channel-scheme custom-protocol
            // redirect. Until then the plugin runs with default behavior.
            config: oidcProviders,
          }),
        ]
      : []),
  ];

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      // Better Auth canonical model names (left) ↔ our pluralized drizzle
      // table objects (right). Phase 02.5 / Plan 03 / D-01.
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.AUTH_URL ?? "http://localhost:3000",
    // Phase 02.3 — AUTH_TRUSTED_ORIGINS_EXTRA: optional comma-separated
    // list of additional origins admitted by better-auth's CSRF gate.
    // Used by in-cluster traffic (e.g. the contract-test seed service
    // POST-ing to http://api:3000) that doesn't go through the public
    // https://api.localhost traefik route. Production deployments leave
    // this unset.
    trustedOrigins: [
      process.env.OPENWHISPR_API_URL,
      process.env.AUTH_URL,
      ...(process.env.AUTH_TRUSTED_ORIGINS_EXTRA ?? "").split(",").map((s) => s.trim()),
    ].filter((s): s is string => typeof s === "string" && s.length > 0),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      // Plan 04 wiring: route verification emails through `email.send()`.
      // If the transport throws (Pitfall #4), Better Auth keeps the
      // account unverified — operator sees the error and the desktop's
      // verification-status poll keeps returning false.
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        await email.send({
          to: user.email,
          subject: "Verify your OpenWhispr account",
          text: `Click to verify: ${url}`,
          html: `<p>Click to verify: <a href="${url}">${url}</a></p>`,
        });
      },
    },
    session: {
      // D-03: ≥30-day TTL.
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      cookiePrefix: "openwhispr",
      crossSubDomainCookies: cookieDomainConfig(),
      useSecureCookies: process.env.NODE_ENV === "production",
      // Phase 02.8 / D-01 — Better Auth UUID mode.
      //
      // Resolution chain (verified at v1.6.9 pin):
      //   1. @better-auth/core/dist/db/adapter/get-id-field.mjs:12 reads
      //      `options.advanced?.database?.generateId === "uuid"`.
      //   2. @better-auth/drizzle-adapter declares `supportsUUIDs:true` for
      //      `provider:"pg"` (line 432 of dist/index.mjs).
      //   3. Result: shouldGenerateId=false → BA stops emitting 32-char
      //      base32 strings into our Postgres `uuid` columns.
      //   4. Postgres `users.id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
      //      (and the same on sessions/accounts/verifications) does the work.
      //
      // CRITICAL: this is the FIRST-CLASS path, not a workaround. Removing
      // this line reintroduces the 22P02 / 422 signup failure surfaced by
      // Phase 02.7-06 contract-test E2E. Reverse-patch evidence is captured
      // by tests/self-tests/better-auth-plugin-uuid-safety.test.ts and
      // apps/api/src/__tests__/auth-schema-mapping.test.ts.
      //
      // Residual risk: BA plugins `organization`/`anonymous` import
      // `generateId` directly from `@better-auth/core/utils/id`, bypassing
      // this override. Adding either requires Option B schema migration
      // (uuid → text) FIRST. Enforced by the CI lint test above.
      database: { generateId: "uuid" },
    },
    plugins,
  }) as unknown as AuthInstance;
}

export type Auth = AuthInstance;
