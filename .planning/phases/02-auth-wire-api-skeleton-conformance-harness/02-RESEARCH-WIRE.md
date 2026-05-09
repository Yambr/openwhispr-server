# Phase 2: Wire Endpoints + CONTRACT-01 Harness — Research (Wire dimension)

**Researched:** 2026-05-09
**Domain:** 4 in-scope wire endpoints + CONTRACT-01 conformance harness
**Confidence:** HIGH (spec authoritative; library versions verified against npm registry)
**Sibling researchers:** Better Auth/OAuth (separate doc); API container + email + rate-limiting (separate doc)

## Summary

Phase 2's wire dimension is the moment where byte-for-byte BACKEND_SPEC.md compatibility becomes executable. We ship four Fastify route handlers (`POST /api/check-user`, `GET /api/auth/verification-status`, `DELETE /api/auth/delete-account`, `GET /api/health`), one centralized `setErrorHandler` emitting the global `{ "error": "<string>" }` envelope on every non-2xx, and a Vitest-driven conformance harness in `packages/contract-tests/` asserting the spec end-to-end against a real deployed backend.

The harness is the load-bearing artifact: it locks the contract from Phase 2 onward, runs as a required GHA check, and is reused (extended, not rewritten) by Phases 3/4/5 as their endpoints land. Single source of truth for every JSON shape is one `schemas.ts` file shared by handlers (via `@fastify/type-provider-zod`) and tests.

**Primary recommendation:** Use `zod@4.x` schemas in `packages/contract-tests/src/schemas.ts` as the **only** definition of every wire shape; import from both Fastify handlers (request validation) and Vitest tests (response validation). Wire `@fastify/type-provider-zod@1.x` so handler validation and test assertions cannot drift.

## User Constraints (from CONTEXT.md)

### Locked Decisions (verbatim from D-09..D-21, D-28)
- **D-09:** `POST /api/check-user` — pre-auth; `{email}` body; SELECT against `users` (default-tenant context); `{exists:boolean}`. No carve-out (regular limiter).
- **D-10:** `GET /api/auth/verification-status?email=...` — cookie-auth; `{verified:boolean}`. Polling carve-out: key `(ip,email)`, 30/min.
- **D-11:** `DELETE /api/auth/delete-account` — cookie-auth (NOT bearer); cascading delete user+sessions+audit-log; returns `{}` at 200.
- **D-12:** `GET /api/health` — no auth; 200 with `{status:"ok"}`. 3s timeout via Traefik.
- **D-13:** Every non-2xx → `{"error":"<string>"}` via centralized `setErrorHandler`.
- **D-14:** Every authenticated route → 401 (not 200-with-error) on missing/invalid bearer+cookie.
- **D-15:** HTTPS-only at Traefik ingress.
- **D-16:** `x-openwhispr-source` preserved in request log; not used for auth in v1.
- **D-17..D-21:** Conformance suite topology + multi-channel matrix + token rotation + cookie-host + run command.
- **D-28:** Rate-limit overrides — `/api/check-user` 10/min/IP; `/api/auth/verification-status` 30/min/(ip,email); `/api/auth/delete-account` 5/min/user (sibling researcher owns config).

### Claude's Discretion (this dimension)
- zod vs JSON Schema → **zod**. File org → **one-file-per-route** under `apps/api/src/routes/`.

### Deferred Ideas (OUT OF SCOPE)
- `/api/transcribe`, `/api/reason`, `/api/agent/*`, `/api/usage`, `/api/streaming-*`, Stripe, referrals — Phase 3+.
- NDJSON streaming infrastructure — Phase 4 (test scaffolds pre-positioned only).
- Quota-exhaustion 200+limitReached — Phase 3.

## Phase Requirements (this dimension)

| ID | Description | Research Support |
|----|-------------|------------------|
| WIRE-01 | `POST /api/check-user` byte-compatible | § Endpoint 1; `CheckUser*` schemas |
| WIRE-02 | `GET /api/auth/verification-status` byte-compatible incl. polling | § Endpoint 2; rate-limit override |
| WIRE-03 | `DELETE /api/auth/delete-account` byte-compatible | § Endpoint 3 |
| WIRE-04 | `GET /api/health` byte-compatible incl. 3s budget | § Endpoint 4 |
| WIRE-17 | Global error envelope on every non-2xx | § Centralized error envelope |
| WIRE-18 | HTTP 401 (not 200-with-error) on auth failures | § conventions test |
| WIRE-19 | `x-openwhispr-source` echoed/logged | § conventions test |
| WIRE-20 | HTTPS-only at ingress | § conventions test (Traefik-level) |
| CONTRACT-01 | Conformance suite asserts byte-for-byte spec | § CONTRACT-01 architecture |

## Standard Stack

