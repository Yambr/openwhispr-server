# Phase 2: Auth + OAuth shim + Custom-Protocol — Research (AUTH dimension)

**Researched:** 2026-05-09
**Domain:** Better Auth v1.6.x server library + Drizzle adapter + OAuth shim + RFC-3986 scheme allow-list + dual auth (bearer/cookie) + token rotation overlap
**Confidence:** HIGH on package pins, scheme grammar, dual-auth hook shape, cookie-domain fix; MEDIUM on the exact overlap-window implementation (Better Auth's stock behavior is "rotate-on-refresh, old token immediately invalid" — we ship a thin custom layer to satisfy AUTH-04 ≥5min overlap)

## Summary

Better Auth v1.6.9 (`latest` on npm as of 2026-04-24) is the pinned server library. The Drizzle adapter ships in-tree (`better-auth/adapters/drizzle`), wired to the Phase 1 `appDb` (PgBouncer, RLS-subject); pre-auth flows (sign-up, OAuth callback) hard-pin to the `default` tenant since Phase 2 has no multi-tenant signup. Better Auth's tables (`account`, `verification`) are added in `0001_better_auth.sql`, hand-augmented with FORCE RLS + `tenant_id` policies; the existing `users` and `sessions` tables from Phase 1 are extended (Better Auth's session shape is mapped onto `sessions`; `users` gains an `email_verified_at` column).

Bearer tokens are opaque (Bearer plugin emits 32-byte URL-safe tokens; we hash with SHA-256 and store in `sessions.token_hash`). The ≥5-minute overlap window required by AUTH-04 is **not** Better Auth's default behavior (stock rotation invalidates the old token immediately) — Phase 2 adds a `previous_token_hash` column and a 300-second `previous_token_expires_at` column to `sessions`, plus a custom auth hook that accepts either token until the previous one expires.

The OAuth shim lives at `apps/api/src/routes/desktop-signin.ts`. State is persisted to a new `oauth_state` table (Phase 2 migration `0002_oauth_state.sql`), keyed by UUID, with PKCE `code_verifier` and 10-minute TTL. The custom-protocol scheme allow-list uses RFC 3986 § 3.1 grammar (`/^[a-z][a-z0-9+.-]*$/`), max 32 chars, with a dangerous-scheme deny-list (`javascript`, `data`, `file`, `vbscript`, `about`, `chrome`, `chrome-extension`, anything starting with `ms-`). Reject case is **400 with `{ "error": "invalid callback scheme" }`** — never a 302 to a rejected scheme.

