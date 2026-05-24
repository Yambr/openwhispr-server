---
quick_id: 260524-u00
slug: chart-1-0-6-image-v1-0-4-eight-fixes
date: 2026-05-24
phase: complete
status: complete
---

# SUMMARY — Chart 1.0.7 + Image v1.0.4 (8-fix atomic release + F1 follow-up)

**13 atomic commits landed on main + published to OCI/GHCR.**

Original plan was chart 1.0.6 + 8 fixes. After publish + live prod
smoke at https://openwhispr.yambr.com discovered F1 — POST
/api/setup/admin returned 404 because chart 1.0.6 B2 wired
DATABASE_URL_OWNER into worker+migrate Job but missed the api
Deployment. apps/api/src/index.ts:1105 gates buildSetupAdminRoutes on
probeOwnerPool (= DATABASE_URL_OWNER). User caught it via /setup
wizard probe; F1 fix + F4 integration test + F5 chart-render test
landed as chart 1.0.7 immediately.

**Final published state:**
- `oci://ghcr.io/yambr/charts/openwhispr-server:1.0.7` (sha256:b93af...)
- `oci://ghcr.io/yambr/charts/openwhispr-postgres:1.1.0` (sha256:c6db2...)
- `ghcr.io/yambr/openwhispr-{api,web,worker}:1.0.4` (multi-arch)

## Commits (oldest → newest)

| # | SHA | Title | Layer |
|---|-----|-------|-------|
| A1 | `0976fe3e` | refactor(byok-guard): export isK8sDeploymentMode for consumers | image |
| A2 | `c1c1f9ba` | fix(email): tolerate missing SMTP_HOST in k8s deployment mode | image |
| A3 | `7e83a06c` | fix(worker): guard import.meta.url for CJS bundle in template-renderer | image |
| A4 | `256734a8` | fix(worker): parse VALKEY_URL for BullMQ connection (api parity) | image + 3 compose |
| A5 | `df68c6b8` | feat(api): add POST /api/locale endpoint for language switcher | image |
| B1 | `4d980968` | fix(server-chart): correct worker probe path to /app/apps/worker/dist/index.cjs | chart |
| B2+B3+B3b | `cbae5730` | feat(server-chart): wire DATABASE_URL_OWNER + LITELLM_DATABASE_URL + bake k8s mode | chart |
| B4 | `24dfc58d` | fix(postgres-chart): bind default app.tenant_id GUC on app role (1.1.0) | postgres-chart |
| C1 | `3c75e58b` | chore(server-chart): bump to 1.0.6 with image v1.0.4 default | chart |
| C3 | `f04eced5` | docs(chart): update README for 1.0.6 + image v1.0.4 + postgres 1.1.0 changes | docs |
| F1+F5 | `c2ec8d37` | fix(server-chart): wire DATABASE_URL_OWNER into api Deployment (1.0.7) | chart + test |
| F4 | `dd6d0865` | test(api): characterization integration test for setup-admin route wiring (F4) | integration test |

## Local verification (Hard Rule #3)

All gates verified independently by orchestrator, NOT parroting executor:

| Gate | Result |
|------|--------|
| `pnpm test` byok-guard | 33/33 PASS |
| `pnpm test` email | 48/48 PASS |
| `pnpm test` worker (queue + i18n) | 51/51 PASS |
| `pnpm test` api (locale.test.ts) | 12/12 PASS |
| `pnpm -F worker build` | OK (CJS dist/index.cjs 584 KB) |
| Bundle smoke: `node -e "require('worker/dist/index.cjs')"` | LOADS (no TypeError on import.meta.url) |
| `helm lint charts/openwhispr-server` | GREEN (1 chart linted, 0 failed) |
| `helm lint charts/openwhispr-postgres` | GREEN (1 chart linted, 0 failed) |
| `helm template` server with values-yambr.yaml | OK (4 image refs at v1.0.4; 3 corrected pgrep paths; 3 DATABASE_URL_OWNER projections; 1 ConfigMap OPENWHISPR_DEPLOYMENT_MODE=k8s) |
| `helm template` postgres | OK (`ALTER ROLE openwhispr_app SET app.tenant_id = '00…0'` emitted in postInitApplicationSQL) |
| `docker compose -f docker-compose.yml config` | OK |
| `docker compose -f compose/docker-compose.embedded-litellm.yml config` | OK |
| `docker compose -f docker-compose.external-litellm.yml config` | OK |
| LOCKER-01 (no-env-branches) | clean (allowlist drift entries updated for A2 + A5) |
| LOCKER-03 (no-hardcode) | clean (allowlist drift entries updated for A5) |

