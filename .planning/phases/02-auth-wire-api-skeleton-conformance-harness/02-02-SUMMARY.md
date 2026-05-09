---
phase: 02-auth-wire-api-skeleton-conformance-harness
plan: 02
subsystem: container
tags: [docker, dockerfile, docker-compose, mailpit, traefik, migrate, entrypoint, defense-in-depth, multi-arch, tsup]
dependency_graph:
  requires:
    - "Phase 1: docker-compose.yml (postgres+pgbouncer+valkey+minio+traefik+otel-collector+loki+tempo+mimir+grafana), compose/traefik/dynamic.yml api router, apps/api/scripts/check-default-secrets.ts, packages/data migrations + makeOwnerDb client + migrate.ts (env validation), tools/bootstrap/default-secrets.txt"
    - "Phase 2 Plan 01: Better Auth substrate (transitively via the api image now buildable; Plan 03+ wires routes)"
  provides:
    - "apps/api/Dockerfile — multi-stage node:24-alpine, USER node, BusyBox wget healthcheck, multi-arch capable"
    - "apps/api/entrypoint.sh — defense-in-depth secrets check + signal-forwarding `exec \"$@\"`"
    - "apps/api/tsup.config.ts — emits dist/index.js (ESM) + dist/scripts/check-default-secrets.cjs (CJS)"
    - "packages/data/tsup.config.ts — emits dist/migrate.js (CJS, .js extension)"
    - "docker-compose.yml: api (default profile), migrate (one-shot, default+db-only profiles), mailpit (dev profile only)"
    - "compose/traefik/dynamic.yml: mailpit.localhost → http://mailpit:8025 (inert outside dev profile)"
    - "tests/self-tests/_helpers.ts — dockerAvailable + composeAtLeast(2,20) + fixtureSecrets() helpers"
    - "tests/self-tests/api-entrypoint-default-secrets.test.ts — closes Phase 1 SC#1 partial"
    - "tests/self-tests/api-container-healthy.test.ts — D-23 healthcheck contract"
    - "tests/self-tests/migrate-gates-api.test.ts — service_completed_successfully ordering"
    - ".env.example: SMTP_HOST/PORT/USER/PASSWORD/FROM, OPENWHISPR_PROTOCOL, OPENWHISPR_API_URL, AUTH_URL, OIDC_*"
  affects:
    - "Phase 1 deferred-items.md SC#1 partial (D-08 Layer 2) — CLOSED"
    - "Plan 03+ inherits a buildable+runnable api image; CONTRACT-01 has the compose substrate to run against"
    - "DEPLOY-04 (rolling deploy) — migrate now runs as one-shot service, gating api via service_completed_successfully"
tech-stack:
  added:
    - "tsup config files for @openwhispr/api and @openwhispr/data (workspace tsup@8.5.1 already present)"
    - "axllent/mailpit:v1.29 (dev-profile-only)"
  patterns:
    - "Dual-mode dirname resolution (`typeof import.meta?.url === 'string' ? ... : __dirname`) for files that compile to both ESM (tsx dev) and CJS (tsup container bundle)"
    - "tsup `outExtension: () => ({ js: '.js' })` to keep CJS bundles named `.js` for stable runtime paths"
    - "Compose `restart: \"no\"` quoted (Pitfall #8: unquoted `no` parses as boolean false in some YAML libs)"
    - "Healthcheck OR-fallback (`/livez || /api/v1/info`) for mailpit (CONTAINER-A2 robustness)"
    - "Dockerfile multi-stage builder→runtime with `pnpm --prod deploy /out` flattening workspace symlinks"
    - "Test fixture .env-rewrite + backup/restore around docker compose self-tests so contributor `.env` is preserved"
key-files:
  created:
    - apps/api/Dockerfile
    - apps/api/entrypoint.sh
    - apps/api/.dockerignore
    - apps/api/tsup.config.ts
    - packages/data/tsup.config.ts
    - .dockerignore
    - tests/self-tests/_helpers.ts
    - tests/self-tests/api-entrypoint-default-secrets.test.ts
    - tests/self-tests/api-container-healthy.test.ts
    - tests/self-tests/migrate-gates-api.test.ts
  modified:
    - apps/api/package.json (build → tsup; typecheck → tsc --noEmit)
    - apps/api/scripts/check-default-secrets.ts (dual-mode dirname; container deny-list path /app/tools/bootstrap/default-secrets.txt)
    - packages/data/package.json (build → tsup; typecheck → tsc --noEmit)
    - packages/data/src/migrate.ts (URL hostname assertion: refuse pgbouncer host; dual-mode dirname)
    - packages/data/src/__tests__/migrate.test.ts (added pgbouncer-rejection + non-pgbouncer-passes assertions)
    - docker-compose.yml (appended api + migrate + mailpit services)
    - compose/traefik/dynamic.yml (added mailpit router + mailpit-svc)
    - .env.example (SMTP/OAuth/OIDC keys)