Cookie-host scoping (PITFALLS #5) is handled by setting Better Auth's cookie `domain` to the eTLD+1 shared between `AUTH_URL` and `OPENWHISPR_API_URL` when they diverge; single-host installs omit `domain` entirely.

**Primary recommendation:** Pin `better-auth@1.6.9`; use the in-tree Drizzle adapter; hand-author the `0001_better_auth.sql` migration (Better Auth's CLI generates a starting point but its schema doesn't include `tenant_id` or RLS policies); ship the overlap window as a custom `previous_token_hash` column rather than fighting Better Auth's internals.

## User Constraints (from 02-CONTEXT.md)

### Locked Decisions (auth subset)

- **D-01:** `better-auth@1.x latest` server, configured via single `apps/api/src/auth.ts`, Drizzle adapter bound to Phase 1 `appDb`. Better Auth migrations integrated into Drizzle migrations as `0001_better_auth.sql`.
- **D-02:** Email + password enabled by default. OIDC via env (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`); silently disabled if any unset.
- **D-03:** Opaque bearer tokens, ≥30-day TTL, `set-auth-token` rotation on Better-Auth calls, **old token valid for 5 minutes after rotation**.
- **D-04:** Dual-auth Fastify `onRequest` hook chain: bearer-first → cookie-fallback → 401. Hook attaches `req.user` and `req.tenant` (via `withTenant`) before route handler.
- **D-05:** `GET /api/desktop-signin/{provider}` at `apps/api/src/routes/desktop-signin.ts`. Reads `callbackURL` query param, validates scheme, persists state in `oauth_state` (Phase 2 migration `0002_oauth_state.sql`), redirects to IdP.
- **D-06:** Allow-list: `openwhispr`, `openwhispr-dev`, `openwhispr-staging` + `OPENWHISPR_PROTOCOL` env override. RFC 3986 grammar, max 32 chars, reject `javascript`/`data`/`file`/control chars.
- **D-07:** Final redirect `${scheme}://?bearer_token=${token}`. Scheme echoed verbatim from validated `callbackURL`.
- **D-08:** OAuth callback creates user under **default tenant** (Phase 2 has no multi-tenant signup).
- **D-22:** Two Phase 2 migrations: `0001_better_auth.sql` (Better Auth tables + RLS + tenant policies) and `0002_oauth_state.sql`.

### Claude's Discretion (auth subset)

- Exact Better Auth minor version + adapter package name.
- OAuth state storage: Postgres `oauth_state` table or Redis with TTL — recommend Postgres for auditability.
- Pin `nodemailer` minor or use `@better-auth/email` if exists.

### Deferred (OUT OF SCOPE)

- Magic-link / passwordless, SAML, SCIM (v2)
- 2FA / TOTP / WebAuthn (Phase 6 or v2)
- Per-tenant signup / invite (Phase 5/6)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Email + password sign-in | Better Auth `emailAndPassword` core, no plugin needed [VERIFIED: better-auth@1.6.9 docs] |
| AUTH-02 | OAuth shim with channel-scheme echo | RFC 3986 § 3.1 grammar + dangerous-scheme deny-list (§ Channel-Scheme Allow-List) |
| AUTH-03 | Opaque bearer ≥30 days, dual auth | Bearer plugin + custom Fastify hook chain (§ Dual-Auth Hook) |
| AUTH-04 | Token rotation overlap ≥5 min | Custom `previous_token_hash` column + middleware (§ Token Rotation Overlap) |
| AUTH-05 | 401 (not 200-with-error) on auth fail | Centralized Fastify `setErrorHandler` (PITFALLS #1) |
| AUTH-06 | Email verification | Better Auth `emailAndPassword.requireEmailVerification` + `sendVerificationEmail` hook routed via `nodemailer` |
| AUTH-07 | Cookie-host scoping (cross-host) | `domain` set to eTLD+1 (§ Cookie Host Scoping) |
| CONTRACT-01 | Conformance suite | Multi-channel matrix + token-rotation contract test (§ Validation Architecture) |

## Project Constraints (from CLAUDE.md)

- **English-only** for code, comments, identifiers, log keys (enforced by `tools/lint-english.ts`)
- **Strict TDD** — tests precede production code
- **HTTPS only** — never plaintext on externally reachable ports
- **`tools/lint-rls.ts`** blocks any new tenant-scoped table without RLS+FORCE RLS+policy — applies to `0001_better_auth.sql` (`account`, `verification`) and `0002_oauth_state.sql`

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-auth` | **1.6.9** | Auth core + Drizzle adapter + Bearer plugin (in-tree) | Pinned by Phase 0 STACK.md; matches desktop client's auth surface byte-for-byte [VERIFIED: `npm view better-auth version` → 1.6.9 published 2026-04-24] |
| `nodemailer` | **8.0.7** | SMTP transport for verification email + admin notifications | Industry default; Better Auth has no in-tree email transport [VERIFIED: npm registry 2026-05-09] |
| `@fastify/cookie` | **11.0.2** | Cookie parsing for Better Auth's session-cookie validator | Required by Better Auth's Fastify integration pattern [VERIFIED: npm 2026-05-09] |
| `@fastify/rate-limit` | **10.3.0** | Per-route rate limits (Phase 2 D-28) | Phase 0 STACK.md pin [VERIFIED: npm 2026-05-09] |

### Better Auth plugins (all in-tree as of 1.6.x — no separate npm packages)

| Import path | Purpose | Notes |
|-------------|---------|-------|
| `better-auth/plugins` → `bearer()` | `Authorization: Bearer` token validation | Stock; emits `set-auth-token` on session refresh |
| `better-auth/plugins` → `genericOAuth()` | Generic OIDC IdP support (D-02) | Configured per-provider via `providers: [{ providerId, discoveryUrl, clientId, clientSecret, ... }]` |
| `better-auth/adapters/drizzle` → `drizzleAdapter()` | Drizzle adapter | Pass `appDb` (NOT `ownerDb`) so RLS applies |

### Migration tool

Better Auth v1.6 ships a **CLI** (`npx @better-auth/cli generate`) that emits Drizzle schema TS files for the auth tables. **Recommendation: use the CLI to generate the starting point, then hand-edit** to add `tenant_id` columns, FK to `tenants`, and FORCE RLS in the migration SQL. The CLI does **not** know about our multi-tenant constraints, so its raw output cannot ship as-is.

```bash
# Run once during Phase 2 plan execution; output is committed to git
npx @better-auth/cli@1.6.9 generate --config apps/api/src/auth.ts --output packages/data/src/schema/better-auth-generated.ts
# Then hand-augment: add tenant_id, FORCE RLS, indexes — write 0001_better_auth.sql by hand
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `better-auth@1.6.9` | `1.7.0-beta.2` | Beta — not for v1 [CITED: dist-tags] |
| `nodemailer` | `@better-auth/email` (does not exist on npm 2026-05-09) | Verified absent — `nodemailer` is the only path |
| In-tree Better Auth plugins | Hand-rolled bearer middleware | Would need to reimplement `set-auth-token` rotation header — multi-month work [CITED: STACK.md § 2] |

**Installation:**

```bash
pnpm add better-auth@1.6.9 nodemailer@8.0.7 @fastify/cookie@11.0.2 @fastify/rate-limit@10.3.0
pnpm add -D @better-auth/cli@1.6.9 @types/nodemailer
```

## Architecture Patterns

### Project structure

```
apps/api/src/
├── auth.ts                    # Better Auth instance + Fastify plugin; exports `auth`
├── routes/
│   ├── desktop-signin.ts      # OAuth shim; D-05
│   ├── check-user.ts          # D-09
│   ├── verification-status.ts # D-10
│   ├── delete-account.ts      # D-11
│   └── health.ts              # D-12
├── middleware/
│   ├── dual-auth.ts           # Fastify onRequest hook; D-04
│   └── tenant.ts              # Wraps handler in withTenant(); extends Phase 1
├── lib/
│   ├── scheme-allowlist.ts    # validateScheme() — pure function, unit-testable
│   └── token-rotation.ts      # previous-token overlap middleware
└── index.ts                   # buildApp() — registers all of the above

packages/data/migrations/
├── 0001_better_auth.sql       # account + verification + extends users/sessions
└── 0002_oauth_state.sql       # OAuth shim state storage
```

### Pattern: Better Auth instance bound to Phase 1 `appDb`

```typescript
// apps/api/src/auth.ts
// CRITICAL: pass appDb (PgBouncer, RLS-subject), NOT ownerDb. Every Better Auth
// query runs as openwhispr_app and is RLS-policed.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, genericOAuth } from "better-auth/plugins";
import nodemailer from "nodemailer";
import { makeAppDb } from "@openwhispr/data/client";
import * as schema from "@openwhispr/data/schema";
import { sendVerificationMail } from "./lib/email.js";

const { db } = makeAppDb();

const oidcProviders = process.env.OIDC_ISSUER_URL && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET
  ? [{
      providerId: "oidc",
      discoveryUrl: `${process.env.OIDC_ISSUER_URL}/.well-known/openid-configuration`,
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      // Better Auth handles PKCE automatically when supported by IdP
    }]
  : [];

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema, // pass the FULL Drizzle schema; Better Auth maps its tables onto ours
  }),
  secret: process.env.BETTER_AUTH_SECRET, // 32+ bytes; lint-default-secrets blocks "changeme"
  baseURL: process.env.AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: [process.env.OPENWHISPR_API_URL, process.env.AUTH_URL].filter(Boolean) as string[],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendVerificationEmail: async ({ user, url, token }) => {
      // url already points at ${AUTH_URL}/api/auth/verify-email?token=...
      await sendVerificationMail(user.email, url);
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days (D-03)
    updateAge: 60 * 60 * 24, // refresh window
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  advanced: {
    cookiePrefix: "openwhispr",
    crossSubDomainCookies: cookieDomainConfig(), // see § Cookie Host Scoping
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  plugins: [
    bearer(), // emits set-auth-token; opaque tokens
    ...(oidcProviders.length > 0 ? [genericOAuth({ config: oidcProviders })] : []),
  ],
});

export type Auth = typeof auth;
```

### Pattern: Fastify integration

```typescript
// apps/api/src/index.ts excerpt
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { auth } from "./auth.js";
import { dualAuthHook } from "./middleware/dual-auth.js";

export async function buildApp() {
  const app = Fastify({ logger: true, trustProxy: true });
  await app.register(fastifyCookie);

  // Mount Better Auth's HTTP handler under /api/auth/*
  // Better Auth exports a Web-Standards Request handler; convert via app.all
  app.all("/api/auth/*", async (req, reply) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body),
    });
    const response = await auth.handler(request);
    reply.status(response.status);
    response.headers.forEach((v, k) => reply.header(k, v));
    reply.send(await response.text());
  });

  // Authenticated-route hook chain
  app.addHook("onRequest", dualAuthHook); // bearer → cookie → 401
  // Routes opt out via { config: { auth: false } }
  return app;
}
```

### Anti-Patterns to Avoid

- **Passing `ownerDb` to `drizzleAdapter()`** — bypasses RLS; leaks across tenants. Always use `appDb`.
- **Returning 200 with `{ error: "..." }` on auth failure** — breaks `withSessionRefresh()` retry path (PITFALLS #1).
- **Hardcoding `openwhispr://` in the redirect** — breaks dev/staging builds (PITFALLS #4).
- **Calling `auth.handler` outside a Fastify request scope without `withTenant`** — the adapter will run queries with no `app.tenant_id` set; RLS fails closed and Better Auth misreports "user not found."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bearer-token issuance, hashing, lookup | Custom session table CRUD | Better Auth Bearer plugin | `set-auth-token` rotation header semantics are subtle; Better Auth has them tested |
| OAuth state cookie + PKCE generation | Hand-rolled `crypto.randomBytes` + `pkce-challenge` | Better Auth `genericOAuth` plugin | PKCE S256 + state verification + nonce validation in 50 LOC, all easy to get wrong |
| Email verification token + redemption | Custom magic-link table | Better Auth `verification` table + `requireEmailVerification` | Idempotency, rate-limiting, and link expiry are non-trivial |
| Password hashing (Argon2id parameters) | `argon2` direct | Better Auth's built-in (Argon2id with 2026-default params) | Better Auth tracks OWASP password-hashing recommendations [CITED: better-auth.com/docs/concepts/password] |
| Session-cookie validator | `cookie-signature` parse | Better Auth's `getSession` API | Cookie format and signing scheme must round-trip with the bearer-token store |
| Scheme-validation regex | Hand-eyeballed regex | RFC 3986 § 3.1 grammar (verified below) | Browser quirks in URL parsing make this footgun-rich |

**Key insight:** Almost every "auth bug" in OSS server projects is a missed edge case in one of the above. Better Auth abstracts the boring parts; we add the **two pieces it doesn't ship**: tenant-scoped query context (`withTenant`) and the ≥5-minute token-overlap window.

## Migrations

### `0001_better_auth.sql` — Better Auth tables, tenant-scoped, FORCE RLS

```sql
-- Phase 2 / D-22. Generated by `npx @better-auth/cli generate` and hand-augmented.
-- Better Auth's "user" and "session" entities map onto Phase 1's users/sessions tables
-- via the Drizzle adapter's schema mapping. We add only `account` (OAuth provider
-- credentials) and `verification` (email-verification + password-reset tokens).

-- Extend Phase 1 users with email_verified + name (Better Auth requires `name` and
-- `emailVerified` boolean on its User model).
ALTER TABLE users ADD COLUMN name text;
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN image text;
ALTER TABLE users ADD COLUMN password_hash text; -- Argon2id; nullable for OAuth-only users

-- Extend Phase 1 sessions for Better Auth shape + overlap window
ALTER TABLE sessions ADD COLUMN previous_token_hash bytea;             -- AUTH-04 overlap
ALTER TABLE sessions ADD COLUMN previous_token_expires_at timestamptz; -- 5 min after rotation
ALTER TABLE sessions ADD COLUMN ip_address text;
ALTER TABLE sessions ADD COLUMN user_agent text;
CREATE INDEX sessions_previous_token_hash_idx ON sessions(previous_token_hash)
  WHERE previous_token_hash IS NOT NULL;

-- Better Auth: account (one row per (user, provider) pair)
CREATE TABLE account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id text NOT NULL,                    -- 'credential' | 'oidc' | future: 'google'
  account_id text NOT NULL,                     -- IdP subject ('sub') or user_id for credential
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,                                 -- Argon2id (Better Auth-managed)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id, tenant_id)
);
CREATE INDEX account_tenant_id_idx ON account(tenant_id);
CREATE INDEX account_user_id_idx ON account(user_id);

ALTER TABLE account ENABLE ROW LEVEL SECURITY;
ALTER TABLE account FORCE ROW LEVEL SECURITY;
CREATE POLICY account_tenant_isolation ON account
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Better Auth: verification (email-verify + password-reset short-lived tokens)
CREATE TABLE verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  identifier text NOT NULL,                     -- email or user_id
  value text NOT NULL,                          -- token (already-hashed by Better Auth)
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_tenant_id_idx ON verification(tenant_id);
CREATE INDEX verification_identifier_idx ON verification(identifier);

ALTER TABLE verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification FORCE ROW LEVEL SECURITY;
CREATE POLICY verification_tenant_isolation ON verification
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

### `0002_oauth_state.sql` — OAuth shim state storage

```sql
-- Phase 2 / D-22. State token storage for the OAuth shim. 10-minute TTL;
-- BullMQ in Phase 6 will run the cleanup sweep (Phase 2 just creates the table).
CREATE TABLE oauth_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider text NOT NULL,                       -- 'oidc' for v1
  callback_url text NOT NULL,                   -- echoed back at completion
  scheme text NOT NULL,                         -- validated channel scheme
  code_verifier text NOT NULL,                  -- PKCE; 43-128 chars
  expires_at timestamptz NOT NULL,              -- now() + 10 min
  consumed_at timestamptz,                      -- single-use; NULL until callback
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_state_tenant_id_idx ON oauth_state(tenant_id);
CREATE INDEX oauth_state_expires_at_idx ON oauth_state(expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE oauth_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_state FORCE ROW LEVEL SECURITY;
CREATE POLICY oauth_state_tenant_isolation ON oauth_state
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Channel-Scheme Allow-List

### `validateScheme()` — pure function, unit-testable

```typescript
// apps/api/src/lib/scheme-allowlist.ts
// RFC 3986 § 3.1: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
// We intentionally REJECT uppercase even though RFC allows it (case-insensitive),
// because every legitimate channel scheme we ship is all-lowercase, and rejecting
// uppercase makes the check stricter without losing any real callers.
const RFC3986_SCHEME = /^[a-z][a-z0-9+\-.]*$/;
const MAX_SCHEME_LEN = 32;

const DANGEROUS_SCHEMES = new Set([
  "javascript", "data", "file", "vbscript", "about",
  "chrome", "chrome-extension",
]);
const DANGEROUS_PREFIXES = ["ms-"]; // ms-appx, ms-windows-store, etc.

const BUILTIN_SCHEMES = ["openwhispr", "openwhispr-dev", "openwhispr-staging"];

export type ValidationResult =
  | { ok: true; scheme: string }
  | { ok: false; reason: string };

export function validateScheme(input: string | undefined | null): ValidationResult {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, reason: "scheme is empty" };
  }
  if (input.length > MAX_SCHEME_LEN) {
    return { ok: false, reason: "scheme exceeds 32 chars" };
  }
  // Reject any control character (codepoint < 0x20) or DEL (0x7f)
  for (let i = 0; i < input.length; i++) {
    const cp = input.charCodeAt(i);
    if (cp < 0x20 || cp === 0x7f) {
      return { ok: false, reason: "scheme contains control character" };
    }
  }
  if (!RFC3986_SCHEME.test(input)) {
    return { ok: false, reason: "scheme does not match RFC 3986 grammar" };
  }
  // Case-insensitive deny-list (input is already known-lowercase from regex,
  // but check is explicit so the deny-list intent is unambiguous)
  const lower = input.toLowerCase();
  if (DANGEROUS_SCHEMES.has(lower)) {
    return { ok: false, reason: "scheme is on the dangerous-scheme deny-list" };
  }
  for (const prefix of DANGEROUS_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return { ok: false, reason: `scheme prefix '${prefix}' is denied` };
    }
  }
  // Allow-list check
  const allowed = new Set(BUILTIN_SCHEMES);
  const override = process.env.OPENWHISPR_PROTOCOL?.trim();
  if (override && override.length > 0) allowed.add(override);
  if (!allowed.has(input)) {
    return { ok: false, reason: "scheme is not in the configured allow-list" };
  }
  return { ok: true, scheme: input };
}

/**
 * Build the final custom-protocol redirect URL.
 * Token uses encodeURIComponent (not encodeURI) because Better Auth tokens
 * are URL-safe-base64 — but we belt-and-suspenders against future token
 * formats that might contain `+`, `/`, `=`. PITFALLS #7 explicitly calls
 * this out: Windows argv parsing mangles `+` and `=`.
 */
export function buildProtocolRedirect(scheme: string, token: string): string {
  return `${scheme}://?bearer_token=${encodeURIComponent(token)}`;
}
```

### Reject case → 400 with global envelope

```typescript
// apps/api/src/routes/desktop-signin.ts excerpt
const result = validateScheme(parsedScheme);
if (!result.ok) {
  return reply.code(400).send({ error: "invalid callback scheme" });
  // NEVER 302 to a rejected scheme — that's the open-redirect vector.
}
```

## Dual-Auth Hook (D-04)

```typescript
// apps/api/src/middleware/dual-auth.ts
import type { FastifyRequest, FastifyReply } from "fastify";
import { auth } from "../auth.js";

export async function dualAuthHook(req: FastifyRequest, reply: FastifyReply) {
  // Routes can opt out: { config: { auth: false } } in route options
  if ((req.routeOptions?.config as any)?.auth === false) return;

  // Build a Web-Standards Request to hand to Better Auth's getSession
  const url = new URL(req.url, `http://${req.headers.host}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }

  // Better Auth's getSession does the bearer-or-cookie check internally:
  //   1. If Authorization: Bearer <token> present → Bearer plugin validates
  //   2. Else read session cookie via cookie validator
  //   3. Returns null on both fail
  const session = await auth.api.getSession({ headers });

  // AUTH-04 overlap: if no session AND we have a bearer token, also try the
  // previous_token_hash table lookup (handled by token-rotation.ts middleware).
  if (!session) {
    const overlapUser = await tryPreviousToken(req); // see § Token Rotation Overlap
    if (!overlapUser) {
      // PITFALLS #1: 401, NOT 200-with-error
      return reply.code(401).send({ error: "unauthorized" });
    }
    (req as any).user = overlapUser.user;
    (req as any).tenant = overlapUser.tenantId;
    return;
  }
  (req as any).user = session.user;
  // v1: every user is in the default tenant. Phase 5/6 introduces real tenant resolution.
  (req as any).tenant = session.user.tenantId ?? await resolveDefaultTenantId();
}
```

A separate `onRequest` hook later in the chain wraps the handler in `withTenant(req.tenant, ...)` so RLS context is set before any DB query inside the route.

## Token Rotation Overlap (AUTH-04)

Better Auth's stock behavior: on `set-auth-token` rotation, the old token is **immediately invalid**. AUTH-04 requires ≥5-minute overlap. Phase 2 ships a custom layer:

```typescript
// apps/api/src/lib/token-rotation.ts
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant } from "@openwhispr/data/tenant-context";

const OVERLAP_MS = 5 * 60 * 1000; // 5 minutes

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/**
 * Called from the Better Auth `session.afterRotate` hook (or wrapped via the
 * adapter) BEFORE the new token replaces the old one in `sessions.token_hash`.
 * Copies the current `token_hash` into `previous_token_hash` with a 5-min TTL.
 */
export async function recordPreviousToken(
  db: AppDb,
  tenantId: string,
  sessionId: string,
  oldHash: Buffer,
): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await tx.execute(sql`
      UPDATE sessions
      SET previous_token_hash = ${oldHash},
          previous_token_expires_at = now() + interval '5 minutes'
      WHERE id = ${sessionId}
    `);
  });
}

/**
 * Called from dualAuthHook when `auth.api.getSession` returns null but a
 * bearer token IS present. Looks up sessions where the bearer matches the
 * PREVIOUS token hash and the overlap window hasn't expired.
 */
export async function tryPreviousToken(
  db: AppDb,
  bearerToken: string,
): Promise<{ user: User; tenantId: string } | null> {
  const hash = hashToken(bearerToken);
  // Note: this query bypasses the per-tenant RLS scope deliberately — we don't
  // know the tenant yet. Solution: scan via a dedicated SECURITY DEFINER
  // function that returns only (user_id, tenant_id) tuples — no row data.
  // Defined in 0001_better_auth.sql; see schema annex.
  const row = await db.execute(sql`
    SELECT user_id, tenant_id FROM lookup_session_by_previous_token(${hash})
  `);
  if (!row.rows[0]) return null;
  // ... fetch user under correct tenant scope
  return { user, tenantId: row.rows[0].tenant_id };
}
```

The SECURITY DEFINER function (added to `0001_better_auth.sql`):

```sql
CREATE OR REPLACE FUNCTION lookup_session_by_previous_token(p_hash bytea)
  RETURNS TABLE (user_id uuid, tenant_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
AS $$
  SELECT user_id, tenant_id
  FROM sessions
  WHERE previous_token_hash = p_hash
    AND previous_token_expires_at > now()
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION lookup_session_by_previous_token(bytea) FROM public;
GRANT EXECUTE ON FUNCTION lookup_session_by_previous_token(bytea) TO openwhispr_app;
```

## Cookie Host Scoping (PITFALLS #5 / D-04 / AUTH-07)

```typescript
// apps/api/src/auth.ts excerpt
import { parse as parseUrl } from "node:url";

function cookieDomainConfig(): { enabled: boolean; domain?: string } {
  const authUrl = process.env.AUTH_URL;
  const apiUrl = process.env.OPENWHISPR_API_URL;
  if (!authUrl || !apiUrl) return { enabled: false };
  const authHost = new URL(authUrl).hostname;
  const apiHost = new URL(apiUrl).hostname;
  if (authHost === apiHost) return { enabled: false }; // single-host: omit domain
  // Find shared parent (eTLD+1). Naive: if they share a suffix of >= 2 labels.
  const sharedParent = findSharedParentDomain(authHost, apiHost);
  if (!sharedParent) {
    // Unsupported topology in v1 — fail loudly rather than silently break verification.
    throw new Error(
      `AUTH_URL host '${authHost}' and OPENWHISPR_API_URL host '${apiHost}' share no common parent. ` +
      `Either co-locate them on the same eTLD+1, OR set AUTH_URL == OPENWHISPR_API_URL. ` +
      `Cross-host installs without a shared parent are not supported in v1.`,
    );
  }
  return { enabled: true, domain: `.${sharedParent}` };
}

function findSharedParentDomain(a: string, b: string): string | null {
  const aLabels = a.split(".");
  const bLabels = b.split(".");
  const shared: string[] = [];
  for (let i = 1; i <= Math.min(aLabels.length, bLabels.length); i++) {
    const aTail = aLabels.slice(-i).join(".");
    const bTail = bLabels.slice(-i).join(".");
    if (aTail === bTail) shared[i] = aTail;
    else break;
  }
  // Need at least 2 labels (e.g., "example.com") — single-label TLDs are unsupported.
  const longest = shared.filter(Boolean).at(-1);
  if (!longest || longest.split(".").length < 2) return null;
  return longest;
}
```

Topologies:

| AUTH_URL | OPENWHISPR_API_URL | `domain` set to | Notes |
|----------|--------------------|-----------------|-------|
| `https://api.example.com` | `https://api.example.com` | (omitted) | Single-host: cookie auto-scoped to host |
| `https://auth.example.com` | `https://api.example.com` | `.example.com` | Cross-subdomain: shared eTLD+1 |
| `https://auth.foo.com` | `https://api.bar.com` | (throw) | Unsupported in v1 — fail at boot |

## Common Pitfalls

### Pitfall 1: 200-with-error on auth failure (PITFALLS #1)
**Detection:** Generic test that scans every route; for routes without `{ config: { auth: false } }`, sends `Authorization: Bearer invalid` and asserts response is 401 + JSON + `error` field.
**Prevention:** Centralized `setErrorHandler` in Fastify; `dualAuthHook` returns 401 directly — handlers are never reached when auth fails.

### Pitfall 2: Hardcoded `openwhispr://` (PITFALLS #4)
**Detection:** Multi-channel matrix in CONTRACT-01 (D-18) loops over `[openwhispr, openwhispr-dev, openwhispr-staging, mycorp-whispr]` and asserts the redirect echoes each one.
**Prevention:** `buildProtocolRedirect(scheme, token)` is the only function that constructs the redirect URL; lint rule blocks any string literal containing `openwhispr://`.

### Pitfall 3: Cookie disappears on cross-host (PITFALLS #5)
**Detection:** D-20 cookie-host matrix test: deploy with `AUTH_URL ≠ OPENWHISPR_API_URL`, sign in, hit `/api/auth/verification-status`, assert 200.
**Prevention:** `cookieDomainConfig()` sets `domain` to shared eTLD+1; throws at boot for unsupported topologies.

### Pitfall 4: Token rotation race (PITFALLS #8)
**Detection:** D-19 token-rotation contract test — 100 concurrent requests interleaved with rotation; assert 0/100 receive 401.
**Prevention:** `previous_token_hash` + `previous_token_expires_at` columns; `tryPreviousToken()` fallback in dual-auth hook.

### Pitfall 5: PKCE downgrade when IdP doesn't support it
**Detection:** Better Auth `genericOAuth` plugin auto-detects via `code_challenge_methods_supported` in the OIDC discovery doc. Phase 2 should log a warning when PKCE is unavailable.
**Prevention:** Plan task: assert that the discovery doc check happens at `auth.ts` boot, with a clear log line if PKCE is disabled for the configured IdP.

### Pitfall 6: State cookie disappears in embedded webview (PITFALLS #6)
**Detection:** Server-side, on state-mismatch failure, redirect to an HTML error page (not 4xx JSON) explaining the issue.
**Prevention:** Plan task: implement a custom error handler on `/api/auth/callback/{provider}` that distinguishes "state missing" from "state expired" and renders user-friendly HTML.

### Pitfall 7: Better Auth + PgBouncer transaction-mode prepared-statement compat
**Detection:** Phase 1 confirmed Drizzle works with PgBouncer 1.23+ (RESEARCH-DB §"Pattern 1"). Better Auth runs queries through the same Drizzle adapter — no separate concern.
**Prevention:** Verified path. The Drizzle adapter uses the same `pg` driver Phase 1 tested. No additional pinning needed beyond Phase 1's PgBouncer 1.23+ config.

### Pitfall 8: Token contains `+` `/` `=` (PITFALLS #7)
**Detection:** Token-emission test asserts `^[A-Za-z0-9_-]+$` regex.
**Prevention:** Better Auth Bearer plugin emits URL-safe-base64 by default [VERIFIED: better-auth@1.6.9 source — `bearer.ts` uses `nanoid` with URL-safe alphabet]. `encodeURIComponent` in `buildProtocolRedirect` is belt-and-suspenders.

## Code Examples

### OAuth shim route — full flow

```typescript
// apps/api/src/routes/desktop-signin.ts
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { validateScheme, buildProtocolRedirect } from "../lib/scheme-allowlist.js";
import { withTenant } from "@openwhispr/data/tenant-context";
import { resolveDefaultTenantId } from "../lib/default-tenant.js";

export default async function desktopSigninRoute(app: FastifyInstance) {
  app.get<{
    Params: { provider: string };
    Querystring: { callbackURL?: string; protocol?: string };
  }>("/api/desktop-signin/:provider", { config: { auth: false } }, async (req, reply) => {
    const { provider } = req.params;
    if (!["oidc"].includes(provider)) {
      return reply.code(400).send({ error: "unsupported provider" });
    }

    // The desktop sends `?callbackURL=<callback>?protocol=<scheme>` (note the `?` not `&` —
    // upstream desktop spec quirk; see SELF_HOSTING.md § OAuth Flow Walkthrough step 3).
    // Normalize: extract the trailing `?protocol=` into a real query param.
    const rawCb = req.query.callbackURL ?? "";
    const protoMatch = rawCb.match(/[?&]protocol=([^&]+)/);
    const proto = req.query.protocol ?? (protoMatch ? decodeURIComponent(protoMatch[1]) : "");

    const result = validateScheme(proto);
    if (!result.ok) {
      app.log.warn({ provider, scheme: proto, reason: result.reason }, "rejected callback scheme");
      return reply.code(400).send({ error: "invalid callback scheme" });
    }

    // Generate PKCE
    const verifier = generatePkceVerifier(); // 43 random URL-safe chars
    const challenge = pkceChallengeS256(verifier);
    const tenantId = await resolveDefaultTenantId();

    // Persist state
    const stateRow = await withTenant(req.server.appDb, tenantId, async (tx) => {
      const r = await tx.execute(sql`
        INSERT INTO oauth_state (tenant_id, provider, callback_url, scheme, code_verifier, expires_at)
        VALUES (${tenantId}, ${provider}, ${rawCb}, ${result.scheme}, ${verifier}, now() + interval '10 minutes')
        RETURNING id
      `);
      return r.rows[0] as { id: string };
    });

    // Redirect to IdP
    const idpUrl = new URL(`${process.env.OIDC_ISSUER_URL}/authorize`);
    idpUrl.searchParams.set("response_type", "code");
    idpUrl.searchParams.set("client_id", process.env.OIDC_CLIENT_ID!);
    idpUrl.searchParams.set("redirect_uri", `${process.env.AUTH_URL}/api/auth/callback/${provider}`);
    idpUrl.searchParams.set("scope", "openid email profile");
    idpUrl.searchParams.set("state", stateRow.id);
    idpUrl.searchParams.set("code_challenge", challenge);
    idpUrl.searchParams.set("code_challenge_method", "S256");
    return reply.redirect(idpUrl.toString(), 302);
  });
}
```

### OAuth callback — token mint + redirect

```typescript
// apps/api/src/routes/auth-callback.ts
// Better Auth's genericOAuth plugin handles `${AUTH_URL}/api/auth/callback/{provider}`
// natively. We extend its post-success hook to look up the oauth_state row and
// emit the custom-protocol redirect.
import { auth } from "../auth.js";

// In auth.ts:
genericOAuth({
  config: oidcProviders,
  // Fires after Better Auth has minted the bearer token and set the cookie
  onSuccess: async ({ user, request, tokens }) => {
    const url = new URL(request.url);
    const stateId = url.searchParams.get("state");
    if (!stateId) throw new Error("missing state");
    const tenantId = await resolveDefaultTenantId();
    const state = await withTenant(appDb, tenantId, async (tx) => {
      const r = await tx.execute(sql`
        UPDATE oauth_state SET consumed_at = now()
        WHERE id = ${stateId} AND consumed_at IS NULL AND expires_at > now()
        RETURNING scheme
      `);
      return r.rows[0] as { scheme: string } | undefined;
    });
    if (!state) throw new Error("state expired or already consumed");
    return {
      redirectTo: buildProtocolRedirect(state.scheme, tokens.bearerToken),
    };
  },
});
```

## Validation Architecture (Auth)

### Test framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (Phase 0 default) |
| Config file | `apps/api/vitest.config.ts` (extends root) |
| Quick run | `pnpm --filter @openwhispr/api test --run` |
| Full suite | `pnpm test` (all workspaces, including `@openwhispr/contract-tests`) |
| Conformance run | `make contract-test BACKEND_URL=http://api.localhost` |

### Phase requirement → test map

| REQ | Behavior | Type | Command | File status |
|-----|----------|------|---------|-------------|
| AUTH-01 | Sign in with email+password against fresh DB → bearer token, ≥30-day TTL | integration | `pnpm --filter @openwhispr/api test src/auth.test.ts -t 'email+password'` | Wave 0 |
| AUTH-02 | OAuth callback emits `<scheme>://?bearer_token=...` for each of 4 schemes (3 builtins + 1 override) | contract | `pnpm --filter @openwhispr/contract-tests test src/oauth.test.ts -t 'channel matrix'` | Wave 0 |
| AUTH-02 | Reject `javascript:` → 400 + global envelope | unit | `pnpm --filter @openwhispr/api test src/lib/scheme-allowlist.test.ts` | Wave 0 |
| AUTH-03 | Authenticated endpoint with invalid bearer → 401 (not 200) | contract | `pnpm --filter @openwhispr/contract-tests test src/auth.test.ts -t '401 on invalid bearer'` | Wave 0 |
| AUTH-03 | Authenticated endpoint with valid cookie + no bearer → 200 | contract | same file -t 'cookie auth' | Wave 0 |
| AUTH-03 | Authenticated endpoint with valid bearer + no cookie → 200 | contract | same file -t 'bearer auth' | Wave 0 |
| AUTH-04 | Force token rotation mid-flight → 100/100 concurrent requests succeed | integration | `pnpm --filter @openwhispr/api test src/token-rotation.test.ts` | Wave 0 |
| AUTH-06 | Email verification: register → email sent → polling returns `{verified:false}` until link clicked | integration | `pnpm --filter @openwhispr/api test src/email-verification.test.ts` | Wave 0 |
| AUTH-07 | Cookie-host matrix: AUTH_URL ≠ API_URL, shared eTLD+1, sign in, GET /api/auth/verification-status → 200 | contract | `pnpm --filter @openwhispr/contract-tests test src/cookie-host.test.ts` | Wave 0 |

### Token-rotation contract test scaffold (D-19)

```typescript
// packages/contract-tests/src/token-rotation.test.ts
import { describe, it, expect, beforeAll } from "vitest";

describe("AUTH-04 token rotation overlap", () => {
  let backendUrl: string;
  let initialToken: string;

  beforeAll(async () => {
    backendUrl = process.env.BACKEND_URL ?? "http://api.localhost";
    // Sign in with seeded user
    const signInResp = await fetch(`${backendUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "rotation-test@local", password: "test-PW-12345!" }),
    });
    expect(signInResp.status).toBe(200);
    const body = await signInResp.json();
    initialToken = body.token; // Better Auth returns token in body for email sign-in
  });

  it("100 concurrent requests with T1 succeed during overlap window after rotation", async () => {
    // Step 1: trigger rotation via test-only endpoint (Phase 2 ships this guarded by NODE_ENV)
    const rotateResp = await fetch(`${backendUrl}/api/_test/force-rotate`, {
      method: "POST",
      headers: { authorization: `Bearer ${initialToken}` },
    });
    expect(rotateResp.status).toBe(200);
    const newToken = rotateResp.headers.get("set-auth-token");
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(initialToken);

    // Step 2: fire 100 concurrent requests USING THE OLD TOKEN (T1)
    const responses = await Promise.all(
      Array.from({ length: 100 }, () =>
        fetch(`${backendUrl}/api/health-authed`, {
          headers: { authorization: `Bearer ${initialToken}` },
        }),
      ),
    );

    const statuses = responses.map((r) => r.status);
    const fails = statuses.filter((s) => s === 401);
    expect(fails).toHaveLength(0); // 0/100 may 401 during the 5-min overlap
    expect(statuses.every((s) => s >= 200 && s < 300)).toBe(true);
  });
});
```

### Multi-channel scheme matrix (D-18)

```typescript
// packages/contract-tests/src/oauth-channel-matrix.test.ts
import { describe, it, expect } from "vitest";

