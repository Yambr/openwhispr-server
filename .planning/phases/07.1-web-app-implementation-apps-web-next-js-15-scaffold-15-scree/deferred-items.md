# Phase 07.1 — Deferred Items

Items discovered during Phase 07.1 execution that are out of scope for the
current plan and must be addressed by a follow-up plan or phase.

---

## DEF-07.1-01 — api runtime fails to boot: lru-cache CJS/ESM mismatch

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