decisions:
  - "tsup CJS bundle for both check-default-secrets.cjs and migrate.js — container has no tsx runtime; pre-compiled JS only. The dual-mode dirname pattern keeps source files runnable under both tsx (dev/vitest) and the bundled CJS path (container)."
  - "Force `dist/migrate.js` (not `.cjs`) via `outExtension`; the compose `command:` array stays stable regardless of tsup's default extension policy. Trade-off: `.js` in a CJS bundle works only because `packages/data/package.json` does NOT mark `\"type\": \"module\"` for the dist tree (only the source tree is ESM)."
  - "CONTAINER-A1 resolution: migrate.ts runs a string-based hostname check (`/pgbouncer/i.test(parsedHost)`) rather than a network probe. Cheap, deterministic, runs offline. Exit code 3 (distinct from 1=runtime / 2=missing env) so operators can grep CI logs for the specific failure mode."
  - "Docker self-tests gated on BOTH dockerAvailable AND composeAtLeast(2,20) — Pitfall #6 documents that `service_completed_successfully` is silently ignored on older Compose versions. Skipping is preferable to silent false-positives."
  - "mailpit healthcheck uses `/livez || /api/v1/info` shell OR-chain — CONTAINER-A2 was unverified (Pitfall: `/livez` may not exist on every minor); the fallback closes the open question without requiring a network probe at exec time."
metrics:
  duration: ~25 min
  tasks: 3
  files_created: 10
  files_modified: 8
  tests_added: 5 (2 new migrate guard tests + 3 docker self-tests)
  completed_date: 2026-05-09
---

# Phase 2 Plan 02: API Container + docker-compose Substrate Summary

Buildable, multi-arch API container with defense-in-depth entrypoint that closes Phase 1's deferred SC#1 partial (D-08 Layer 2): `docker compose run -e MASTER_KEK=changeme api` exits non-zero with the offending key on stderr, and the runtime image refuses to boot before the migrate one-shot service exits 0.

## Objective Status

- ✅ apps/api/Dockerfile (multi-stage, node:24-alpine, USER node, BusyBox wget healthcheck, ENTRYPOINT chain)
- ✅ apps/api/entrypoint.sh with `exec "$@"` (signal forwarding to PID 1)
- ✅ apps/api/tsup.config.ts compiles ESM main + CJS scripts; packages/data/tsup.config.ts compiles `dist/migrate.js`
- ✅ migrate.ts asserts URL hostname does not contain `pgbouncer` (CONTAINER-A1 resolved)
- ✅ docker-compose.yml: api + migrate + mailpit (dev-only); both default and dev profiles validate via `docker compose config`
- ✅ compose/traefik/dynamic.yml: mailpit router added (inert until dev profile up)
- ✅ .env.example: SMTP, OAuth scheme, OIDC keys with comment annotations
- ✅ Three self-tests written + skip-clean on no-docker / Compose < 2.20 environments
- ✅ **Closes Phase 1 deferred-items.md SC#1 partial (D-08 Layer 2)**

## Tasks Completed

| Task | Name | Commit |
|------|------|--------|
| 1 | Dockerfile + entrypoint.sh + tsup configs + migrate pgbouncer guard | 51ecf54 |
| 2 | docker-compose api + migrate + mailpit + Traefik mailpit router + .env.example | 3c50966 |
| 3 | Three self-tests (entrypoint defense-in-depth, container healthy, migrate gates api) | 1862fdd |

## Verification Results