const SCHEMES = ["openwhispr", "openwhispr-dev", "openwhispr-staging", "mycorp-whispr"];

describe("AUTH-02 channel-scheme echo", () => {
  it.each(SCHEMES)("echoes %s in final redirect", async (scheme) => {
    const cb = `${scheme}://callback?protocol=${scheme}`;
    const url = `${process.env.BACKEND_URL}/api/desktop-signin/oidc?callbackURL=${encodeURIComponent(cb)}&protocol=${scheme}`;
    const resp = await fetch(url, { redirect: "manual" });
    expect(resp.status).toBe(302);
    const loc = resp.headers.get("location")!;
    // First hop is to the IdP — but we can verify the state row carries the scheme,
    // then drive a fixture IdP that 302s straight to /api/auth/callback/oidc?code=fixture&state=...
    // and assert the FINAL redirect after the callback handler runs:
    // expect(finalLoc).toMatch(new RegExp(`^${scheme}://\\?bearer_token=`));
  });

  it("rejects javascript: scheme with 400 + global envelope", async () => {
    const url = `${process.env.BACKEND_URL}/api/desktop-signin/oidc?callbackURL=javascript:alert(1)&protocol=javascript`;
    const resp = await fetch(url, { redirect: "manual" });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body).toEqual({ error: "invalid callback scheme" });
  });
});
```

### Sampling rate

- **Per task commit:** `pnpm --filter @openwhispr/api test --run` (~ 5–8 s for unit + dual-auth specs)
- **Per wave merge:** `pnpm test` (full suite, ~ 30–60 s)
- **Phase gate:** `make contract-test BACKEND_URL=http://api.localhost` green before `/gsd-verify-work`

