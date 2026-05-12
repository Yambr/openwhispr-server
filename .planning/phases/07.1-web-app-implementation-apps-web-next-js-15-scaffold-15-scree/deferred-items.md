# Phase 07.1 — Deferred Items

Items discovered during Phase 07.1 execution that are out of scope for the
current plan and must be addressed by a follow-up plan or phase.

---

## DEF-07.1-01 — api runtime fails to boot: lru-cache CJS/ESM mismatch — RESOLVED

**Status:** RESOLVED 2026-05-12 (commit recorded below) via Fix Option 3
(`pnpm-workspace.yaml` `overrides.lru-cache: ^11.3.6`). The `pnpm`-field in
root `package.json` did not invalidate the lockfile under pnpm 11.0.8;
moving the override to `pnpm-workspace.yaml` (the pnpm v10+ canonical
location for monorepo overrides) forced re-resolution and dropped the
v5.1.1 + v10.4.3 transitives. Verified:
- `pnpm-lock.yaml` now contains only `lru-cache@11.3.6` (was: 5.1.1 + 10.4.3 + 11.3.6).
- `docker compose --profile default build api` succeeds.
- `docker compose --profile default up -d api` reaches `Up (healthy)` in ~11s.
- `GET /api/health` → `200 OK {"status":"ok"}`.
- Runtime image: `require('lru-cache/package.json').version === '11.3.6'`
  and `typeof require('lru-cache').LRUCache === 'function'`.
No transitive package required v5 with a peer-dep enforcement, so
Option 1 (.npmrc public-hoist-pattern) and Option 2 (pnpm deploy) were
unnecessary.

**Discovered:** Plan 03 execution (docker-compose web service + Traefik basic-auth)
**Scope:** apps/api Dockerfile + pnpm hoisted-linker resolution
**Severity:** HIGH (blocks any local `docker compose --profile default up`)
**Reproducer:**
```
docker compose --profile default up -d --build api
docker compose logs api
```
yields a tight loop:
```
file:///app/dist/index.js:1731
import { LRUCache } from "lru-cache";
         ^^^^^^^^
SyntaxError: Named export 'LRUCache' not found.
The requested module 'lru-cache' is a CommonJS module ...
```

**Root cause:** apps/api declares `"lru-cache": "^11.3.6"` (named export
`LRUCache` available since v10). The api Dockerfile's `prod-deps` stage
runs `pnpm install --prod --node-linker=hoisted --filter @openwhispr/api...`
which produces `/app/node_modules/lru-cache` resolved to **v5.1.1**
(default-export only, brought in by a transitive). The tsup-bundled
`/app/dist/index.js` does `import { LRUCache } from "lru-cache"` against
v11's API shape, but the runtime resolves v5 and explodes.

The pnpm-lock has all three versions (5.1.1, 10.4.3, 11.3.6); hoisted-linker
picks v5 for the top-level node_modules even though the direct workspace
dep is v11.

**Pre-existing:** Yes — last api source change was Phase 06 (commit af6a3c8);
this plan (07.1 Plan 03) made no api or packages changes. Verified by:
```
git log --oneline -5 apps/api/ packages/
```
shows only Phase 06 commits.

**Recommended fix paths (Phase 6.x or 07.2):**
1. Override hoisting in `apps/api/Dockerfile` prod-deps stage with a
   `.npmrc` containing `public-hoist-pattern[]=lru-cache` or
   `hoist-pattern[]=lru-cache@^11`.
2. Switch the api prod-deps install to `pnpm deploy --filter @openwhispr/api`
   (now usable via `inject-workspace-packages: true` in pnpm.workspaces) so
   the api gets its OWN flat node_modules tree without cross-package
   hoisting collisions.
3. Add `"pnpm.overrides.lru-cache": "^11.3.6"` at the repo root so every
   transitive resolves to v11.

Option 3 is the smallest patch and the recommended starting point.

**Impact on Plan 03 verification:**
- Probe 1 (`curl https://api.localhost/api/health`) cannot run end-to-end
  because the api container never reaches `healthy`, which in turn keeps
  the `web` container in the `created` state (depends_on api healthy).
- Probes 2–4 (web reachability + admin basic-auth gate) verified via a
  temporary one-shot api stub on the internal network — documented in
  the Plan 03 commit body.
- Static verification: the api router in `compose/traefik/dynamic.yml` is
  unchanged; the routing precedence (api wins on `Host(api.localhost)`
  before falling through to the new `web` PathPrefix(`/`) priority=1
  router) is preserved.

---

## DEF-07.1-NOTES-DELETE-ALL — `DELETE /api/notes/delete-all` returns HTTP 500 on live stack

