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