### Wave 0 gaps

- `apps/api/src/auth.ts` — Better Auth instance (Wave 1)
- `apps/api/src/middleware/dual-auth.ts` (Wave 1)
- `apps/api/src/lib/scheme-allowlist.ts` + `.test.ts` (Wave 0 — pure function, no infra)
- `apps/api/src/lib/token-rotation.ts` (Wave 1)
- `apps/api/src/routes/desktop-signin.ts` (Wave 2 — depends on auth.ts + scheme-allowlist)
- `packages/contract-tests/src/oauth-channel-matrix.test.ts` (Wave 2)
- `packages/contract-tests/src/token-rotation.test.ts` (Wave 2)
- `packages/contract-tests/src/cookie-host.test.ts` (Wave 3 — needs docker-compose fixture)
- `packages/data/migrations/0001_better_auth.sql` + `0002_oauth_state.sql` (Wave 0 — required for everything else)

## Security Domain

### Applicable ASVS categories

| ASVS | Applies | Standard control |
|------|---------|------------------|
| V2 Authentication | yes | Better Auth (password hashing Argon2id, account lockout via Better Auth) |
| V3 Session Management | yes | Better Auth opaque bearer + cookie; SHA-256 token hash at rest |
| V4 Access Control | yes | RLS at Postgres layer; `tenant_id` policies on every Better Auth table |
| V5 Input Validation | yes | `validateScheme()` for callback scheme; zod for endpoint bodies (Phase 0 standard) |
| V6 Cryptography | yes | Argon2id (Better Auth-managed); SHA-256 for token hash; never hand-roll |
| V13 API/Web Service | yes | Global error envelope; 401-not-200 on auth fail; HTTPS-only at Traefik |

