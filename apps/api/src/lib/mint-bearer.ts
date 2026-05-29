// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 02.7 / Plan 02.7-02 / D-01 — production `MintBearer` adapter.
//
// Closes AUTH-A1 (deferred from Phase 02 Plan 05). Replaces the previous
// auth.handler('/api/auth/oauth2/callback/...') delegation, which could
// never work: Better Auth's callbackOAuth route reads PKCE state from its
// own internal `verification` table (parseState in
// node_modules/better-auth/dist/api/routes/callback.mjs:58), but our
// desktop-signin route writes state to our own `oauth_state` table —
// every delegation attempt 400'd with state_not_found.
//
// New design (per RESEARCH §D-01 "Recommended (plain fetch)"):
//   1. POST OIDC_TOKEN_URL (form-urlencoded) with code + code_verifier
//      + redirect_uri + client credentials → access_token (+ optional
//      id_token).
//   2. GET OIDC_USERINFO_URL with Bearer access_token → {sub, email, …}.
//   3. await auth.$context → ctx.internalAdapter.findUserByEmail(
//      email.toLowerCase()) — explicit lowercase even though the installed
//      Better Auth lowercases on read; D-03 alignment requires the
//      explicit guard so any future behavior change does not regress us.
//   4. If user exists → reuse user.id; else internalAdapter.createOAuthUser
//      with explicit lowercased email (createOAuthUser does NOT lowercase
//      automatically — verified in internal-adapter.mjs:39 vs createUser:62).
//   5. internalAdapter.createSession(userId, false) → session.token is the
//      raw 32-char string. The bearer plugin self-signs on receive when
//      the token has no `.` (verified plugins/bearer/index.mjs:32-37 with
//      requireSignature unset), so returning it raw is correct.
//
// Threat boundaries (T-02.7-07): error messages include only status code
// + provider name, NEVER the IdP response body — IdP body may contain
// PII or attacker-controlled values.
import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import { withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import { LRUCache } from "lru-cache";
import { z } from "zod";
import type { MintBearer, MintBearerArgs } from "../routes/auth-callback.js";
import { type AuditCtx, recordAudit } from "./audit.js";
import { resolveDefaultTenantId } from "./default-tenant.js";
import { type JitConfig, readJitConfig } from "./oidc-jit-config.js";
import { JitRejectionError } from "./oidc-jit-hooks.js";
import { type ExistingIdentity, resolveJitDecision } from "./oidc-jit-resolver.js";

/**
 * Minimal Better Auth surface this adapter consumes. Narrowing to a
 * structural type (rather than importing Better Auth's exported `Auth`)
 * keeps the test fakes ergonomic and avoids leaking the full plugin
 * configuration into mint-bearer's call signature.
 */
export interface AuthContextLike {
  internalAdapter: {
    findUserByEmail: (
      email: string,
      options?: unknown,
    ) => Promise<{ user: { id: string }; accounts?: unknown[] } | null>;
    createOAuthUser: (
      user: {
        email: string;
        name: string;
        emailVerified: boolean;
        image?: string | null;
      },
      account: {
        providerId: string;
        accountId: string;
        accessToken?: string;
        idToken?: string | null;
        scope?: string;
      },
    ) => Promise<{ user: { id: string }; account: unknown }>;
    createSession: (
      userId: string,
      dontRememberMe?: boolean,
    ) => Promise<{ token: string; userId: string }>;
  };
}

export interface AuthLike {
  $context: Promise<AuthContextLike>;
}

export interface BuildMintBearerOpts {
  auth: AuthLike;
  /** Reserved for future use; tenant binding is automatic via role-level GUC. */
  db?: TransactionalDb<ExecutableTx>;
  log?: {
    info?: (msg: unknown) => void;
    warn?: (msg: unknown) => void;
  };
}

// HI-04 (REVIEW api-core HIGH / Phase 62) — the OIDC token response is
// zod-validated before use. `await res.json() as OidcTokenResponse` was
// an unchecked cast: a hijacked token endpoint could plant a malformed
// body and the unchecked `access_token` would flow into the userinfo
// Bearer header. The schema fails loud instead.
const OidcTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().optional(),
});
type OidcTokenResponse = z.infer<typeof OidcTokenResponseSchema>;

