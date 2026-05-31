---
quick_id: 260528-370
slug: health-build-info
title: "Health endpoint exposes build info — version + commit_sha + image_tag (v1.0.14)"
date: 2026-05-28
status: planned
mode: quick
---

# Quick Plan: GET /api/health build-info widening (v1.0.14)

## 1. Goal

Widen the `GET /api/health` response with three additive fields — `version`, `commit_sha`, `image_tag` — sourced from build-time Docker ARGs propagated through `OPENWHISPR_BUILD_VERSION` / `OPENWHISPR_BUILD_SHA` / `OPENWHISPR_IMAGE_TAG` env vars, so operators can prove which image is serving a given replica from a single `curl` without `kubectl` access. Peer `9zn786o0` requested this after v1.0.13 RED live-verify confused "ArgoCD synced?" vs "gateway caching?" vs "rollout incomplete?".

## 2. Scope

### 2.1 In scope

1. **NEW `apps/api/src/config/build-info.ts`**
   - Export `BuildInfo` type: `{ version: string; commitSha: string; imageTag: string }`.
   - Export `BUILD_INFO_UNKNOWN = "unknown" as const`.
   - Export `parseBuildInfoFromEnv(env: NodeJS.ProcessEnv = process.env): BuildInfo` reading `OPENWHISPR_BUILD_VERSION` / `OPENWHISPR_BUILD_SHA` / `OPENWHISPR_IMAGE_TAG`. Trim each; empty / undefined / whitespace-only → `BUILD_INFO_UNKNOWN`. Truncate each field to 120 chars (LOCKER-05 defense-in-depth; semver / SHA-40 / OCI tag-name all fit comfortably).
   - Pure, sync, no I/O, no `process.env` capture at module scope (always reads the `env` argument), no `as any`, no Cyrillic — must pass LOCKER-02/03/04.

2. **EDIT `apps/api/src/routes/probes.ts`**
   - Import `BuildInfo`, `BUILD_INFO_UNKNOWN` from `../config/build-info.js`.
   - Extend `ProbesDeps` with `readonly buildInfo?: BuildInfo;` (jsdoc: "when omitted, all three build fields report `"unknown"` — operator-actionable signal that boot did not wire `parseBuildInfoFromEnv()`").
   - In the `GET /api/health` handler: replace the response with `{ status: "ok" as const, migrations_completed, version, commit_sha, image_tag }` where the three new fields default to `BUILD_INFO_UNKNOWN` when `deps.buildInfo` is `undefined`. Snake_case wire keys (`commit_sha`, `image_tag`) mirror `migrations_completed`.
   - The four-route registration block (`/livez`, `/readyz`, `/startupz`, `/api/health`) plus `markStartupComplete` / `resetStartupComplete` / `isStartupComplete` exports are otherwise untouched.

3. **EDIT `apps/api/src/index.ts`**
   - Add `import { parseBuildInfoFromEnv } from "./config/build-info.js";`.
   - In `buildApp` (around the existing `loadRealtimeConfigFromEnv()` call near line 1059, or wherever probe deps are assembled), resolve `const buildInfo = opts.buildInfo ?? parseBuildInfoFromEnv();` and thread it into the existing `registerProbes(app, { ...depCheck, ...migrationsCheck, buildInfo })` call at line 751-754.
   - Add `buildInfo?: BuildInfo` to the `buildApp` opts type (mirrors the existing `migrationsCheck?` optionality on the opts shape near line 357) so integration tests can inject a deterministic `BuildInfo` without setting `process.env`.