### Known threat patterns

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Open redirect via `callbackURL=javascript:...` | Tampering, Elevation | `validateScheme()` allow-list + 400 reject (never 302 to rejected scheme) |
| Token leakage via URL → logs | Information disclosure | Bearer token in URL is only on the final 302 hop to the desktop; **lint rule: never log full URLs containing `bearer_token=`** (PITFALLS #40) |
| State CSRF on OAuth callback | Tampering | Better Auth's built-in state validation + our oauth_state.consumed_at single-use |
| Cross-tenant leak via Better Auth queries | Information disclosure | Better Auth uses appDb (RLS-subject) + `withTenant` wraps every authenticated request |
| Token rotation race → cascading 401s | DoS (UX-level) | `previous_token_hash` overlap (AUTH-04) |
| Email enumeration via `/api/check-user` | Information disclosure | D-28: 10 req/min per IP rate limit; constant-time response |
| Password brute-force | Tampering | Better Auth account lockout (configurable; defaults block 5 fails / 15 min) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Better Auth `genericOAuth` plugin's `onSuccess` hook can replace the default redirect | OAuth callback route | If it doesn't, fall back to a Fastify handler at `/api/auth/post-callback` that reads the cookie and re-emits the custom-protocol redirect — adds 1 task |
| A2 | Better Auth Bearer plugin emits URL-safe-base64 tokens (no `+`/`/`/`=`) by default | PITFALLS #8 prevention | If wrong, configure custom token generator in plugin options — adds 1 task |
| A3 | Better Auth's stock `set-auth-token` rotation invalidates the old token immediately (we add overlap) | Token Rotation Overlap | If Better Auth already supports overlap natively, we delete `previous_token_hash` columns — saves work |
| A4 | `npx @better-auth/cli generate` outputs Drizzle-compatible TS schema | Migration tool | If output is for a different ORM, hand-author the entire `0001_better_auth.sql` from the Better Auth schema reference — adds ~2 hr |
| A5 | Better Auth's email-verification redirect target is configurable to a custom URL (so we can echo the channel scheme on verification success) | Email + verification flow | If not, intercept the default verify-email handler with a Fastify route override — adds 1 task |

## Open Questions

1. **Does Better Auth `genericOAuth` plugin let `onSuccess` rewrite the redirect target, or is the redirect path baked into the plugin?**
   - What we know: the plugin emits a 302 after token mint; the target is configurable in 1.6.x via `redirectTo` callback.
   - What's unclear: whether `redirectTo` is per-provider config or per-request (we need per-request because the scheme comes from the state row).
   - Recommendation: Wave 1 task spends 30 min in the plugin source to confirm; if not, ship the post-callback Fastify route in A1.

2. **Is the test-only `/api/_test/force-rotate` endpoint acceptable, or should we drive rotation via Better Auth's natural refresh path?**
   - What we know: D-19 says "test-only hook" is fine.
   - What's unclear: whether CI gates accept a `NODE_ENV=test`-gated route.
   - Recommendation: ship guarded by `if (process.env.NODE_ENV !== "test") return 404`; planner adds a Wave 0 lint that fails if the route is reachable in production builds.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `better-auth` | Phase 2 entire auth surface | ✓ (npm) | 1.6.9 | — |
| `nodemailer` | AUTH-06 verification | ✓ (npm) | 8.0.7 | If SMTP_HOST unset → no-op (dev path; D-26) |
| Postgres 17 + PgBouncer | Better Auth DB queries | ✓ (Phase 1) | 17.x | — |
| OIDC IdP | AUTH-02 OAuth flow | optional | — | Email+password remains if any of OIDC_* unset (D-02) |
| SMTP server | AUTH-06 verification email | optional | — | Mailpit dev profile (D-27); auto-verify if SMTP_HOST unset |

## Sources

### Primary (HIGH confidence)
- `npm view better-auth version` → 1.6.9 published 2026-04-24 [VERIFIED 2026-05-09]
- `npm view better-auth dist-tags` → latest=1.6.9, beta=1.7.0-beta.2 [VERIFIED 2026-05-09]
- `/Users/nick/openwhispr/docs/SELF_HOSTING.md` § Authentication Contract; § OAuth Flow Walkthrough; § Custom Protocol Channel Variants
- `/Users/nick/openwhispr/docs/OAUTH_SPEC.md` § OpenWhispr Cloud Sign-In; § Custom Protocol Reference; § Conventions
- `.planning/research/PITFALLS.md` Pitfalls #1, #4, #5, #6, #7, #8 (canonical numbering)
- `.planning/research/STACK.md` § 2 Auth Library / Server (Phase 0 pin)
- RFC 3986 § 3.1 — URI scheme grammar — https://datatracker.ietf.org/doc/html/rfc3986#section-3.1

### Secondary (MEDIUM confidence)
- Better Auth official docs — https://better-auth.com/docs (Bearer plugin, OAuth plugin, Drizzle adapter pages)
- Better Auth GitHub — https://github.com/better-auth/better-auth (plugin source for token format verification)

### Tertiary (LOW confidence — flagged for Wave 1 verification)
- A1, A3, A4, A5 in Assumptions Log — Better Auth-specific plugin behaviors that the planner should re-verify against 1.6.9 source during Wave 1 task scoping.

## Metadata

**Confidence breakdown:**
- Package versions + adapter naming: HIGH (verified via `npm view` 2026-05-09)
- Scheme allow-list + RFC 3986 grammar: HIGH (RFC text + custom validator unit-testable in isolation)
- Dual-auth hook shape: HIGH (Better Auth's `getSession` API is stable across 1.5–1.6)
- Cookie host scoping: HIGH (RFC 6265 + Phase 1 PITFALLS #5 is canonical)
- Token rotation overlap: MEDIUM (custom layer; A3 needs Wave 1 verification against Better Auth 1.6.9 source)
- OAuth callback redirect interception: MEDIUM (A1 — plugin API may have changed in 1.6.x)
- Migration content: HIGH (Phase 1 patterns + Better Auth schema reference)

**Research date:** 2026-05-09
**Valid until:** 2026-06-09 (30 days; Better Auth releases ~weekly so re-pin at Phase 3 if any auth work lands)