**Status:** OPEN
**Discovered:** Plan 04 execution (test tooling — seed.ts selftest)
**Scope:** apps/api route handler `apps/api/src/routes/notes/delete-all.ts`
**Severity:** MEDIUM (blocks the bulk-purge wire endpoint; per-row delete
fallback works)
**Reproducer:**
```bash
docker compose --profile default up -d --wait
# (assumes a signed-in session cookie for any verified user; the test
#  fixture `apps/web/tests/e2e/fixtures/auth.ts.provisionTestUser` is
#  sufficient.)
curl -sk -b "<session>" -X DELETE https://api.localhost/api/notes/delete-all
# → HTTP 500 {"error":"Internal server error"}
```
Reproduces regardless of whether the user has 0, 1, or more notes; reproduces
on a fresh user; the corresponding `notes/list` and `notes/delete` (per-row)
endpoints both work normally. The 500 is emitted by Fastify's default error
handler — the underlying exception is not surfaced in `docker logs` from
host (Docker Desktop log-stream quirk in this environment) and was not
investigated further in Plan 04 (out of scope; pre-existing code from
Phase 05 Plan 05 Task 2).

**Pre-existing:** YES — apps/api `notes/delete-all.ts` last changed in
Phase 05 (commit predates Phase 07.1). Plan 04 did not touch apps/api.

**Mitigation (Plan 04 seed fixture):** `apps/web/tests/e2e/fixtures/seed.ts.clearAllData()`
uses the per-row `DELETE /api/notes/delete?id=<id>` path against the result
of `GET /api/notes/list` (Plan 04 Step 0 alternative #2). This keeps every
e2e plan (07+) unblocked.

**Recommended next step (Phase 6.x or as part of Plan 14 final-verify):**
1. Run `apps/api`'s existing integration test
   `apps/api/src/routes/notes/__tests__/delete-all.integration.test.ts`
   inside the running compose stack (the test passes in CI per the latest
   green pipeline — so the runtime regression is environmental: container
   image vs. testcontainer DB, or a migration drift between the test DB
   and the live `openwhispr` DB).
2. Compare `\d notes` in the live container vs. the test DB; the most
   likely cause is a column addition (e.g. `tenant_id`/`organization_id`)
   in a later migration that the SQL in `delete-all.ts` does not yet
   reference, causing the `DELETE ... WHERE user_id=$1 RETURNING id`
   statement to fail under RLS.

---
- **2026-05-12 — Plan 05 — apps/api typecheck pre-existing error**: `apps/api/src/routes/transcriptions/create.ts(63,56)` — `CloudTranscriptionRow` missing index signature for `Record<string,unknown>` constraint. Predates Plan 05 (confirmed via `git stash` baseline test). Out of scope for web auth wiring; flag for the api-side phase that owns transcriptions/create.
- **2026-05-12 — Plan 09 — Phase 7.x backlog: `GET /api/transcriptions/:id` detail endpoint.** Plan 09 Step 0 confirmed `apps/api/src/routes/transcriptions/list.ts` accepts only `limit / before / since` (see `parseListQuery` in `apps/api/src/lib/keyset-pagination.ts`); there is no single-row endpoint and no `?id=` filter on the list endpoint. U7 detail screen now uses **Branch B** (list-then-filter with bounded pagination: `limit=50`, `MAX_PAGES=5` = 250 rows cap, render "not found" past cap). Workaround documented inline in `apps/web/src/app/(auth)/app/transcriptions/[id]/page.tsx` and `TranscriptionDetailClient.tsx`. Recommended Phase 7.x fix: add `GET /api/transcriptions/:id` returning the same `CloudTranscription` wire shape, mounted under the existing `transcriptionsRoutes` plugin with the same rate-limit config. Refs: WEB-IMPL-02 (Phase 07.1).
- **2026-05-12 — Plan 05 — apps/api/src/auth.ts cookieCache enabled (RESEARCH § Pattern 2 contradiction)**: RESEARCH § Pattern 2 says cookie cache is "not enabled today — verified in apps/api/src/auth.ts:80-95" but inspection at line 212 shows `session.cookieCache: { enabled: true, maxAge: 5 * 60 }`. RESEARCH note is stale. Our web `getServerSession()` hits apps/api over HTTP (out-of-process) so better-auth#7008 (in-process RSC cookie cache returning null) does not apply to our path; however the api itself could be affected when the apps/api Better Auth handler reads its own cache. Recommend Plan 07 e2e on /sign-in confirms session round-trip; if it fails, disable cookie cache on api side.