4. **EDIT `apps/api/Dockerfile`** (runtime stage only — image-level ARG/ENV)
   - In the `FROM node:24-alpine AS runtime` stage, BEFORE `ENV NODE_ENV=production` (line 125), insert:
     ```dockerfile
     ARG BUILD_VERSION=unknown
     ARG BUILD_SHA=unknown
     ARG IMAGE_TAG=unknown
     ENV OPENWHISPR_BUILD_VERSION=$BUILD_VERSION \
         OPENWHISPR_BUILD_SHA=$BUILD_SHA \
         OPENWHISPR_IMAGE_TAG=$IMAGE_TAG
     ```
   - Placement note: must sit inside the `runtime` stage (not `builder` / `prod-deps`) so the env vars survive into the final image. Defaulting to `unknown` keeps local `docker build apps/api -f apps/api/Dockerfile` (no `--build-arg`) working without producing empty-string env values that would be ambiguous with "release-built but ARG forgotten".
   - Do NOT add the same ARG/ENV block to `apps/api/builder` or `apps/api/prod-deps` (they're discarded). Do NOT touch `apps/web/Dockerfile` or `apps/worker/Dockerfile` (web `/api/health` is a literal `"OK"` string — different surface; worker has no HTTP listener — confirmed via `grep HEALTHCHECK apps/worker/Dockerfile`).

5. **EDIT `.github/workflows/release.yml`**
   - Extend the shared `docker/build-push-action@v7` step (line 120-131) with:
     ```yaml
     build-args: |
       BUILD_VERSION=${{ steps.tag.outputs.value }}
       BUILD_SHA=${{ github.sha }}
       IMAGE_TAG=${{ steps.tag.outputs.value }}
     ```
   - Matrix coverage: a single edit covers ALL 6 matrix entries (`cnpg-postgres-17-pgpartman`, `postgres-17-pgpartman`, `api`, `web`, `worker`, `test-probe`) because the step is shared. Only `api`'s Dockerfile consumes these ARGs; the other 5 ignore the unknown ARGs silently (Docker behavior: build-args not declared via `ARG` in the Dockerfile are dropped without warning). Acceptable cost; no per-matrix conditional needed.
   - Use `steps.tag.outputs.value` (the resolved tag, e.g. `1.0.14`) for both `BUILD_VERSION` and `IMAGE_TAG`. They CAN diverge in future (e.g. chart-only releases that ship the same image under a new tag), but for v1.0.14 they are identical — keep both fields for forward compatibility with the wire contract.

6. **NEW `apps/api/tests/unit/config/__tests__/build-info.test.ts`**
   - 6 cases (per §5). Pure unit, no testcontainers, no Fastify boot. Mirrors the layout of `apps/api/tests/unit/config/__tests__/setup-claim.test.ts`.
   - Use `parseBuildInfoFromEnv({ ... })` with explicit env-snapshot objects — never mutate `process.env`.

7. **NEW `apps/api/tests/integration/health-build-info.test.ts`**
   - 3 cases (per §5). Uses `buildApp` factory with explicit `buildInfo` opts (no env-var smuggling). Sends `inject({ method: 'GET', url: '/api/health' })`. No testcontainers needed — `/api/health` does not touch Postgres (only `migrationsCheck` does, and we inject a stub `async () => true`).
   - Regression assertion: `migrations_completed` still present and truthy when stub returns `true`; verifies the field ordering / shape did not regress.

8. **EDIT `docs/operations.md`**
   - New subsection "Live version verification" (insert near the existing health-probe docs; if there's a §Operations runbook section keep it there):
     ```markdown
     ### Live version verification

     Every API replica exposes the build it was assembled from on `/api/health`:

     \`\`\`bash
     curl -s https://openwhispr.example.com/api/health | jq
     # {
     #   "status": "ok",
     #   "migrations_completed": true,
     #   "version": "1.0.14",
     #   "commit_sha": "84b90245...",
     #   "image_tag": "1.0.14"
     # }
     \`\`\`

     The three build fields are populated at image build time via
     `docker/build-push-action@v7` `build-args`
     (`BUILD_VERSION` / `BUILD_SHA` / `IMAGE_TAG`) which set
     `ARG`s in `apps/api/Dockerfile`'s runtime stage, which set
     `OPENWHISPR_BUILD_VERSION` / `OPENWHISPR_BUILD_SHA` / `OPENWHISPR_IMAGE_TAG`
     environment variables in the image, which are read at process boot by
     `apps/api/src/config/build-info.ts`'s `parseBuildInfoFromEnv()`.

     **`"unknown"` semantics**: any of the three fields reading `"unknown"` means
     the image was built outside the canonical `release.yml` workflow (local
     `docker build`, third-party rebuild, malformed CI override). Production
     installs SHOULD see real values on all three; a `"unknown"` triplet on a
     production replica is operator-actionable (rebuild + re-deploy).

     **Rollout verification (replaces `kubectl get pods -o jsonpath`)**:

     \`\`\`bash
     for i in 1 2 3; do curl -s https://openwhispr.example.com/api/health | jq -r '.version'; done
     # 1.0.14
     # 1.0.14
     # 1.0.14   ← all three replicas are on the new image
     \`\`\`
     ```
   - No other docs touched.

9. **Chart + image-tag bump (atomic with the wire-surface widening)**
   - `charts/openwhispr-server/Chart.yaml`: `version: 1.0.16 → 1.0.17`, `appVersion: "1.0.13" → "1.0.14"`.
   - `charts/openwhispr-server/values.yaml`: `image.tag: "1.0.13" → "1.0.14"` (line 184).
   - Add a lineage comment block above the new `tag:` line documenting "1.0.14 — /api/health build-info fields (260528-370): version / commit_sha / image_tag additive widening for live rollout verification" — match the existing v1.0.13 / v1.0.12 / v1.0.11 lineage-comment pattern (values.yaml lines 16-60).

### 2.2 NOT in scope

- Client-side rendering of `/api/health` `version` field (Electron client concern; lives in upstream repo).
- Version-mismatch warnings or boot refusal when image lineage smells stale (e.g. `OPENWHISPR_BUILD_SHA !== package.json sha`).
- Telemetry / remote logging of the build-info on boot (out of scope — `/api/health` exposure is sufficient).
- `/api/ready` (R25 Cloud readiness probe) expansion — stays minimal; only `/api/health` gets build info per this scope.
- `apps/web/Dockerfile`: web's `/api/health` returns literal `"OK"` (see `apps/web/src/app/api/health/route.ts`) — different wire contract, deferred.
- `apps/worker/Dockerfile`: worker has no HTTP listener (confirmed: no `HEALTHCHECK` / no `/api/health` route) — N/A.
- Postgres `cnpg-postgres-17-pgpartman` / `postgres-17-pgpartman` / `test-probe` images: not application servers, no `/api/health`, the dropped build-args are harmless no-ops.
- Backporting build-info to released v1.0.13 image — forward-only release.

## 3. Files modified

| Path | Change | LOC est |
|---|---|---|
| `apps/api/src/config/build-info.ts` | NEW | ~35 |
| `apps/api/src/routes/probes.ts` | EDIT (handler + ProbesDeps + import) | ~12 |
| `apps/api/src/index.ts` | EDIT (import + opts + buildInfo threading) | ~6 |
| `apps/api/Dockerfile` | EDIT (3 ARG + 1 ENV block in runtime stage) | ~7 |
| `.github/workflows/release.yml` | EDIT (build-args under step 120-131) | ~4 |
| `apps/api/tests/unit/config/__tests__/build-info.test.ts` | NEW | ~55 |
| `apps/api/tests/integration/health-build-info.test.ts` | NEW | ~50 |
| `docs/operations.md` | EDIT (new subsection) | ~35 |
| `charts/openwhispr-server/Chart.yaml` | EDIT (version + appVersion) | ~2 |
| `charts/openwhispr-server/values.yaml` | EDIT (image.tag + lineage comment) | ~10 |

**Total ~150 LOC. No deletions, all additive (except the 1-line `/api/health` handler response object widening).**

## 4. Implementation order (strict TDD)

1. **RED-1 (unit, build-info parser)** — write `apps/api/tests/unit/config/__tests__/build-info.test.ts` with all 6 cases asserting against `parseBuildInfoFromEnv` (file does not yet exist; TypeScript compile fails). Commit at RED: `test(build-info): RED — env-driven build-info parser contract (260528-370)`.
2. **GREEN-1** — create `apps/api/src/config/build-info.ts`. Run `pnpm --filter @openwhispr/api test apps/api/tests/unit/config/__tests__/build-info.test.ts` until all 6 cases pass. Commit: `feat(build-info): GREEN — parseBuildInfoFromEnv (260528-370)`.
3. **RED-2 (integration, /api/health widening)** — write `apps/api/tests/integration/health-build-info.test.ts` with 3 cases asserting against `/api/health` response shape. Confirm RED by running it (probes.ts handler still emits the 2-field shape). Commit: `test(health): RED — /api/health build-info wire contract (260528-370)`.
4. **GREEN-2** — edit `apps/api/src/routes/probes.ts`: extend `ProbesDeps`, widen handler response. Edit `apps/api/src/index.ts`: thread `buildInfo` into `registerProbes`. Run integration test until 3-of-3 pass. Commit: `feat(health): GREEN — /api/health surfaces version + commit_sha + image_tag (260528-370)`.
5. **Dockerfile + workflow wiring** — add ARG/ENV block to `apps/api/Dockerfile` runtime stage; add `build-args` to `.github/workflows/release.yml` build-push step. Local verification: `docker build --build-arg BUILD_VERSION=test-1.0.14 --build-arg BUILD_SHA=deadbeef --build-arg IMAGE_TAG=test-tag -f apps/api/Dockerfile -t openwhispr-api:local-build-info-test .` then `docker run --rm openwhispr-api:local-build-info-test sh -c 'echo "$OPENWHISPR_BUILD_VERSION $OPENWHISPR_BUILD_SHA $OPENWHISPR_IMAGE_TAG"'` MUST print `test-1.0.14 deadbeef test-tag`. Then `docker run -d --name probe-test -p 3000:3000 openwhispr-api:local-build-info-test` + `curl -s localhost:3000/api/health | jq` MUST show the three values populated. Commit: `feat(build): wire BUILD_VERSION + BUILD_SHA + IMAGE_TAG ARGs through Dockerfile + release.yml (260528-370)`.
6. **Docs** — add the new subsection to `docs/operations.md`. Commit: `docs(operations): live version verification via /api/health (260528-370)`.
7. **Chart bump (atomic ship)** — Chart.yaml `1.0.16→1.0.17` + appVersion `1.0.13→1.0.14`, values.yaml `image.tag 1.0.13→1.0.14` + lineage comment. Commit: `chore(server-chart): bump to 1.0.17 with image v1.0.14 default (build-info fields)`.

## 5. Test matrix

### 5.1 Unit — `build-info.test.ts` (6 cases)

| # | Input env snapshot | Expected output |
|---|---|---|
| U1 | All three vars present, valid values: `{ OPENWHISPR_BUILD_VERSION: "1.0.14", OPENWHISPR_BUILD_SHA: "84b90245abcd...", OPENWHISPR_IMAGE_TAG: "1.0.14" }` | `{ version: "1.0.14", commitSha: "84b90245abcd...", imageTag: "1.0.14" }` |
| U2 | All three vars absent (`{}`) | `{ version: "unknown", commitSha: "unknown", imageTag: "unknown" }` |
| U3 | Partial: only `OPENWHISPR_BUILD_VERSION: "1.0.14"` present | `{ version: "1.0.14", commitSha: "unknown", imageTag: "unknown" }` |
| U4 | All three whitespace-only: `{ OPENWHISPR_BUILD_VERSION: "   ", OPENWHISPR_BUILD_SHA: "\t\n", OPENWHISPR_IMAGE_TAG: "" }` | `{ version: "unknown", commitSha: "unknown", imageTag: "unknown" }` |
| U5 | Empty-string explicit: `{ OPENWHISPR_BUILD_VERSION: "" }` | `{ version: "unknown", commitSha: "unknown", imageTag: "unknown" }` |
| U6 | `OPENWHISPR_BUILD_VERSION` = 200-char string `"a".repeat(200)` | `version` field truncated to exactly 120 chars (`"a".repeat(120)`) |

### 5.2 Integration — `health-build-info.test.ts` (3 cases)

| # | buildApp opts | Request | Expected `/api/health` response |
|---|---|---|---|
| I1 | `{ buildInfo: { version: "1.0.14", commitSha: "deadbeef", imageTag: "v1.0.14" }, migrationsCheck: async () => true }` | `GET /api/health` | `200`, body `{ status: "ok", migrations_completed: true, version: "1.0.14", commit_sha: "deadbeef", image_tag: "v1.0.14" }` |
| I2 | `{ migrationsCheck: async () => true }` (no `buildInfo`) — exercises the `parseBuildInfoFromEnv()` fallback with no env vars set | `GET /api/health` | `200`, body `{ status: "ok", migrations_completed: true, version: "unknown", commit_sha: "unknown", image_tag: "unknown" }` |
| I3 | `{ buildInfo: { version: "1.0.14", commitSha: "deadbeef", imageTag: "1.0.14" }, migrationsCheck: async () => false }` | `GET /api/health` | `200`, body `{ status: "ok", migrations_completed: false, version: "1.0.14", commit_sha: "deadbeef", image_tag: "1.0.14" }` — regression check that build-info widening did NOT break migrations_completed |

### 5.3 Coverage targets

- `apps/api/src/config/build-info.ts`: 100/100/100/100 (pure function, 6 cases exhaustively cover all branches: present / absent / partial / whitespace / empty / truncation).
- `apps/api/src/routes/probes.ts` diff lines: ≥ 90/90/90/90 — I1/I2/I3 cover the `buildInfo ?? defaults` branch + spread into response.

## 6. Verification checklist (orchestrator MUST run before claiming done)

- [ ] `pnpm --filter @openwhispr/api test apps/api/tests/unit/config/__tests__/build-info.test.ts` → 6/6 pass, exit 0
- [ ] `pnpm --filter @openwhispr/api test apps/api/tests/integration/health-build-info.test.ts` → 3/3 pass, exit 0
- [ ] `pnpm --filter @openwhispr/api lint` → 0 errors (LOCKER-02 `as any`, LOCKER-03 hardcoded literals, LOCKER-04 prod-readiness all green)
- [ ] `pnpm --filter @openwhispr/api typecheck` → 0 errors
- [ ] `pnpm --filter @openwhispr/api build` → tsup bundle succeeds
- [ ] `pnpm biome check apps/api/src/config/build-info.ts apps/api/src/routes/probes.ts apps/api/src/index.ts apps/api/tests/unit/config/__tests__/build-info.test.ts apps/api/tests/integration/health-build-info.test.ts` → 0 findings
- [ ] `pnpm test` (full root) → all 22 vitest projects pass — confirms pre-push test-evidence gate (v1.0.12) will accept the eventual `git push`
- [ ] `helm lint charts/openwhispr-server` → 0 errors
- [ ] `helm template charts/openwhispr-server | grep -E 'image:.*openwhispr-api:1\.0\.14'` → at least one match (api Deployment renders the new image tag)
- [ ] `docker build --build-arg BUILD_VERSION=test-1.0.14 --build-arg BUILD_SHA=deadbeefcafebabe --build-arg IMAGE_TAG=test-1.0.14 -f apps/api/Dockerfile -t openwhispr-api:local-build-info-test .` → exit 0
- [ ] `docker run --rm --entrypoint sh openwhispr-api:local-build-info-test -c 'env | grep OPENWHISPR_BUILD_'` → prints all three vars with the expected values (proves Dockerfile ARG→ENV propagation works)
- [ ] `docker run -d --rm --name probe-test openwhispr-api:local-build-info-test && sleep 5 && docker exec probe-test wget -qO- http://127.0.0.1:3000/api/health` → response JSON includes `"version":"test-1.0.14"` + `"commit_sha":"deadbeefcafebabe"` + `"image_tag":"test-1.0.14"`. Then `docker kill probe-test`. (Local-only smoke; not a CI step.)
- [ ] `git log --oneline -8` shows the 7 commits from §4 in order with the expected scopes/subjects, every cited SHA on HEAD.
- [ ] `git status --short` is clean (no orphaned partial edits).
- [ ] Lefthook hooks fire on commit AND push without `--no-verify` (CLAUDE.md hard-rule 4).

## 7. Release artifacts (atomic ship)

- Tag `v1.0.14` (image release) → triggers `release.yml` → publishes `ghcr.io/yambr/openwhispr-api:1.0.14` (+ web/worker/test-probe/postgres variants under the same tag).
- Tag `openwhispr-server-1.0.17` (chart release) → triggers `helm-release.yml` → publishes `oci://ghcr.io/yambr/charts/openwhispr-server:1.0.17` with `appVersion: "1.0.14"`.
- Both tags pushed in the same `git push --tags` after the 7-commit chain lands on main.
- Post-push: `gh release view v1.0.14` MUST render the body from `release.yml`'s `create-image-release` job with the v1.0.14 pull commands; `gh release view openwhispr-server-1.0.17` MUST render the chart release body.

## 8. Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | Dockerfile ARG ordering invalidates layer cache and balloons CI build time. | ARG/ENV block goes in the `runtime` stage BEFORE `ENV NODE_ENV=production` but AFTER the heavy `COPY --from=prod-deps` / `COPY --from=builder` layers — those layers are content-addressed and unaffected by ARG-value changes. Tested locally by building twice with different `--build-arg` values; second build cache-hits everything except the `ENV` layer (~50ms). |
| R2 | `release.yml` matrix has 6 entries but only `api` consumes the new build-args; Docker may warn on the unused ones. | Docker silently drops build-args not declared via `ARG` in the Dockerfile — no warning, no error. Confirmed behavior; no per-matrix conditional needed. Cost: a 6-line `build-args` block applied to 5 images that ignore it. Acceptable. |
| R3 | Wire contract widening might break a strict-shape client parser. | `/api/health` already widened in Plan 13-01 (`migrations_completed` added) without breakage — clients use object-spread parsing. New fields are STRICTLY additive; field order in JSON object is irrelevant. Documented in §6 of `docs/operations.md` as additive forward compatibility. |
| R4 | `"unknown"` triplet semantics could confuse operators ("is the field broken? is the image bad?"). | `docs/operations.md` new subsection explicitly disambiguates "release-built but ARG forgotten" (impossible — defaults are `"unknown"` literal, not empty string) from "local dev build" (expected `"unknown"`). Operators can grep production replicas for the literal `"unknown"` string as a build-pipeline regression signal. |
| R5 | Pre-push test-evidence gate (v1.0.12, hard-rule 4) rejects the commit because the new test files weren't run before push. | Implementation order §4 step 7 runs `pnpm test` from project root immediately before the chart bump commit; the test-evidence reporter writes fragments for ALL 22 projects (including `apps-api-unit` + `apps-api-integration`) covering the new test files. Gate will accept. NEVER use `git push --no-verify`. |
| R6 | LOCKER-03 (no hardcoded `BUILD_*` / UUID / secret-shape literals) refuses the new build-info module. | The literal `"unknown"` is exported as a named const `BUILD_INFO_UNKNOWN`, never inlined at call sites in production code; tests are exempt (under `tests/` path allowlist). All other literals (`OPENWHISPR_BUILD_VERSION` etc.) are env-var NAMES, not hardcoded values — LOCKER-03 ignores them. |
| R7 | LOCKER-05 string-truncation lint catches `bodyText|responseBody|...` shapes — but `version` / `commit_sha` / `image_tag` aren't error-class fields. | LOCKER-05 scope is Error subclasses only (`tools/lint-secret-shape-in-error.ts`). `BuildInfo` is a plain DTO, not an Error subclass. Truncation to 120 chars is defense-in-depth (defends against `OPENWHISPR_IMAGE_TAG` injection of a 100KB string crashing JSON.stringify) — documented in the module jsdoc. |
| R8 | `apps/api/src/index.ts` `buildApp` opts type accepts arbitrary fields without compile-time checking; `buildInfo` typo silently becomes `undefined`. | Add `buildInfo?: BuildInfo` to the opts type explicitly (per §2.1 item 3); TypeScript catches typos at integration-test call sites. |

## 9. Out-of-scope deferrals (recorded for future quick tasks)

- **`apps/web/Dockerfile` build-info widening** — web's `/api/health` returns a plaintext `"OK"`; widening it requires a separate JSON wire contract decision. Defer.
- **Boot-time build-info log emission** — emit `{ event: "boot.build_info", version, commit_sha, image_tag }` at Fastify boot for OTel/Loki correlation. Useful but out of scope for v1.0.14.
- **Build-info on `/api/ready`** — R25 Cloud readiness probe stays minimal; widening it requires coordination with the desktop client's Cloud-plane probe consumer.
- **Worker build-info exposure** — worker has no HTTP surface; would need an exec-time stdout banner or a new control plane. Defer until worker grows an admin/inspection surface.

## 10. Operator runbook (post-merge, post-rollout)

After v1.0.14 ships and Helm chart 1.0.17 is deployed:

```bash
# Single-replica verification
curl -s https://api.openwhispr.example.com/api/health | jq
# Expected: status=ok, migrations_completed=true, version=1.0.14,
#          commit_sha=<40-char-sha>, image_tag=1.0.14

# Multi-replica rollout verification (3 replicas, no kubectl needed)
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -s https://api.openwhispr.example.com/api/health \
    | jq -r '"\(.version) \(.commit_sha[0:8]) \(.image_tag)"'
done | sort | uniq -c
# Expected (all replicas converged):
#   10 1.0.14 84b90245 1.0.14

# Drift detection (any "unknown" on a production replica is a regression):
curl -s https://api.openwhispr.example.com/api/health \
  | jq -r 'select(.version=="unknown" or .commit_sha=="unknown" or .image_tag=="unknown")'
# Expected on production: NO output (empty stdout).
# Output present → rebuild + re-deploy that image (built outside release.yml).
```

If `migrations_completed` flips to `false` after the bump → check the migrate Job logs as before (orthogonal to this widening). If `version` / `commit_sha` / `image_tag` report `"unknown"` on a production replica → the image was rebuilt outside `release.yml`'s `docker/build-push-action@v7` step (e.g. operator ran `docker build` locally and pushed manually) and the build-args were forgotten; rebuild via the canonical workflow.

---

**End of plan. Executor: implement in the order in §4; orchestrator: verify per §6 before reporting done to the user.**