// Phase 69 / Plan 69-04 / D-69-1 — the desktop path reads OIDC claims via the
// server-side userinfo fetch (genericOAuth's mapProfileToUser never fires here).
// The shape is widened so the JIT resolver can read `groups` + the configured
// tenant claim. The index signature carries whatever named tenant claim the
// operator configured (OIDC_TENANT_CLAIM) without hardcoding its key; `groups`
// is named explicitly for the common case. Unknown claims pass through as the
// untyped `Record<string, unknown>` slice the resolver coerces defensively.
interface OidcUserinfo {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  groups?: string[];
  [claim: string]: unknown;
}

// HI-04 — the OIDC discovery doc is zod-validated before caching.
// `token_endpoint` / `userinfo_endpoint` MUST be absolute https:// URLs;
// the scheme + same-origin checks below additionally pin them to the
// issuer's origin so a poisoned discovery response cannot redirect the
// `client_secret` exchange to an attacker endpoint.
const OidcDiscoveryDocSchema = z.object({
  token_endpoint: z.string().url(),
  userinfo_endpoint: z.string().url(),
});
type OidcDiscoveryDoc = z.infer<typeof OidcDiscoveryDocSchema>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`mint bearer: ${name} is not configured`);
  }
  return value;
}

// HI-04 — bounded, TTL'd cache for the OIDC discovery doc.
//
// OIDC Discovery 1.0 §4 explicitly permits caching the metadata
// document. The original implementation used a bare process-lifetime
// `Map` with NO TTL and NO size bound: a poisoned discovery response
// (token-endpoint swap) was cached for the entire process life, and a
// rotated/refreshed IdP could not recover without a pod roll.
//
// `lru-cache` (the same library `dep-check.ts` uses) provides the
// bounded-size + TTL semantics natively: `max` evicts the
// least-recently-used issuer on overflow; `ttl` (60 min) lets a
// refreshed IdP recover on the next callback — an expired entry is a
// transparent miss (`get` returns `undefined`), triggering a re-fetch.
const MAX_CACHE_ENTRIES = 16;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

const discoveryCache = new LRUCache<string, OidcDiscoveryDoc>({
  max: MAX_CACHE_ENTRIES,
  ttl: DISCOVERY_TTL_MS,
  // `Date.now()` is the TTL clock. `lru-cache` defaults to
  // `performance.now()` when `performance` is present; at a 60-minute
  // TTL granularity a wall-clock-vs-monotonic distinction is immaterial,
  // and `Date.now()` keeps the TTL deterministically controllable under
  // test fake timers.
  perf: { now: () => Date.now() },
  // `ttlResolution: 0` disables `lru-cache`'s 1-second `now()` memoization
  // (which it normally refreshes via an internal `setTimeout`). At a
  // 60-minute TTL the per-read clock call is negligible, and disabling
  // the memoization makes expiry depend solely on the injected `perf`
  // clock — no reliance on a background timer firing.
  ttlResolution: 0,
});

/**
 * HI-04 — assert an OIDC endpoint URL is an https:// URL whose origin
 * matches the issuer's origin (or an explicit operator-configured
 * allowlist origin). A non-affiliated origin on `token_endpoint` /
 * `userinfo_endpoint` is the exact attacker primitive HI-04 describes
 * (redirect the `client_secret` exchange). Default-deny: an operator
 * with a legitimate split-domain IdP sets `OIDC_DISCOVERY_ALLOWED_ORIGINS`
 * (csv of `https://...` origins).
 */