### Core
| Library | Version | Purpose |
|---------|---------|---------|
| `fastify` | 5.8.5 [VERIFIED npm 2026-05-09] | HTTP framework (Phase 1 lock) |
| `zod` | 4.4.3 [VERIFIED npm 2026-05-09] | Single source of truth for wire shapes |
| `@fastify/type-provider-zod` | 1.0.0 [VERIFIED npm 2026-05-09] | Zod ↔ Fastify route schema integration |
| `@fastify/rate-limit` | 10.3.0 [VERIFIED npm 2026-05-09] | Per-route rate-limit overrides (Redis-backed; sibling researcher owns config) |
| `vitest` | 4.1.5 [VERIFIED npm 2026-05-09] | Test runner for `packages/contract-tests/` |

### Supporting
| Library | Purpose |
|---------|---------|
| `undici` (bundled with Node 24) | HTTP client inside conformance tests via `globalThis.fetch` |
| `tough-cookie@5` [CITED npm registry] | Cookie jar for cookie-auth tests (verification-status, delete-account) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zod | JSON Schema + AJV | Native to Fastify but loses TS inference; tests would re-encode shapes and drift |
| `@fastify/type-provider-zod` | Manual `zodToJsonSchema` glue | Type-provider does this for free — saves ~50 LoC/route |
| `tough-cookie` | Manual `Set-Cookie` parsing | Breaks on Domain/SameSite; D-20 needs all three |
| `supertest` | Direct `fetch` against `BACKEND_URL` | Supertest binds in-process; D-17 requires real deployed instance |

**Installation:**
```bash
pnpm add -F api fastify@5 zod@4 @fastify/type-provider-zod@1 @fastify/rate-limit@10
pnpm add -F @openwhispr/contract-tests -D zod@4 vitest@4 tough-cookie@5
```

## Architecture Patterns

### Project Structure

```
apps/api/src/
├── index.ts                      # buildApp(): plugins + routes + error handler
├── errors.ts                     # AuthError, ValidationError, NotFoundError, RateLimitError, ServerError, ServiceUnavailable
├── error-handler.ts              # setErrorHandler implementation
├── plugins/
│   ├── zod-type-provider.ts      # withTypeProvider<ZodTypeProvider>()
│   ├── rate-limit.ts             # @fastify/rate-limit setup (sibling)
│   └── request-log.ts            # log x-openwhispr-source as structured field
└── routes/
    ├── check-user.ts             # POST /api/check-user
    ├── verification-status.ts    # GET /api/auth/verification-status
    ├── delete-account.ts         # DELETE /api/auth/delete-account
    └── health.ts                 # GET /api/health

packages/contract-tests/src/
├── schemas.ts                    # zod source of truth (imported by api + tests)
├── env.ts                        # BACKEND_URL, AUTH_URL with sane defaults
├── helpers/{http.ts,cookie-jar.ts,streaming.ts}
├── conventions.test.ts           # global envelope, 401-not-200, x-openwhispr-source, HTTPS-only
├── check-user.test.ts
├── verification-status.test.ts
├── delete-account.test.ts
├── health.test.ts
├── oauth-redirect.test.ts        # multi-channel matrix (D-18)
├── token-rotation.test.ts        # 100 concurrent during overlap (D-19)
└── cookie-host.test.ts           # split-host topology (D-20)
```

### Pattern 1: Zod schemas as single source of truth

```typescript
// packages/contract-tests/src/schemas.ts
// Source: BACKEND_SPEC.md §POST /api/check-user, §GET /api/auth/verification-status,
//         §DELETE /api/auth/delete-account, §GET /api/health, §Global Error Envelope
import { z } from "zod";

// Global error envelope — every non-2xx response
export const ErrorEnvelope = z.object({ error: z.string().min(1) }).strict();

// POST /api/check-user
export const CheckUserRequest = z.object({ email: z.string().email() }).strict();
export const CheckUserResponse = z.object({ exists: z.boolean() });

// GET /api/auth/verification-status?email=<urlencoded>
export const VerificationStatusQuery = z.object({ email: z.string().email() }).strict();
export const VerificationStatusResponse = z.object({ verified: z.boolean() });

// DELETE /api/auth/delete-account — passthrough so handler may add audit metadata
export const DeleteAccountResponse = z.object({}).passthrough();

// GET /api/health
export const HealthResponse = z.object({ status: z.literal("ok") });
```

**Convention:** `.strict()` on requests (reject extra fields); permissive on responses (desktop ignores extras; forward-compat).

### Pattern 2: One-file-per-route Fastify handler with Zod type provider

**`/api/check-user` (pre-auth, default tenant):**
```typescript
// apps/api/src/routes/check-user.ts
// Source: BACKEND_SPEC.md §POST /api/check-user
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { eq } from "drizzle-orm";
import { CheckUserRequest, CheckUserResponse } from "@openwhispr/contract-tests/schemas";
import { withTenant } from "@openwhispr/data";
import { users } from "@openwhispr/data/schema";
import { DEFAULT_TENANT_ID } from "../tenants.js";

export const checkUserRoute: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: "POST", url: "/api/check-user",
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },          // D-28
    schema: { body: CheckUserRequest, response: { 200: CheckUserResponse } },
    handler: async (req) => {
      const exists = await withTenant(DEFAULT_TENANT_ID, async (db) => {
        const rows = await db.select({ id: users.id }).from(users)
          .where(eq(users.email, req.body.email)).limit(1);
        return rows.length > 0;
      });
      return { exists };
    },
  });
};
```