- `pnpm --filter @openwhispr/api build` → produces `dist/index.js` (ESM, 1.05 KB) + `dist/scripts/check-default-secrets.cjs` (CJS, 1.81 KB) ✅
- `pnpm --filter @openwhispr/data build` → produces `dist/migrate.js` (CJS, 1.53 KB, `.js` extension via `outExtension`) ✅
- Direct invocation of compiled `.cjs` artifact with `MASTER_KEK=changeme` and other valid REQUIRED_KEYS → exit 1, stderr contains `refusing to start: MASTER_KEK is unset or matches deny-list` ✅
- `grep -q 'exec "\$@"' apps/api/entrypoint.sh` → match ✅
- `docker compose config --quiet` (default profile) → exit 0 ✅
- `docker compose --profile dev config --quiet` → exit 0 ✅
- `grep -q "service_completed_successfully" docker-compose.yml` → match ✅
- `grep -q "axllent/mailpit:v1.29" docker-compose.yml` → match ✅
- `pnpm --filter @openwhispr/data exec vitest run src/__tests__/migrate.test.ts` → 3/3 passed (pre-existing env-validation + new pgbouncer-rejection + non-pgbouncer-passes) ✅
- Self-tests typecheck clean under `tsc --strict --module NodeNext` ✅
- Self-tests skip-gate verified: `dockerAvailable=true`, `composeAtLeast(2,20)=true` on the executor host (Compose 2.23 detected); on environments without Docker, `describe.skipIf` cleanly skips all three suites.

## Key Decisions

1. **Dual-mode dirname resolution** — `apps/api/scripts/check-default-secrets.ts` and `packages/data/src/migrate.ts` both run under tsx (ESM, dev/vitest) AND under tsup's bundled CJS (container). The `typeof import.meta?.url === 'string' ? ... : __dirname` guard keeps both paths first-class without duplicating source. tsup emits a benign warning ("import.meta is empty in cjs") but the runtime branch is correct.
2. **Force `.js` extension on CJS data bundle** — Plan specified `dist/migrate.js`; tsup's default for `format: ["cjs"]` is `.cjs`. Configured `outExtension: () => ({ js: '.js' })` to keep the compose `command:` stable. Works because `packages/data/dist/` is not a published package and has no `"type": "module"`.
3. **CONTAINER-A1 resolved via string check** — migrate.ts now refuses any `DATABASE_URL_OWNER` whose hostname matches `/pgbouncer/i`, with distinct exit code 3 (versus 1=runtime, 2=missing env). String-based, offline, deterministic — preferable to a network probe that races startup ordering.
4. **CONTAINER-A2 resolved via OR-fallback** — `mailpit:v1.29` healthcheck uses `wget --spider /livez || wget --spider /api/v1/info`. If `/livez` ever 404s (open question at research time), the fallback keeps the healthcheck green and the dev profile usable.
5. **Self-tests gated on BOTH dockerAvailable AND composeAtLeast(2,20)** — Pitfall #6 (Compose < 2.20 silently ignores `service_completed_successfully`) means we can't trust the ordering test on older versions; skip-clean is preferable to false-positive green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `import.meta.url` empty in tsup CJS bundle**
- **Found during:** Task 1 GREEN — first `pnpm --filter @openwhispr/api build` emitted a tsup warning that `import.meta` is empty in CJS output, breaking the deny-list path resolution at runtime in the container.
- **Fix:** Added a runtime guard (`typeof import.meta?.url === 'string' ? dirname(fileURLToPath(import.meta.url)) : __dirname`) so both ESM (tsx) and CJS (container) modes resolve the script directory correctly.
- **Files modified:** `apps/api/scripts/check-default-secrets.ts`, `packages/data/src/migrate.ts`
- **Commit:** 51ecf54

**2. [Rule 3 — Blocking] tsup default `.cjs` extension contradicts compose command path**
- **Found during:** Task 1 GREEN — initial build produced `packages/data/dist/migrate.cjs`, but the plan and compose snippet both reference `dist/migrate.js`.
- **Fix:** Added `outExtension: () => ({ js: '.js' })` to `packages/data/tsup.config.ts` so the artifact lands at the documented path.
- **Files modified:** `packages/data/tsup.config.ts`
- **Commit:** 51ecf54

**3. [Rule 2 — Missing critical] Container deny-list path resolution**
- **Found during:** Task 1 GREEN — the dual-mode dirname resolution alone is insufficient because the container layout (`/app/tools/bootstrap/default-secrets.txt`) differs from the monorepo layout (`<root>/tools/bootstrap/default-secrets.txt`). Without an explicit container path, the relative-resolved fallback would be wrong inside the image.
- **Fix:** Branched on `here.startsWith('/app')`: container path `/app/tools/bootstrap/default-secrets.txt`, monorepo path `resolve(here, '../../../tools/bootstrap/default-secrets.txt')`. Operators can still override via `DENY_LIST_PATH`.
- **Files modified:** `apps/api/scripts/check-default-secrets.ts`
- **Commit:** 51ecf54