function assertEndpointAffiliated(label: string, endpoint: string, issuerOrigin: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`mint bearer: discovery ${label} is not a valid URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`mint bearer: discovery ${label} must be https`);
  }
  if (url.origin === issuerOrigin) return;
  const allowed = (process.env.OIDC_DISCOVERY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (allowed.includes(url.origin)) return;
  throw new Error(`mint bearer: discovery ${label} origin not affiliated with issuer`);
}

/**
 * Fetch (and cache) the OIDC issuer's discovery doc. Per RFC 8414 /
 * OpenID Connect Discovery 1.0 §4, the metadata document lives at
 * `${issuer}/.well-known/openid-configuration` and contains the
 * `token_endpoint` + `userinfo_endpoint` URLs the relying party uses
 * for code exchange and profile retrieval. Operators set ONE env var
 * (OIDC_ISSUER_URL) and we resolve the rest — matches Better Auth
 * genericOAuth's lazy-discovery contract (auth.ts:89–90).
 *
 * HI-04 — the fetched document is zod-validated AND each endpoint is
 * checked for https + issuer-origin affiliation BEFORE caching; an
 * expired cache entry is treated as a miss and re-fetched.
 *
 * T-02.7-07 — error messages include the HTTP status only, NEVER the
 * response body (discovery doc may be served from a misconfigured
 * proxy that leaks PII or attacker-controlled values).
 */
async function discoverOidc(issuerUrl: string): Promise<OidcDiscoveryDoc> {
  const issuer = issuerUrl.replace(/\/+$/, "");
  // An expired entry is a transparent miss — `get` returns `undefined`
  // once the TTL elapses, so no manual expiry/delete bookkeeping.
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;

  const url = `${issuer}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`mint bearer: discovery ${res.status} (issuer=${issuer})`);
  }
  const parsed = OidcDiscoveryDocSchema.safeParse(await res.json());
  if (!parsed.success) {
    // HI-04 — never cache an unvalidated doc; fail loud (no body leak).
    throw new Error(`mint bearer: discovery doc failed schema validation (issuer=${issuer})`);
  }
  const doc = parsed.data;

  let issuerOrigin: string;
  try {
    issuerOrigin = new URL(issuer).origin;
  } catch {
    throw new Error(`mint bearer: OIDC_ISSUER_URL is not a valid URL`);
  }
  assertEndpointAffiliated("token_endpoint", doc.token_endpoint, issuerOrigin);
  assertEndpointAffiliated("userinfo_endpoint", doc.userinfo_endpoint, issuerOrigin);

  // HI-04 — cache only after zod-validation + origin-affiliation pass;
  // `lru-cache` bounds the size (LRU eviction) and applies the TTL.
  discoveryCache.set(issuer, doc);
  return doc;
}

/** Test-only: clear the discovery cache between vitest runs. */
export function __resetOidcDiscoveryCacheForTests(): void {
  discoveryCache.clear();
}

// ── Phase 69 / Plan 69-04 — desktop JIT seam helpers (D-69-1) ───────────────
//
// The desktop path bypasses genericOAuth, so the SAME pure `resolveJitDecision`
// runs here at the second call-site. The new-user branch projects the resolved
// {tenantId, role} into createOAuthUser (the Plan-03 databaseHooks then fire via
// createWithHooks). The returning-user (reuse-userId) branch never calls
// createOAuthUser, so it persists the role re-sync + emits the audit DIRECTLY —
// mirroring the update-path semantics in oidc-jit-hooks.ts. No PII enters the
// audit payload or the structured log (D-69-2 / T-69-09).

/** Build a no-PII AuditCtx for a JIT emission (no Fastify req on this path). */
function jitAuditCtx(tenantId: string, actorUserId: string | null): AuditCtx {
  return {
    tenant_id: tenantId,
    actor_user_id: actorUserId,
    request_id: crypto.randomUUID(),
    ip: null,
    user_agent: "sso-jit-desktop",
  };
}