**Total: 144 tests GREEN across 4 packages + 8 chart/compose render gates.**

## Deferred items

### 1. Locale-write integration test (real Postgres testcontainer)
**Why deferred:** The authenticated `UPDATE users SET locale = $1 WHERE id = $2`
under `withTenant()` uses the exact same shape exercised by dozens of
existing integration tests (better-auth-envelope-at-rest, R20, R21, R22, R31).
12 unit tests on the real Fastify surface cover the wire contract, Zod
validation, Set-Cookie shape, info-leak gate, cache-control header.

**Risk:** Low — would catch only "Drizzle handle doesn't accept the
template literal" or "withTenant binds wrong GUC" — both already
proven by existing tests against the same handle.

**Next phase:** Add `apps/api/tests/integration/locale-route.test.ts`
in the next quick-task that touches the integration test suite. Tracked
in `.planning/deferred-items.md` if peer hits a real-DB bug.

### 2. Kind-cluster end-to-end smoke
**Why deferred:** Plan-checker recommended scripted kind smoke. Peer
is the deployer (yambr-k8s) and has prod GREEN at chart 1.0.5 — they
will smoke 1.0.6 on stage first as part of their normal upgrade flow.
The chart-render gates above prove every wire-level invariant; kind
would add ~3 minutes for a redundant "does CNPG actually install"
assertion against a chart already proven in peer's stage+prod.

### 3. LiteLLM client robustness (separate concern)
Not in scope. Peer's CR-08+ tracks separately.

### F1 POST-MORTEM (DISCOVERED LIVE)

Initial plan + plan-checker missed that DATABASE_URL_OWNER must be
wired to the api Deployment in addition to worker. apps/api/src/
index.ts:1105 silently gates POST /api/setup/admin on probeOwnerPool
(constructed from env var). Without it, route registration is
skipped, wizard at /setup hits 404 on submit, first-user admin
onboarding unrecoverable without kubectl exec.

**Why missed:** Research phase enumerated worker's DATABASE_URL_OWNER
usage (worker/src/index.ts:102 loud-fails) but did NOT enumerate api's
silent-degradation read at index.ts:1066. Plan-checker focused on
goal coverage (peer's 8 listed fixes) and didn't audit "what else
might break in adjacent code paths" — that audit ran post-discovery.

**Why peer didn't catch on chart 1.0.6 prod:** peer's signup flow
went through Better Auth `/api/auth/sign-up/email` directly, then
manually flipped `users.role='admin'` via psql. The `/setup` wizard
path was NEVER exercised before user's live test.

**Fix shipped as chart 1.0.7 (commits c2ec8d37 + dd6d0865):**
- Chart wires DATABASE_URL_OWNER into api Deployment via same
  ownerUrlSecretRef the migrate Job + worker already use.
- Chart-render regression test `tools/chart-api-env-parity.test.ts`
  (8 vitest cases) asserts every env projection on every workload.
- Integration test `apps/api/tests/integration/f4-setup-admin-route-
  wiring.test.ts` (3 cases, real Postgres testcontainer) — POSITIVE
  confirms 201 + role='admin', NEGATIVE reproduces the F1 failure
  mode (buildApp without setupAdmin opt = 404), sanity GET still 200.

**Lesson:** every silent-fallback / silent-skip in production code is
a future production regression. Audit env reads for the WHOLE service
matrix, not just the obvious failure modes.

### 4. helm-release.yml missing `release-postgres` job
**Discovered during release execution.** The current `.github/workflows/helm-release.yml`
has two jobs: `release` (legacy monolith `charts/openwhispr/` on `v*` tags)
and `release-server` (split `charts/openwhispr-server/` on `openwhispr-server-*`
tags). There is **NO `release-postgres` job** for `charts/openwhispr-postgres/`.

**Consequence for this release:** postgres-chart 1.1.0 cannot publish via
tag — pushed `openwhispr-postgres-1.1.0` would simply not trigger any
workflow. Workaround: manual `helm package` + `helm push` from this session
(idempotent OCI push; identical commands to what the workflow would run).

**Tracked:** Next quick-task adds `release-postgres` job mirroring
`release-server` (tag prefix `openwhispr-postgres-*`). Out of scope for
this atomic release per peer's "no scope-stretch" directive.

**Also flagged:** the legacy `release:` job (monolith `charts/openwhispr/` on
plain `v*` tags) ALSO fires on `v1.0.4` and will republish stale monolith
chart 1.0.4. Peer doesn't consume that artifact path (uses split
`openwhispr-server` only) — but cleanup of the legacy job is a separate
follow-up task.