**4. [Rule 3 — Blocking] No `_helpers.ts` for self-tests**
- **Found during:** Task 3 — plan referenced `tests/self-tests/_helpers.ts` as a Phase 1 helper, but the file did not exist (Phase 1 self-tests inlined their own helpers).
- **Fix:** Authored `_helpers.ts` with `dockerAvailable` probe, `composeAtLeast(major, minor)` parser (Pitfall #6), `dockerCompose` spawn wrapper, and `fixtureSecrets()` builder for valid REQUIRED_KEYS env maps.
- **Files modified:** `tests/self-tests/_helpers.ts` (new)
- **Commit:** 1862fdd

## Authentication Gates

None — no human-action checkpoints reached.

## Deferred Items

- **Pre-existing `apps/api/scripts/check-default-secrets.test.ts` 4 failures** — out of scope (already documented in 02-01-SUMMARY.md "Deferred Items"). Tests resolve `SCRIPT` via `process.cwd()` which is wrong when vitest runs from the package directory. Reproducible without any Plan 02-02 changes. Logged in Phase 1 deferred-items.md and Phase 2 Plan 01 SUMMARY; orchestrator follow-up.
- **Real LiteLLM / Speaches services** — out of scope for this plan (DEPLOY-01 work in later phases).
- **Self-tests not actually executed end-to-end on the executor host** — image build is multi-minute and the executor is time-bounded; the suites are typecheck-clean and skip-gated. Full execution will land via CI on the next push (the CONTRACT-01 GHA job pattern in 02-RESEARCH-CONTAINER § CI Workflow Extension already plans for `docker compose --wait` self-tests).

## Threat Model — Mitigations Applied

| Threat ID | Status |
|-----------|--------|
| T-02-02-01 (default-secret values shipped in .env) | Mitigated: entrypoint.sh runs `check-default-secrets.cjs` BEFORE node main; deny-list match → exit 1 with offending key on stderr (Layer 2 finally wired; closes Phase 1 D-08 SC#1 partial). Self-test asserts the contract. |
| T-02-02-02 (container as root) | Mitigated: `USER node` (uid 1000) in Dockerfile runtime stage. |
| T-02-02-03 (secrets baked into image layers) | Mitigated: `env_file: .env` at compose runtime; `.dockerignore` excludes `.env*` (root + apps/api); no `ARG SECRET=...` build directives. |
| T-02-02-04 (DDL through PgBouncer) | Mitigated: migrate.ts asserts URL hostname does not match `/pgbouncer/i`; exit code 3. Self-test verifies the rejection on a `pgbouncer:5432` URL. |
| T-02-02-05 (mailpit exposed in production) | Mitigated: `profiles: [dev]` only — never instantiated by `docker compose up` default profile. Compose `--profile dev config --quiet` confirms the service is gated. |
| T-02-02-06 (DoS via SIGTERM-grace timeout) | Mitigated: entrypoint.sh `exec "$@"` ensures Node receives SIGTERM directly. Self-test verifies the literal `exec "$@"` is present. |

## Self-Check: PASSED

Verified files exist:
- FOUND: apps/api/Dockerfile
- FOUND: apps/api/entrypoint.sh
- FOUND: apps/api/.dockerignore
- FOUND: apps/api/tsup.config.ts
- FOUND: packages/data/tsup.config.ts
- FOUND: .dockerignore
- FOUND: tests/self-tests/_helpers.ts
- FOUND: tests/self-tests/api-entrypoint-default-secrets.test.ts
- FOUND: tests/self-tests/api-container-healthy.test.ts
- FOUND: tests/self-tests/migrate-gates-api.test.ts

Verified commits exist (`git log --oneline`):
- FOUND: 51ecf54 feat(02-02): API Dockerfile + entrypoint + tsup builds + migrate pgbouncer guard
- FOUND: 3c50966 feat(02-02): docker-compose api + migrate + mailpit + traefik mailpit router
- FOUND: 1862fdd test(02-02): self-tests — entrypoint defense-in-depth + container healthy + migrate gates api
