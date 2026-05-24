---
status: diagnosed
trigger: "PROD CI red-sweep Issue A: litellm-unhealthy in CI compose envs (ci.yml::smoke, conformance-axe::axe-baseline, harness-self-check)"
created: 2026-05-24T00:00:00Z
updated: 2026-05-24T00:00:00Z
---

## Current Focus

hypothesis: Mandate framed three failing jobs as one root cause ("litellm-unhealthy"). They are THREE distinct root causes — only the first is "already fixed". The other two are live bugs in production code (or compose wiring) that demand independent fixes.
test: Read artifacts for each of the three failing jobs on the latest post-fix run.
expecting: Three different stderr/log fingerprints.
next_action: Surface the 3-way split to the orchestrator; do not fire a "single fix" since none exists.

## Symptoms

expected: smoke job green
actual:
  - Run 26337800406 / 77534390507 (the one the user cited): "container openwhispr-api-1 is unhealthy" after 50s. → RESOLVED in 5e3be923 (current main).
  - Run 26343494828 (CURRENT, post-fix): compose stack up healthy in <2min. `pnpm smoke` exits 1 with TWO vitest failures:
    1. tests/smoke/signup-transcribe.smoke.test.ts:83 — "sign-up did not return a session cookie: expected null to be truthy"
    2. tests/smoke/transcribe-415.smoke.test.ts:34 — body is `{ error: "unauthorized" }` (string), expected `{ error: { code, message } }` (envelope)
errors: as above
reproduction: push to main → ci.yml smoke job
started: same SHA cluster — sign-up regression appears to predate the user's mandate

## Eliminated

- hypothesis: redis undefined → depCheck unwired → /api/ready 503 unhealthy
  evidence: Latest run 26343494828 — `up --wait` completed successfully, api healthy. The 5e3be923 commit (localhost → 127.0.0.1 in api Dockerfile + compose healthcheck) already fixed the actual unhealthy-at-boot symptom.
  timestamp: 2026-05-24T00:00:00Z

## Evidence

- timestamp: 2026-05-24T00:00:00Z
  checked: git log + git show 5e3be923
  found: Commit 5e3be923 "fix(ci-smoke): pin healthcheck target to 127.0.0.1, ban localhost" explicitly closes "CI red on run 26337800406 / job 77534390507" — the exact run cited in user's mandate. Root cause was BusyBox wget on GHA runner (IPv6-first gai.conf) resolving `localhost` to `::1`, Fastify bound to 0.0.0.0 (IPv4 only) → Address not available → healthcheck failed 3× → unhealthy.
  implication: Issue A as stated in mandate is ALREADY FIXED on current main. The 3-line api.log + zero readiness probes in /tmp/smoke-artifacts evidence matches the pre-fix symptom exactly.

- timestamp: 2026-05-24T00:00:00Z
  checked: gh run view 26343494828 (latest push, post-fix)
  found: smoke job FAILED but with different signature: stack came up healthy, smoke probes ran. 2 of 6 vitest assertions failed:
    - signup-transcribe.smoke.test.ts:83 — sign-up POST returned no set-cookie header
    - transcribe-415.smoke.test.ts:34 — /api/transcribe 401 envelope shape is `{error:"unauthorized"}` (string) not `{error:{code,message}}` (typed envelope per BACKEND_SPEC.md)
  implication: Different bug surface from Issue A. Likely a sign-up regression and/or a 401-pre-validation envelope shape regression. Scope question for orchestrator: extend to fix these too, or hand off?

## Resolution