**`/api/auth/verification-status` (cookie-auth, polling carve-out):**
```typescript
// apps/api/src/routes/verification-status.ts
// Source: BACKEND_SPEC.md §GET /api/auth/verification-status
app.route({
  method: "GET", url: "/api/auth/verification-status",
  config: {
    rateLimit: {
      max: 30, timeWindow: "1 minute",                                    // D-28
      keyGenerator: (req) => `${req.ip}:${(req.query as any).email ?? ""}`,
    },
  },
  schema: { querystring: VerificationStatusQuery, response: { 200: VerificationStatusResponse } },
  preHandler: [app.requireSessionCookie],   // cookie-auth ONLY — bearer NOT accepted per spec
  handler: async (req) => {
    if (!req.session?.user) throw new AuthError("Session expired");
    const verified = await req.tenantDb.checkEmailVerified(req.query.email);
    return { verified };
  },
});
```

**`/api/auth/delete-account` (cookie-auth, cascading delete):**
```typescript
// apps/api/src/routes/delete-account.ts
// Source: BACKEND_SPEC.md §DELETE /api/auth/delete-account
app.route({
  method: "DELETE", url: "/api/auth/delete-account",
  config: { rateLimit: { max: 5, timeWindow: "1 minute" } },              // D-28
  schema: { response: { 200: DeleteAccountResponse } },
  preHandler: [app.requireSessionCookie],   // NOT bearer per spec
  handler: async (req, reply) => {
    const { id: userId, tenantId } = req.session.user;
    await withTenant(tenantId, async (db) => {
      await db.transaction(async (tx) => {
        await tx.delete(sessions).where(eq(sessions.userId, userId));
        await tx.insert(auditLog).values({
          tenantId, userId, event: "account_deleted", occurredAt: new Date(),
        });
        await tx.delete(users).where(eq(users.id, userId));
      });
    });
    app.metrics.increment("account_deleted", { tenant: tenantId });
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return {};
  },
});
```

**`/api/health` (no auth, 3s budget enforced at Traefik):**
```typescript
// apps/api/src/routes/health.ts
// Source: BACKEND_SPEC.md §GET /api/health
app.route({
  method: "GET", url: "/api/health",
  config: { rateLimit: false },              // health checks bypass limiter
  schema: { response: { 200: HealthResponse } },
  handler: async () => ({ status: "ok" as const }),
});
```

### Pattern 3: Centralized error envelope via `setErrorHandler`

```typescript
// apps/api/src/errors.ts
export class AuthError           extends Error { name = "AuthError"; }
export class ValidationError     extends Error { name = "ValidationError"; }
export class NotFoundError       extends Error { name = "NotFoundError"; }
export class RateLimitError      extends Error { name = "RateLimitError"; }
export class ServerError         extends Error { name = "ServerError"; }
export class ServiceUnavailable  extends Error { name = "ServiceUnavailable"; }

// apps/api/src/error-handler.ts
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    let status = 500, message = "Internal server error";
    if (err instanceof ZodError || err.validation)        { status = 400; message = err.issues?.[0]?.message ?? err.message ?? "Invalid request"; }
    else if (err instanceof ValidationError)              { status = 400; message = err.message; }
    else if (err instanceof AuthError)                    { status = 401; message = err.message || "Session expired"; }
    else if (err instanceof NotFoundError)                { status = 404; message = err.message || "Not found"; }
    else if (err instanceof RateLimitError || err.statusCode === 429) { status = 429; message = err.message || "Too many requests"; }
    else if (err instanceof ServiceUnavailable || err.statusCode === 503) { status = 503; message = err.message || "Service temporarily unavailable"; }
    else if (err instanceof ServerError)                  { status = 500; message = err.message; }
    req.log.warn({ err, status }, "request error");
    reply.status(status).type("application/json; charset=utf-8").send({ error: message });
  });
}
```

### Pattern 4: `x-openwhispr-source` request-log tag (D-16)

```typescript
// apps/api/src/plugins/request-log.ts
import fp from "fastify-plugin";
export default fp(async (app) => {
  app.addHook("onRequest", async (req) => {
    req.log = req.log.child({ openwhisprSource: req.headers["x-openwhispr-source"] ?? null });
  });
});
```

### Anti-Patterns to Avoid