/** Map the configured tenant-claim mode onto the audit enum. */
function tenantClaimMode(cfg: JitConfig): "named_claim" | "email_domain" {
  return cfg.tenantClaim === "email_domain" ? "email_domain" : "named_claim";
}

/**
 * Read the persisted identity (tenant + role) of user `id` SCOPED TO `tenantId`.
 *
 * The users RLS policy is `tenant_id = current_setting('app.tenant_id')`, so the
 * row is visible only when the GUC matches. We bind the GUC to the freshly-resolved
 * (incoming) tenant: a `undefined` result therefore means "this id is NOT in the
 * resolved tenant" — the mode-6 tenant-mismatch signal. Mirrors
 * `loadExistingUnderTenant` in oidc-jit-hooks.ts.
 */
async function loadExistingUnderTenant(
  db: TransactionalDb<ExecutableTx>,
  id: string,
  tenantId: string,
): Promise<ExistingIdentity | undefined> {
  return withTenant(db, tenantId, async (tx) => {
    const result = await tx.execute(
      sql`SELECT tenant_id, role FROM users WHERE id = ${id} LIMIT 1`,
    );
    const rows = (result as { rows?: Array<{ tenant_id?: unknown; role?: unknown }> }).rows ?? [];
    const first = rows[0];
    if (first === undefined || typeof first.tenant_id !== "string") {
      return undefined;
    }
    return {
      tenantId: first.tenant_id,
      role: typeof first.role === "string" ? first.role : "",
    };
  });
}

/** Persist a re-synced role on the existing user row (within the resolved tenant tx). */
async function persistRoleResync(
  db: TransactionalDb<ExecutableTx>,
  id: string,
  tenantId: string,
  role: string,
): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await tx.execute(sql`UPDATE users SET role = ${role} WHERE id = ${id}`);
  });
}

/**
 * The structured-log handle threaded from `buildMintBearer({ log })`.
 *
 * Phase 69 fix — the desktop OIDC path uses the RAW internal adapter
 * (`createOAuthUser`), whose Better-Auth `create.after`/`update.after` hooks are
 * queued post-transaction and were observed NOT to flush a `sso.jit.*` line to
 * stdout under our RLS-wrapped adapter (live run15: zero events in api stdout).
 * The @cjm-sso e2e asserts on the STRUCTURED STDOUT log (it greps
 * `docker compose logs api` — there is no audit-read route), so each desktop-side
 * emit helper must `.info()`/`.warn()` the same event shape the web hooks emit
 * (oidc-jit-hooks.ts), in ADDITION to the audit row. Optional so unit tests that
 * build the adapter without a logger keep working.
 */
type MintLog = NonNullable<BuildMintBearerOpts["log"]>;

/** Emit the sso.jit.user.created structured log + audit row (own withTenant tx). */
async function emitUserCreated(
  db: TransactionalDb<ExecutableTx>,
  log: MintLog | undefined,
  tenantId: string,
  actorUserId: string,
  role: "admin" | "member" | "viewer",
  tenantClaimModeValue: "named_claim" | "email_domain",
): Promise<void> {
  log?.info?.({ event: "sso.jit.user.created", tenant_id: tenantId, role });
  await withTenant(db, tenantId, async (tx) => {
    await recordAudit(tx, jitAuditCtx(tenantId, actorUserId), "sso.jit.user.created", {
      tenant_id: tenantId,
      role,
      tenant_claim_mode: tenantClaimModeValue,
    });
  });
}

/** Emit the sso.jit.role.updated structured log + audit row (own withTenant tx). */
async function emitRoleUpdated(
  db: TransactionalDb<ExecutableTx>,
  log: MintLog | undefined,
  tenantId: string,
  actorUserId: string,
  before: "admin" | "member" | "viewer",
  after: "admin" | "member" | "viewer",
  reason: "group_change" | "revocation_downgrade",
): Promise<void> {
  log?.info?.({ event: "sso.jit.role.updated", tenant_id: tenantId, before, after, reason });
  await withTenant(db, tenantId, async (tx) => {
    await recordAudit(tx, jitAuditCtx(tenantId, actorUserId), "sso.jit.role.updated", {
      tenant_id: tenantId,
      before,
      after,
      reason,
    });
  });
}

