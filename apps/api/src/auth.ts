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

/**
 * Phase 10 / Plan 10-01c — email-delivery queue DI payload.
 *
 * Mirrors the Zod schema `emailDeliverySchema` in
 * `apps/worker/src/jobs/email-delivery.ts` (D-A7 payload conventions).
 * Re-declared here as a structural type rather than imported from the
 * worker package to keep the API → worker dependency direction clean:
 * the API enqueues jobs but does not consume worker-internal types.
 * When the worker processes the queue entry it re-parses through Zod,
 * so any drift is caught at job pickup.
 */
export interface EmailDeliveryPayload {
  tenant_id: string;
  to: string;
  template_id: string;
  locale: "en" | "ru";
  variables: Record<string, unknown>;
  request_id: string;
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
  /**
   * Phase 10 / Plan 10-01c — optional BullMQ email-delivery enqueuer.
   *
   * When provided, the Better Auth `sendVerificationEmail` hook routes
   * through the worker-side queue (template_id="email_verification") so
   * the worker process renders the locale-aware template (Plan 10-01b)
   * and dispatches via SMTP. When omitted (every existing call site that
   * predates Plan 10-01c — `auth.test.ts`, the schema-mapping tests,
   * the IP-headers test, etc.) the legacy inline `email.send` path runs.
   * Production wires this from the BullMQ Queue in
   * `apps/api/src/index.ts`; tests pass a mock or leave it unset.
   */
  enqueueEmail?: (payload: EmailDeliveryPayload) => Promise<void>;
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
/**
 * Defensive no-op logger satisfying the FastifyBaseLogger surface that
 * `makeEmailService` and Better-Auth-internals call into when no
 * `opts.log` is supplied by the caller. Exported for test coverage: the
 * fallback must implement every level (info/warn/error/fatal/trace/
 * debug/silent) plus `child()` so a Better-Auth internal that decides
 * to `log.child({ ... }).warn(...)` doesn't crash at runtime.
 *
 * The shared `noop` keeps the function count low (one declared function
 * reused across seven log levels) without sacrificing the
 * FastifyBaseLogger conformance the consumer expects.
 */
const noop = (): void => {
  /* fallback log methods are intentional no-ops */
};

export const fallbackLog = {
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  trace: noop,
  debug: noop,
  silent: noop,
  level: "info" as const,
  child(): typeof fallbackLog {
    return fallbackLog;
  },
};

// ── Phase 8 / Plan 01 ───────────────────────────────────────────────────
// `OPENWHISPR_DISABLE_RATE_LIMIT` LOAD-TEST-ONLY env switch. When set to
// "1" or "true", Better Auth's built-in rate-limiter is force-disabled
// (sign-in / sign-up / forgot-password / verification-status carve-out)
// so synthetic load traffic can saturate auth endpoints without tripping
// the anti-abuse counter. The Fastify limiter honours the same switch in
// apps/api/src/plugins/rate-limit.ts. Default OFF (unset OR "0").
function rateLimitDisabled(): boolean {
  const raw = process.env.OPENWHISPR_DISABLE_RATE_LIMIT;
  return raw === "1" || raw === "true";
}

export function buildAuth(opts: BuildAuthOptions): AuthInstance {
  const { db } = opts;
  const oidcProviders = readOidcProviders();
  // Email service: caller can inject for tests; production path
  // constructs the nodemailer-backed service from env. The dev fallback
  // (SMTP_HOST unset) inside makeEmailService preserves the < 5 min
  // OSS first-launch SLO without requiring an SMTP relay.
  const email: EmailService = opts.email ?? makeEmailService((opts.log ?? fallbackLog) as never);

  // ── Phase 8 / Plan 01 ────────────────────────────────────────────────
  // Loud WARN banner when the load-test switch is on so an operator who
  // fat-fingers OPENWHISPR_DISABLE_RATE_LIMIT into prod sees the failure
  // mode in their logs. Routed through the caller-injected logger so
  // tests can capture it without touching pino.
  const rateLimitOff = rateLimitDisabled();
  if (rateLimitOff) {
    const log = opts.log ?? fallbackLog;
    log.warn(
      "[security] Better Auth rate-limit DISABLED via OPENWHISPR_DISABLE_RATE_LIMIT — load-test only, MUST NOT be set in production",
    );
  }

  const plugins = [
    // Bearer plugin: emits opaque tokens + set-auth-token rotation header.
    // Per AUTH-04 we layer a 5-minute overlap window on top via the
    // sessions.previous_token (text) column. Phase 02.12 dropped the
    // bytea hash storage in favor of Better Auth's canonical plain-text
    // session.token shape; the DB-touching helpers live in
    // apps/api/src/lib/token-rotation.ts.
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
    // Phase 8 / Plan 01 — load-test bypass. When the switch is OFF (the
    // production default) we DO NOT emit a rateLimit block so Better
    // Auth's built-in defaults apply (enabled in production, disabled in
    // dev — its own NODE_ENV-aware behaviour). Only when the operator
    // explicitly opts in do we force-disable the limiter.
    ...(rateLimitOff ? { rateLimit: { enabled: false } } : {}),
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
    // Phase 10 / Plan 10-01c — declare the `locale` additionalField on the
    // user model so Better Auth's sign-up endpoint accepts it from the
    // request body (input:true) and the Drizzle adapter round-trips it
    // through get-session. The DB column is added in migration 0016
    // (NOT NULL DEFAULT 'en' CHECK locale IN ('en','ru')); the
    // additionalField defaultValue matches the column default so a
    // sign-up that omits `locale` (no Accept-Language → no negotiated
    // value) lands as 'en' end-to-end.
    user: {
      additionalFields: {
        locale: {
          type: "string",
          required: false,
          defaultValue: "en",
          input: true,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      // Phase 08-07 / D-LOAD-EV — load-test profiles set
      // OPENWHISPR_DISABLE_EMAIL_VERIFICATION=1 so the synthetic k6 setup
      // can pre-provision 1000 users via /api/auth/sign-up/email and read
      // session.token directly off the response (matching plan-02
      // `provisionUsers()` contract). Production .env NEVER sets this —
      // omitting / setting to anything other than "1" preserves the
      // production default of strict verification. Pattern matches
      // OPENWHISPR_DISABLE_RATE_LIMIT (plan 08-01).
      requireEmailVerification: process.env.OPENWHISPR_DISABLE_EMAIL_VERIFICATION !== "1",
      // Plan 04 wiring: route verification emails through `email.send()`.
      // If the transport throws (Pitfall #4), Better Auth keeps the
      // account unverified — operator sees the error and the desktop's
      // verification-status poll keeps returning false.
      //
      // Phase 10 / Plan 10-01c — when `opts.enqueueEmail` is wired by the
      // production entrypoint, route through the BullMQ email-delivery
      // queue so the worker renders the locale-aware template (Plan
      // 10-01b). Backward-compat: every existing call site that omits
      // `enqueueEmail` continues to hit the inline `email.send` path.
      sendVerificationEmail: async ({
        user,
        url,
      }: {
        user: { email: string; locale?: string; tenantId?: string };
        url: string;
      }) => {
        if (opts.enqueueEmail) {
          const locale: "en" | "ru" = user.locale === "ru" ? "ru" : "en";
          await opts.enqueueEmail({
            // Better Auth surfaces additionalFields on the user object; the
            // Drizzle adapter populates tenantId from the row. When the hook
            // is invoked outside a tenant context (shouldn't happen in
            // production but we don't want to crash here), fall through to
            // the zero UUID so the Zod schema on the worker side still
            // parses; the worker logs a per-tenant warning.
            tenant_id: user.tenantId ?? "00000000-0000-0000-0000-000000000000",
            to: user.email,
            template_id: "email_verification",
            locale,
            variables: { url },
            request_id: crypto.randomUUID(),
          });
          return;
        }
        await email.send({
          to: user.email,
          subject: "Verify your OpenWhispr account",
          text: `Click to verify: ${url}`,
          html: `<p>Click to verify: <a href="${url}">${url}</a></p>`,
        });
      },
      // Phase 07.1 / Plan 13.2 — Better Auth's `onExistingUserSignUp` cannot
      // surface a USER_ALREADY_EXISTS error: the internal context wrapper
      // `runInBackgroundOrAwait` (create-context.mjs:211) swallows any throw
      // inside the hook and logs `Failed to run background task`, then the
      // request continues to return the synthetic anti-enumeration response.
      // The duplicate-email opt-out therefore lives one layer above as a
      // Fastify preHandler — see apps/api/src/routes/better-auth-handler.ts
      // (the `OPENWHISPR_DISABLE_EMAIL_ENUMERATION_PROTECTION` env-gate).
    },
    session: {
      // D-03: ≥30-day TTL.
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // Phase 07.1 / Plan 13.3 — `OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE=1`
      // disables Better Auth's signed-JWT session_data cookie cache so every
      // get-session call validates against the live DB session row. The
      // production default (cache enabled, 5-min maxAge) is the recommended
      // posture for low-latency RSC; the test stack flips it OFF so a
      // sign-out (e.g. 99-cross-screen-smoke step 6) revokes the session
      // immediately for the per-worker fixture user instead of leaving a
      // 5-minute grace window during which subsequent specs still see a
      // valid signed cookie pointing at a deleted DB row.
      cookieCache:
        process.env.OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE === "1"
          ? { enabled: false }
          : { enabled: true, maxAge: 5 * 60 },
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
      // Phase 02.18 / D-01 — Better Auth rate-limiter IP resolution.
      //
      // Better Auth's built-in rate-limiter (sign-in, sign-up,
      // forgot-password, verification-status polling carve-out) buckets by
      // client IP via `getRequestIp`. By default it reads `request.ip`,
      // which behind Traefik is the proxy IP (or empty when invoked from
      // the in-cluster network). Without this override every rate-limited
      // route in production collapses onto a single shared bucket =
      // anti-abuse limiter is effectively disabled, AND the contract-test
      // suite's parallel sign-ins all bucket on the test runner's source
      // IP, tripping the polling carve-out on adjacent tests.
      //
      // Setting `ipAddressHeaders: ["x-forwarded-for"]` makes Better Auth
      // resolve the client IP from the X-Forwarded-For header that Traefik
      // sets on every proxied request. NOT a header-spoofing risk: Traefik
      // strips client-supplied X-Forwarded-For at the public edge by
      // default (see compose/traefik/traefik.yml + 02.18-SUMMARY.md
      // production-safety verification).
      //
      // Reverse-patch evidence:
      // apps/api/src/__tests__/auth-ip-address-headers.test.ts.
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for"],
      },
    },
    plugins,
  }) as unknown as AuthInstance;
}

export type Auth = AuthInstance;