- **200-with-error on auth failure** (PITFALLS #1) — never. Auth middleware throws `AuthError`; handler never returns 200 on a missing user.
- **Hand-rolled error JSON in handlers** — every error path goes through `throw new <ErrorClass>(msg)`. No `reply.status(401).send({error: ...})` inline.
- **Schema duplication** — never redefine wire shapes in `apps/api`. Always import from `@openwhispr/contract-tests/schemas`.
- **Hardcoded `openwhispr://` scheme** — every redirect echoes the validated `callbackURL` scheme (sibling researcher owns; conformance test owns the assertion).
- **Bearer-auth on `/api/auth/verification-status` or `/api/auth/delete-account`** — spec says cookie-only on these two. `preHandler` is `requireSessionCookie`, not the dual-auth chain.
- **`.strict()` on response schemas** — desktop ignores extras; use `.passthrough()` where audit metadata may grow.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Wire JSON shape definitions | Custom TS interfaces in two places | One `zod` file imported by api + tests | Drift between handler + test is the entire reason CONTRACT-01 exists |
| Error envelope per-route | `reply.send({error: ...})` inline | `setErrorHandler` + error classes | Forgetting one route is how PITFALLS #1 ships to prod |
| Cookie parsing in tests | regex on `Set-Cookie` | `tough-cookie@5` | Domain/SameSite/Path edge cases break naive parsers; D-20 needs all three |
| HTTP client in tests | `node-fetch` / `axios` | `globalThis.fetch` (Node 24 undici) | Node 24 ships undici natively |
| URL scheme validation | `url.startsWith("openwhispr")` | RFC 3986 grammar regex `/^[a-z][a-z0-9+.-]{0,31}$/` + reject-list | Sibling owns; included for test design |
| Status-code map per error type | inline `if-else` per route | one `setErrorHandler` mapping table | Single audit point |

## Centralized Error Envelope — Status Code Map

| Trigger | HTTP | Error class |
|---------|------|-------------|
| Body/query fails Zod schema | 400 | `ValidationError` / `ZodError` / Fastify validation |
| Missing/invalid bearer+cookie on auth-required route | 401 | `AuthError` |
| Route exists but resource missing | 404 | `NotFoundError` |
| `@fastify/rate-limit` rejects | 429 | `RateLimitError` |
| Uncaught DB / unknown | 500 | `ServerError` |
| Transient infra (DB unavailable) — clients keep polling | 503 | `ServiceUnavailable` |

Every body: `{ "error": "<human-readable string>" }`. Content-Type: `application/json; charset=utf-8`.

## CONTRACT-01 Conformance Suite Architecture

### Topology
- Lives in `packages/contract-tests/` (Phase 0 ships shell — `loads.test.ts`, `index.ts`, `package.json`, `tsconfig.json` already present).
- One file per endpoint + one file per cross-cutting convention.
- All HTTP traffic via `globalThis.fetch` (undici under Node 24).
- All cookie-auth tests share one `tough-cookie` jar per `describe`.
- All Zod assertions via `Schema.parse(body)` (throws on mismatch — Vitest auto-formats diff).

### `env.ts` — host resolution
```typescript
export const BACKEND_URL = process.env.BACKEND_URL ?? "http://api.localhost";
export const AUTH_URL    = process.env.AUTH_URL    ?? "http://auth.localhost";
```

### `helpers/http.ts` — envelope-asserting fetch wrapper
```typescript
import { ErrorEnvelope } from "../schemas.js";
export async function fetchAndParse(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = undefined;
  if (text.length > 0) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!res.ok && body !== undefined) ErrorEnvelope.parse(body);   // global convention
  return { status: res.status, body, headers: res.headers, ok: res.ok };
}
```

### `conventions.test.ts` — cross-cutting (D-13/14/15/16, WIRE-17/18/19/20)

```typescript
const AUTH_REQUIRED = [
  ["GET",    "/api/auth/verification-status?email=x%40y.test"],
  ["DELETE", "/api/auth/delete-account"],
] as const;

describe("global conventions", () => {
  for (const [method, path] of AUTH_REQUIRED) {
    it(`${method} ${path} returns 401 (not 200) on missing auth`, async () => {
      const res = await fetchAndParse(`${BACKEND_URL}${path}`, { method });
      expect(res.status).toBe(401);                         // PITFALLS #1 guard
      ErrorEnvelope.parse(res.body);
    });
    it(`${method} ${path} returns 401 on Bearer invalid`, async () => {
      const res = await fetchAndParse(`${BACKEND_URL}${path}`, {
        method, headers: { Authorization: "Bearer invalid" },
      });
      expect(res.status).toBe(401);
    });
  }

  it("non-2xx body always matches ErrorEnvelope shape", async () => {
    const res = await fetchAndParse(`${BACKEND_URL}/api/does-not-exist`);
    expect([404, 405]).toContain(res.status);
    ErrorEnvelope.parse(res.body);
  });

  it("HTTPS-only at ingress (Traefik refuses plaintext)", async () => {
    if (!BACKEND_URL.startsWith("https://")) return;        // skip in local docker dev
    const httpUrl = BACKEND_URL.replace(/^https:/, "http:");
    const res = await fetch(httpUrl + "/api/health", { redirect: "manual" });
    expect([301, 302, 308, 426]).toContain(res.status);
  });

  it("preserves x-openwhispr-source request-log field (Phase 5 asserts log emission)", async () => {
    const res = await fetchAndParse(`${BACKEND_URL}/api/health`, {
      headers: { "x-openwhispr-source": "desktop" },
    });
    expect(res.status).toBe(200);
  });
});
```

### `check-user.test.ts`
```typescript
describe("POST /api/check-user", () => {
  it("returns { exists: false } for new email", async () => {
    const res = await fetchAndParse(`${BACKEND_URL}/api/check-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ email: `nonexistent-${Date.now()}@test.invalid` }),
    });
    expect(res.status).toBe(200);
    expect(CheckUserResponse.parse(res.body).exists).toBe(false);
  });

  it("returns { exists: true } for seeded email", async () => {
    // CI seeds fixture user before running suite
    const res = await fetchAndParse(`${BACKEND_URL}/api/check-user`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "fixture@conformance.test" }),
    });
    expect(CheckUserResponse.parse(res.body).exists).toBe(true);
  });

  it("rate-limits 11th call in 60s (D-28: 10/min/IP)", async () => {
    const opts = { method: "POST", headers: { "Content-Type": "application/json" },
                   body: JSON.stringify({ email: `rl-${Date.now()}@test.invalid` }) };
    let saw429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${BACKEND_URL}/api/check-user`, opts);
      if (res.status === 429) {
        saw429 = true;
        expect(await res.json()).toMatchObject({ error: expect.any(String) });
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});
```

### `verification-status.test.ts`
```typescript
describe("GET /api/auth/verification-status", () => {
  it("cookie + verified email → { verified: true }", async () => {
    const jar = await signInFixture("verified@conformance.test");
    const res = await jar.fetch(
      `${BACKEND_URL}/api/auth/verification-status?email=verified%40conformance.test`);
    expect(res.status).toBe(200);
    expect(VerificationStatusResponse.parse(await res.json()).verified).toBe(true);
  });

  it("cookie + unverified → { verified: false }", async () => {
    const jar = await signInFixture("pending@conformance.test", { verified: false });
    const res = await jar.fetch(
      `${BACKEND_URL}/api/auth/verification-status?email=pending%40conformance.test`);
    expect(VerificationStatusResponse.parse(await res.json()).verified).toBe(false);
  });

  it("no cookie → 401 (not 200)", async () => {
    const res = await fetch(
      `${BACKEND_URL}/api/auth/verification-status?email=anyone%40test.invalid`);
    expect(res.status).toBe(401);
    ErrorEnvelope.parse(await res.json());
  });

  it("polling carve-out: 31st in 60s for (ip,email) → 429 (D-28)", async () => {
    const jar = await signInFixture("poll@conformance.test");
    const url = `${BACKEND_URL}/api/auth/verification-status?email=poll%40conformance.test`;
    let saw429 = false;
    for (let i = 0; i < 31; i++) {
      const res = await jar.fetch(url);
      if (res.status === 429) { saw429 = true; break; }
    }
    expect(saw429).toBe(true);
  });
});
```

### `delete-account.test.ts`
```typescript
describe("DELETE /api/auth/delete-account", () => {
  it("cookie → 200; subsequent verification-status → 401", async () => {
    const jar = await signInFixture(`delete-${Date.now()}@conformance.test`);
    const del = await jar.fetch(`${BACKEND_URL}/api/auth/delete-account`, { method: "DELETE" });
    expect(del.status).toBe(200);
    DeleteAccountResponse.parse(await del.json());
    const after = await jar.fetch(
      `${BACKEND_URL}/api/auth/verification-status?email=anyone%40test.invalid`);
    expect(after.status).toBe(401);
  });
  it("no cookie → 401 (not 200)", async () => {
    const res = await fetch(`${BACKEND_URL}/api/auth/delete-account`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});
```

### `health.test.ts`
```typescript
describe("GET /api/health", () => {
  it("returns 200 with { status: 'ok' } within 3s budget", async () => {
    const start = Date.now();
    const res = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    expect(res.status).toBe(200);
    expect(Date.now() - start).toBeLessThan(3000);
    HealthResponse.parse(await res.json());
  });
  it("does not require auth", async () => {
    expect((await fetch(`${BACKEND_URL}/api/health`)).status).toBe(200);
  });
});
```

### Run command (D-21)
```makefile
contract-test:
	pnpm --filter @openwhispr/contract-tests test --run

contract-test-deployed:
	@test -n "$(BACKEND_URL)" || (echo "set BACKEND_URL=https://api.customer.com" && exit 1)
	BACKEND_URL=$(BACKEND_URL) AUTH_URL=$(AUTH_URL) $(MAKE) contract-test
```

### GHA workflow snippet (`contract-test` required check)

```yaml
# .github/workflows/ci.yml — new job, wired into branch-protection.json
contract-test:
  runs-on: ubuntu-latest
  needs: [build, lint]
  steps:
    - uses: actions/checkout@v5
    - uses: pnpm/action-setup@v4
      with: { version: 10 }
    - uses: actions/setup-node@v5
      with: { node-version: 24, cache: pnpm }
    - run: pnpm install --frozen-lockfile

    - name: Bring up ephemeral stack
      run: docker compose up -d api postgres pgbouncer redis traefik
      env:
        MASTER_KEK:          ${{ secrets.CI_MASTER_KEK }}
        BETTER_AUTH_SECRET:  ${{ secrets.CI_BETTER_AUTH_SECRET }}

    - name: Wait for /api/health
      run: |
        for i in $(seq 1 60); do
          curl -fsS http://api.localhost/api/health && exit 0
          sleep 1
        done; exit 1

    - name: Seed conformance fixtures
      run: pnpm --filter @openwhispr/data run seed:conformance

    - name: Run conformance suite
      run: make contract-test
      env: { BACKEND_URL: http://api.localhost, AUTH_URL: http://auth.localhost }

    - name: Tear down
      if: always()
      run: docker compose down -v
```

Add to `scripts/branch-protection.json`:
```json
{ "contexts": ["build", "lint", "test", "contract-test"] }
```

## Common Pitfalls

### Pitfall 1: 200-with-error on auth failure (PITFALLS.md #1)
Desktop's `withSessionRefresh()` keys on HTTP 401. 200-with-error breaks the retry path; users get silent logouts. **Prevention:** Centralized `setErrorHandler`. Routes throw `AuthError`. `conventions.test.ts` exhausts every authenticated endpoint with bad creds and asserts 401.

### Pitfall 2: Hardcoded `openwhispr://` scheme (PITFALLS.md #4)
Dev/staging builds register their own schemes. Hardcoded redirect goes to wrong app. **Prevention:** Echo validated `callbackURL` scheme verbatim. `oauth-redirect.test.ts` runs multi-channel matrix (4 schemes + reject case) per D-18. Sibling owns implementation; this dimension owns the test.

### Pitfall 3: Cookie-host scoping in split-host topology (PITFALLS.md #5)
When `AUTH_URL=auth.example.com ≠ API_URL=api.example.com`, cookies set with `Domain=auth.example.com` don't reach the API. `/api/auth/verification-status` 401s. **Prevention:** Set session cookie with `Domain=.example.com` (eTLD+1) when split-host. `cookie-host.test.ts` boots fixture with explicit split hosts and asserts 200 (D-20).

### Pitfall 4: `set-auth-token` race during concurrent requests (PITFALLS.md #8)
Token rotates mid-flight; in-flight requests still using old token cascade-401. **Prevention:** ≥5min overlap window where old token remains valid. `token-rotation.test.ts` fires 100 concurrent during overlap and asserts 0/100 see 401 (D-19). Sibling owns Better Auth implementation; this dimension owns the test.

### Pitfall 5: NDJSON buffering — pre-positioned, not exercised (PITFALLS.md #3)
Streaming endpoints land Phase 4. Phase 2 ships `helpers/streaming.ts` empty stub; Phase 4 fills it. **Prevention:** Documented in code as `// Phase 4: implement once /api/agent/stream lands`.

### Pitfall 6: Schema drift between handler and test
Two definitions → handler validates one shape, test asserts another. **Prevention:** ONE definition in `packages/contract-tests/src/schemas.ts`. `apps/api` re-exports; tests import directly.

### Pitfall 7: Strict response schemas reject server-side metadata
`DeleteAccountResponse = z.object({}).strict()` would reject future `{auditId:"..."}`. **Prevention:** `.passthrough()` on response schemas where forward-compat matters; `.strict()` only on requests.

### Pitfall 8: Test runs against in-process server instead of real deploy
Conformance suite green locally, red against `make up` — defeats CONTRACT-01's "ran against any operator's deployment" purpose. **Prevention:** Tests use `BACKEND_URL` env only; no `app.listen()` import. CI brings up `docker compose` and points the suite at `http://api.localhost`.

## Validation Architecture (Wire)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 [VERIFIED npm 2026-05-09] |
| Config file | `packages/contract-tests/vitest.config.ts` (Phase 2 creates; Phase 0 only ships `package.json` with `"test":"vitest run"`) |
| Quick run command | `pnpm -F @openwhispr/contract-tests test --run` |
| Full suite command | `make contract-test BACKEND_URL=http://api.localhost AUTH_URL=http://auth.localhost` |

### Phase Requirements → Test Map
| Req | Behavior | Command | File |
|-----|----------|---------|------|
| WIRE-01 | check-user new → `{exists:false}` | `pnpm -F …contract-tests test src/check-user.test.ts` | ❌ Wave 0 |
| WIRE-01 | check-user existing → `{exists:true}` | same | ❌ Wave 0 |
| WIRE-01 | check-user 11th in 60s → 429+envelope | same | ❌ Wave 0 |
| WIRE-02 | verification cookie+verified → `{verified:true}` | `…test src/verification-status.test.ts` | ❌ Wave 0 |
| WIRE-02 | verification cookie+unverified → `{verified:false}` | same | ❌ Wave 0 |
| WIRE-02 | verification no-cookie → 401 | same | ❌ Wave 0 |
| WIRE-02 | verification 31st in 60s for (ip,email) → 429 | same | ❌ Wave 0 |
| WIRE-03 | delete cookie → 200; subsequent verification → 401 | `…test src/delete-account.test.ts` | ❌ Wave 0 |
| WIRE-03 | delete no-cookie → 401 | same | ❌ Wave 0 |
| WIRE-04 | health → 200 within 3s | `…test src/health.test.ts` | ❌ Wave 0 |
| WIRE-17 | every non-2xx body matches `{error:string}` | `…test src/conventions.test.ts` | ❌ Wave 0 |
| WIRE-18 | all auth endpoints 401 (not 200) on bad creds | same | ❌ Wave 0 |
| WIRE-19 | `x-openwhispr-source` preserved (Phase 5 asserts log emission) | same | ❌ Wave 0 |
| WIRE-20 | HTTPS-only at ingress (skipped on http BACKEND_URL) | same | ❌ Wave 0 |
| CONTRACT-01 | Suite as required GHA check | n/a (`.github/workflows/ci.yml`) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm -F @openwhispr/contract-tests test --run` (single endpoint subset acceptable mid-Wave)
- **Per wave merge:** Full suite green against local `make up`
- **Phase gate:** Full suite green in GHA against ephemeral docker-compose before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/contract-tests/vitest.config.ts`
- [ ] `packages/contract-tests/src/schemas.ts` — single source of truth
- [ ] `packages/contract-tests/src/env.ts` — BACKEND_URL/AUTH_URL resolution
- [ ] `packages/contract-tests/src/helpers/{http,cookie-jar,streaming}.ts` (streaming.ts is a Phase 4 stub)
- [ ] `packages/contract-tests/src/{conventions,check-user,verification-status,delete-account,health}.test.ts`
- [ ] `apps/api/src/errors.ts` — error class hierarchy
- [ ] `apps/api/src/error-handler.ts` — `setErrorHandler` registration
- [ ] `apps/api/src/routes/{check-user,verification-status,delete-account,health}.ts`
- [ ] `apps/api/src/plugins/{zod-type-provider,request-log}.ts`
- [ ] Workspace dep: `@openwhispr/contract-tests` exports `./schemas` from its package.json
- [ ] `Makefile` — `contract-test` target
- [ ] `.github/workflows/ci.yml` — `contract-test` job
- [ ] `scripts/branch-protection.json` — add `contract-test` to required contexts
- [ ] `packages/data/src/seed/conformance.ts` — fixture seeder for CI (verify if exists; create if not)

## Security Domain

### Applicable ASVS Categories

| ASVS | Applies | Standard Control |
|------|---------|-----------------|
| V2 Authentication | yes | Better Auth (sibling); this dimension enforces 401-not-200 + envelope |
| V3 Session Management | yes | cookie scoping (`Domain=eTLD+1`, `Secure`, `HttpOnly`, `SameSite=Lax`); D-20 test |
| V4 Access Control | partial | tenant scoping via `withTenant`; Phase 1 owns RLS |
| V5 Input Validation | yes | Zod via `@fastify/type-provider-zod` on every body/query |
| V6 Cryptography | n/a | Phase 2 emits no new crypto; bearer is opaque (sibling) |
| V7 Error Handling | yes | Centralized `setErrorHandler`; never leak stack traces; always envelope shape |
| V13 API and Web Service | yes | HTTPS-only at ingress (D-15); per-route rate limits (D-28); content-type enforcement |

### Known Threat Patterns

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Email enumeration via `/api/check-user` | Information Disclosure | Rate limit 10/min/IP (D-28); identical 200 shape regardless of existence |
| Auth bypass via 200-with-error confusion | Elevation of Privilege | Centralized `setErrorHandler` enforces 401 (PITFALLS #1) |
| Open redirect via `callbackURL=javascript:...` | Tampering | Scheme allow-list + RFC 3986 grammar regex (sibling) + reject-list test in `oauth-redirect.test.ts` |
| Account-deletion CSRF | Tampering | `SameSite=Lax` cookie; Phase 6 adds CSRF token if browser admin UI exposes endpoint |
| DoS via verification-status polling | Denial of Service | Per-(ip,email) 30/min (D-28) — tighter than per-IP (legit users poll from one IP) |
| Token leakage via URL logs | Information Disclosure | Bearer in `Authorization` header, never URL; OAuth final redirect carries `bearer_token` in URL but sibling owns one-shot exchange |
| Plaintext HTTP downgrade | Tampering | Traefik HTTP→HTTPS 308 (D-15); WIRE-20 conformance test asserts |

## Assumptions Log

| # | Claim | Section | Risk |
|---|-------|---------|------|
| A1 | Fastify 5 + `@fastify/type-provider-zod@1.0` GA-ready [VERIFIED npm 2026-05-09] | Standard Stack | LOW |
| A2 | `tough-cookie@5` is current major [CITED npm; planner verifies at task time] | Standard Stack | LOW |
| A3 | Desktop tolerates `{}` body AND `{auditId:"..."}` extras on delete-account [CITED BACKEND_SPEC.md "client ignores body, only checks res.ok"] | Schemas | LOW |
| A4 | `{status:"ok"}` vs `{}` on health does NOT break desktop [CITED "body is not read"] | Health | LOW |
| A5 | `(ip,email)` rate-limit key is implementable via `@fastify/rate-limit` `keyGenerator` | Rate-limit | LOW |
| A6 | `withTenant` is callable inside route handlers AND cookie-auth `preHandler` chain [ASSUMED — Phase 1 ships `withTenant<T>`; planner verifies against `packages/data/src/tenant-context.ts`] | Handler design | MEDIUM |
| A7 | `users` table is `{id,tenantId,email,createdAt,updatedAt}` with `(tenantId,email)` unique [VERIFIED reading file 2026-05-09] | check-user query | LOW |
| A8 | `email_verified_at` lands on `users` OR Better Auth `verification` via D-22 migration `0001_better_auth.sql` [ASSUMED — sibling owns schema] | verification-status | MEDIUM |
| A9 | `pnpm --filter @openwhispr/data run seed:conformance` script exists or is created in Phase 2 Wave 0 [ASSUMED] | GHA workflow | MEDIUM |

## Open Questions

1. **Does `withTenant` work inside Fastify `preHandler` hooks or only inside route handlers?** Phase 1 ships `withTenant<T>(tenantId, async fn)` as a callback-scoped middleware contract. Whether the cookie-auth `preHandler` (which must run a tenant-scoped session-validation query) can wrap `withTenant`, or must defer tenant resolution to handler body, is unclear. **Recommendation:** Planner asks sibling auth researcher; if blocked, route handlers wrap `withTenant` themselves; `preHandler` only validates the cookie and attaches `req.session`.

2. **Drizzle helper for `(tenantId, email) → users`, or inline SQL?** **Recommendation:** Inline Drizzle (5 lines); no helper until Phase 3+.

3. **Is `mailpit` available in docker-compose stack at the time `verification-status.test.ts` runs in CI?** **Recommendation:** For conformance, do NOT send a verification email. Seed `email_verified_at` directly in the fixture, then test the endpoint. Real email round-trip is a separate Phase 2 self-test owned by sibling researcher.

4. **Should harness assert exact status text ("Session expired") or just non-empty `error` string?** **Recommendation:** Non-empty string only. Exact wording is i18n-fluid and should not break the contract.

## Environment Availability

| Dependency | Required By | Available | Fallback |
|------------|------------|-----------|----------|
| Node 24 | Fastify routes + Vitest | ✓ (Phase 0+1 lock) | — |
| pnpm 10 | Workspace runner | ✓ | — |
| Postgres 17 | check-user query, delete-account cascade | ✓ (Phase 1) | — |
| Redis/Valkey | Rate-limit backing store | ✓ (Phase 1) | — |
| Traefik | HTTPS-only convention assertion | ✓ (Phase 1) | Skip HTTPS test on `http://` BACKEND_URL |
| Docker Compose | Ephemeral CI stack | ✓ (GHA runners) | — |

**Missing dependencies with no fallback:** None — all substrate is in Phase 1.
**Missing dependencies with fallback:** `mailpit` for email round-trip (sibling researcher's scope).

## Sources

### Primary (HIGH confidence)
- `/Users/dev/openwhispr/docs/BACKEND_SPEC.md` — § Conventions, § Global Error Envelope, cards for 4 endpoints (read 2026-05-09)
- `/Users/dev/openwhispr/docs/SELF_HOSTING.md` — § Authentication Contract, § Edge Cases (read 2026-05-09)
- `/Users/dev/openwhispr-server/.planning/phases/02-auth-wire-api-skeleton-conformance-harness/02-CONTEXT.md` — D-09..D-21, D-28
- `/Users/dev/openwhispr-server/.planning/research/PITFALLS.md` — pitfalls #1, #4, #5, #8 (read 2026-05-09)
- `/Users/dev/openwhispr-server/CLAUDE.md` — Project + Stack constitutional docs
- `/Users/dev/openwhispr-server/packages/data/src/schema/users.ts` — schema verified
- `/Users/dev/openwhispr-server/packages/contract-tests/` — Phase 0 shell
- npm registry: `fastify@5.8.5`, `zod@4.4.3`, `@fastify/type-provider-zod@1.0.0`, `@fastify/rate-limit@10.3.0`, `vitest@4.1.5` (verified 2026-05-09)

### Secondary (MEDIUM confidence)
- Fastify 5 docs https://fastify.dev/ — type-provider pattern [CITED]
- `@fastify/type-provider-zod` README on npm [CITED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified at npm
- Architecture / handler patterns: HIGH — Fastify 5 + Zod is well-trodden 2026 ground
- Schemas: HIGH — derived directly from BACKEND_SPEC.md authoritative cards
- Conformance test design: HIGH — test bodies are spec-driven
- Pitfalls: HIGH — copied from internal PITFALLS.md
- Tenant integration with `withTenant` in `preHandler`: MEDIUM — see Open Question 1
- `email_verified_at` schema location: MEDIUM — sibling Better Auth researcher owns

**Research date:** 2026-05-09
**Valid until:** 2026-06-09 (30 days; library versions stable, spec authoritative)