root_cause: THREE distinct root causes, not one:

  ROOT_CAUSE_1 — ci.yml::smoke (the ORIGINAL "litellm-unhealthy" mandate symptom)
    Already fixed by commit 5e3be923 — `localhost` → `127.0.0.1` in api+web Dockerfile HEALTHCHECK + compose embedded-litellm api/web healthcheck.test + load-test mock-litellm healthcheck. BusyBox wget IPv6-first resolution on GHA runners was the cause; Fastify binds 0.0.0.0 (IPv4-only) so `[::1]:3000` failed with EADDRNOTAVAIL. Smoke uses embedded-litellm overlay which overrides api healthcheck from /api/ready (base) → /api/health (overlay), so SSRF-issue below doesn't bite this path.
    Verified on run 26343494828: compose `up --wait` succeeded; smoke job still fails 2/6 tests for UNRELATED reasons (signup-transcribe.smoke.test.ts:83 "sign-up did not return a session cookie" + transcribe-415.smoke.test.ts:34 envelope shape mismatch `{error:"unauthorized"}` vs `{error:{code,message}}`). These are SEPARATE bugs outside the mandate's scope.

  ROOT_CAUSE_2 — conformance-axe::axe-baseline (e2e-cjm-api-1 unhealthy)
    api refuses to boot with `BYOK_STORAGE_REQUIRED` / missing S3_ENDPOINT. The conformance-axe overlay chain is `docker-compose.yml + embedded-litellm + observability + pgbouncer + dev-tools + ingress` — NO `compose/docker-compose.storage.yml` overlay → no S3_ENDPOINT → assertBYOKConfig() in apps/api/dist/index.js:143 throws BYOKGuardError → container exits at boot (~8s, not unhealthy from healthchecks).
    Evidence: /tmp/axe-logs/api.log shows 6 consecutive `BYOK env missing for disabled overlay; refusing to start (overlay=storage, missing=S3_ENDPOINT)` BYOKGuardError loops from PID 1.

  ROOT_CAUSE_3 — harness-self-check (api-container-healthy.test.ts + migrate-gates-api.test.ts)
    BASE-only docker-compose.yml stack uses /api/ready healthcheck (changed by commit 54719dc8 "feat(R25)"), which requires the depCheck to probe `http://litellm:4000/health/readiness`. The api's process-wide SSRF guard is gated on OUTBOUND_ALLOWED_HOSTS (default empty → deny everything). Base compose does NOT set OUTBOUND_ALLOWED_HOSTS — only the dev-tools overlay does (`litellm,mailpit,valkey,postgres`). Result: every /api/ready probe emits `security.ssrf_blocked` `host_not_allowed` for `litellm` → litellm_upstream.ok=false → /api/ready returns 503 → wget healthcheck non-zero → unhealthy → `up --wait` fails.
    Evidence: 8 consecutive 503 /api/ready responses in api log + `event:"security.ssrf_blocked", target_url_host:"litellm", rule:"host_not_allowed"` from `ssrf.guard` logger. Healthcheck wget DID reach api (logs are full of req-1..req-8).
    Concept-of-the-bug: 54719dc8 (R25) made base compose use /api/ready (deep cloud-ready) for the docker HEALTHCHECK, but never added a base-default OUTBOUND_ALLOWED_HOSTS that includes the bundled-default litellm hostname. Any operator who runs the base-only stack hits this — not just CI self-tests. The dev-tools overlay is a workaround, not a fix.

fix: REFUSED — three independent fixes are needed and only one of them was clearly in mandate scope (ROOT_CAUSE_1 already done by 5e3be923). The other two require user direction:
  • ROOT_CAUSE_2: Either add storage overlay to conformance-axe bootStack args, OR remove the BYOK_STORAGE_REQUIRED guard (it presumes ALL deploys have S3, which fights the conformance-axe scope).
  • ROOT_CAUSE_3: Base compose should ship a default OUTBOUND_ALLOWED_HOSTS that includes the bundled-default litellm/valkey/postgres service names (matching the LITELLM_BASE_URL default of `http://litellm:4000`). Putting the default in dev-tools is wrong: the docker-compose.yml api healthcheck IS `/api/ready` and a base-only deploy MUST be able to satisfy its own healthcheck. Alternatively, /api/ready could fall back to /health/liveliness (no SSRF cost) when no allowlist is configured — but that defeats the cloud-ready guarantee R25 was designed to provide.

verification: Run 26343494828: stack-up phase of smoke succeeded post-fix; harness-self-check fails with SSRF block evidence; conformance-axe (run 26343494805) fails with BYOK_STORAGE_REQUIRED evidence.
files_involved:
  - 5e3be923 (DONE): apps/api/Dockerfile, apps/web/Dockerfile, compose/docker-compose.embedded-litellm.yml, compose/docker-compose.load-test.yml, tools/lint-compose-healthcheck-target.test.ts
  - For ROOT_CAUSE_2: tests/e2e-cjm/support/compose-harness.ts (bootStack call site, ~line 406) OR apps/api/src/config/byok.ts (the assertBYOKConfig guard) OR conformance-axe.yml workflow
  - For ROOT_CAUSE_3: docker-compose.yml (api environment block, add OUTBOUND_ALLOWED_HOSTS + OUTBOUND_PRIVATE_HOST_ALLOWLIST defaults) OR apps/api/src/routes/readiness.ts (allow skipped/SSRF-blocked litellm probe to pass when no allowlist set)