/** Emit the sso.jit.rejected structured log + audit row (own withTenant tx; actor_user_id=null). */
async function emitRejected(
  db: TransactionalDb<ExecutableTx>,
  log: MintLog | undefined,
  tenantId: string,
  code:
    | "forbidden_missing_tenant_claim"
    | "forbidden_unknown_tenant"
    | "forbidden_no_role_mapping"
    | "forbidden_tenant_mismatch"
    | "invalid_oidc_profile",
): Promise<void> {
  log?.warn?.({ event: "sso.jit.rejected", tenant_id: tenantId, code });
  await withTenant(db, tenantId, async (tx) => {
    await recordAudit(tx, jitAuditCtx(tenantId, null), "sso.jit.rejected", {
      tenant_id: tenantId,
      code,
    });
  });
}

/**
 * Resolve the tenant for a rejected-sign-in audit row. A rejection may have no
 * valid tenant (unknown/missing tenant claim), so use DEFAULT_TENANT_ID per
 * D-69-2 (mirrors the `auth.signin_failed` precedent). actor_user_id is null.
 */
async function resolveRejectionTenant(_code: string): Promise<string> {
  return resolveDefaultTenantId();
}

const JIT_VALID_ROLES = ["admin", "member", "viewer"] as const;
type JitRoleLiteral = (typeof JIT_VALID_ROLES)[number];
function asJitRoleLiteral(value: string): JitRoleLiteral | undefined {
  return JIT_VALID_ROLES.find((r) => r === value);
}

/**
 * Build the OAuth account scope. When JIT is enabled the configured group claim
 * is appended so Keycloak emits groups in userinfo (A1 residual risk); when JIT
 * is disabled the legacy "openid email profile" is unchanged (backward-compat).
 */
function buildAccountScope(jitConfig: JitConfig | null): string {
  const base = "openid email profile";
  if (jitConfig === null) return base;
  const groupScope = jitConfig.groupClaim.length > 0 ? jitConfig.groupClaim : "groups";
  return `${base} ${groupScope}`;
}

/**
 * Build the production `MintBearer` adapter bound to a Better Auth
 * instance. The returned function performs a real OIDC code exchange,
 * upserts the user via Better Auth's internalAdapter, mints a session,
 * and returns the raw opaque bearer.
 */
