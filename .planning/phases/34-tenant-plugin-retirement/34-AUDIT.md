# Phase 34 — `req.tenantId` Production Readers Audit

**Date:** 2026-05-16
**Method:** `grep -rn "req\.tenantId\|request\.tenantId" apps/*/src packages/*/src`, filtered to non-test files, with manual inspection of every match.

## Result

**Production readers of `req.tenantId`: ZERO.**

DELETE path is safe. The plugin sets a decorator that no production code reads.

## Inventory of `req.tenantId` references in non-test code

### 1. `apps/api/src/middleware/tenant.ts:62` (writer — the plugin itself)

```ts
   req.tenantId =
     typeof headerVal === "string" && TENANT_UUID_RE.test(headerVal)
       ? headerVal
       : DEFAULT_TENANT_ID;
```

**Disposition:** The setter, not a reader. Deleted with the file.

### 2. `apps/api/src/middleware/tenant.ts:35` (module augmentation — the lie)

```ts
   declare module "fastify" {
     interface FastifyRequest {
       tenantId: string;
     }
   }
```

**Disposition:** The TS module augmentation that makes `req.tenantId` type-visible. Deleted with the file. Canonical augmentation lives in `apps/api/src/types/fastify.d.ts` and declares only `user?` and `tenant?` — never `tenantId`.

### 3. `apps/api/src/index.ts:391` (registration site)

```ts
   await app.register(tenantPlugin);
```

**Disposition:** Deleted. The preceding comment block (lines 387-390) goes with it.

### 4. `apps/api/src/index.ts:118` (import)

```ts
   import { tenantPlugin } from "./middleware/tenant.js";
```

**Disposition:** Deleted (import of a deleted module).

## Non-matches (false positives ruled out)

These contain the substring `tenantId` but reference different properties — NOT `req.tenantId`:

| Site | What it reads | Why it is safe |
| --- | --- | --- |
| `apps/api/src/index.ts:355` | `(req as { tenant?: string }).tenant` | Reads `req.tenant` (authoritative dual-auth value), not `req.tenantId`. Untouched by Phase 34. |
| `apps/api/src/index.ts:420,422` | `m.tenantId` | Local variable `m` from a map — unrelated to `req.tenantId`. |
| `apps/api/src/auth.ts:403,453` | `user.tenantId` | Session user shape, not request decorator. |
| `apps/api/src/middleware/dual-auth.ts:82` | Return type `{ user, tenantId: string }` from `validateBearer` | Internal return type of an auth helper, not `req.tenantId`. |
| `apps/api/src/middleware/dual-auth.ts:164,182` | `req.tenant = session.user.tenantId ?? ...` | WRITES `req.tenant`, READS `user.tenantId`. Both authoritative. |
| `apps/api/src/middleware/require-cookie-only.ts:40` | Same as above (`req.tenant = ...`) | Same — authoritative writer of `req.tenant`. |
| `apps/api/src/lib/settings-resolver.ts`, `client-id-upsert.ts`, `token-rotation.ts`, `audit.ts`, `auth-callback.ts`, `capabilities.ts`, `test-only.ts`, `better-auth-handler.ts` | Function parameter `tenantId: string` | Helpers that accept tenantId as an argument. Callers pass `req.tenant`, not `req.tenantId`. |

**Conclusion:** No production callsite reads `req.tenantId`. Plan 02 / dual-auth migrated every authenticated route off the legacy decorator (`req.tenant` is the authoritative value), and pre-auth routes never read `req.tenantId` either — they let `withTenant` resolve the default tenant via `resolveDefaultTenantId()`.

## Affected test-only files (housekeeping during delete)

| File | Action |
| --- | --- |
| `apps/api/tests/unit/middleware/tenant.test.ts` | DELETE (unit tests for the deleted plugin) |
| `apps/api/tests/unit/__tests__/entrypoint-db-shape.test.ts:116` | EDIT — remove `vi.mock("../../../src/middleware/tenant.js", ...)` line |
| `apps/api/tests/unit/__tests__/fastify-request-types.test.ts` | LEAVE (no live import; comment-only stale ref at line 13 is out of scope) |

## Allowlist hygiene

| File | Entry | Action |
| --- | --- | --- |
| `tools/lint-no-hardcode.allowlist.txt:29` | `apps/api/src/middleware/tenant.ts:44 # canonical-default-tenant` | REMOVE (target file no longer exists) |
| `tools/lint-prod-readiness.allowlist.txt` | (none — searched; no entries reference `middleware/tenant.ts`) | NONE |

## CR-1 closure criteria satisfied by DELETE

1. Client-controlled `x-tenant-id` header can no longer set `req.tenantId` — the decorator is gone.
2. The lying TS module-augmentation (`tenantId: string`) is gone.
3. Authoritative tenant value (`req.tenant`, set by dual-auth from the Better Auth session) is the ONLY tenant binding on a `FastifyRequest`.
4. E2E test (`tests/e2e/tenant-isolation.test.ts`) asserts a forged `x-tenant-id` header cannot escalate access.
5. Regression test (`apps/api/tests/unit/middleware/no-tenant-plugin-regression.test.ts`) asserts the file does not exist and no `req.tenantId` references remain in non-test production code.
