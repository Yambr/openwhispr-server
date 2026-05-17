// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 19 / Plan 01 / Task 02 — SR-19.2 GREEN.
//
// Canonical ambient module augmentation for `FastifyRequest` decorators
// populated at runtime by middleware. Closes SERVER-ERRORS.md Entry 2 and
// the Phase 14-04 typecheck-deferral root cause (deferred-items §14-04).
//
// Why a dedicated `.d.ts` file (CONTEXT.md D-07):
//   - `req.user` is set by `dualAuthHook` (`src/middleware/dual-auth.ts`)
//     once a session is resolved (bearer-or-cookie via Better Auth, or
//     AUTH-04 rotation overlap fallback).
//   - `req.tenant` is set by the same hook from `session.user.tenantId`
//     (or the seeded default tenant on a fresh install).
//   - Without a `declare module 'fastify'` block in the typecheck graph,
//     TypeScript has no way to know these decorators exist — `req.user`
//     resolves to `never` from a fresh `FastifyRequest` import unless the
//     consumer transitively pulls in `dual-auth.ts` (which declares the
//     same interface inline). Centralizing the declaration here makes
//     the contract reachable from every file under `src/**/*.ts` without
//     any import-order discipline.
//
// Coexistence with inline augmentations:
//   `src/middleware/dual-auth.ts:84` and `src/middleware/tenant.ts:33`
//   continue to declare their per-module concerns (`sessionId`, the legacy
//   `tenantId` header-read field, route-level `auth?: boolean` opt-out
//   config). TypeScript merges all `declare module 'fastify'` blocks
//   across the compilation unit — duplicate property declarations are
//   permitted as long as the types are structurally compatible. We keep
//   `user?` and `tenant?` shapes identical to the inline version to
//   guarantee compatibility.
//
// Types sourced from:
//   `SessionResult["user"]` in `src/middleware/dual-auth.ts:46-50` —
//   `{ id: string; email: string; tenantId?: string | null }`. We mirror
//   the structural shape here so this file has zero runtime imports
//   (a pure ambient `.d.ts`) and stays usable by tsc as a top-level
//   module-augmentation source without dragging the Better Auth instance
//   type graph through every consumer.
//
// Runtime behavior: NONE. `.d.ts` files emit no JS; they exist only for
// the TypeScript compiler. D-23 carve-out applies — no Vitest runtime
// coverage measures this file.

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Authenticated user resolved by `dualAuthHook` (Better Auth session
     * lookup or AUTH-04 rotation overlap). Undefined on routes that opted
     * out via `config.auth === false` (e.g. `/api/check-user`, `/api/health`)
     * and on any request that failed authentication (the hook throws
     * `AuthError` before the handler runs, so handler-side code can rely
     * on this being defined; types stay optional because pre-handler
     * hooks may observe a request before auth runs).
     */
    user?: {
      id: string;
      email: string;
      tenantId?: string | null;
    };

    /**
     * Tenant identifier (UUID) the request is acting against. Set by
     * `dualAuthHook` from the resolved session's `user.tenantId`, falling
     * back to the seeded default tenant on a fresh install. Authenticated
     * route handlers pass this to `withTenant(db, req.tenant, ...)` so the
     * Postgres `app.current_tenant_id` GUC is bound inside the same DB
     * transaction as the query (sidestepping any preHandler-vs-handler
     * Fastify hook-scope ambiguity).
     */
    tenant?: string;

    /**
     * Phase 51 / Plan 51-13c — augmentation for `i18n` and `language`
     * decorators populated at runtime by `i18nPlugin` (src/i18n/init.ts).
     * The plugin adapts i18next-http-middleware's Connect handler to a
     * Fastify preHandler hook; the middleware mutates `req.raw.i18n` /
     * `req.raw.language`, then the plugin mirrors them onto the Fastify
     * request so route handlers can read `req.i18n` without dereferencing
     * `.raw`. Typed minimally as the `t()` surface the error-handler +
     * better-auth-handler call sites need.
     */
    i18n?: { t(key: string, opts?: object): string };
    language?: string;
  }
}

// Marker export to keep the module a file-scoped TypeScript module rather
// than an ambient script. Required by `verbatimModuleSyntax` / strict
// project settings so the file is interpreted as a module that augments
// 'fastify' rather than as a script polluting global scope.
export {};