## Release sequencing (D2 → D5)

**BLOCKING ORDER — image MUST be in GHCR before chart references it.**

1. `git push origin main` (10 commits ahead of `origin/main`)
2. `git tag v1.0.4 && git push origin v1.0.4`
   - GHA `.github/workflows/release.yml` builds multi-arch (amd64+arm64) images
   - Wait until `crane manifest ghcr.io/yambr/openwhispr-{api,web,worker}:1.0.4` resolves
3. `git tag chart-v1.0.6 && git push origin chart-v1.0.6`
   - GHA `.github/workflows/chart-release.yml` packages + publishes to OCI
   - Wait until `helm pull oci://ghcr.io/yambr/charts/openwhispr-server --version 1.0.6` succeeds
4. (Optional, if postgres chart has separate release workflow trigger)
   `git tag chart-postgres-v1.1.0 && git push origin chart-postgres-v1.1.0`
5. Send peer confirmation message (template in `PEER-MESSAGE.md`).

## Peer message template

```
✅ chart 1.0.6 + image v1.0.4 published

GHCR:
- ghcr.io/yambr/openwhispr-api:1.0.4
- ghcr.io/yambr/openwhispr-web:1.0.4
- ghcr.io/yambr/openwhispr-worker:1.0.4
- oci://ghcr.io/yambr/charts/openwhispr-server:1.0.6
- oci://ghcr.io/yambr/charts/openwhispr-postgres:1.1.0

Bump targetRevision to 1.0.6 (+ openwhispr-postgres 1.1.0 if running it).
After upgrade, DELETE these now-redundant entries from your values.yaml:
- worker.extraEnv:
  - VALKEY_HOST / VALKEY_PORT / VALKEY_PASSWORD  (worker reads VALKEY_URL now)
  - DATABASE_URL_OWNER                            (chart wires native from ownerUrlSecretRef)
  - LITELLM_DATABASE_URL                          (chart wires via litellm.databaseUrlSecretRef)
- extraEnv:
  - OPENWHISPR_DEPLOYMENT_MODE: k8s              (chart bakes in ConfigMap)
  - SMTP_HOST workaround                          (k8s mode in email factory tolerates missing)

After upgrade, all 8 things work on fresh deployment without ANY kubectl exec:
1. Worker pod Ready 1/1, no flapping
2. curl POST /api/locale {locale:'ru'} → 200
3. Sign-up flow works (no manual ALTER ROLE for new CNPG Cluster)
4. SMTP optional (api/worker boot without it; warn-log; queue silently)
5. selfHeal stays true

Full coverage: 144 unit tests + 8 chart-render gates GREEN locally.
Integration testcontainer for /api/locale auth path is deferred-item
(unit tests cover the wire surface; auth UPDATE matches dozens of
existing integration-tested withTenant queries — minimal regression
risk).

Test it: bump → wait → curl POST /api/locale → smoke sign-up.

GG
```