export function buildMintBearer(opts: BuildMintBearerOpts): MintBearer {
  const { auth, db, log } = opts;

  return async function mintBearer(args: MintBearerArgs): Promise<string> {
    // Fail-fast env validation BEFORE any network call so misconfigured
    // operators see a clear error rather than a confusing 502 from the IdP.
    //
    // Phase 02.16 — token_endpoint / userinfo_endpoint may now come from
    // the OIDC discovery doc when the explicit env overrides are unset.
    // Real-world operators set ONE env var (OIDC_ISSUER_URL) and rely on
    // RFC 8414 / OpenID Connect Discovery 1.0; the explicit env vars
    // remain available for non-conforming IdPs that don't publish a
    // discovery doc at the standard path.
    const clientId = requireEnv("OIDC_CLIENT_ID");
    const clientSecret = requireEnv("OIDC_CLIENT_SECRET");
    const authUrl = requireEnv("AUTH_URL");
    const explicitTokenUrl = process.env.OIDC_TOKEN_URL;
    const explicitUserinfoUrl = process.env.OIDC_USERINFO_URL;
    let tokenEndpoint: string;
    let userinfoEndpoint: string;
    if (explicitTokenUrl && explicitUserinfoUrl) {
      tokenEndpoint = explicitTokenUrl;
      userinfoEndpoint = explicitUserinfoUrl;
    } else {
      const issuerUrl = requireEnv("OIDC_ISSUER_URL");
      // HI-04 — `discoverOidc` zod-validates the doc and asserts both
      // endpoints are https + issuer-origin-affiliated before returning;
      // `token_endpoint` / `userinfo_endpoint` are therefore guaranteed
      // present, well-formed, and trusted at this point.
      const doc = await discoverOidc(issuerUrl);
      tokenEndpoint = explicitTokenUrl ?? doc.token_endpoint;
      userinfoEndpoint = explicitUserinfoUrl ?? doc.userinfo_endpoint;
    }

    const redirectUri = `${authUrl.replace(/\/+$/, "")}/api/auth/desktop-callback/${args.provider}`;

    // Step 1 — token exchange.
    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: args.codeVerifier,
      }),
    });
    if (!tokenRes.ok) {
      // T-02.7-07 — DO NOT include response body in the error message.
      throw new Error(`mint bearer: token exchange ${tokenRes.status} (provider=${args.provider})`);
    }
    // HI-04 — zod-validate the token response; an unchecked cast let a
    // malformed/poisoned body's `access_token` flow into the userinfo
    // Bearer header. Fail loud instead (no body leak in the message).
    const tokenParsed = OidcTokenResponseSchema.safeParse(await tokenRes.json());
    if (!tokenParsed.success) {
      throw new Error(
        `mint bearer: token response failed schema validation (provider=${args.provider})`,
      );
    }
    const tokens: OidcTokenResponse = tokenParsed.data;

    // Step 2 — userinfo.
    const uiRes = await fetch(userinfoEndpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!uiRes.ok) {
      throw new Error(`mint bearer: userinfo ${uiRes.status} (provider=${args.provider})`);
    }
    const profile = (await uiRes.json()) as OidcUserinfo;

    // Step 3 — explicit lowercase BEFORE adapter calls (D-03 alignment).
    // Better Auth's findUserByEmail also lowercases internally
    // (internal-adapter.mjs:448) but createOAuthUser does NOT (line 39 —
    // it spreads `...user` only). Lowercasing ourselves at one chokepoint
    // keeps both paths case-consistent and survives any future Better
    // Auth refactor.
    const email = profile.email.toLowerCase();

    const ctx = await auth.$context;
    const ia = ctx.internalAdapter;

    // Phase 69 / Plan 69-04 (D-69-1) — read the JIT config once. When unset
    // (OIDC_TENANT_CLAIM absent) the resolver is never called and BOTH branches
    // behave exactly as before (backward-compat). When set, the SAME pure
    // resolver runs on both the new-user and the returning-user branches.
    const jitConfig = readJitConfig();
    // The userinfo claim bag (groups + the configured tenant claim) is the
    // resolver input. A typed spread into Record<string, unknown> (LOCKER-02
    // compliant — no type-suppression cast) feeds the resolver, which coerces
    // the bag defensively.
    const claims: Record<string, unknown> = { ...(profile as Record<string, unknown>) };
    const accountScope = buildAccountScope(jitConfig);

    let userId: string;
    const existing = await ia.findUserByEmail(email);
    if (existing) {
      userId = existing.user.id;
      // RETURNING-user branch — the reuse-userId path that historically SKIPPED
      // createOAuthUser, so update.before / role re-sync (mode 5) /
      // tenant-mismatch (mode 6) never fired on desktop. Close that gap here.
      if (jitConfig !== null && db !== undefined) {
        // First resolve WITHOUT `existing` to obtain the resolved tenant; we
        // need it to scope the persisted-row read (the RLS GUC). A rejection
        // (e.g. unknown tenant) surfaces without minting a bearer.
        const resolvedTenant = resolveJitDecision(claims, jitConfig);
        if (!resolvedTenant.ok) {
          await emitRejected(
            db,
            log,
            await resolveRejectionTenant(resolvedTenant.code),
            resolvedTenant.code,
          );
          throw new JitRejectionError(resolvedTenant.code);
        }
        // Read the persisted identity UNDER the resolved tenant. Absent → the
        // bound tenant changed (mode 6): a user is permanently bound to one
        // tenant. Re-run the resolver WITH the existing identity so mode 5/6
        // fire identically to the web update path.
        const persisted = await loadExistingUnderTenant(db, userId, resolvedTenant.tenantId);
        const existingIdentity: ExistingIdentity = persisted ?? { tenantId: "", role: "" };
        const decision = resolveJitDecision(claims, jitConfig, existingIdentity);
        if (!decision.ok) {
          // Mode 6 — refuse reuse + refuse mint; emit sso.jit.rejected.
          await emitRejected(db, log, resolvedTenant.tenantId, decision.code);
          throw new JitRejectionError(decision.code);
        }
        // Mode 5 — the resolved role differs from the persisted role → re-sync
        // the existing row + emit sso.jit.role.updated. Idempotent (unchanged
        // role) → no write, no audit.
        const beforeRole = asJitRoleLiteral(existingIdentity.role);
        if (beforeRole !== undefined && beforeRole !== decision.role) {
          const reason: "group_change" | "revocation_downgrade" =
            beforeRole === "admin" && decision.role !== "admin"
              ? "revocation_downgrade"
              : "group_change";
          await persistRoleResync(db, userId, resolvedTenant.tenantId, decision.role);
          await emitRoleUpdated(
            db,
            log,
            resolvedTenant.tenantId,
            userId,
            beforeRole,
            decision.role,
            reason,
          );
        }
      }
    } else {
      // NEW-user branch — project the resolved {tenantId, role} into the
      // createOAuthUser USER arg so the Plan-03 databaseHooks (which fire via
      // createWithHooks) land the resolved tenant + role on the row.
      let jitFields: { tenantId: string; role: string } | undefined;
      let jitClaimMode: "named_claim" | "email_domain" | undefined;
      if (jitConfig !== null) {
        const decision = resolveJitDecision(claims, jitConfig);
        if (!decision.ok) {
          if (db !== undefined) {
            await emitRejected(db, log, await resolveRejectionTenant(decision.code), decision.code);
          }
          throw new JitRejectionError(decision.code);
        }
        jitFields = { tenantId: decision.tenantId, role: decision.role };
        jitClaimMode = tenantClaimMode(jitConfig);
      }
      const created = await ia.createOAuthUser(
        {
          email,
          name: profile.name ?? profile.email,
          emailVerified: true,
          image: profile.picture ?? null,
          ...(jitFields !== undefined ? jitFields : {}),
        },
        {
          providerId: args.provider,
          accountId: profile.sub,
          accessToken: tokens.access_token,
          idToken: tokens.id_token ?? null,
          scope: accountScope,
        },
      );
      userId = created.user.id;
      // Emit sso.jit.user.created HERE (not via Better-Auth's create.after
      // databaseHook). createOAuthUser runs createWithHooks, but its create.after
      // hooks are queued post-transaction and were observed not to flush a stdout
      // line under the RLS-wrapped adapter on this raw-adapter path (live run15).
      // The @cjm-sso e2e asserts on the structured stdout event, so emit it
      // directly — mirrors the returning-user role-resync emit above.
      if (jitFields !== undefined && jitClaimMode !== undefined && db !== undefined) {
        const createdRole = asJitRoleLiteral(jitFields.role);
        if (createdRole !== undefined) {
          await emitUserCreated(db, log, jitFields.tenantId, userId, createdRole, jitClaimMode);
        }
      }
    }

    // Step 5 — mint session. dontRememberMe=false → full sessionExpiration.
    const session = await ia.createSession(userId, false);
    return session.token;
  };
}
