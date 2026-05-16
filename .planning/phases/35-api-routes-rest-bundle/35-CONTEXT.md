# Phase 35: api-routes-rest bundle (CR-2 + CR-3 + CR-4) — Context

**Source:** ROADMAP Phase 35 + `.planning/review/api-routes-rest.md` CR-01/02/03

Three independent sub-plans, no shared files. Each its own RED→GREEN atomic commit pair per DISCIPLINE Rule 1; ≥ 90/90/90/90 coverage on each diff.

## 35.a — Public bootstrap endpoints (CR-2 / CRIT-FIX-04)

Files: `apps/api/src/routes/{locale,auth-providers,setup-state}.ts`. Add `config: { auth: false }` to each route registration so the global `dualAuthHook` opts out.

**RED test:** boot full app via `bootstrap()` (NOT bare Fastify — DISCIPLINE Rule 4 no internal mocks); `inject({ method: 'GET', url: '/api/locale' })` returns 200. Same for `/api/auth/providers` + `/api/setup-state`. Currently fails (401 under dualAuthHook).

**GREEN:** add `config: { auth: false }` to all three.

## 35.b — better-auth-handler Set-Cookie (CR-3 / CRIT-FIX-05)

File: `apps/api/src/lib/better-auth-handler.ts:179-182`. Replace `headers.forEach((v, k) => reply.header(k, v))` with `headers.getSetCookie()` per-value loop emitting independent `reply.header('set-cookie', v)`.

**RED test:** mock Better Auth response with two Set-Cookie values (session + CSRF). Assert reply has 2 independent set-cookie headers, NOT one comma-joined.

**GREEN:** `getSetCookie()` loop.

## 35.c — setup-admin rollback (CR-4 / CRIT-FIX-06)

File: `apps/api/src/routes/setup-admin.ts:234`. Wrap step-4 role flip + `setup_state=completed` in single PG transaction with rollback.

**RED test:** inject pg failure during role flip; assert next POST returns 409 with recoverable envelope (NOT `alreadyCompleted: true` + no admin).

**GREEN:** wrap both in `pool.transaction(async client => {...})`.

## Scope (out)

- New routes/endpoints. Pure fix surface.
- Phase 41 route bulkfix.
