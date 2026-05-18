# Roadmap: OpenWhispr Server

**Created:** 2026-05-08 (rebaselined after pivot)
**Granularity:** standard
**Total v1 requirements:** 89 (101 incl. Phase 5 + 07.1 scope-expansions)
**Total v2 requirements:** 61 (E2E + ADMIN + UICONF + SLIM + BYOK + STRUCT + FSL + COMMENT + TLS + SSO)
**Coverage:** v1 101/101 mapped (100%); v2 61/61 mapped (100%)
**v2 milestone opened:** 2026-05-14 — work-order 13 → 12 → 14 → 15 → 16 → 17 → 18

## Core Value

A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.

## Constitutional Rules (apply to every phase)

1. **Strict TDD.** Tests precede production code on every feature, every bugfix.
2. **GitHub Actions CI must be green** before any merge to `main`.
3. **English-only** for all source artifacts (docs, code, comments, identifiers, log keys).
4. **Wire-contract conformance** — every endpoint added in Phases 2-5 extends the CONTRACT-01 suite in the same PR.
5. **Coverage gate** ≥ 85% lines / ≥ 80% branches enforced in CI.
6. **Per-endpoint p95 SLOs are NOT published until Phase 8 load test validates them.**

## Phases

- [x] **Phase 0: Repo Bootstrap & Constitutional CI** — Establish TDD discipline, GitHub Actions, license/secrets/dep scanning, coverage gate from commit #1
- [x] **Phase 1: Core Infra & Multi-Tenant Data** — Compose stack scaffolding (Postgres+PgBouncer+Redis+observability+Traefik+MinIO), RLS DDL, tenant-context middleware, no-default-secrets gate
- [x] **Phase 2: Auth + Wire-API Skeleton + Conformance Harness** — Better Auth (email+pwd + OIDC pluggable), OAuth shim with channel-scheme echo, token rotation, CONTRACT-01 harness, all 3 auth-lifecycle endpoints + `/api/health` (closed via Phases 02.1 → 02.22 cascade)
- [x] **Phase 3: LiteLLM Integration + Bundled OSS Models** — Bundle LiteLLM ≥1.83.7 with faster-whisper / pyannote / Speaches-compatible image; env-override path documented; sync `/api/transcribe` + `/api/reason` end-to-end with usage ledger (observability only). Live e2e green against real OpenRouter / Groq / OpenAI / pyannote.ai (2026-05-11).
- [x] **Phase 4: Streaming + Realtime** — `/api/agent/stream` NDJSON line-flush + WSS realtime 3600s + 3 realtime token endpoints (verification: human_needed)
- [x] **Phase 5: Operational Endpoints** — `/api/usage`, `/api/stt-config`, `/api/note-recording-config`, `/api/streaming-usage`, `/api/agent/web-search`, generic `cloud-api-request` passthrough (closed 2026-05-11, 828/830 tests green)
- [x] **Phase 6: Observability + Ops Hardening + Workers** — CLOSED 2026-05-12. OTel/Prom/Loki end-to-end + audit log + BullMQ workers + tenant-context job middleware + anti-abuse rate limit + SSRF defense. 12 plans landed (06-01..06-11 + 06-12a/b/c/d split). PR-gate e2e + nightly full sweep wired. Per-file coverage audit in 06-12-COVERAGE.md. All 7 success criteria PASS.
- [x] **Phase 7: Frontend UI-SPEC** — Admin console + end-user self-service specs targeting Next.js 15 + shadcn/ui v2; design tokens; component inventory. CLOSED 2026-05-12 (15/15 verifier must-haves PASS; tools/lint-ui-spec.ts coverage 96.81/92.24/94.59/96.77; three design-gap markers encoded for Claude Design re-engagement; apps/web/ scaffold deferred to Phase 8).
- [x] **Phase 07.1: Web App Implementation** — `apps/web/` Next.js 15 + React 19 + Tailwind 4 + shadcn/ui v2 implementing every UI-SPEC screen (A2, A3, U1–U13) same-origin behind Traefik. CLOSED 2026-05-12 (27 atomic commits; 510 unit + 85 e2e tests; coverage 98.53/92.99/97.79/97.62; size-limit 168.84 kB max gz across 15 routes; Traefik basic-auth admin gate verified; Better Auth wired end-to-end; WEB-IMPL-01..04 Complete).
- [x] **Phase 8: Load Test, Tuning & SLO Publication** — CLOSED 2026-05-13. Manual on-demand `make load-test PROFILE={mock,realistic}`; PgBouncer 4×100=400 backend + FD 65535 refuse-to-start; 4-endpoint SLO budgets published in `docs/operations.md` from Run 5 (commit `a5e5920`, 1000 VU × 30 min, 0.106% error rate, 6/6 k6 thresholds PASS): transcribe p95 2521→SLO 3025 ms, reason 1209→1451, agent-stream TTFB 610→732, agent-stream total 1127→1352, realtime-ws 41→49 (mock-floor, OPERATOR_RERUN_ON_GPU). Realistic-profile plateau deferred to H100 per RESEARCH §Pitfall 2; wiring proven LIVE via paid smoke (commit `11d21f3`). Nightly CI cadence + auto-regression-gate deferred per D-EXEC-1 — TEST-LOAD-01 carries the v2 amendment note. 8 plans (08-01..08-08) + 5 inserted sub-phases (08.1..08.5); 08.6 (Speaches main-branch diarization) runs in parallel and does not block closure. See `.planning/phases/08-load-test-tuning-slo-publication/08-SUMMARY.md`.
- [x] **Phase 08.1: Deferral Fixes + Mock Re-run** — gap-closure of 08-07 CLOSED 2026-05-12 with partial-live-validation: anomaly #1 (99.93% error rate) → transcribe + reason 200 LIVE, agent-stream api-side issue escalated; anomaly #2 (realtime-ws p95=0) → code-closed via custom Trend; anomaly #3 (pgbouncer_admin SCRAM) → LIVE SHOW POOLS returns rows. 30-min plateau is operator hand-off via `make load-test PROFILE=mock`.
- [x] **Phase 08.2: agent-stream undici dispatcher fix** — CLOSED 2026-05-12: Option A landed in two atomic commits (08.2-01 `feat(08.2-01): add chatCompletionsStream to @openwhispr/litellm-client`; 08.2-02 `fix(08.2-02): replace undici.fetch in agent/stream with shared litellm-client streaming method` + `fix(08.2-02): stop forwarding signal to litellm client in agent/stream (live-probe finding)`). Live forensic-probe against `compose/mock-litellm` returns content-bearing NDJSON ending in `finishReason:"stop"` (12 text-deltas + finish chunk). New architectural finding from live probe: undici 7.25 `signal:AbortSignal` + custom-wrapped SSRF Agent fails at connect/dispatch — fix omits signal at the route call site; client interface preserves `signal?` for non-SSRF callers (deferred follow-up item). Coverage: litellm-client 100/98/100/100; stream.ts 100/90.47/100/100. Unblocks 08-08.
- [~] **Phase 08.3: mock-litellm `/v1/realtime` echo for measurable WS roundtrip** — CLOSED 2026-05-13 partial: echo handler shipped (commits `b43c610` + `5e2c32d`, 22/22 vitest GREEN, coverage 100/100/100/100); Run 4 plateau (commit `1510a23`) PASSED transcribe/reason/agent-stream exit gates but realtime-ws p95 still = 0 — root cause moved api-side. Diagnosis 2026-05-13: handshake succeeds (108k WS sessions, ws_connecting p95 5.7ms) so route IS registered (LITELLM_MASTER_KEY present in .env); echo handler ships in image (verified `dist/realtime.js` inside `openwhispr-mock-litellm:dev`); failure is upstream-message-frame-forwarding through `@fastify/http-proxy` v11. Tracked as Phase 08.4.
- [x] **Phase 08.4: realtime-ws load-test path fix** — CLOSED 2026-05-13. ROADMAP entry was originally written assuming an api-side proxy bug; research and empirical host-side WebSocket probing rejected that hypothesis and identified TWO CLIENT-side load-test bugs: (H7) `tools/load-test/src/utils/http-client.ts:152` called `new W(url, params)` instead of 3-arg `new W(url, null, params)`, silently dropping `Authorization: Bearer` headers — commit `a86140d`; (H8) `tools/load-test/src/flows/realtime-ws.ts wsUrl()` hit `wss://api.localhost/v1/realtime` (port 443) but Phase 04 Plan 05 had isolated long-running WSS onto a dedicated `:8443 websecure-realtime` entrypoint (SCALE-05) — Traefik :443 returned plain-text 404 which k6's browser-style addEventListener silently dropped — commit `670aa8a`. Smoke-gate extension (commit `0ac7985`) asserts `ws_msgs_sent > 0` and caught H8 in 30 sec when H7 alone proved insufficient. Run 5 produced complete 4-endpoint mock baseline at 1000 VU × 30 min: transcribe p95 2521 ms, reason 1209 ms, agent-stream TTFB 610 ms, realtime-ws roundtrip 41 ms (mock-floor — operator H100 re-run will fill window); error rate 0.106%; 6/6 k6 thresholds PASS.
- [x] **Phase 08.5: realistic profile boot + smoke + short Mac baseline** — CLOSED 2026-05-13. All 5 production endpoints proven LIVE on Mac via canonical `speaches-audio.md` wiring: (1) /api/reason → LiteLLM → OpenRouter (paid LLM); (2) /api/agent/stream SSE → OpenRouter (paid streaming); (3) /api/transcribe → Speaches Whisper-large-v3 local (returned real text "Thanks for watching!" on sample WAV); (4) wss :8443/v1/realtime → Speaches local (session.created with input_audio_transcription model=Systran/faster-distil-whisper-large-v3); (5) sign-up via Better Auth. Per user directive 2026-05-13 (memory: loadtest-cost-discipline), plateaus stay local-only; paid providers receive 10-call smoke proof-of-wiring only — `tools/load-test/scripts/smoke-paid.sh` costs ~$0.02 per run. Commits: 81ac634 (smoke-paid script + plateau-local realtime config), 7cb68c6 (3 config-bug fixes: build override merge precedence, Enterprise pass_through removal, Speaches wget→curl healthcheck, speaches-realtime model alias), 11d21f3 (smoke-paid `audio` → `file` form field fix; 5/7 PASS). Diarization endpoint deferred to Phase 08.6 (Speaches latest-cpu v0.8.2 doesn't expose /v1/audio/diarization; main branch does — build-from-source). Full 12-min Mac baseline plateau deferred — Mac CPU saturates Whisper inference per RESEARCH.md §Pitfall 2; operator H100 re-run substitutes numbers via the now-proven wiring.
- [x] **Phase 08.6: Speaches master-branch build + local diarization wiring** — CLOSED 2026-05-13. Speaches now builds from `https://github.com/speaches-ai/speaches.git#master` (BASE_IMAGE=ubuntu:24.04 for CPU); the source build exposes `/v1/audio/diarization` against `pyannote/speaker-diarization-community-1` (verified via `docker exec openwhispr-speaches-1 curl /openapi.json`). `apps/api/src/routes/diarization.ts` gained a SPEACHES_DIARIZATION_URL branch that bypasses pyannote.ai async orchestration and POSTs multipart synchronously to local Speaches; pyannote.ai async branch fully preserved as production default. Coverage on diarization.ts: 96.5/90.6/100/96.4 (stmt/branch/fn/lines). Live smoke-paid: **6/8 PASS** (the 2 fails are LiteLLM-direct probes against an unexposed port 4000 — known, scope-out). Inline Rule-3 fixes: Speaches master parses PRELOAD_MODELS as a JSON list (CSV broke pydantic-settings), and a new Traefik `api-audio` router was added because the file provider's `api` router is constrained to PathPrefix(/api) — /v1/audio/* needs its own router (same pattern as `api-realtime`). Commits: 0161c35 (speaches build from master), f9fa791 (RED), 0a118a0 (GREEN + env wiring), 5e7ec1e (compose env + smoke-paid extension), 60a09f6 (live smoke + traefik fix).
- [x] **Phase 08-08: docs/operations.md + SLO publication** — CLOSED 2026-05-13. 4-endpoint SLO budget table (mock profile, sourced from Run 5 `runs/2026-05-12T22-47-48Z-mock-summary.json`) published in `docs/operations.md` with OPERATOR_RERUN_ON_GPU markers; sizing matrix (compose row populated, Helm rows TBD/Phase 9); PgBouncer 4×100=400 + FD 65535 tuning rationale; architecture-bound vs hardware-bound limitations; operator H100 re-run recipe pointing at `08.5-03-STATUS.md`. ROADMAP Phase 8 closed; REQUIREMENTS TEST-LOAD-01 carries deviation note. Commits: `fd1267b` (operations.md), `2fe7d5f` (08-SUMMARY.md), this commit (ROADMAP + REQUIREMENTS).
- [x] **Phase 9: Helm Chart & Cloud Deploy** — CLOSED 2026-05-13. 11 sub-plans across 4 waves landed the production-grade `charts/openwhispr/` Helm chart wrapping the 18-service compose stack: CNPG HA Postgres (custom `cnpg-postgres-17-pgpartman` image, A4), CNPG Pooler CRD (A6), Bitnami Valkey + MinIO OCI sub-charts (A5), api/web/worker Deployments + HPAs + PDBs + ServiceMonitors, LiteLLM Deployment (embedded + external-mode helper), migrate Helm-hook Job, Traefik dual IngressRoutes (`:443` short-JSON + `:8443` websecure-realtime), cert-manager Certificate templates, OTel Collector DaemonSet, helm test SLO probe (DEPLOY-05; `tools/test-probe/` image + Helm-test hook pod), helm-upgrade-matrix.yml (DEPLOY-04; kind cluster + N-1 → N + seed/integrity), helm-release.yml (chart OCI push to GHCR + follow-up PR for `.chart-versions/previous`), and `docs/operations.md` Helm chart section. 32 atomic commits; 106/106 helm-unittest PASS; 95 new vitest tests for tooling. All 5 DEPLOY-* success criteria PASS. See `.planning/phases/09-helm-chart-and-cloud-deploy/09-SUMMARY.md`.
- [x] **Phase 09.1: Real kind Apply (Live Chart Validation)** — CLOSED 2026-05-13. First live `helm install` of `charts/openwhispr/` against kind v0.31. 33 of 34 findings fixed inline (F35 deferred to 09.2). 17 atomic commits, helm-unittest 109/109. All 9 application pods reach `1/1 Running` + migrate Job Complete in 59 seconds: api, web, worker, litellm, postgres (CNPG), pg-pooler ×2, valkey, minio + minio-console. helm test partial — SLO probe reaches api Service in <40ms but Better Auth signup 403 (Origin/IP forwarding gap, recorded as F35 in 09.2 backlog). Architectural validations beyond helm-unittest scope: CNPG admission webhook (F4 shared_preload_libraries, F24 dollar-quote shell escape), PG 17 privilege chain (F25 CREATEROLE + ADMIN OPTION, F26 GRANT SET ON PARAMETER), Bitnami Secure Images migration to bitnamilegacy/* (F6), Helm hook exclusivity trap (F10 → revision-suffixed regular Job), 15-key secret schema gap between chart and app ENTRYPOINT validator (F22), distroless kubectl shell missing (F19 → alpine/kubectl). See `.planning/phases/09.1-helm-real-kind-apply/09.1-SUMMARY.md`.
- [x] **Phase 09.2: helm test SLO probe GREEN** — CLOSED 2026-05-13. helm test exit 0 in 1.365 s (deadline 300 s). DEPLOY-05 SLO criterion fully PASS. F35 + 3 unmasked follow-ons (F36 CNPG Pooler hostname `-pg-pooler` not `-pg-pooler-rw`; F37 SSRF allow-list missing in-cluster litellm; F38 SSRF rfc1918_10 block on k8s Service IP). 4 chart env additions: AUTH_TRUSTED_ORIGINS_EXTRA + OPENWHISPR_DISABLE_EMAIL_VERIFICATION (kind only) + OUTBOUND_ALLOWED_HOSTS + OUTBOUND_PRIVATE_HOST_ALLOWLIST. probe.ts sends Origin header (RED→GREEN vitest +1 = 22/22). helm-unittest 109/109. See `.planning/phases/09.2-helm-test-slo-probe-green/09.2-SUMMARY.md`.
- [ ] **Phase 11: Cloud Profile Refactor (3 variants: embedded / external LiteLLM / local-Speaches example)** — IN PROGRESS 2026-05-13. Default compose+chart slim down: HF_TOKEN + Speaches container moved behind `bundledAi.enabled` (Variant C opt-in only); Variant A (OSS quickstart) = embedded LiteLLM + pyannote.ai managed diarization, minimum 12 secrets; Variant B (corporate) = external LiteLLM via `LITELLM_BASE_URL` + `LITELLM_VIRTUAL_KEY`; Variant C (GPU operators) = local Speaches in `examples/docker-compose.local-speaches.yml`. Each profile ships compose + values overlay + `.env.*.example` + README quick-start section + helm-unittest regression assertions. Plan 11-04 closes with live cloudflared tunnel demo + human-verify checkpoint. See `.planning/phases/11-cloud-profile-refactor/11-PLAN.md`.
- [x] **Phase 10: i18n + Docs + OSS Housekeeping** — CLOSED 2026-05-13. 34 atomic commits across 4 sub-plans. **10-01 (15 commits)**: server-side i18n end-to-end — i18next + ICU bootstrap + en/ru locale bundles + 6 typed-error codes + error-handler localization + worker WorkerTemplateRenderer + 18 email template files + users.locale migration 0016 + Better Auth additionalFields.locale + enqueueEmail DI + BullMQ wired in api entrypoint + audit-log Cyrillic guard (T-10-01 mitigation) + LOCALES_DIR bind mounts + CI i18n-completeness gate + 70-site bulk conversion of inline reply.code(N).send({error}) to typed throws with 29 distinct codes en/ru. **10-02 (6 commits)**: web-side i18n — edge middleware locale negotiation (cookie → Accept-Language → en) + en+ru bundles + RSC layout + LanguageSwitcher + /api/locale route handler + i18next-ICU client+server + 763 web tests at 97.59/92.66/97.85/98.45 coverage. **10-03 (6 commits)**: docs/architecture.md (3 mermaid diagrams) + docs/i18n.md (operator LOCALES_DIR guide) + docs/security.md (threat-model index) + README quickstart + docs/operations.md + docs/auth.md + docs/wire-contract.md + docs/litellm-target-spec.md extensions. **10-04 (7 commits)**: SPDX Apache-2.0 header codemod + 675 source files headerized + CI spdx:check gate + CODEOWNERS + 4 issue templates + CODE_OF_CONDUCT.md + CONTRIBUTING.md + 8 ADRs (0004 licensing, 0005 stack, 0006 wire compat, 0007 RLS multi-tenancy, 0008 LiteLLM, 0009 Better Auth, 0010 i18n runtime, 0011 strict TDD CI). See `.planning/phases/10-i18n-docs-oss-housekeeping/10-SUMMARY.md`.


### v2 — Production Readiness (milestone opened 2026-05-14)

Work-order: **13 → 12 → 14 → 15 → 16 → 17 → 18** (user-confirmed; numbering is deliberately non-sequential — labels assigned after the order was picked). Hard ordering: 13 first (E2E harness gates everything; 13's atomic commit also replaces worker `noopSender` which 12 depends on); 15 → 17 (host split changes mkcert host list); 15 → 16 (FSL relicense rewrites every SPDX header — running 16 first = redo); 18 is SPEC-only and orthogonal to all code (schedulable anytime ≥ 13).

- [x] **Phase 13: E2E + CJM Harness (ships first — the harness every other v2 phase tests against)** — CLOSED 2026-05-14 (`status: passed`, 13/13 must-haves verified). Cucumber+Playwright at `tests/e2e-cjm/`, `docs/customer-journeys.md`, Gherkin journeys with happy-path + negative-twin coverage, Mailpit-HTTP verification, testcontainers teardown, weak-assertion ESLint ban, real nodemailer in `packages/email/`. Verification at `.planning/phases/13-e2e-cjm-harness-v2-ships-first/13-VERIFICATION.md`. Tick reconciled 2026-05-18 during Plan 51-19 closure sweep.
- [x] **Phase 12: Admin Onboarding Wizard + UI-SPEC Conformance Audit** — `/setup` gated by `setup_state` enum (NOT users-count); single-page RHF+Zod+shadcn Stepper wizard; `users.role` migration + Better Auth `additionalFields.role`; `/admin` index page (closes TD-12.a 404); `GET /api/capabilities` driving conditional OIDC button render (closes TD-12.c capability drift); per-field Zod localized errors; resend-verification CTA on 403; semantic Playwright DOM conformance vs Phase 07 `design-canvas.jsx` (NOT pixel-diff); axe a11y baseline+delta. **Conformance to existing design contract — NOT redesign.** (completed 2026-05-14)
- [x] **Phase 14: Slim Core + BYOK Profiles** — Slim default = 6 services (api+web+worker+postgres+valkey+litellm); opt-in compose overlays (observability / storage / ingress / pgbouncer / dev-tools); `.env.slim.example` ~5 keys; BYOK env matrix in `docs/operations.md`; Helm `*.enabled` toggles 1:1 with overlays; loud-fail BYOK (refuse to start on misconfigured prod env); audit ALL three worker noops at `apps/worker/src/index.ts:68-92`. (completed 2026-05-14)
- [ ] **Phase 15: Repo Refactor + FSL Relicense + History Scrub** — Test-layout codified (`tests/{unit,integration}/`); `compose/` directory holds every compose YAML; Traefik host split (`web.localhost` vs `api.localhost` — closes TD-15.g `/api/locale` 404 shadowing); Apache-2.0 → FSL-1.1-ALv2 via `reuse` codemod across 675 SPDX headers + every workspace `package.json` + Docker LABELs + README badges + DCO sign-off + retroactive contributor consent; `git filter-repo --path speaches-audio.md --invert-paths` history scrub bundled WITH FSL as ONE release event. Recommended sub-plan split: 15.a structural reorg + Traefik host split + test layout; 15.b FSL codemod + history scrub (irreversible-history-rewrite — owns its atomic window).
- [ ] **Phase 16: Phase-Tag Comment Audit** — regex-on-text codemod (NOT AST traversal; ts-morph dep reserved for deferred inline-comment phase) audits **approximately 754** `// Phase XX / Plan YY / D-ZZ` header comments in `apps/` + `packages/` (originally cited as 771 pre-Phase-15; delta = file deletions during structural reorg; scope corrected from TECH_DEBT's 1642 figure which double-counted tests/tools/.planning); per-area sweep canary before bulk; two-bucket REMOVE/KEEP classification (heuristic-only, conservative-KEEP defaults); lint regression rule (tsx CLI per Phase 15-01 pivot); grouped per-area atomic commits (each < ~300 files for comment-only deletions per Phase 15-03 precedent). **Must run AFTER Phase 15 — FSL codemod rewrites every SPDX header; running 16 first = redo.**
- [x] **Phase 17: Trusted Local TLS + Production ACME** — CLOSED 2026-05-15 codebase (5/5 must-haves VERIFIED PASS-WITH-DEFERRED-RUNTIME, 3 runtime live-smokes routed to operator/CI by design per CONTEXT Q1-B3). All artefacts landed: `Makefile:152` `tls-trust` target, `compose/traefik/dynamic.prod.yml`, `charts/openwhispr/templates/issuer.yaml`, `docs/operations.md#air-gap-mkcert`, `.dockerignore` dev-cert exclusion + per-context `compose/traefik/.dockerignore`, `tools/lint-dockerfile-tls.ts` (13/13 tests + lefthook + CI wiring), `tests/e2e-cjm/features/phase17-tls.feature` 3 Gherkin scenarios. helm-unittest 163/163 GREEN. Verification at `.planning/phases/17-trusted-local-tls-production-acme-v2/17-VERIFICATION.md`. Update tick missed earlier; reconciled 2026-05-18 during Plan 51-19 closure sweep.
- [x] **Phase 18: LDAP / Keycloak SSO — SPEC + ADR only (NO code in v2; implementation deferred to v3)** — CLOSED 2026-05-15 (`status: passed`, score 5/5 must-haves, ROADMAP §Phase 18 `passed_spec_only` accepted). `SPEC-ldap-keycloak.md`, `docs/adrs/0012-ldap-via-keycloak.md`, `compose/test/keycloak.yml` fixture stub all landed. Verification at `.planning/phases/18-ldap-keycloak-sso-spec/18-VERIFICATION.md` (4 commits `9b51ee3..HEAD`). Update tick missed earlier; reconciled 2026-05-18 during Plan 51-19 closure sweep.
- [x] **Phase 20: Compose+Helm Production Guardrails (P0 audit remediation)** — CLOSED 2026-05-18 (`status: passed`, 4/4 plans summarized + phase-level VERIFICATION.md). Plan 20-01 (compose resource limits + `restart: unless-stopped` across production overlays — base/embedded-litellm/observability/ingress/storage/load-test/pgbouncer; acme/contract-test/dev-tools intentionally carved out per CONTEXT as test/dev-only short-lived services). Plan 20-02a (startupProbe failureThreshold=30 × periodSeconds=10 + topologySpreadConstraints maxSkew=1/hostname/ScheduleAnyway on api/web/worker/litellm Deployments — commits `3635b40` RED → `1bc4987` + `b055b81` GREEN). Plan 20-02b (pod+container securityContext on api/web/worker — runAsNonRoot, readOnlyRootFilesystem, drop ALL, allowPrivilegeEscalation=false, seccompProfile RuntimeDefault; litellm container-level subset only per SR-20.5 documented exception (upstream image uid 0 + Prisma /app/.prisma writes); OTel Collector partial-hardening — commit `943a7d1`). Plan 20-03 (CI `compose-lint` + `compose-lint-resources` matrix across 8 profiles). helm-unittest 184/184 GREEN. Verification at `.planning/phases/20-compose-helm-production-guardrails/20-VERIFICATION.md`. Tick reconciled 2026-05-18; sub-plan execution predates Phase 51.


### v2.1 — Test-debt + Server-error closure (milestone opened 2026-05-15, RE-OPENED 2026-05-16 for downstream cjm)

Work-order: 19 → 19.1 → 19a → 19b → **19.1 (close-out) → 19.2 → 19.3 → 19.4** (downstream-cjm batch added 2026-05-16 after Phase 19b proved e2e harness GREEN end-to-end). Hard ordering: 19.1 close-out FIRST (formalize the e2e GREEN proven through 19b); 19.2/19.3/19.4 are independent downstream cjm-tag flips and can run in any order.

- [x] **Phase 19: Server-error closure (production-fix)** — CLOSED-WITH-PARTIAL-DEBT 2026-05-15. SERVER-ERRORS.md Entries 1-5 closed; SR-19.1b carry. See Phase Details.
- [x] **Phase 19.1: reset-mail wiring (sendResetPassword)** — CLOSED 2026-05-16. Hook landed via commits 664f979/c8be1f5/e703314 (Plan 01, 10/10 unit tests GREEN); e2e GREEN proven through Phase 19b (`make e2e-cjm SCENARIO="@cjm-3.1"` → 1/1 GREEN 1.2s). Plan 02 round-trip extension deferred — `@cjm-3.1` already covers signup → request-reset → mailpit fetch → reset → re-sign-in.
- [x] **Phase 19a: compose infra hot-fix (byok-guard Dockerfile + cjm-lint @after-docker-up + Drizzle role + cucumber escape + storage overlay)** — CLOSED 2026-05-16. SERVER-ERRORS Entries 7+8+9 closed via commits 6771f46/700c837/1832f28/adf0e09/9fb0e6f/9ff5040.
- [x] **Phase 19b: Traefik STRUCT-05 host-split regression fix** — CLOSED 2026-05-16. 5 commits b2ebf24/62d87d7/6a5d638/e82a390/d9ce0ec. `@cjm-traefik-host-split[+web]` + `@cjm-3.1` all GREEN end-to-end through real Traefik+api+worker+mailpit. 3 memory lessons captured.
- [x] **Phase 19.2: stt-fixture (@cjm-4.1 transcribe-happy-path)** — CLOSED 2026-05-16. SERVER-ERRORS Entry 11 unfolded into a 3-layer cascade (client `?model=` query-param + multipart-form-field injection + LiteLLM config `groq/` provider prefix). Closing commits: `8680485` / `e80b047` / `c2a5e79` / `1f60ff0` / `c5112d9` / `9e1db63` / `c4a49d6`. Final verification: `make e2e-cjm SCENARIO="@cjm-4.1"` → 1/1 GREEN (1.8s).
- [x] **Phase 19.3: ba-i18n localized error envelopes (@cjm-1.4)** — CLOSED 2026-05-16. Better Auth `{message, code}` envelope intercepted in `better-auth-handler.ts` and re-serialized via `req.i18n.t("errors.<code>", { defaultValue: original })`. Production fix piggybacked Phase 33 research-cascade commit `c8c6b33`. 13 BA codes added to en+ru i18n bundles. Direct probe verification: `curl -H "Accept-Language: ru"` on POST `/api/auth/sign-up/email` with invalid email returns `{"message":"<russian>","code":"VALIDATION_ERROR"}`.
- [x] **Phase 19.4: locale-e2e (@cjm-6.1 en↔ru cookie set)** — CLOSED 2026-05-16. `tests/e2e-cjm/steps/locale.steps.ts` stubs replaced with real wire-level probes: GET `/sign-up` → POST `/api/locale` with `{locale: "ru"}` → assert Set-Cookie carries `NEXT_LOCALE=ru` → replay cookie on subsequent GET → assert Cyrillic copy via unicode-escape regex `/[А-яЁё]/`. Same approach for `@cjm-6.2` (now uses the host-split routing probe Phase 19b already proved). Bindings ASCII-only; production stack (apps/web `/api/locale` Phase 10-02 + Edge middleware) already in place — no production-side edits required.


### v2.2 — Pre-OSS Security & Hygiene (milestone opened 2026-05-16)

Source: `.planning/review/REVIEW-INDEX.md` — 11-agent pre-publication code review against `main` @ `1832f28`, surfacing **10 CRITICAL + 35 HIGH** findings spanning authentication, multi-tenant isolation, secret handling, and route hygiene. Work-order: **31 → 32 → 33 → 34 → 35 → 36 → 37 → 38 → 39 → 40 → 41** (strict sequential at milestone level; gsd-executor still parallelizes plan-level tasks inside each phase where the dependency graph allows). Hard ordering rationale: **Phase 31 (constitutional lockers) ships FIRST** — the six tsx-CLI linters (`lint-no-env-branches`, `lint-no-suppressions`, `lint-no-hardcode`, `lint-prod-readiness`, `lint-secret-shape-in-error`, `lint-shell-credential-interpolation`) + new DISCIPLINE Rules 11–14 are the GATE every subsequent v2.2 phase is tested against; a Phase 32–41 commit that violates a Phase 31 locker cannot land. **Phase 33 (envelope encryption) depends on Phase 32 (RLS fail-closed)** because both migrations touch the same Better Auth credential schemas — landing encryption-at-rest before RLS posture is fail-closed would leave the multi-tenant invariant violated against the new bytea columns. Phases 32–41 each depend on Phase 31. Phase 20 (compose+Helm guardrails, separately-scoped 2026-05-16 audit) is unrelated to v2.2 and runs in parallel.

- [x] **Phase 31: Constitutional Lockers (ships FIRST — the gate Phases 32–41 are tested against)** — Six tsx-CLI lockers (`tools/lint-no-env-branches.ts`, `lint-no-suppressions.ts`, `lint-no-hardcode.ts`, `lint-prod-readiness.ts`, `lint-secret-shape-in-error.ts`, `lint-shell-credential-interpolation.ts`) wired into Lefthook pre-commit + GitHub Actions `ci.yml` + `nightly.yml`; allowlists seeded with current main inventory (CI fails on net additions); `.planning/DISCIPLINE.md` Rules 11–14 amended + mirrored to `CLAUDE.md` in the SAME commit as the linter source; `make lint:lockers` target shipped. Source: LOCKER-01..09 (`.planning/REQUIREMENTS.md` v2.2 § "Constitutional lockers"). Each locker has its own vitest suite at ≥ 90/90/90/90; a synthetic violation PR is REFUSED by lefthook AND CI. **CLOSED 2026-05-16** across 8 sub-plans 31-01..31-08. 3 lockers (01/02/03) BLOCKING from day one; 3 lockers (04/05/06) shipped WARN-only with future-phase flips per the WARN→BLOCKING ledger in DISCIPLINE Rule 14 closing prose: LOCKER-04 → Phase 41 (operationally deferred from Plan 31-08 closure per `31-08-DECISIONS.md §D-1`; 47-route bulkfix backlog + 469 dead-export → Phase 38), LOCKER-05 → Phase 37, LOCKER-06 → Phase 36.a. Plan 31-08 Task 0 triage produced `31-08-DEFERRED.md` mapping every residual finding to its owning future phase. `pnpm lint:lockers` exits 0 on HEAD; `pnpm lint:lockers-allowlist-diff` exits 0 on HEAD.
- [x] **Phase 32: RLS fail-closed (CR-7 closure)** — CLOSED 2026-05-16. Migration `0018_rls_fail_closed.sql` reverses Phase 01's `0003_better_auth_tenant_defaults.sql:43-57` (the `ALTER ROLE openwhispr_app SET app.tenant_id` rolconfig default) AND drops the GUC-bound `tenant_id` column DEFAULT on the four Better Auth tables (HI-04 multiplier). RLS policies now use `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid` — the NULLIF cast makes the unset-GUC path unambiguously NULL (treated as FALSE), avoiding the `''::uuid` cast error that an AND-chain short-circuit would have surfaced through PG's RLS planner. Semantics: SELECT/UPDATE/DELETE without context = 0 rows (silent deny); INSERT without context = PG `42501` raise. Property test (**128 = 16 tenant-scoped tables × 4 ops × 2 ctx**) on real Postgres testcontainer + migration test + tenant-context JSDoc + `docs/security.md` §11 + e2e at `tests/e2e/rls-fail-closed.spec.ts`. Source: CRIT-FIX-01 (`.planning/review/data.md` CR-01 + HI-04).
- [x] **Phase 33: Envelope encryption wired to Better Auth credential columns (CR-8 closure)** — CLOSED 2026-05-16 via Plan 33-05 atomic closure commit. Plans 33-01..04 landed the additive sidecars, lens, boot validator, backfill, wrap-adapter wiring, and `0019b` SQL function drop; **Plan 33-05** ships the closing atomic commit bundling `0020_envelope_encrypt_secret_columns_drop_plaintext.sql` (drops the 8 plaintext columns + `sessions_token_unique` + `sessions_previous_token_idx`; flips `sessions.token_fp` to NOT NULL; promotes `sessions_token_fp_unique` to full UNIQUE), the Drizzle schema flip to bytea-only sidecars, `tools/lint-no-plaintext-secret-columns.ts` (DISCIPLINE Rule 15 / LOCKER-PLAINTEXT-COLS / LOCKER-08 — BLOCKING from day one; no `--warn-only`, no allowlist), `CLAUDE.md` Rule 15 mirror, lefthook + Makefile + ci.yml + nightly.yml wiring, `docs/security.md` §12 (encryption scope, `MASTER_KEK` env, KEK rotation runbook, AWS KMS / GCP KMS / Azure Key Vault / HashiCorp Vault provisioning, rollback rescue), deletion of the 5 Phase-32-deferred-Category-A obsolete tests in `0003_better_auth_tenant_defaults.test.ts` (replaced with a 3-introspection "net effect" suite), and the encryption-at-rest e2e test (`tests/e2e/encryption-at-rest.test.ts`). The 8 credentials (`account.{access_token, refresh_token, id_token, password}`, `verification.value`, `sessions.{token, previous_token}`, `oauth_state.code_verifier`) are envelope-encrypted at rest via AES-256-GCM with per-row DEK + KEK from `MASTER_KEK`. Phase 33-04 §D-05 ciphertext-on-disk assertion deferred-then-resolved by the 33-05 schema-side `bytea` declarations. Source: CRIT-FIX-02 (`.planning/review/data.md` CR-02).
- [x] **Phase 34: tenantPlugin retirement (CR-1 closure)** — CLOSED 2026-05-16. Audit (`.planning/phases/34-tenant-plugin-retirement/34-AUDIT.md`) confirmed zero production readers of `req.tenantId`. Deleted: `apps/api/src/middleware/tenant.ts` (plugin body + inline `declare module 'fastify' { tenantId: string }` augmentation), `apps/api/src/index.ts` import + registration, `apps/api/tests/unit/middleware/tenant.test.ts` (plugin unit tests), and the obsolete `vi.mock` line in `entrypoint-db-shape.test.ts`. E2E `tests/e2e/tenant-isolation.test.ts` (3/3 GREEN) proves forged / missing / array-valued `x-tenant-id` cannot decorate `req.tenantId`. Regression test `apps/api/tests/unit/__tests__/no-tenant-plugin-regression.test.ts` (3/3 GREEN) guards against future re-introduction. Phase 31 lockers (`pnpm lint:lockers`) exit 0. Source: CRIT-FIX-03 (`.planning/review/api-core.md` CR-01).
- [x] **Phase 35: api-routes-rest bundle (CR-2 + CR-3 + CR-4 closure)** — CLOSED 2026-05-16 via three atomic commits (`b9a4e6e`, `7b46659`, `79a6768`). **35.a** added `config: { auth: false }` to `apps/api/src/routes/{auth-providers,setup-state}.ts` (locale was already opted out in 19b/SR-19b.3); full-stack integration test boots `buildApp({auth, db})` and asserts 200 anonymously on all three URLs (CRIT-FIX-04). **35.b** replaced the `Headers.forEach`-only path in `apps/api/src/routes/better-auth-handler.ts` with `Headers.getSetCookie()` per-value emission + guarded forEach for non-Set-Cookie headers; two-cookie test asserts 2 independent `set-cookie` reply headers (no comma-joined signature) (CRIT-FIX-05). **35.c** wrapped `apps/api/src/routes/setup-admin.ts` step-4 role flip in compensating try/catch: DELETEs half-created user, UPDATEs `setup_state` back to `pending`, returns 503 `ADMIN_CREATE_FAILED` envelope; real-Postgres testcontainer regression with Proxy-wrapped owner pool that throws on the role-flip UPDATE only; existing 10 setup-admin tests continue to pass (CRIT-FIX-06). Phase 31 lockers exit 0.
- [x] **Phase 36: worker bundle (CR-5 + CR-6 closure) — CLOSED 2026-05-16** — Two sub-plans: **36.a** rewrote `apps/worker/src/jobs/audit-archive.ts` to use argv-array `spawn()` + PG* env vars (no bash, no dbUrl in argv); password+dbUrl scrubbed from thrown errors via `redactSecret()`; LOCKER-06 flipped from WARN-only to BLOCKING in same atomic commit (CRIT-FIX-07 / `worker.md` CR-01 closed). **36.b** extended `runIngestOnce(deps, {since,until,tenantId})` with an explicit-window SQL path filtering on `startTime >= since AND startTime < until` and tenant-scoped via owner-pool subquery; closure-captured result replaces the previous double-cast in `reconciliation-discrepancy.ts`; watermark not advanced in windowed mode (CRIT-FIX-08 / `worker.md` CR-02 closed). Atomic commits `92ece0d` + `d36818e`. 11 pre-existing test/tooling LOCKER-06 entries documented in `36-a-DECISIONS.md §D-1` (out of scope; non-production paths). `pnpm lint:lockers` exits 0; 77/77 worker job tests GREEN; coverage ≥ 90/90/90/90 on every diff file.
- [x] **Phase 37: LitellmUpstreamError bodyText truncation (CR-9 closure)** — `packages/litellm-client/src/errors.ts:31, 40` truncates `bodyText` at construction (`.slice(0, 200)`), makes the field `private readonly`, and overrides `toJSON()` to return `{name, message, status}` only — so pino's own-property serializer cannot exfiltrate full upstream bodies to Loki. **CLOSED 2026-05-16** across 3 sites (LitellmUpstreamError + PyannoteBadRequestError + PyannoteUpstreamError); LOCKER-05 flipped to BLOCKING in the same closing commit. Regression test asserts `JSON.stringify(new LitellmUpstreamError(500, 'x'.repeat(10000)))` < 500 bytes; pino structured-log contains no `bodyText` field. Source: CRIT-FIX-09 (`.planning/review/litellm-client.md` CR-01). Locker LOCKER-05 (`lint-secret-shape-in-error`) catches future regressions of the same class.
- [x] **Phase 38: @openwhispr/auth retirement (CR-10 closure)** — `packages/auth/` renamed `@openwhispr/auth` → `@openwhispr/auth-stub` (was already `private: true`); load-bearing namespace cannot be squat-published. `isPlaceholder()` export retained as Stryker mutation target. `vitest.config.ts:63` project name aligned. Audit clean: zero non-self importers before rename. **CLOSED 2026-05-16.** Commit `c843b8a`. See `.planning/phases/38-auth-pkg-retirement/38-SUMMARY.md`.
- [x] **Phase 39: wire-schemas HIGH sweep (HIGH-FIX-WIRE-01..04 closure) — CLOSED 2026-05-16** — Mechanical sweep across `packages/wire-schemas/`: (a) `.strict()` on every input schema (NoteInput, FolderInput, ConversationInput + nested messages, TranscriptionInput, StreamingUsageBody, WebSearchRequest, CreateApiKeyOptions); (b) `z.string().uuid()` / `.datetime({offset:true})` / `.url()` on every permissive output primitive; (c) `.max()` bounds on long-text body fields (256 KB content, 5 MB transcript/text, 16 KB prompt) + metadata records (bounded keys+scalar values, 4 KB stringified cap); (d) symmetrical enums (CloudNote.note_type, CloudTranscription.status, SttConfig.availableProviders, NoteRecordingConfig.allowedFormats) + `.int().nonnegative()` counts; diarization_enabled `0|1`. 66/66 wire-schemas tests GREEN; contract-tests 29/29 GREEN; downstream api routes 134/134 GREEN; lockers exit 0. Commit `a0ee7cb`. See `.planning/phases/39-wire-schemas-strict/39-SUMMARY.md`.
- [x] **Phase 40: byok-guard + contract-tests HIGH sweep (HIGH-FIX-BYOK-01..03 closure)** — (a) Package-boundary inversion: every wire schema currently imported from `@openwhispr/contract-tests` by `apps/api/src/routes/**` moves into `@openwhispr/wire-schemas`; `contract-tests` flipped to `private: true` (HIGH-FIX-BYOK-01); (b) `redactUrl` extended to mask query-string credentials (`api_key`, `token`, `key`, `code`, `secret`), AWS SigV4 `X-Amz-Signature`, URL userinfo, and bearer-token-shaped path segments (`sk-…`, `sk-ant-…`, `AIza…`, `AKIA…`); drift-as-failure parity test enumerates every `process.env.*_API_KEY` actually read by `apps/**/src/**` (HIGH-FIX-BYOK-02); (c) `fetchAndParse` envelope enforcement — the `typeof body === "object"` guard removed; non-JSON / empty body raises `MalformedUpstreamEnvelopeError` (HIGH-FIX-BYOK-03). Source: `.planning/review/byok-guard-contract-tests.md` HI-1..3.
- [x] **Phase 41: Residual HIGH sweep (HIGH-FIX-API-CORE / AGENT-STREAM / WEB / WORKER / DATA / LITELLM / SMALL closure)** — CLOSED 2026-05-16 across seven sub-plans 41.a–41.g (TDD RED → GREEN → REFACTOR atomic commits each). Two finale items deferred to v2.3 with rationale in `41-FINAL-DECISIONS.md`: (1) **LOCKER-04 BLOCKING flip** kept on `--warn-only` because 46 route-shape findings + 520 dead-export findings remain on HEAD — 41.b only closed `agent/stream`; bulk 46-route zod/rateLimit wire-up + per-package public-surface allowlist refactor are v2.3-sized work. (2) **6 Phase-32 Category-A/B test fixes** (`0003_better_auth_tenant_defaults.test.ts`, `bootstrap-roles.test.ts`, `settings-rls.test.ts`, `worker-rls-property.test.ts`, `audit-log-actions.test.ts`) kept on the 32-DEFERRED ledger — they assert pre-Phase-32 fail-open semantics that Phase 32 explicitly reversed; rewriting their assertion targets is a v2.3 test-debt phase, not residual HIGH sweep. Seven sub-plans, each RED → GREEN → REFACTOR atomic commit: **41.a** api-core — replace hardcoded `"00000000-..."` at `apps/api/src/auth.ts:330, 380` with `resolveDefaultTenantId()`; delete `apps/api/src/placeholder.ts` (HIGH-FIX-API-CORE / `api-core.md` HI-01..03); **41.b** `/api/agent/stream` — reconcile `DEFAULT_AGENT_MODEL` with LiteLLM config (single source of truth), add body zod validation, add per-user `rateLimit` (HIGH-FIX-AGENT-STREAM / `api-routes-transcriptions.md` HI-01..03); **41.c** web — app-level RSC role-check guard on `/admin/*` (defense-in-depth over Traefik basic-auth); remove `PLAYWRIGHT_DISABLE_SSR_PREFETCH` from 5 production RSC pages (HIGH-FIX-WEB / `web.md` HI-1..2); **41.d** worker — bare `pino()` replaced with shared redact factory in `index.ts` + `ingest-litellm-spend.ts`; reconciliation-daily-check loop bound corrected; OTel gauge callbacks read fresh `driftStore`; minutes-priced model `metadata.duration` validation + warn-log + counter metric (HIGH-FIX-WORKER / `worker.md` HI-1..4); **41.e** data — `migrate.ts` LiteLLM-init idempotency enforced; migration `0019` replaces 0005's TRUNCATE with idempotent UPSERT; account-token `expires_at` enforcement (HIGH-FIX-DATA / `data.md` HI-01..03; HI-04 closed by Phase 32); **41.f** litellm-client — `headersTimeout`/`bodyTimeout`/required `AbortSignal` on `chatCompletions`, `audioTranscriptions`, `passthrough`; SSRF dispatcher asserted at module load; model-alias drift fixed via single-source-of-truth read from `compose/litellm/litellm_config.yaml`; `streamOptions` spread allows caller opt-out of `include_usage` (HIGH-FIX-LITELLM / `litellm-client.md` HI-01..04); **41.g** small-pkgs — real en/ru locale bundles OR `packages/i18n` renamed to `-stub` (verify against Phase 10 coverage); CI parity test between `byok-guard` and `observability/redact` provider lists; `SMTP_SECURE` parser accepts `1`/`true`/`yes`/`on` case-insensitive (HIGH-FIX-SMALL / `small-pkgs.md` HI-01..03).

### v2.1 — QA discipline gates + CJM gap closure (added 2026-05-16 from .planning/qa-audit/)

Source plan: `~/.claude/plans/mellow-watching-hinton.md` + `.planning/qa-audit/2026-05-16-cjm-coverage.md` + `.planning/qa-audit/2026-05-16-test-layering.md`.

Work-order: **21 (lockers) → 22 (smoke) → 23 (BYOK matrix) → 24..29 (parallel CJM gap closures) → 30, 42, 43 (BYOK runtime, blocked on 23) → 44..49 (layering polish) → 50 (v3 deferral marker)**.

**Numbering note (post-rebase 2026-05-16):** When this v2.1 QA cascade was originally planned as Phase 21..39, slots 31..39 had not yet been spec'd. The overnight v2.2 autonomous run (Phase 31..41 — constitutional lockers + RLS fail-closed + Better Auth encryption + CR/HIGH closures from `.planning/review/`) claimed those slots before merge. Phases 21..30 here are unchanged from the original plan; Phases 31..39 in this cascade are renumbered to 42..50 to avoid collisions with the v2.2 work. Phase 21 here is "Anti-shortcut Locker Infrastructure" (CJM/coverage-discipline lockers) — distinct from Phase 31 "Constitutional Lockers" (LOCKER-01..06 production-safety lockers); the two locker programs are complementary and both are required.

- [x] **Phase 21: Anti-shortcut Locker Infrastructure (CRITICAL — must land before any other Phase 22+; complementary to Phase 31 Constitutional Lockers)** — CLOSED 2026-05-16. All 5 lockers present at `tools/lint-{gherkin-tags,playwright-config,steps-have-unit-tests,no-prod-edit-with-test-only-pr,coverage-floor-per-phase}.ts` with sibling `*.test.ts` ≥ 90/90/90/90, wired into pre-commit + CI + branch-protection. Summary at `.planning/phases/21-anti-shortcut-lockers/21-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 22: L1 Smoke layer (HIGH)** — CLOSED 2026-05-16. `tests/smoke/` ships 5 probes (health, transcribe-415, realtime-handshake, web-root, traefik-host-split) + `vitest.smoke.config.ts`. SUMMARY at `.planning/phases/22-smoke-layer/22-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 23: L2 BYOK provider matrix (HIGH)** — CLOSED 2026-05-16. SUMMARY at `.planning/phases/23-byok-provider-matrix/23-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 24: G8 cross-tenant RLS CJM (non-SSO)** — CLOSED 2026-05-16. SUMMARY at `.planning/phases/24-cross-tenant-rls-cjm/24-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 25: G5 agent-stream NDJSON CJM** — CLOSED 2026-05-16. SUMMARY at `.planning/phases/25-agent-stream-cjm/25-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 26: G6 web-search CJM (Tavily/Yandex via mock)** — CLOSED 2026-05-16. SUMMARY at `.planning/phases/26-web-search-cjm/26-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 27: G7 session refresh / set-auth-token CJM** — CLOSED 2026-05-16 (partial-RED — happy path GREEN; negative twin parked behind `@expected-red @after-phase-28-SESSION-EXPIRY`). SUMMARY at `.planning/phases/27-session-refresh-cjm/27-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 28: G3 diarization round-trip CJM** — CLOSED 2026-05-16. SUMMARY at `.planning/phases/28-diarization-cjm/28-SUMMARY.md`. Multi-speaker 2-speaker assertion deferred until fixture lands; single-speaker round-trip is sufficient. Tick reconciled 2026-05-18.
- [x] **Phase 29: G4 realtime WSS user-journey CJM** — CLOSED 2026-05-16. SUMMARY at `.planning/phases/29-realtime-wss-cjm/29-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 30: G1 LiteLLM virtual-key rotation CJM (depends on Phase 23)** — CLOSED 2026-05-16. SUMMARY at `.planning/phases/30-byok-key-rotation-cjm/30-SUMMARY.md`. Composed pattern coverage (create + revoke; no dedicated /rotate route). Tick reconciled 2026-05-18.
- [x] **Phase 42: G2 per-tenant STT/LLM override CJM (depends on Phase 23 + 19.2)** — CLOSED 2026-05-16 (full-RED scaffold; `@cjm-9.*` tagged `@expected-red @after-phase-51-WIRE-11-PUT` until `PUT /api/stt-config` route lands). SUMMARY at `.planning/phases/42-tenant-settings-cjm/42-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 43: G9 transcribe via corporate `LITELLM_BASE_URL` override CJM (depends on Phase 19.2)** — CLOSED 2026-05-16 (full-RED scaffold; `@cjm-byok-litellm.*` tagged `@expected-red @after-phase-44-MOCK-CORP-LITELLM` until second-mock container lands). SUMMARY at `.planning/phases/43-corp-litellm-cjm/43-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 44: L3 PR-time k6 mock load smoke (≤ 2 min)** — CLOSED 2026-05-16. `Makefile` `load-smoke` target + `.github/workflows/ci.yml` PR-only job + `tests/load/baselines/` + `tests/self-tests/load-smoke-cost-discipline.test.ts`. SUMMARY at `.planning/phases/44-load-smoke/44-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 45: L4 consolidate vitest configs** — CLOSED 2026-05-16. Architecture was already clean (audit-doc worry was based on stale state); `tests/self-tests/vitest-config-architecture.test.ts` 7/7 GREEN pins the architecture against future regression. SUMMARY at `.planning/phases/45-vitest-configs/45-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 46: L5 testcontainers cleanup self-test** — CLOSED 2026-05-16. `tests/self-tests/testcontainers-cleanup.test.ts` 6/6 GREEN (4 source-contract + 2 docker-gated runtime). SUMMARY at `.planning/phases/46-testcontainers-cleanup/46-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 47: L6 SSO step-string drift self-test** — CLOSED 2026-05-16. `tests/self-tests/sso-step-drift.test.ts` 3/3 vitest GREEN; exports `extractStepBindings` + `extractFeatureSteps` helpers; asserts (a) ≥ 12 placeholder bindings present, (b) ≥ 30% feature-step coverage by bindings, (c) step file is still placeholder-only. Summary at `.planning/phases/47-sso-step-drift/47-SUMMARY.md`. Update tick reconciled 2026-05-18 during Plan 51-19 closure sweep.
- [x] **Phase 48: L7 SR-19a.4 worker S3 normative fix** — CLOSED 2026-05-16. `compose/docker-compose.storage.yml` carries worker block mirroring api's S3_* injection; `tests/e2e-cjm/compose-overrides.yml` cleaned of non-normative worker S3_* block; `tests/self-tests/worker-s3-normative.test.ts` 3/3 GREEN. SUMMARY at `.planning/phases/48-worker-s3-normative/48-SUMMARY.md`. Tick reconciled 2026-05-18.
- [x] **Phase 49: L8 weekly @expected-red staleness alert** — CLOSED 2026-05-16. `tools/check-expected-red-staleness.ts` CLI + 12/12 vitest GREEN + `.github/workflows/expected-red-staleness.yml` Monday 09:07 UTC cron. SUMMARY at `.planning/phases/49-staleness-alert/49-SUMMARY.md`. **Completes the v2.1 QA cascade — all 19 phases (21-30 + 42-50) CLOSED.** Tick reconciled 2026-05-18.
- [x] **Phase 50: G10 billing/subscription CJM scaffold (deferred to v3)** — CLOSED 2026-05-16 (doc-only v3 deferral marker). `docs/customer-journeys.md` reserves `@cjm-billing-*` namespace; `.planning/deferred-items.md` carries G10 entry. SUMMARY at `.planning/phases/50-billing-v3-deferral/50-SUMMARY.md`. Tick reconciled 2026-05-18.

## Phase Details

### Phase 0: Repo Bootstrap & Constitutional CI
**Goal**: A fresh `git clone` lands in a repo where every constitutional discipline (TDD, CI, scanning, coverage, English-only) is already enforced — no retrofit possible.
**Depends on**: Nothing (first phase)
**Requirements**: TDD-01, TDD-02, CI-01, CI-02, CI-03, TEST-COV-01, TEST-MUTATION-01, DEVEX-01, DOCS-09
**Success Criteria** (what must be TRUE):
  1. A contributor can run `make dev` and `make test` from a clean clone and the full local suite passes.
  2. Every PR opened against `main` triggers GHA workflows (lint + typecheck + unit + integration + e2e + contract + license-scan + gitleaks + Trivy + CodeQL + container-scan) and `main` is branch-protected against unchecked merges.
  3. CI fails any PR that drops API-tier coverage below 85% lines / 80% branches, that introduces a non-English string in a source artifact, or that lands production code without a preceding test commit (PR template "tests first" checklist enforced).
  4. Mutation testing (Stryker) runs on auth, multi-tenancy, and virtual-key modules and fails PRs on score regression — even though those modules don't yet exist, the harness scaffolding is wired and runs against placeholder code.
  5. All CI checks green on the bootstrap PR; tests written first (TDD).
**Plans**: 6 plans (3 waves)
- [x] 00-01-PLAN.md — Workspace + TS + Biome + Lefthook + commitlint scaffold (Wave 1)
- [x] 00-02-PLAN.md — Vitest 4 + Stryker 9 + skeleton workspaces with placeholders (Wave 1)
- [x] 00-03-PLAN.md — tools/lint-english.ts, lint-tdd.ts, Makefile, docker-compose placeholder, branch-protection script (Wave 1)
- [x] 00-04-PLAN.md — GHA workflows (ci.yml, security.yml, nightly.yml, release.yml) + dependabot + PR template (Wave 2)
- [x] 00-05-PLAN.md — Constitutional self-tests + harness-self-check CI job (Wave 2)
- [x] 00-06-PLAN.md — CLOSED (SUMMARY at .planning/phases/00-repo-bootstrap-constitutional-ci/00-06-SUMMARY.md); README/CONTRIBUTING/SECURITY/COC/operations + ADRs 0000-0003 + integration smoke (Wave 3). Tick reconciled 2026-05-18.
**UI hint**: no

### Phase 1: Core Infra & Multi-Tenant Data
**Goal**: A single `docker compose up` brings up the full data plane (Postgres 17 + PgBouncer transaction-mode + Redis/Valkey + MinIO + Traefik 3 + OTel Collector + Loki + Tempo + Mimir + Grafana) with row-level multi-tenancy enforced at the database and a refuse-to-start gate on default secrets.
**Depends on**: Phase 0
**Requirements**: DATA-01, DATA-02, DATA-05, DATA-06, DATA-07, TEST-MIGRATION-01, TEST-RLS-01, PROVIDER-02
**Success Criteria** (what must be TRUE):
  1. An operator runs `bootstrap.sh && docker compose up` and lands on a healthy stack where every required secret was generated (the runtime aborts on any known-default value like `changeme` or `sk-1234`).
  2. The `default` tenant exists after first migration; every `tenant_id`-bearing table has `ENABLE ROW LEVEL SECURITY` and a policy referencing `current_setting('app.tenant_id')`; an RLS-introspection lint blocks any future migration that adds an unguarded table.
  3. A property test (TEST-RLS-01) runs random tenant pairs against every queryable model and observes zero cross-tenant reads or writes; a `SET LOCAL` framework middleware contract test interleaves 100 tenant-A / tenant-B queries through PgBouncer transaction-mode without leakage.
  4. `make backup` produces a KEK/DEK-encrypted dump; `make restore` reconstructs the database in one command; both run in CI on every `migrations/` change, including forward-apply + rollback verification on real Postgres.
  5. MinIO is reachable on the compose network with a per-tenant bucket-prefix convention documented; sensitive columns are encrypted at rest via the KEK/DEK envelope (KEK from env / Vault / KMS adapter).
  6. Tests written first (TDD); all CI checks green.
**Plans**: 6 plans (3 waves)
- [x] 01-01-PLAN.md — Compose stack expansion (10 services with healthchecks) + observability config + Traefik file provider + PgBouncer transaction-mode (Wave 1)
- [x] 01-02-PLAN.md — bootstrap.sh refuse-to-start gate + entrypoint defense-in-depth + deny-list self-test (Wave 1)
- [x] 01-03-PLAN.md — Drizzle schema + first migration with FORCE RLS + role init (openwhispr_owner BYPASSRLS / openwhispr_app RLS-subject) + two-pool client factory (Wave 2)
- [x] 01-04-PLAN.md — Tenant-context middleware (set_config app.tenant_id) + Fastify hook + KEK/DEK envelope encryption + KeyProvider env/Vault/KMS (Wave 2)
- [x] 01-05-PLAN.md — RLS-introspection lint + TEST-RLS-01 property test (fast-check 100 tenant pairs through PgBouncer) + GHA lint-rls/test-migration jobs + branch protection (Wave 3)
- [x] 01-06-PLAN.md — Backup/restore via age envelope encryption + nightly round-trip + operations.md + storage.md (Wave 3)
**UI hint**: no

### Phase 01.2: Fix postgres init env passthrough — POSTGRES_OWNER_PASSWORD and POSTGRES_APP_PASSWORD not propagated to 00-roles.sh; uncovered after Phase 02.1 unblocked api/migrate builds; postgres exits 2 on first init (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 1
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 01.2 shipped (SUMMARY at .planning/phases/01.2-*/01.2-01-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact. Tick reconciled 2026-05-18.

### Phase 2: Auth + Wire-API Skeleton + Conformance Harness
**Goal**: A desktop client can complete the full auth lifecycle (sign-up / sign-in / verification-poll / delete-account) against the server over any channel scheme it presents, receive opaque bearer tokens that rotate cleanly without logging the user out, and the wire-contract conformance suite (CONTRACT-01) is the canonical regression net for everything subsequent phases add.
**Depends on**: Phase 1
**Requirements**: WIRE-01, WIRE-02, WIRE-03, WIRE-04, WIRE-17, WIRE-18, WIRE-19, WIRE-20, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, PROVIDER-03, PROVIDER-04, CONTRACT-01
**Success Criteria** (what must be TRUE):
  1. A user signs in with email+password (no external IdP configured) and receives a bearer token ≥30 days old; the same code path also accepts an OIDC provider plugged in via Better Auth's OAuth-Provider plugin (Google Workspace / Azure AD / Okta / generic OIDC) selected by env/YAML, with no server-side allowlist.
  2. The OAuth final redirect emits `<scheme>://?bearer_token=<token>` echoing the **exact** scheme received in the `callbackURL` query parameter — verified against a multi-channel matrix (`openwhispr` / `openwhispr-dev` / `openwhispr-staging` / arbitrary `OPENWHISPR_PROTOCOL` override) — and never hardcodes a scheme.
  3. Every authenticated endpoint accepts `Authorization: Bearer <opaque>` AND session cookies; every non-2xx response carries the global `{"error":"<human-readable>"}` envelope; every invalid/expired token receives HTTP **401** (not 200-with-error); every externally reachable port refuses plaintext HTTP.
  4. Token rotation via `set-auth-token` overlaps the old token by ≥5 minutes; a concurrent-request rotation contract test confirms that R1/R2/R3 issued mid-rotation never see a 401 cascade.
  5. The CONTRACT-01 conformance suite is runnable via `make contract-test BACKEND_URL=...`, asserts byte-for-byte spec compliance for the auth-lifecycle endpoints + `/api/health` + global conventions, and is wired as a required GHA check on every PR — Phases 3, 4, 5 will extend it endpoint by endpoint.
  6. `/api/check-user`, `/api/auth/verification-status` (with 5s polling carve-out from rate limiting), `/api/auth/delete-account`, `/api/health` (3s timeout, body unread) all conform; `x-openwhispr-source: desktop` is preserved/observable.
  7. SMTP email provider is wired for verification + admin notifications; tests written first (TDD); all CI checks green.
**Plans**: 7 plans (4 waves)
- [x] 02-01-PLAN.md — Better Auth wiring + migrations 0001/0002 + scheme/cookie/token-rotation libs (Wave 1)
- [x] 02-02-PLAN.md — API container Dockerfile + compose api/migrate/mailpit services + closes Phase 1 D-08 (Wave 1)
- [x] 02-03-PLAN.md — 4 wire endpoints + global error envelope + dual-auth + cookie-only middleware + zod source of truth (Wave 2)
- [x] 02-04-PLAN.md — HTTPS-only at Traefik + @fastify/rate-limit with envelope-conformant 429 + nodemailer SMTP + AUTH-06 logs (Wave 2)
- [x] 02-05-PLAN.md — OAuth shim + callback redirect + token rotation overlap (5-min) + cookie host scoping (Wave 3)
- [x] 02-06-PLAN.md — CONTRACT-01 conformance suite (8 test files) + fixture-idp + GHA contract-test job + branch protection (Wave 3)
- [x] 02-07-PLAN.md — Auth docs (auth.md / oidc-operator-config.md / channel-scheme-override.md) + planning state finalization + Phase 1 SC#1 closure + integration smoke (Wave 4)
**UI hint**: no

### Phase 02.22: TLS bootstrap two-tier CA chain — bootstrap.sh emitted self-signed end-entity cert (CA:FALSE); Node 24 + OpenSSL 3 reject as trust anchor; contract-test-runner could not probe https://api.localhost from openwhispr_internal (DEPTH_ZERO_SELF_SIGNED_CERT) → 8/9 test files skip on REACHABLE gate; surfaced during Phase 3 live e2e validation (INSERTED + CLOSED 2026-05-11)

**Goal:** Rewrite bootstrap as root-CA (CA:TRUE, keyCertSign) signing leaf (CA:FALSE, serverAuth); compose contract-test-runner mounts/trusts root-ca.crt instead of local.crt; Node fetch from in-cluster trusts the issuing CA properly.
**Requirements:** SECURITY-01 (TLS only), TEST-CONTRACT-01 (in-cluster runner reachability)
**Depends on:** Phase 1 (cert mounting), Phase 02.15 (network aliases)
**Plans:** 1 inline (TDD: failing tests first, then bootstrap.sh + compose update)

Plans:
- [x] inline — `tests/unit/bootstrap-cert-gen.test.ts` (13 tests: X509.ca true/false, issuer chain, openssl verify, idempotency) + `tests/integration/traefik-network-alias.test.ts` (9 tests, flipped to root-ca.crt mount) + tools/bootstrap.sh rewrite + docker-compose.yml runner cert mount + RUN_E2E/MOCK_DIARIZATION/OPENWHISPR_TEST_ROUTES env passthrough. Commits 344f4dd / 546096c / 97da5c1.

### Phase 02.21: Group C residuals — 3 pre-existing carries: conventions 404 envelope (got 401), delete-account cookie cascade (got 200 expected 401), token-rotation suite (sign-in 403 in beforeAll); diagnose-then-fix; potentially 3 distinct sub-fixes (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.21 shipped (SUMMARY at .planning/phases/02.21-*/02.21-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.20: Group I — verification-status test for unverified user; signInFixture verified:false branch flips email_verified=true via owner pool, signs in to get real BA cookie, flips back to false in try/finally; exploits BA getSession not re-checking emailVerified; preserves prod requireEmailVerification:true posture (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.20 shipped (SUMMARY at .planning/phases/02.20-*/02.20-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.19: Group F E2E closure — configure Traefik forwardedHeaders.trustedIPs for openwhispr_internal docker network so contract-test runner-injected X-Forwarded-For survives the edge to Better Auth rate-limiter; Phase 02.18 unit fix is correct, this enables E2E delivery (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.19 shipped (SUMMARY at .planning/phases/02.19-*/02.19-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.18: Group F — Better Auth rate-limiter cant see client IP behind Traefik (real prod security defect: WARN log Rate limiting skipped); recommended Option B: configure advanced.ipAddress.ipAddressHeaders + per-fixture unique X-Forwarded-For in signInFixture; fixes prod abuse hole AND unblocks 2 verification-status tests (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.18 shipped (SUMMARY at .planning/phases/02.18-*/02.18-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.17: Group E variant — mycorp-whispr scheme test 400 because OPENWHISPR_PROTOCOL accepts only single override; extend parser to comma-list + add mycorp-whispr to contract-test compose env (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.17 shipped (SUMMARY at .planning/phases/02.17-*/02.17-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.16: Group H NEW — api OAuth callback completion 500 (3 oauth-redirect tests); Group G transport closed but server-side handler errors; likely Better Auth genericOAuth token-exchange against fixture-idp /token shape mismatch OR mintBearer issue; needs api debug log capture + diagnosis (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.16 shipped (SUMMARY at .planning/phases/02.16-*/02.16-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.15: Group G — api 302s to https://api.localhost from inside cluster ECONNREFUSED; advisor recommends Option B network-alias variant: add aliases:[api.localhost,auth.localhost] to traefik service network block + mount cert + update-ca-certificates in runner image + flip runner BACKEND_URL/AUTH_URL to https://api.localhost; preserves canonical-public URL byte-for-byte (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.15 shipped (SUMMARY at .planning/phases/02.15-*/02.15-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.14: Group E — host-side contract-test runner cant resolve docker-internal fixture-idp DNS; advisor research recommends Option C: contract-test runner inside compose network (mirror Phase 02.3 seed pattern); one URL one issuer no /etc/hosts mutation (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.14 shipped (SUMMARY at .planning/phases/02.14-*/02.14-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.13: OIDC env provisioning for contract-test profile — apps/api auth.ts silently disables genericOAuth when OIDC_ISSUER_URL/CLIENT_ID/CLIENT_SECRET unset; contract-test profile fixture-idp running on http://fixture-idp:9000 but api container has no env vars pointing at it; result: 5 OAuth contract tests get 503; mechanical fix: add OIDC_* env vars to api service in contract-test profile context (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.13 shipped (SUMMARY at .planning/phases/02.13-*/02.13-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.12: Better Auth session.token field missing — Phase 02 Plan 01 designed sessions.tokenHash bytea (AUTH-04) but BA v1.6.9 expects plain session.token text; advisor research recommends Option C (drop tokenHash, use plain token, defer hash-only to v2 hardening); preserves AUTH-04 5-min overlap contract (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.12 shipped (SUMMARY at .planning/phases/02.12-*/02.12-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.10: Group A — signInFixture helper missing Origin header → 403 MISSING_OR_NULL_ORIGIN on 4 contract tests; mirror seed-time origin: baseUrl pattern from Phase 02.3 conformance.ts; TDD per TDD-01b (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.10 shipped (SUMMARY at .planning/phases/02.10-*/02.10-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.9: Better Auth email-validator rejects @local fixtures — packages/data/src/seed/conformance.ts uses rotation-test@local + similar @local addresses; Better Auth v1.6.9 hardened email validator rejects (no TLD per RFC 5321/5322); surfaced by Phase 02.8 contract-test E2E after UUID mismatch closed. Trivial fix: rewrite 3 fixture emails to @example.com (RFC 2606 reserved TLD for examples). TDD: extend seed-signup-non-2xx-loud test or add fixture-email-rfc-compliance test (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.9 shipped (SUMMARY at .planning/phases/02.9-*/02.9-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.8: Better Auth ID type vs Postgres uuid mismatch — Better Auth v1.6.9 default generateId emits 32-char base32 strings (e.g. '04xaRzi0ScgyXxWRtKwGG74OkqNZb0yO') but users.id (and likely sessions.id, account.id, verification.id) are Postgres uuid columns → 22P02 parse error → 422 from /api/auth/sign-up/email; surfaced by Phase 02.7-04 loud-fail discipline + 02.7-06 E2E. Discuss-phase + research-first required: A) advanced.generateId override in auth.ts, B) schema migration uuid→text on all 4 BA tables incl FK cascade, C) defensive create-user hook (rejected as workaround). Need investigation of related id columns (sessions, account, verification, oauth_state) before locking. BLOCKS Phase 02.7 plan 06+07 closure (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.8 shipped (SUMMARY at .planning/phases/02.8-*/02.8-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.7: Phase 02 contract-test conformance gaps — 13/26 contract tests RED after Phase 02.5+02.6 unblocked the auth surface; new architectural defects in signInFixture (HTTP 404 — endpoint missing or path mismatch), Bearer-invalid handling (returns 500 instead of contract-spec 401), OAuth final-redirect (returns 200 instead of channel-scheme custom-protocol — was deferred per 02.5 D-06 / Phase 02 Plan 05 territory), check-user contract (exists:true returning false — likely RLS visibility issue), AND Makefile test harness uses BACKEND_URL=http:// against Traefik HTTPS-only ingress causing 308→silent-skip; full discuss-phase + research-first plan required (no yolo) (INSERTED)

**Goal:** Close the 13/26 contract-test conformance gaps left after Phases 02.5+02.6 unblocked the auth surface. Six discrete defects, all Phase-02-internal: D-01 OAuth channel-scheme mintBearer (real internalAdapter path, not the broken auth.handler delegation); D-02 bearer-invalid envelope hybrid (dual-auth try/catch + setErrorHandler APIError recognizer); D-03 A+B check-user lifecycle (seed signUp() loud-fail) + lower(email) functional unique index; D-04 AUTH_URL default collapse; D-05 cert-gen in bootstrap.sh + HTTPS contract-test path. End state: `make contract-test` 25/26 GREEN + 1 deliberate skip (cookie-host split-host topology), 02-HUMAN-UAT.md Item 1 flipped without scope qualifier. Plan 06 STOPPED on first run when D-03A loud-fail surfaced a Better Auth uuid-id-generator vs uuid-column impedance mismatch (masked under the original 13 by silent-swallow); the cascade tail (Phases 02.8 → 02.21) closed every additional defect that surfaced. Plan 06 RE-RUN GREEN on 2026-05-10.
**Requirements**: TDD-01, TDD-01b, AUTH-A1, AUTH-02, WIRE-01, WIRE-17, WIRE-18, WIRE-19, WIRE-20, CONTRACT-01
**Depends on:** Phase 2
**Plans:** 7/7 plans executed (COMPLETE)

Plans:
- [x] 02.7-01-PLAN.md — Wave 1: D-04 + D-05 — bootstrap cert-gen + https contract-test + AUTH_URL collapse + probe loud-fail
- [x] 02.7-02-PLAN.md — Wave 2: D-01 — real mintBearer via internalAdapter + IdP token exchange (closes AUTH-A1)
- [x] 02.7-03-PLAN.md — Wave 2: D-02 — bearer-invalid 401 envelope via dual-auth try/catch + setErrorHandler APIError recognizer
- [x] 02.7-04-PLAN.md — Wave 2: D-03A — seed signUp() loud-fail on non-duplicate 4xx + preflight row check
- [x] 02.7-05-PLAN.md — Wave 2: D-03B — migration 0004 functional unique on lower(email) + check-user lower() lookup
- [x] 02.7-06-PLAN.md — Wave 3: contract-test 25/26 GREEN witness + 4 reverse-patch experiments (RE-RUN after cascade closure)
- [x] 02.7-07-PLAN.md — Wave 3: phase summary + UAT flip (no qualifier) + STATE/ROADMAP refresh

### Phase 02.6: Fix apps/api/src/index.ts entrypoint — passes makeAppDb() wrapper {db, pool} to buildAuth/buildApp instead of destructuring the .db Drizzle instance; surfaced by Phase 02.5-04 contract-test (TypeError: db.select is not a function in better-auth findOne); one-line destructure fix + remove the 'as never' casts that hid the type mismatch + plus stale-volume cleanup helper (make clean-stack) for repeatable contract-test runs after secret rotation; TDD per TDD-01b (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.6 shipped (SUMMARY at .planning/phases/02.6-*/02.6-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.5: Better Auth drizzle schema — drizzleAdapter missing schema option AND @openwhispr/data lacks Better Auth required tables (user/session/account/verification — singular names per Better Auth convention vs our pluralized users/sessions/accounts/verifications); add tables, pass schema to drizzleAdapter(db, {provider:pg, schema}), re-run drizzle migrate, make contract-test passes end-to-end → 02-HUMAN-UAT.md Item 1 finally flippable; TDD per CLAUDE.md TDD-01b (≥90% on touched files) (INSERTED)

**Goal:** Close the Better Auth ↔ Drizzle binding gap surfaced at Phase 02.3 — `drizzleAdapter` receives an explicit canonical-name schema map (D-01), and a new migration 0003 binds `app.tenant_id` per openwhispr_app connection (D-02) plus column DEFAULTs on Better Auth tables (D-03), so Better Auth's tenant-blind INSERTs satisfy FORCE RLS transparently. After this phase, `make contract-test` runs end-to-end (signup → verify-skipped → signin → token rotation), unblocking 02-HUMAN-UAT.md Item 1.
**Requirements**: TDD-01, TDD-01b, DATA-01, AUTH-01, AUTH-04, CONTRACT-01
**Depends on:** Phase 2
**Plans:** 3/5 plans executed

Plans:
- [x] 02.5-01-PLAN.md — Wave 1: RED tests (auth-schema-mapping unit + 0003 testcontainer integration) + contract-test RED baseline capture
- [x] 02.5-02-PLAN.md — Wave 2: migration 0003_better_auth_tenant_defaults.sql (D-02 ALTER ROLE + D-03 column DEFAULTs) + journal append; turns Plan 01 integration test GREEN
- [x] 02.5-03-PLAN.md — Wave 2: apps/api/src/auth.ts explicit schema map (D-01); turns Plan 01 unit test GREEN; coverage ≥90%
- [x] 02.5-04-PLAN.md — CLOSED (SUMMARY at .planning/phases/02.5-*/02.5-04-SUMMARY.md); Wave 3: end-to-end `make contract-test` run + capture GREEN witness. Tick reconciled 2026-05-18.
- [x] 02.5-05-PLAN.md — CLOSED-PARTIAL (parent phase 02.5 closure status: CLOSED-PARTIAL 2026-05-09 per .planning/phases/02.5-*/02.5-SUMMARY.md; Item 1 flipped to "pass-partial" with documented 11/26 contract pass + 13/26 carry-over to Phase 02.7); SUMMARY + 3-scenario reverse-patch evidence + UAT flip. Tick reconciled 2026-05-18.

### Phase 02.4: Backfill TDD test coverage for Phase 02.x Yolo cascade — 6 production fixes (commits 451e9b3, 26eaa69, 7ccb8bb, 059b948, 5f274e6) shipped without per-fix tests, violating constitutional ≥90% per-phase coverage floor; test-only phase (no production code changes); aggregate coverage on touched files must reach ≥90%; vitest+CI green; MUST land before Phase 02.5 better-auth drizzle schema (INSERTED)

**Goal:** Backfill TDD test coverage for the Phase 02.x Yolo cascade. Six production fixes (commits 451e9b3, 26eaa69, 7ccb8bb, 059b948, 5f274e6) shipped without per-fix tests, violating PROJECT.md TDD-01b (≥90% per-phase coverage). Test-only phase — zero production code changes. Aggregate coverage on touched files reaches ≥90%; vitest+CI green; reverse-patch evidence per test group. MUST land before Phase 02.5.
**Requirements**: TDD-01, TDD-01b
**Depends on:** Phase 2
**Plans:** 4/6 plans executed

Plans:
- [x] 02.4-01-PLAN.md — G1: tools/bootstrap.sh interpolate + three-way value semantics (Wave 1)
- [x] 02.4-02-PLAN.md — G3: api Dockerfile no-pnpm-deploy + tsup external pg/pg-native/better-auth (Wave 1)
- [x] 02.4-03-PLAN.md — CLOSED (parent phase SUMMARY at .planning/phases/02.4-*/02.4-SUMMARY.md aggregates Wave 1 completion); G5a + G5b: better-auth handler bridge + AUTH_TRUSTED_ORIGINS_EXTRA (Wave 1). Tick reconciled 2026-05-18.
- [x] 02.4-04-PLAN.md — G2: postgres role init idempotency via testcontainer (Wave 2)
- [x] 02.4-05-PLAN.md — G4: docker compose obs-only stack-up smoke (Wave 2)
- [x] 02.4-06-PLAN.md — CLOSED (parent phase SUMMARY at .planning/phases/02.4-*/02.4-SUMMARY.md); Aggregate coverage report + reverse-patch verification + atomic commit + SUMMARY (Wave 3). Tick reconciled 2026-05-18.

### Phase 02.3: Add seed compose service for contract-test — make contract-test seed:conformance step runs from host shell with internal-only postgres hostname; needs in-network compose service like migrate (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.3 shipped (SUMMARY at .planning/phases/02.3-*/02.3-01-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.2: Externalize pg native module from api tsup bundle — Phase 02.1 noExternal pulled pg in via drizzle and broke ESM (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.2 shipped (SUMMARY at .planning/phases/02.2-*/02.2-01-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 02.1: Fix apps/api/Dockerfile pnpm v10 ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE — replace broken pnpm deploy with proper enterprise fix (NOT --legacy); inject-workspace-packages or multi-stage Dockerfile; api+migrate images build clean, full stack up --wait succeeds, no workspace regressions, unblocks Phase 01.1 Plan 05 (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [x] CLOSED — phase 02.1 shipped (SUMMARY at .planning/phases/02.1-*/02.1-01-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact, never expanded. Tick reconciled 2026-05-18.

### Phase 3: LiteLLM Integration + Bundled OSS Models
**Goal**: Out of the box, an OSS operator gets a working `/api/transcribe` and `/api/reason` against bundled open-source models (faster-whisper + pyannote + Speaches-compatible realtime image) via a bundled LiteLLM Proxy ≥1.83.7; a corporate operator overrides `LITELLM_BASE_URL` + `LITELLM_VIRTUAL_KEY` and hits the same wire surface against their internal LiteLLM (the shape described in `speaches-audio.md`) with zero code changes.
**Depends on**: Phase 2
**Requirements**: WIRE-05, WIRE-06, LITELLM-01, LITELLM-02, LITELLM-03, LITELLM-04, LITELLM-05, LITELLM-06, LITELLM-07, PROVIDER-01, DATA-03
**Success Criteria** (what must be TRUE):
  1. With no env overrides set, `docker compose up` starts the bundled LiteLLM v1.83.7-stable+ container wired to `Systran/faster-whisper-large-v3` for transcriptions, `pyannote/speaker-diarization-3.1` for diarization (HF token required at first run), and a Speaches-compatible open image for `WSS /v1/realtime` — and `POST /api/transcribe` end-to-end against this stack returns the documented JSON shape (`{text, wordsUsed, wordsRemaining, plan, limitReached:false, sttProvider, sttModel, ...}`).
  2. Setting `LITELLM_BASE_URL` + `LITELLM_VIRTUAL_KEY` (or admin master key) in env disables the bundled LiteLLM container (compose profile) and routes all STT/LLM/Realtime traffic to the operator's existing LiteLLM Proxy — the wire surface for `/api/transcribe` and `/api/reason` is identical, verified by a parametrized contract-suite run against both modes.
  3. Per-user LiteLLM virtual keys are minted on first sign-in via `/key/generate` with alias `user-<userId>`; no per-user budget caps are set (corporate users are unlimited); rotation occurs on tenant config change.
  4. The three audio routes (`POST /v1/audio/transcriptions`, `POST /v1/audio/diarization` pass-through, `WSS /v1/realtime`) are reachable through LiteLLM with 3600s ingress read/send timeouts on the realtime route.
  5. `POST /api/reason` returns `{text, model, provider, promptMode, matchType}` against the configured cloud LLM via LiteLLM; `limitReached` is always `false` in v1 (schema preserved); the usage ledger records `request_id`-idempotent rows for transcribe minutes + reason tokens, observability only with no enforcement.
  6. LiteLLM spend logs are ingested into the platform usage ledger via a BullMQ-driven sync (every 30s); pass-through endpoints (diarization) are not metered by LiteLLM natively and we surface only what LiteLLM gives us — no nginx-log scraping in v1.
  7. `docs/litellm-target-spec.md` exists (derived from `speaches-audio.md`) and documents both the bundled-default and corporate-override LiteLLM configurations including model definitions, virtual-key auth, `pass_through_endpoints` for diarization, realtime mode, and 3600s ingress timeouts.
  8. CONTRACT-01 extended for `/api/transcribe` and `/api/reason`; tests written first (TDD); all CI checks green.
**Plans**: 10 plans (4 waves)
- [x] 03-01-PLAN.md — Wave 0: Wire-contract extraction + LiteLLM stack-up (sidecar + separate `litellm` DB + bundled config)
- [x] 03-02-PLAN.md — Wave 0: contract-mock LiteLLM config + request_id metadata spike + audio fixture + Phase-3 zod schemas
- [x] 03-03-PLAN.md — Wave 1: packages/litellm-client real client (master-key + user param + metadata header injection; PROVIDER-01 single endpoint abstraction)
- [x] 03-04-PLAN.md — Wave 2: POST /api/transcribe (multipart streaming + ledger idempotent + 503-on-missing-key)
- [x] 03-05-PLAN.md — Wave 2: POST /api/reason (default qwen3.5-plus + user-attribution + ledger reason_tokens)
- [x] 03-06-PLAN.md — Wave 2: Diarization endpoint (pass-through OR 503-only fallback per Plan 01 outcome)
- [x] 03-07-PLAN.md — Wave 2: WSS /v1/realtime (Fastify wsUpstream + auth preHandler + Traefik 3600s)
- [x] 03-08-PLAN.md — Wave 3: apps/worker BullMQ spend-ingest job (30s scheduler + co-tenant Postgres read + idempotent UPSERT)
- [x] 03-09-PLAN.md — Wave 3: docs/litellm-target-spec.md + docs/litellm-mock-mode.md + Makefile e2e-test + README quickstart
- [x] 03-10-PLAN.md — Wave 3: cross-cutting contract tests (PROVIDER-01 override + Pitfall #8 503-not-401 + DATA-03 idempotency) + nightly e2e CI job
**UI hint**: no

### Phase 4: Streaming + Realtime
**Goal**: A desktop client opens an NDJSON agent stream and sees the first line within 500ms of the first server token through the full ingress chain (no buffering anywhere) and holds a WSS realtime session for ≥1h without ingress-timeout disconnects.
**Depends on**: Phase 3
**Requirements**: WIRE-07, WIRE-13, WIRE-14, WIRE-15, SCALE-05
**Success Criteria** (what must be TRUE):
  1. `POST /api/agent/stream` returns `Content-Type: application/x-ndjson` and a first-line-latency contract test confirms < 500ms first-line through full Traefik + API + LiteLLM chain — explicit `res.flush()` per line, `X-Accel-Buffering: no`, per-route `proxy_buffering off` confirmed by a buffering-injection negative test.
  2. A 65-minute synthetic WSS smoke test against `WSS /v1/realtime` survives end-to-end with zero ingress-timeout disconnects (3600s read/send timeouts on the realtime route).
  3. `POST /api/streaming-token` mints AssemblyAI streaming tokens from the server-held key (or returns 503 when AssemblyAI is not configured); `POST /api/deepgram-streaming-token` does the same for Deepgram; `POST /api/openai-realtime-token` mints OpenAI Realtime tokens with `streams=2` and returns `clientSecrets[]`.
  4. CONTRACT-01 extended for all four streaming/realtime endpoints (NDJSON line-flush behavior, gating-503 shape, `streams=2` payload); tests written first (TDD); all CI checks green.
**Plans**: 10 plans (5 waves)
- [x] 04-01-PLAN.md — Wave 0: SSE fixture corpus + provider shape spikes + mock-realtime skeleton + RED test stubs
- [x] 04-02-PLAN.md — Wave 1: SSE→NDJSON parser + tool-call accumulator (TDD pure utilities)
- [x] 04-03-PLAN.md — Wave 1: AssemblyAI + Deepgram token-mint routes + _call-provider helper
- [x] 04-04-PLAN.md — Wave 1: OpenAI Realtime token-mint route with parallel-mint Promise.all (streams=2)
- [x] 04-05-PLAN.md — Wave 1: Traefik websecure-realtime entrypoint :8443 + dynamic.yml router binding + 8443 port mapping
- [x] 04-06-PLAN.md — Wave 2: /api/agent/stream route handler + tool-translation helpers + buildAllRoutes wiring
- [x] 04-07-PLAN.md — Wave 2: hermetic mock-realtime WS server + e2e compose overlay + realtime.ts D-27 tightening
- [x] 04-08-PLAN.md — Wave 3: CONTRACT-01 extension (4 files) + buffering-injection negative-control trio + per-user rate-limit isolation
- [x] 04-09-PLAN.md — Wave 3: e2e first-line-latency test + hermetic 5-min WSS soak through real Traefik :8443
- [x] 04-10-PLAN.md — Wave 4: nightly-realtime-soak GHA workflow (65-min live OpenAI) + operator docs for :8443 and new env vars
**UI hint**: no

### Phase 5: Operational Endpoints + CRUD Resource Families
**Goal**: The OpenWhispr desktop client (authoritative reference: `~/openwhispr/src/services/*.ts`) operates end-to-end against this server. Phase 5 ships the six operational endpoints (web-search, streaming-usage, usage, stt-config, note-recording-config, cloud-api-request envelope) AND the five CRUD resource families the client invokes through `cloud-api-request` (notes / folders / conversations+messages / transcriptions / api-keys) — completing the v1 wire surface byte-for-byte against the client. Stripe and referrals are explicitly OUT OF SCOPE in v1.
**Depends on**: Phase 3, Phase 4
**Requirements**: WIRE-08, WIRE-09, WIRE-10, WIRE-11, WIRE-12, WIRE-16, WIRE-22, WIRE-23, WIRE-24, WIRE-25, WIRE-26, WIRE-27, WIRE-28, WIRE-29
**Success Criteria** (what must be TRUE):
  1. `GET /api/usage` returns observed usage stats with `plan: "unlimited"` always (v1 has no enforcement); `POST /api/streaming-usage` accepts and records streaming-session usage idempotently into the ledger keyed on client-supplied `sessionId` (duplicate → 200 OK, not 409).
  2. `GET /api/stt-config` returns server-side STT provider/model selection per tenant/user; `GET /api/note-recording-config` returns note-recording configuration — both honor the tenant context. Both back onto new `tenant_settings` + `user_settings` tables (JSONB, RLS) with env fallback; mutations deferred to Phase 7 UI.
  3. `POST /api/agent/web-search` provides the server-side search tool with a registry-based multi-provider adapter; v1 ships Tavily + Yandex AI Studio Search; missing-key → 503 envelope; future providers added as additional adapter files without route changes.
  4. The `cloud-api-request` passthrough invariant is proved end-to-end via a CONTRACT-01 negative matrix: every implemented `/api/*` route AND synthetic unknown paths emit a compliant `{error: string}` envelope on every non-2xx response.
  5. The five CRUD resource families (notes / folders / conversations+messages / transcriptions / api-keys) are fully implemented per the client TypeScript interfaces at `~/openwhispr/src/services/*.ts`: create / update / delete (soft-delete via `deleted_at`) / list (keyset pagination on `created_at + id`) / search (Postgres `tsvector + GIN`) / batch-create / batch-delete as the client requires. Every resource has `client_<resource>_id` for offline-first idempotent retry. Every new table has RLS + FORCE RLS + TEST-RLS-01 coverage.
  6. API keys (`/api/v1/keys/{list,create}`) issue Argon2id-hashed programmatic-access keys with the unique `{data: T}` envelope wrapper per client contract; the `Bearer pak_*` auth middleware integration MAY defer to Phase 6 (Phase 5 minimum is CRUD).
  7. CONTRACT-01 extended for every Phase 5 endpoint (6 operational + ~20+ CRUD routes); REQUIREMENTS.md WIRE-traceability updated; tests written first (TDD); all CI checks green.
  8. Stripe (`/api/stripe/*`) and referrals (`/api/referrals/*`) endpoints — present in upstream `BACKEND_SPEC.md` — are NOT implemented; they 404 via Phase 2's not-found handler with envelope.
**Plans:** 10 plans

Plans:
- [x] 05-01-PLAN.md — Wave 0: wire-schemas + migrations 0006..0010 + RLS extension + schema-push BLOCKING
- [x] 05-02-PLAN.md — Wave 1: /api/streaming-usage + /api/usage (WIRE-09, WIRE-10)
- [x] 05-03-PLAN.md — Wave 1: /api/agent/web-search registry + Tavily + Yandex adapters (WIRE-08, WIRE-16)
- [x] 05-04-PLAN.md — Wave 1: settings-resolver + /api/stt-config + /api/note-recording-config (WIRE-11, WIRE-12, WIRE-28)
- [x] 05-05-PLAN.md — Wave 2: notes CRUD + tsvector search + batch + delete-all + shared CRUD helpers (WIRE-22)
- [x] 05-06-PLAN.md — Wave 2: folders CRUD + batch (WIRE-23)
- [x] 05-07-PLAN.md — Wave 2: conversations + messages CRUD + include=messages + search (WIRE-24, WIRE-25)
- [x] 05-08-PLAN.md — Wave 2: transcriptions CRUD + batch-create + batch-delete (WIRE-26)
- [x] 05-09-PLAN.md — Wave 2: API keys list + create + revoke + Argon2id + {data: T} envelope (WIRE-27)
- [x] 05-10-PLAN.md — Wave 3: CONTRACT-01 negative matrix + envelope passthrough + docs/conventions + REQUIREMENTS traceability (WIRE-16, WIRE-29)
**UI hint**: no (Phase 5 lays UI groundwork via settings tables; actual UI is Phase 7)

### Phase 6: Observability + Ops Hardening + Workers
**Goal**: An operator opens the shipped Grafana dashboards and sees end-to-end traces (API → LiteLLM → models), per-tenant usage, LiteLLM spend, RED + saturation, and audit-log activity; bearer tokens never appear in logs; background jobs always run with full tenant context; anti-abuse rate limiting is live; SSRF-safe HTTP client gates all server-side outbound calls.
**Depends on**: Phase 5
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, DATA-04, SCALE-01, SCALE-03, SCALE-04
**Success Criteria** (what must be TRUE):
  1. OpenTelemetry SDK auto-instrumentation covers Fastify + undici + pg + ioredis with correlation IDs propagated through to LiteLLM; default Grafana dashboards (RED + saturation, per-tenant usage, LiteLLM spend) are shipped in-tree.
  2. Structured JSON logs flow to Loki via the OTel Collector; a sentinel-token log-scrub test confirms `Authorization`, `Cookie`, `set-auth-token`, and `*token*`/`*secret*`/`*password*`/`*key*` patterns are scrubbed; all log keys are English-only.
  3. The `audit_log` table records auth events, account deletion, key issuance, provider config changes, admin actions, and cross-tenant attempts; LiteLLM spend logs are reconciled against per-request ledger entries with a daily discrepancy alert.
  4. Liveness, readiness, and startup probes are wired; readiness fails when Postgres / Redis / LiteLLM are unhealthy; the API tier is fully stateless (sessions in Postgres, cache in Redis/Valkey) and horizontal scaling is verified by spinning a second replica and observing zero session loss.
  5. BullMQ workers run audit-log fanout, email delivery, usage rollups, and virtual-key rotation; a tenant-context job middleware re-establishes the DB GUC + log MDC + OTel context before every handler invocation, verified by a CI introspection gate.
  6. Anti-abuse rate limiting (per-user, per-IP, Redis token-bucket) is enforced with the polling carve-out for `/api/auth/verification-status`; SSRF defense (private-IP block + DNS-rebinding defense) gates every server-side outbound HTTP call.
  7. Tests written first (TDD); all CI checks green.
**Plans**: 12 plans (4 waves)
- [x] 06-01-PLAN.md — Wave 0: Materialize 31 RED test stubs (apps/api + apps/worker + packages/data + tools + integration)
- [x] 06-02-PLAN.md — Wave 0: pg_partman custom postgres image + migration 0011 (audit_log → monthly RANGE partition) + [BLOCKING] db:push
- [x] 06-03-PLAN.md — Wave 0: OTel SDK bootstrap + pino redact + Loki↔Tempo derivedFields + 8 e2e RED stubs
- [x] 06-04-PLAN.md — Wave 1: /livez /readyz /startupz probes + dep-check lru-cache + x-served-by hook (OBS-05, SCALE-01 prep)
- [x] 06-05-PLAN.md — Wave 1: recordAudit helper + 18-action const-union + 15 emission sites wired (DATA-04, OBS-03)
- [x] 06-06-PLAN.md — Wave 1: undici SSRF Dispatcher (12 CIDRs + single-resolve + 502 + security.ssrf_blocked audit row) (SCALE-04 security half)
- [x] 06-07-PLAN.md — Wave 1: withTenantContext + withSystemContext + typedQueue + app-pool runtime guard + worker-rls property test (SCALE-03 layers 2+3)
- [x] 06-08-PLAN.md — Wave 2: 7 new BullMQ queues + scheduler (email-delivery, usage-rollup-daily, virtual-key-rotation, reconciliation-daily-check, reconciliation-discrepancy, partman-maintenance, audit-archive) (SCALE-03, DATA-04, OBS-04)
- [x] 06-09-PLAN.md — Wave 2: Layered IP+user rate-limit + per-route rpm matrix + X-RateLimit-* headers + tools/lint-tenant-context.ts GHA gate (SCALE-04, SCALE-03 layer 1)
- [x] 06-10-PLAN.md — Wave 2: Log scrubbing finalization across api + worker tier + sentinel-token sweep integration test (OBS-03)
- [x] 06-11-PLAN.md — Wave 2: 4 Grafana dashboards (RED+sat, per-tenant usage, LiteLLM spend, reconciliation drift) + reconciliation alert rule + docs/observability.md (OBS-01, OBS-02, OBS-04)
- [x] 06-12-PLAN.md — CLOSED via 12a/b/c/d split (SUMMARYs at .planning/phases/06-*/06-12{a,b,c,d}-SUMMARY.md); Wave 3: 8 e2e tests flipped GREEN + coverage gate + nightly CI. Plan 51-19 (this session) re-proved e2e 14/14 via make e2e-test-phase6 exit 0. Tick reconciled 2026-05-18.
**UI hint**: no

### Phase 06.1: Add tempo + mimir minimal filesystem-backed configs — both crash on default empty backend; uncovered after Phase 02.2 brought api healthy (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 6
**Plans:** 15/16 plans executed

Plans:
- [x] CLOSED — phase 06.1 shipped (SUMMARY at .planning/phases/06.1-*/06.1-01-SUMMARY.md); TBD sub-plan entry was a roadmapper INSERTED-phase artifact. Tick reconciled 2026-05-18.

### Phase 7: Frontend UI-SPEC
**Goal**: An operator (or downstream code-generation agent) reads two markdown specs and can implement the admin console + end-user self-service UI in Next.js 15 + shadcn/ui v2 without ambiguity — every screen, component, design token, and accessibility requirement is enumerated.
**Depends on**: Phase 6
**Requirements**: UI-SPEC-01, UI-SPEC-02, UI-SPEC-03
**Success Criteria** (what must be TRUE):
  1. `UI-SPEC-admin.md` enumerates the operator/admin console: tenants list, tenant detail (members, IdP config, LiteLLM endpoint config, observed usage), users list, virtual-key management, audit log, observability deep-links — each screen broken into shadcn/ui v2 components with props, states, and copy keys.
  2. `UI-SPEC-end-user.md` enumerates end-user self-service: profile, observed usage breakdown, account deletion (mirroring the desktop-client surface) — same component-level decomposition.
  3. Both specs target Next.js 15 + React 19 + Tailwind 4 + shadcn/ui v2 + TanStack Query 5; document WCAG 2.2 AA conformance, responsive breakpoints (mobile + tablet + desktop), light + dark theme, design tokens, locale-negotiation chain, and a complete component inventory.
  4. Tests written first (TDD — spec linter validates structure); all CI checks green.
**Plans**: 7 plans (3 waves)
- [x] 07-PLAN-01-api-shape-verification.md — Wave 0: verify upstream `/api/usage`, sessions, settings shapes; scaffold UI-SPEC stubs (b72882f)
- [x] 07-PLAN-02-linter-tests-red.md — Wave 0: RED linter tests + fixtures + config (TDD foundation) (0a240cd)
- [x] 07-PLAN-03-linter-implementation.md — Wave 1: GREEN linter implementation `tools/lint-ui-spec.ts` (ce72448)
- [x] 07-PLAN-04-ui-spec-admin.md — Wave 1: author UI-SPEC-admin.md (A2 + A3) (70aed25)
- [x] 07-PLAN-05-ui-spec-end-user.md — Wave 1: author UI-SPEC-end-user.md (U1–U13) (cd9bf30)
- [x] 07-PLAN-06-ci-and-appendix.md — Wave 2: shared appendix + GHA workflow + lefthook + cross-file lint gate (65824b7)
- [x] 07-PLAN-07-finalize.md — Wave 3: full verification sweep + SUMMARY + STATE/ROADMAP (this commit)
**UI hint**: yes (spec only; `apps/web/` scaffold + implementation are Phase 8)

### Phase 07.1: Web App Implementation — apps/web/ Next.js 15 + 15 screens (CLOSED 2026-05-12)

**Goal**: A working `apps/web/` Next.js 15 application implementing every screen enumerated in `UI-SPEC-admin.md` (A2, A3) and `UI-SPEC-end-user.md` (U1–U13), deployed same-origin behind Traefik alongside `apps/api`, with Playwright e2e covering all four UI states (loading/empty/error/success) on each screen plus axe-core WCAG 2.2 AA assertions, ≥90/90/90/90 coverage on diff per CLAUDE.md.
**Depends on**: Phase 7
**Requirements**: WEB-IMPL-01, WEB-IMPL-02, WEB-IMPL-03, WEB-IMPL-04
**Success Criteria** (what must be TRUE) — ALL VERIFIED 2026-05-12:
  1. ✅ `apps/web/` exists as a Next.js 15 + React 19 + TS strict + Tailwind 4 + shadcn/ui v2 project; `pnpm --filter @openwhispr/web build` exits 0.
  2. ✅ Every screen from both UI-SPEC files is implemented under `apps/web/src/app/` with exact route paths; A2/A3 admin + U1–U13 end-user screens reachable.
  3. ✅ Web behind Traefik; `/admin/*` 401 without basic-auth, 200 with valid `ADMIN_BASIC_AUTH_USERS` credential (4-probe smoke verified).
  4. ✅ Playwright e2e 85/85 PASS — 15 screens × 4 UI states + 15 axe-core WCAG 2.2 AA scans + cross-screen smoke against real docker-compose stack.
  5. ✅ Bundle gate green: max 168.84 kB gz across 15 routes (budget 200 kB); CSP/HSTS/X-Frame-Options DENY in `next.config.ts`.
  6. ✅ TDD RED→GREEN evidence per task; coverage 98.53/92.99/97.79/97.62 on diff.
  7. ✅ All CI commands pass locally (typecheck + vitest + build + size-limit + playwright); `.github/workflows/web.yml` YAML-valid (yaml=OK). First remote run pending merge.
**Mode:** mvp
**Total commits:** 27 (554b54c..14-finalize)
**Plans:** 14 plans (5 waves)
- [x] 07.1-PLAN-01 — scaffold apps/web Next.js 15 + Tailwind 4 + standalone (198e1fc)
- [x] 07.1-PLAN-02 — shadcn/ui v2 init + 16 primitives (132b084)
- [x] 07.1-PLAN-03 — compose web service + Traefik admin basic-auth (c9a6a04) + lru-cache fix (de3ada2)
- [x] 07.1-PLAN-04 — Playwright + vitest + axe-core + state-matrix fixtures (31a5e42)
- [x] 07.1-PLAN-05 — Better Auth client + server + Edge middleware (8eae878 RED, cfd40d9 GREEN)
- [x] 07.1-PLAN-06 — TanStack Query + i18n + RHF + shells + theme (64125cf RED, 8b2a618 GREEN)
- [x] 07.1-PLAN-07 — U1/U2/U3 auth slice (e9f170e RED, 14d329d GREEN)
- [x] 07.1-PLAN-08 — U4 Usage KPI + U5 Account (3b77456 RED held files, 7e82068 GREEN)
- [x] 07.1-PLAN-09 — U6/U7 transcriptions (Branch B) (bad13b1 RED, 6c6040d GREEN)
- [x] 07.1-PLAN-10 — U8/U9/U10 notes (c8a74ae RED, 9fb6b6e GREEN)
- [x] 07.1-PLAN-11 — U11/U12/U13 conversations (9c6a5cd GREEN + 947f546 summary)
- [x] 07.1-PLAN-12 — A2/A3 admin (4b5ca31 RED, 0606808 GREEN)
- [x] 07.1-PLAN-13 — bundle gate + GHA web.yml + lefthook + cross-screen smoke (2254fb2 + 36c87f3 + 3d9ce2f + c12e6f9 fixes → 85/85 e2e green)
- [x] 07.1-PLAN-14 — finalize: SUMMARY + STATE + ROADMAP + REQUIREMENTS (this commit)
**UI hint**: yes (working app)

### Phase 8: Load Test, Tuning & SLO Publication
**Goal**: An on-demand k6 load test (`make load-test`) demonstrates 1000 concurrent active users (mixed transcribe + reason + agent stream + WSS realtime) against a real docker-compose stack at validated p95 baselines, and per-endpoint p95 SLO budgets (baseline + 20% headroom) are published to operators in `docs/operations.md` only after this phase passes.
**Depends on**: Phase 6
**Requirements**: SCALE-02, SCALE-06, SCALE-07, TEST-LOAD-01
**Success Criteria** (what must be TRUE):
  1. ✅ DONE — `make load-test` runs the k6 scenario at 1000 VU × 30 min (5m+20m+5m) with the assumed mix ratios; per-endpoint p95 latencies recorded. Run 5 (2026-05-13, commit `a5e5920`): 944,988 HTTP requests @ 510.7 rps, 0 container restarts. Nightly CI cadence deferred per D-EXEC-1 (manual on-demand; documented in `docs/operations.md#cadence-and-deferrals`).
  2. ✅ DONE — Two profiles ship: `mock` (compose/mock-litellm Fastify stub with simulated latency, evidence `compose/mock-litellm/src/server.test.ts`) and `realistic` (Speaches + LiteLLM per `docs/litellm-target-spec.md`, evidence `tools/load-test/scripts/smoke-paid.sh` + commit `11d21f3` 5/7 PASS). Mock baseline published; realistic plateau deferred to H100 per RESEARCH §Pitfall 2; realistic wiring proven LIVE.
  3. ✅ DONE — PgBouncer 4 instances × 100 server pool = 400 backend connections verified under Run 5 with `wait_time ≈ 0` (evidence `runs/2026-05-12T18-00-00Z-mock/diagnostics/show-pools.txt`); FD probe at `apps/api/scripts/fd-probe.sh` + `/usr/local/bin/fd-probe.sh` (traefik) refuses to start under 65535; compose load-test overlay sets `ulimits: nofile: { soft: 65535, hard: 65535 }`.
  4. ✅ DONE — Sizing matrix published in `docs/operations.md#sizing-matrix`. Compose single-host row populated with measured numbers from Run 5 (16 vCPU, 32 GB, 1000 VU sustained 30 min, transcribe p95 2521 ms); Helm small / Helm large rows marked TBD/Phase 9 per scope contract.
  5. ✅ DONE — 4-endpoint SLO table at `docs/operations.md#published-slo-budgets-mock-profile` with baseline × 1.20 headroom sourced from `runs/2026-05-12T22-47-48Z-mock-summary.json` (NOT extrapolated): transcribe 2521→3025, reason 1209→1451, agent-stream TTFB 610→732, agent-stream total 1127→1352, realtime-ws 41→49 (mock-floor, OPERATOR_RERUN_ON_GPU).
  6. ✅ DONE — Live `make load-test PROFILE=mock` ran on the developer Mac on 2026-05-13 (Run 5, commit `a5e5920`); 6/6 k6 thresholds PASS; raw k6 JSON committed under `runs/2026-05-12T22-47-48Z-mock-summary.json` + `runs/2026-05-12T22-47-48Z-mock.json`; numbers embedded in `08-SUMMARY.md`. Realistic Mac baseline deferred per RESEARCH §Pitfall 2; wiring proven via paid smoke (commit `11d21f3`).
  7. ✅ DONE — TDD enforced across all 8 plans + 5 sub-phases. Coverage on touched files ≥ 90/90/90/90 (litellm-client 100/98/100/100; stream.ts 100/90.47/100/100; mock-litellm/realtime 100/100/100/100). CI green at Phase 8 closure.
**Plans**: 8 plans (5 waves) + 5 inserted sub-phases (08.1..08.5) + 1 parallel sub-phase (08.6)
- [x] 08-01 — rate-limit env switch (Wave 0)
- [x] 08-02 — load-test workspace scaffold (Wave 0)
- [x] 08-03 — mock-litellm Fastify scaffold (Wave 0)
- [x] 08-04 — FD probe scripts (Wave 0)
- [x] 08-05 — docker-compose load-test profiles (Wave 1)
- [x] 08-06 — k6 flows + Makefile (Wave 2)
- [x] 08-07 — live baseline run on Mac (Wave 3) → escalated 3 anomalies to 08.1
- [x] 08-08 — operations.md + SLO publication + closure (Wave 4) — commits `fd1267b` + `2fe7d5f` + this commit
**UI hint**: no

### Phase 08.1: Deferral Fixes + Mock Re-run
**Goal**: Mock load-test baseline run satisfies all exit gates (error rate < 1%, all 4 endpoints non-zero p95, no container restarts, no prepared-statement errors, no 429s, pool-exhaustion < 5%) — producing artifact set consumable by plan 08-08 for SLO table publication. Realistic profile remains DEFERRED per RESEARCH.md §Pitfall 2 (Apple Silicon CPU saturates Speaches under 1000 VU). Inserted 2026-05-12 after 08-07 mock run produced invalidated baseline (99.93% HTTP error rate, realtime-ws p95=0 from k6/websockets addEventListener tag-mapping bug, pgbouncer_admin SCRAM hash absent from userlist.txt forcing log-scrape fallback).
**Depends on**: Phase 8 plans 01–07
**Requirements**: SCALE-02, SCALE-06, SCALE-07, TEST-LOAD-01
**Success Criteria** (what must be TRUE):
  1. Three deferrals from 08-07 are closed: (a) request-layer mismatch between k6 flows and api routes / mock-litellm envelopes resolved → HTTP error rate < 1%; (b) k6 realtime-ws flow uses `addEventListener` correctly so per-iteration p95 > 0; (c) `compose/pgbouncer/userlist.txt` contains pgbouncer_admin SCRAM hash so `SHOW POOLS` works without log-scrape fallback.
  2. Strict TDD per deferral: forensic capture script + bug-reproducing test land RED before each fix; fix commits land GREEN with their tests in the SAME atomic commit.
  3. `make load-test PROFILE=mock` re-run produces valid 30-minute baseline at 1000 VU on the developer Mac; raw k6 output + summary embedded under `.planning/phases/08.1-deferral-fixes-and-rerun/runs/`.
  4. All exit gates pass: error rate < 1%, all 4 endpoints (transcribe, reason, agent-stream, realtime-ws) report non-zero p95, zero container restarts, zero prepared-statement errors, zero 429s, pool-exhaustion < 5%.
  5. Coverage on modified k6 flow files + compose/pgbouncer/userlist.txt generator ≥ 90% lines/branches/functions/statements.
  6. Tests written first (TDD); all CI checks green; plan 08-08 (SLO publication) is unblocked.
**Plans**: 1 plan (Wave 1)
- [x] 08.1-01 — deferral fixes + mock re-run (Wave 1) — CLOSED 2026-05-12 (partial: anomalies #1/#2/#3 closed at code level with 67 unit tests + 5 hermetic shell tests GREEN; anomaly #1 LIVE-validated for transcribe + reason; anomaly #3 LIVE-validated for SHOW POOLS; full 30-min plateau is operator hand-off per the plan's wall-clock cap; agent-stream undici.fetch issue escalated as api-side, outside Plan 08.1-01 scope)
**UI hint**: no

### Phase 08.2: agent-stream undici dispatcher fix
**Goal**: `apps/api/src/routes/agent/stream.ts` upstream call to LiteLLM completes end-to-end under load-test-mock profile (no `upstream_error` from `undici.fetch`), matching the working behaviour of sibling routes (`/api/transcribe`, `/api/reason`) that use the shared litellm-client built on `undici.request`. After this lands, all four k6 flows (transcribe, reason, agent-stream, realtime-ws) can satisfy 08-07.1 exit gates and the operator's 30-min mock plateau produces a valid SLO-grade summary.
**Depends on**: Phase 08.1
**Requirements**: SCALE-02, TEST-LOAD-01
**Success Criteria** (what must be TRUE):
  1. The chosen architectural option (replace `undici.fetch` with shared litellm-client OR inject the SSRF dispatcher explicitly into the fetch call) is selected based on documented analysis of which approach is consistent with the rest of `apps/api/` and the SSRF-gate contract.
  2. `apps/api/src/routes/agent/stream.ts` no longer emits `upstream_error` against `compose/mock-litellm` under the `load-test-mock` profile; first SSE chunk reaches the k6 client within the api's normal upstream-fetch budget; the full streamed response terminates with `[DONE]` per the contract `BACKEND_SPEC.md` specifies.
  3. Existing SSRF gate behaviour preserved: requests to denied hosts continue to be blocked; existing SSRF unit tests stay GREEN.
  4. RED tests for the bug land first: at least one new vitest in `apps/api/src/routes/agent/stream.test.ts` (or sibling) reproduces the upstream_error against a fixture that mimics the mock-litellm envelope, then goes GREEN after the fix.
  5. `tools/load-test/scripts/forensic-probe.ts` (from 08.1) re-run against the running stack returns HTTP 200 + SSE body for agent-stream — no `upstream_error` in api logs.
  6. Coverage on modified files ≥ 90/90/90/90 lines/branches/functions/statements.
  7. Tests written first (TDD); all CI checks green; plan 08-08 unblocked for the operator's mock plateau.
**Plans**:
  - [x] 08.2-01 — Add `chatCompletionsStream` to shared litellm-client (Wave 0) — CLOSED 2026-05-12 (commit `6040ed5`; 7 new RED→GREEN tests; coverage 100/98/100/100; T-08.2-01 mitigation verified — no per-call dispatcher option exposed).
  - [x] 08.2-02 — Swap `undici.fetch` for `chatCompletionsStream` in `agent/stream.ts` (Wave 1) — CLOSED 2026-05-12 (commits `741a009` + `ae0dcc3`; 17/17 tests GREEN; coverage 100/90.47/100/100 on stream.ts; live forensic-probe returns content-bearing NDJSON ending in finishReason:"stop"; deviation: signal not forwarded at route call site due to live-isolated undici 7.25 + SSRF-wrapped-Agent incompatibility — client interface preserves `signal?` for non-SSRF callers; SSRF gate untouched, 54/54 SSRF tests GREEN; sibling routes transcribe + reason 23/23 GREEN).
**UI hint**: no

### Phase 08.3: mock-litellm `/v1/realtime` echo for measurable WS roundtrip
**Goal**: `compose/mock-litellm` exposes a `WSS /v1/realtime` endpoint that accepts the k6 realtime-ws flow's handshake + echoes back at least one message frame per request, so the realtime-ws custom Trend `realtime_ws_roundtrip_ms` populates a non-zero p95 in the 30-min mock plateau. This is the final gap blocking Plan 08-08 from publishing a complete 4-endpoint SLO table. Inserted 2026-05-12 after Run 3 (commit `fa799fa`) showed transcribe/reason/agent-stream all PASS exit-gates but realtime-ws p95=0 because mock-litellm has no `/v1/realtime` route (102k WS sessions handshook but no message frames emitted).
**Depends on**: Phase 08.1 (k6 flow Trend correctness), Phase 08.2 (no api-side blockers)
**Requirements**: SCALE-02, TEST-LOAD-01
**Success Criteria** (what must be TRUE):
  1. `compose/mock-litellm/src/server.ts` registers a `WSS /v1/realtime` handler that completes the upstream WS handshake (101 Switching Protocols) and emits at least one binary or text message frame in response to the first inbound client message, mirroring the OpenAI Realtime API frame envelope just enough for the k6 flow to record a roundtrip (no full session.state machine required).
  2. Strict TDD: unit test in `compose/mock-litellm/src/realtime.test.ts` asserts handshake + echo behaviour against a fake WS client BEFORE the handler is implemented.
  3. `tools/load-test/src/flows/realtime-ws.ts` continues to call `realtime_ws_roundtrip_ms.add(...)` inside the message listener (08.1 fix unchanged) and now records non-zero values; existing vitest assertions adapted only if the mock-litellm frame shape requires a new client-side parse.
  4. `make load-test PROFILE=mock` Run 4 produces a summary JSON where `realtime_ws_roundtrip_ms` p95 ∈ [50, 1000] ms (Plan 08-07.1 plausibility window).
  5. Coverage on new mock-litellm code ≥ 90/90/90/90.
  6. Tests written first (TDD); all CI checks green; Plan 08-08 receives the complete 4-endpoint SLO baseline.
**Plans**: 1 plan (Wave 1)
- [x] 08.3-01 — CLOSED. `compose/mock-litellm/src/realtime.ts` + `realtime.test.ts` shipped (Phase 08.3 / Plan 01). Run 4 superseded by Run 5 in Phase 08.4 closure (commit `a5e5920` 4-endpoint mock baseline complete). Tick reconciled 2026-05-18.
**UI hint**: no

### Phase 08.4: realtime ws proxy frame-forwarding fix
**Goal**: `apps/api/src/routes/realtime.ts` proxies upstream `/v1/realtime` WebSocket frames to the desktop client. Currently 101 upgrade succeeds and the mock-litellm echo handler ships in the image, but message frames from upstream never reach the k6 client across 108k WS sessions — `realtime_ws_roundtrip_ms` p95 stays 0. Diagnose `@fastify/http-proxy` v11 WS forwarding behaviour, identify whether bug is in our config (`wsClientOptions`, `prefix` / `rewritePrefix` mismatch, host-header rewrite, `wsReconnect: false` interaction with upstream-initiated frames) or in the library itself, fix or document architectural workaround.
**Depends on**: Phase 08.3
**Requirements**: SCALE-02, TEST-LOAD-01
**Success Criteria** (what must be TRUE):
  1. A short-form k6 probe (5 VU × 60s realtime-ws-only flow) against the running load-test-mock stack records `realtime_ws_roundtrip_ms` p95 in [50, 1000] ms — the same plausibility window from Plan 08-07.1.
  2. The fix is documented at the `realtime.ts` code site with the root-cause one-liner so a future regression is immediately diagnosable.
  3. Existing realtime route tests stay GREEN (the route is referenced by Phase 03/04 contracts).
  4. SSRF gate behaviour preserved.
  5. Strict TDD: RED test reproduces the missing-frame symptom under a controlled http-proxy harness (vitest with a stub upstream WS); GREEN after the fix.
  6. Coverage ≥ 90/90/90/90 on `apps/api/src/routes/realtime.ts`.
  7. If the root cause is in `@fastify/http-proxy` v11 itself (not our config), the workaround is documented in the SUMMARY with a link to an upstream issue/PR; the workaround MUST NOT degrade auth, host-header rewriting, or the 10s handshake timeout.
**Plans**: TBD (1–2 plans expected — research+fix, or research+fix+regression-coverage)
**UI hint**: no

### Phase 08.5: realistic profile boot + smoke + short Mac baseline
**Status (2026-05-13)**: Waves 1+2 CLOSED. 8 atomic commits (4491369…e6c7b34) land the realistic compose overlay, litellm_config.realistic.yaml, Speaches PRELOAD_MODELS + HF-cache-path fixes, pre-warm `--strict`, k6 baseline scenario + runner, run.sh realistic extensions. Wave 3 (live boot + smoke + 12-min baseline + docs) BLOCKED on operator-supplied `.env` provider keys (HF_TOKEN / OPENROUTER_API_KEY / OPENAI_API_KEY). Operator unblock recipe and remaining task contract at `.planning/phases/08.5-realistic-profile-boot-and-baseline/08.5-03-STATUS.md`.

**Goal**: The `load-test-realistic` compose profile boots end-to-end with Speaches + Whisper-large-v3 + pyannote behind LiteLLM (per `speaches-audio.md` and `docs/litellm-target-spec.md`), passes a k6 smoke (5 VU × 60s per endpoint asserting zero TypeErrors / handshake failures), and produces a short Mac baseline summary JSON (5 min ramp-up + 5 min sustained + 2 min ramp-down at 100 VU — NOT 1000, because Apple Silicon CTranslate2-CPU saturates per RESEARCH.md §Pitfall 2 and 1000 VU would just timeout). The result: working compose+LiteLLM-config wiring that an operator can re-run on H100 to substitute production numbers without re-engineering the integration.
**Depends on**: Phase 08.3
**Requirements**: SCALE-02, TEST-LOAD-01
**Success Criteria** (what must be TRUE):
  1. `make load-test PROFILE=realistic` boots the realistic stack — Speaches container + LiteLLM config wired per `docs/litellm-target-spec.md` (faster-whisper-large-v3 model alias, pyannote diarization pass-through, `/v1/realtime` route to Speaches WS). All containers reach healthy.
  2. The k6 smoke gate (already in place from 08.1-followup, commit `f3a17a9`) extended to cover all 4 realistic flows at 5 VU × 60s with ZERO iteration errors.
  3. A short Mac baseline runs at 100 VU for 12 min total (5 + 5 + 2) and produces a summary JSON committed under `runs/<timestamp>-realistic-mac.json`. All p95 numbers recorded.
  4. Mac baseline numbers documented in `runs/RUN-LOG.md` and `docs/operations.md` with explicit `OPERATOR_RERUN_ON_GPU` markers — the wiring is the deliverable, the numbers are advisory until H100 re-run.
  5. All existing vitest + k6 tests preserved unchanged (operator re-runs with same suite, only numbers change).
  6. Documentation in `docs/operations.md` distinguishes Mac-bound vs architecture-bound metrics so a reader on H100 knows which to trust as-is and which to re-measure.
**Plans**: 3 plans (08.5-01 / 08.5-02 / 08.5-03)
- [x] 08.5-01 — compose + LiteLLM config + Speaches env + pre-warm (Wave 1) — CLOSED 2026-05-13
- [x] 08.5-02 — k6 baseline.ts + baseline.sh + run.sh realistic (Wave 2) — CLOSED 2026-05-13
- [x] 08.5-03 — live boot + smoke + (deferred plateau) + docs (Wave 3) — CLOSED 2026-05-13 via smoke-paid 5/7 PASS proof-of-wiring
**UI hint**: no

### Phase 08.6: Speaches main-branch build + local diarization wiring
**Goal**: Speaches running as a `build: from main` source build (NOT the stale `latest-cpu` tag) exposes `/v1/audio/diarization` against pyannote/speaker-diarization-community-1. `apps/api/src/routes/diarization.ts` switches to a new SPEACHES_DIARIZATION_URL env target, bypassing pyannote.ai (paid). Diarization joins the full-local 4-endpoint realistic stack.
**Depends on**: Phase 08.5
**Requirements**: TEST-LOAD-01
**Success Criteria** (what must be TRUE):
  1. `docker-compose.load-test.realistic.yml` Speaches service uses `build:` against `https://github.com/speaches-ai/speaches.git#main` (or a pinned SHA), and `curl http://speaches:8000/openapi.json | jq .paths` includes `/v1/audio/diarization`.
  2. `apps/api/src/routes/diarization.ts` reads SPEACHES_DIARIZATION_URL when set; if set, posts multipart directly to Speaches (synchronous, single-shot — no presigned upload, no job polling, no pyannote.ai). Tests cover both branches: pyannote.ai (production), Speaches (load-test). Coverage ≥ 90/90/90/90 on touched files.
  3. Strict TDD: RED test mocks dispatcher and asserts the Speaches branch sends the expected form fields.
  4. smoke-paid script extended with 8th call → /api/diarization → asserts 200 + `segments[]` non-empty.
  5. HF_TOKEN must be populated in .env (already documented since 08.5).
**Plans**: TBD (1 plan likely)
**UI hint**: no

### Phase 08-08: operations.md + SLO publication (Plan 08-08 finalization)
**Goal**: Publish per-endpoint p95 SLO budgets (baseline × 1.20 headroom) in `docs/operations.md` per Phase 8 SC5. Mock baseline numbers from Run 5 (commit a5e5920) with explicit "OPERATOR_RERUN_ON_GPU" markers; realistic Mac numbers documented as "Apple Silicon CPU saturates Whisper inference; numbers advisory until H100 re-run". Document profiles, sizing matrix, load-test orchestration recipe.
**Depends on**: Phase 08.4 (mock baseline), Phase 08.5 (realistic wiring proven)
**Requirements**: SCALE-02, SCALE-06, SCALE-07, TEST-LOAD-01, DOCS-02
**Success Criteria** (what must be TRUE):
  1. `docs/operations.md` exists with sections: Load Test (how to run mock / realistic profiles), SLO Budgets (4-endpoint table from Run 5), Sizing Matrix (compose / k8s / GPU), PgBouncer + FD tuning rationale, Limitations (Mac CPU saturates, realistic plateau requires H100/GPU node).
  2. Each SLO row carries: measured p95, +20% headroom budget, OPERATOR_RERUN_ON_GPU marker if Mac-bound.
  3. ROADMAP Phase 8 + REQUIREMENTS.md SCALE rows tick "SLOs published".
  4. Coverage on docs not applicable; verify English-only + commitlint hooks pass.
**Plans**: 1 plan (08-08)
- [x] 08-08 — CLOSED. `docs/operations.md` carries "Published SLO budgets — mock profile" + "Published SLO budgets — realistic profile" sections sourced from Run 5 (commit `a5e5920`, 2026-05-13) with SLO = observed p95 × 1.20 per D-SLO-1. Tick reconciled 2026-05-18.
**UI hint**: no

### Phase 9: Helm Chart & Cloud Deploy
**Goal**: An operator runs `helm install` against a fresh Kubernetes cluster and lands on a production-grade deployment (CNPG HA Postgres + Traefik 3 ingress + cert-manager + HPA + GPU node-selector for bundled AI workers) with one-command upgrade, safe rollback, and a refuse-to-start gate on default secrets — going from `git clone` to first authenticated `/api/transcribe` in under 5 minutes via the compose path.
**Depends on**: Phase 8
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05
**Success Criteria** (what must be TRUE):
  1. The shipped `docker-compose.yml` brings up API + Postgres 17 + PgBouncer + Redis/Valkey + bundled LiteLLM + bundled open-source AI models (Whisper / pyannote / faster-whisper) + MinIO + Traefik + OTel Collector + Grafana + Loki + Tempo + Mimir, with a compose profile to disable bundled LiteLLM when overriding to corporate.
  2. The Helm chart deploys against a fresh Kubernetes cluster with HA Postgres via CloudNativePG 1.29 (PG 17 image catalog override), Traefik 3 ingress (NOT ingress-nginx — retired Mar 2026), HPA on API + worker tiers, cert-manager hooks for TLS, OTel-Collector DaemonSet, GPU node-selector for bundled AI workers, and a documented option to disable bundled AI and point at corporate LiteLLM.
  3. Migrations run as a pre-deploy job and are safe under rolling deploy and backwards-compatible across one minor version; an upgrade-matrix CI test installs N-1, populates data, upgrades to N, and asserts health and integrity.
  4. Online-migration discipline is enforced (CONCURRENTLY indexes, NOT VALID then VALIDATE constraints, batched column adds) by a `squawk`/`pgroll` lint that blocks PRs with blocking patterns.
  5. The DEPLOY-05 first-launch SLO test gates CI: from `git clone` to first authenticated `/api/transcribe` against the bundled LiteLLM in **< 5 minutes**.
  6. Tests written first (TDD); all CI checks green.
**Plans**: 11 plans (4 waves)
Plans:
- [x] 09-01-PLAN.md — Chart skeleton + secrets-mode dual path + helm-lint CI (Wave 0)
- [x] 09-02-PLAN.md — squawk PR-gate via tools/lint-migrations.ts + 16-rule allowlist (Wave 0)
- [x] 09-03-PLAN.md — Compose↔chart parity lint via tools/lint-compose-chart-parity.ts (Wave 0)
- [x] 09-04-PLAN.md — CNPG Cluster CR + custom openwhispr/cnpg-postgres-17-pgpartman image (Wave 1)
- [x] 09-05-PLAN.md — CNPG Pooler CRD + Bitnami Valkey + MinIO sub-charts (Wave 1)
- [x] 09-06-PLAN.md — api/web/worker Deployments + HPAs + PDBs + ServiceMonitors (Wave 2)
- [x] 09-07-PLAN.md — LiteLLM Deployment (embedded mode) + external-mode helper (Wave 2)
- [x] 09-08-PLAN.md — migrate Job as pre-install/pre-upgrade Helm hook (Wave 2)
- [x] 09-09-PLAN.md — Traefik IngressRoute :443 (api+web) and :8443 (websecure-realtime) + cert-manager (Wave 3)
- [x] 09-10-PLAN.md — OTel Collector DaemonSet + ServiceMonitor wiring (Wave 3)
- [x] 09-11-PLAN.md — Helm test SLO probe + helm-upgrade-matrix.yml + helm-release.yml + operations.md (Wave 4)
**UI hint**: no

### Phase 10: i18n + Docs + OSS Housekeeping
**Goal**: An operator (or contributor) lands on a fully localized (en + ru) runtime with operator-overridable locale resources, complete OSS documentation (README, architecture, operations, LiteLLM spec, wire contract, auth, ADRs), and the OSS housekeeping (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, Apache-2.0 LICENSE) needed to accept the first community contribution.
**Depends on**: Phase 9
**Requirements**: I18N-01, I18N-02, TEST-I18N-01, DOCS-01, DOCS-02, DOCS-03, DOCS-04, DOCS-05, DOCS-06, DOCS-07, DOCS-08
**Success Criteria** (what must be TRUE):
  1. All runtime user/operator-facing strings (UI copy, email templates including subject lines, notification text, end-user error messages) use i18next + i18next-icu with `en` (default) + `ru`; CLDR plural rules are applied (Russian one/few/many/other handled correctly with boundary-case snapshot tests); `Accept-Language` negotiation drives API responses.
  2. Locale resources are operator-overridable via mounted volume / config map without forking; a TEST-I18N-01 CI gate fails when a key exists in `en` but is missing in `ru` (or vice versa); ESLint forbids string literals in user-facing surfaces.
  3. The full documentation suite is shipped: `README.md` with < 5min quickstart, `docs/architecture.md` with mermaid diagrams of the three hot paths, `docs/operations.md` (deploy / upgrade / scale / backup / restore / troubleshoot), `docs/litellm-target-spec.md` (already created in Phase 3), `docs/wire-contract.md` referencing upstream specs and listing v2-deferred endpoints (Stripe / referrals), `docs/auth.md` covering OIDC plug-in + email+password + channel-scheme handling.
  4. `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, Apache-2.0 LICENSE with license headers are present; ADRs exist for every Key Decision listed in PROJECT.md.
  5. Tests written first (TDD); all CI checks green.
**Plans**: 4 plans
Plans:
- [x] 10-01-PLAN.md — Server i18n (API + Worker): i18next + ICU + http-middleware, error-envelope translation at setErrorHandler, worker TemplateRenderer (3 templates), users.locale column, TEST-I18N-01 gate
- [x] 10-02-PLAN.md — Web Russian translations + locale negotiation: NEXT_LOCALE cookie + Edge middleware + RSC layout, 200+ key ru bundles, language switcher, /api/locale route
- [x] 10-03-PLAN.md — Docs suite: docs/architecture.md, docs/i18n.md, docs/security.md (new); README + operations.md + auth.md + wire-contract.md + litellm-target-spec.md extensions
- [x] 10-04-PLAN.md — CLOSED (SUMMARY at .planning/phases/10-*/10-04-SUMMARY.md); OSS housekeeping: SPDX header codemod + CI gate, CODEOWNERS, ISSUE_TEMPLATE, CoC 2.1 audit, CONTRIBUTING/SECURITY extension, ADRs 0004-0011. Tick reconciled 2026-05-18.
**UI hint**: no


### Phase 13: E2E + CJM Harness (v2 — ships first) ✅ CLOSED 2026-05-14
**Goal**: Every subsequent v2 phase writes its tests RED against a Cucumber+Playwright harness that boots the real docker-compose stack — happy-path-only tests that ship bugs green (TD-13.a/d) become structurally impossible.
**Depends on**: Phase 11 (v1 closed)
**Requirements**: E2E-01, E2E-02, E2E-03, E2E-04, E2E-05, E2E-06, E2E-07, E2E-08, E2E-09, E2E-10, E2E-11, E2E-12
**Success Criteria** (what must be TRUE):
  1. `make e2e-cjm` boots the docker-compose stack on a clean clone, runs the Cucumber+Playwright suite against `web.localhost` + `api.localhost`, and exits 0 with every happy-path scenario AND its negative twin GREEN; the same suite runs in GHA on every PR via the `E2E_CJM=1` job.
  2. `docs/customer-journeys.md` enumerates ~20 named journeys with `@cjm-N.M` Gherkin tags; every happy path has at least one negative twin (no journey ships happy-path-only); the signup → verification-email → verified state journey round-trips through Mailpit's HTTP API end-to-end against the real worker.
  3. The single atomic commit that ships the harness ALSO replaces `apps/worker/src/index.ts:68-134` `noopSender` with a real nodemailer-backed `EmailSender` extracted to new `packages/email/` — Phase 12's signup-verify flow is functional from this commit forward.
  4. testcontainers leaks are closed: `tools/global-vitest-teardown.ts` + SIGINT/SIGTERM hook drop orphan containers locally, CI runs `docker container prune --filter label=org.testcontainers=true` in `always()`; ESLint rule blocks the `getAllByText(...).length.toBeGreaterThan(0)` weak-assertion family, and the existing `apps/web/src/components/screens/auth/__tests__/*.test.tsx` files are swept to `toHaveLength(1)` where exclusivity matters.
  5. Readiness probes (not just liveness) gate scenario start; per-scenario tenant isolation enforced; retry-on-flake is BANNED in CI config (a flake IS a bug — PITFALLS §5). Phase verifier reports PASSED with ≥ 90/90/90/90 coverage on diff and live e2e green.
**Plans:** 2 plans
- [x] 13-01-PLAN.md — harness scaffold + packages/email/ + worker noopSender removal + global-vitest-teardown + lint-weak-assertions + 7-site sweep + readiness probe + @cjm-1.1/1.2 reference scenarios (ATOMIC commit `17c603e`)
- [x] 13-02-PLAN.md — docs/customer-journeys.md + lint-cjm-doc + 7 remaining feature files (@cjm-2..8) + @expected-red downstream scenarios for Phases 12/15 (ATOMIC commit `df91de2`)
**UI hint**: yes
**Open question (deferred to `/gsd-discuss-phase 13`)**: Cucumber+Playwright+playwright-bdd (locked per REQUIREMENTS.md E2E-01) vs plain `@playwright/test` with `describe('@cjm-N.M', …)` tags (ARCHITECTURE alternative). Cucumber is authoritative for v2 roadmap — may be revisited in discuss-phase.

### Phase 12: Admin Onboarding Wizard + UI-SPEC Conformance Audit (v2)
**Goal**: A fresh operator goes from `git clone && docker compose up` to a logged-in admin in one wizard pass with zero bcrypt-in-`.env` traps, and every auth screen renders only the OIDC providers the operator actually configured.
**Depends on**: Phase 13 (harness + real `EmailSender` worker)
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-06, UICONF-01, UICONF-02, UICONF-03, UICONF-04, UICONF-05, UICONF-06, UICONF-07
**Success Criteria** (what must be TRUE):
  1. First-run operator visits `/setup`, completes a single-page wizard (email + password + display name + workspace + timezone), and is logged in as an admin; the `setup_state` enum state machine (`pending` / `completed` / `skipped_legacy`) gates the route — NOT a naive users-count check (closes TD-12.b duplicate-admin trap on v1-upgrade installs).
  2. `/admin` returns a real index page (no longer the TD-12.a 404); basicauth-htpasswd remains documented in `docs/operations.md` as the break-glass recovery path; the bcrypt-`$$`-in-`.env` escape trap is removed by the wizard for fresh installs.
  3. `GET /api/capabilities` (or `/api/auth/providers`) returns the configured OIDC providers + email-verification status; auth screens (`SignInForm`, `SignUpForm`, `OidcButtons`, `VerifyEmailClient`) render zero social buttons when zero providers are configured (closes TD-12.c capability drift + 404 → 429 lockout cascade).
  4. Auth screens conform semantically to `design-canvas.jsx` + `UI-SPEC-end-user.md` + `UI-SPEC-admin.md` (assertions in `tests/conformance/ui-spec/` — NOT pixel-diff); per-field Zod errors render in en+ru (no bare "Invalid input"); duplicate-banner regression in SignUpForm fixed (exactly one banner element); resend-verification CTA on sign-in 403 screen; axe a11y baseline shows zero violations on auth screens.
  5. Phase 13 Gherkin journey `@cjm-admin-onboarding` is GREEN before merge; phase verifier reports PASSED with ≥ 90/90/90/90 coverage on diff and live e2e green.
**Plans**: 5 plans
Plans:
- [x] 12-01-PLAN.md — setup_state singleton schema + 0017 migration + users.role + Better Auth additionalFields.role (input:false)
- [x] 12-02-PLAN.md — Public /api/auth/providers + authed /api/capabilities + shared listConfiguredOidcProviders helper (D-08 zero-drift)
- [x] 12-03-PLAN.md — Idempotent POST /api/setup/admin + /setup wizard page + vendored shadcn-stepper + UICONF-03 zod-i18n
- [x] 12-04-PLAN.md — Auth screens consume /api/auth/providers + UICONF-06/07 fixes + /admin index page + ADMIN-05 ops docs
- [x] 12-05a-PLAN.md — UICONF-04 Vitest+RTL conformance suite (6 files) with JSX-oracle citations
- [x] 12-05b-PLAN.md — UICONF-05 axe baseline (5 routes) + flip 5 @cjm scenarios GREEN
**UI hint**: yes

### Phase 14: Slim Core + BYOK Profiles (v2)
**Goal**: Bare `docker compose up` brings up exactly the 6 services a corporate operator needs (api+web+worker+postgres+valkey+litellm), and observability / storage / ingress / pgbouncer / dev-tools land only when the operator explicitly opts in.
**Depends on**: Phase 13 (every change asserted via Gherkin journey)
**Requirements**: SLIM-01, SLIM-02, SLIM-03, SLIM-04, BYOK-01, BYOK-02, BYOK-03
**Success Criteria** (what must be TRUE):
  1. `docker compose up` with NO flags brings up exactly 6 services (api, web, worker, postgres, valkey, litellm) on a clean clone using `.env.slim.example` (~5 keys); the inverted-`profiles:` trap (TD-14.f / deferred-items #3a) is closed — universal services carry no `profiles:` key.
  2. Opt-in overlays under `compose/` (`docker-compose.observability.yml`, `.storage.yml`, `.ingress.yml`, `.pgbouncer.yml`, `.dev-tools.yml`) layer additively; Mailpit lives ONLY in `dev-tools` (TD-14.a); each overlay has a 1:1 Helm `*.enabled` toggle on `charts/openwhispr/values.yaml` (`observability.enabled`, `storage.enabled`, `pooler.enabled`, `tls.enabled`, `mailpit.enabled`).
  3. BYOK env contracts (`S3_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `INGRESS_BASE_URL`, `SMTP_HOST`) are documented in `docs/operations.md` with the matrix of which overlay each unlocks; the api refuses to start (loud-fail) when an overlay is OFF AND the corresponding BYOK env is unset (e.g., storage overlay off AND `S3_ENDPOINT` unset → api exits non-zero at boot with a typed error code).
  4. The full worker noop audit at `apps/worker/src/index.ts:68-92` is closed — ALL three (`noopSender` (already fixed in Phase 13), `noopLitellmKeyClient`, `noopUserKeyLookup`) are either replaced with real adapters or loud-fail at worker boot when their backing config is absent.
  5. Phase 13 Gherkin scenarios `@cjm-byok-storage`, `@cjm-byok-observability`, `@cjm-loud-fail-misconfig` are GREEN; phase verifier reports PASSED with ≥ 90/90/90/90 coverage on diff and live e2e green.
**Plans**: 7 plans (4 waves)
- [x] 14-01-PLAN.md — Slim-core base: delete profiles, strip overlay services, add api/web host ports (Wave 1)
- [x] 14-02-PLAN.md — .env.slim.example + bootstrap.sh env-overridable + BYOK matrix in operations.md (Wave 1)
- [x] 14-03-PLAN.md — Six compose overlays + Grafana datasource + Makefile + cjm harness + parity allowlist (Wave 2)
- [x] 14-04-PLAN.md — byok-guard module + OTel =disabled sentinel + boot-order wire-up (Wave 2, TDD)
- [x] 14-05-PLAN.md — Virtual-key-rotation removal + transient Valkey cleanup + log-scrub rewrite (Wave 3)
- [x] 14-06-PLAN.md — Helm 5 toggles (observability umbrella, storage, tls, pooler flip, mailpit informational) + helm-unittest (Wave 3)
- [x] 14-07-PLAN.md — Gherkin authoring: @cjm-byok-storage, @cjm-byok-observability, @cjm-loud-fail-misconfig + bootStack envOverrides (Wave 4)
**UI hint**: no
**Open question (deferred to `/gsd-discuss-phase 14` or 15)**: Phase 14 ↔ 15 order swap — user-confirmed order (13→12→14→15→…) vs ARCHITECTURE's recommendation to swap (13→12→15→14→…) so the Phase 15 `compose/` reorg precedes Phase 14's overlay authoring. User order is authoritative for v2 roadmap; ARCHITECTURE alternative sidebar logged here.

### Phase 15: Repo Refactor + FSL Relicense + History Scrub (v2)
**Goal**: The repo's structure stops fighting the framework (Traefik host split eliminates `/api/locale` 404 shadowing), the license switches from Apache-2.0 to FSL-1.1-ALv2 across every surface (LICENSE + 675 SPDX headers + every workspace `package.json` + every Docker LABEL + every README badge), and `speaches-audio.md` is scrubbed from git history — bundled as ONE release event so contributors absorb one force-push, not two.
**Depends on**: Phase 14 (overlay structure must exist before `compose/` reorg)
**Requirements**: STRUCT-01, STRUCT-02, STRUCT-03, STRUCT-04, STRUCT-05, STRUCT-06, STRUCT-07, FSL-01, FSL-02, FSL-03, FSL-04, FSL-05, FSL-06, FSL-07
**Success Criteria** (what must be TRUE):
  1. Test-layout convention codified in `docs/conventions.md` (recommendation: `apps/<app>/tests/{unit,integration}/` full split; `tests/e2e-cjm/` at root); `Phase15-MOVE-INVENTORY.md` exists BEFORE any move PR; `compose/` directory holds every compose YAML; route-group naming convention (`(admin)` / `(public)` / `(authed)`) documented or eliminated; `apps/web/public/.gitkeep` committed (closes deferred-items #2).
  2. Traefik host split — `web.localhost` routes to Next.js, `api.localhost` routes to Fastify; the `/api/locale` 404 shadowing (TD-15.g) is closed; Better Auth `trustedOrigins` updated; Phase 13 Playwright `baseURL` follows the new hosts; the Phase 17 mkcert host list (`web.localhost`, `api.localhost`, `app.localhost`, `grafana.localhost`, `mailpit.localhost`) is what gets trusted.
  3. License surface fully migrated to FSL-1.1-ALv2: root `LICENSE` replaced; `MIGRATING.md` published with 7-day notice; pre-scrub tag captured; `reuse` codemod sweeps every `.ts/.tsx/.js/.sh/.py/.sql/.yaml/.yml` SPDX header (~675 files); every workspace `package.json` `license` field updated; every Docker `LABEL org.opencontainers.image.licenses` updated; README badges updated; `REUSE.toml` + `reuse lint` CI gate green; DCO `Signed-off-by:` required in `CONTRIBUTING.md`; retroactive existing-contributor consent thread linked from ADR `docs/adrs/0013-fsl-relicense.md`.
  4. `git filter-repo --path speaches-audio.md --invert-paths` history scrub executed and bundled with the FSL relicense as ONE force-push (PITFALLS §10 — two force-pushes amortise badly); branch-protection lock → scrub → unlock → push → re-lock runbook published; CI cache invalidation documented; signed-commit re-signing path documented.
  5. Phase 13 Gherkin scenarios continue GREEN against the new hosts (no regression); phase verifier reports PASSED with ≥ 90/90/90/90 coverage on diff and live e2e green.
**Plans**: TBD (recommended sub-plan split per research SUMMARY.md — 15.a structural reorg + Traefik host split + test layout codification; 15.b FSL codemod + history scrub — 15.b is irreversible-history-rewrite and OWNS its atomic window).
**UI hint**: no
**Open question (deferred to `/gsd-discuss-phase 15`)**: Helm in monorepo (current lean) vs separate repo (TD-15.d original proposal). Marked TBD on STRUCT-03 — decision belongs to discuss-phase outcome.

### Phase 16: Phase-Tag Comment Audit (v2)
**Goal**: approximately 754 stale `// Phase XX / Plan YY / D-ZZ` header comments in `apps/` + `packages/` are swept against the "no comments unless WHY is non-obvious" rule, and the codebase stops carrying historic provenance that no longer earns its keep — without burying readers in 754 atomic commits.
**Depends on**: Phase 15 (FSL codemod rewrites every SPDX header — running 16 first means redoing 16 after 15)
**Requirements**: COMMENT-01, COMMENT-02, COMMENT-03, COMMENT-04
**Success Criteria** (what must be TRUE):
  1. The regex-on-text codemod (NOT AST traversal; ts-morph dep reserved for a deferred inline-comment phase) audits approximately 754 phase-tag header comments in `apps/` + `packages/` (originally cited as 771 pre-Phase-15; delta = file deletions during structural reorg); tests/tools/.planning are explicitly OUT of audit scope per the scope correction (TECH_DEBT's "1642" figure double-counted them).
  2. A per-area sweep canary (smallest area first — `apps/worker`) lands BEFORE the larger-area sweeps, with REMOVE / KEEP classification per CLAUDE.md policy: REMOVE = comment merely re-states the phase number a reader can derive from the surrounding code; KEEP = comment explains a non-obvious WHY the code itself cannot. Heuristic-only with conservative-KEEP defaults on ambiguity.
  3. A lint regression rule (tsx CLI per Phase 15-01 pivot — `tools/lint-phase-tag-comments.ts`) lands in the same phase preventing re-introduction of `// Phase XX` / `// Plan YY` / `// D-ZZ` provenance comments in future code (existing exemptions documented).
  4. The sweep is delivered as per-area atomic commits (each area < ~300 files for comment-only deletions per Phase 15-03 precedent) — NEVER 754 atomic commits; reviewer can read the diff in a single sitting.
  5. Phase verifier reports PASSED with ≥ 90/90/90/90 coverage unchanged (no behavior changes — comment-only sweep); live e2e green; no Phase 13 Gherkin regression.
**Plans**: 2 plans
  - [ ] 16-01-PLAN.md — Codemod + lint rule + wiring (audit/fix CLI; lint CLI; allowlist; pnpm/lefthook/CI triad; conventions doc)
  - [ ] 16-02-PLAN.md — Per-area sweep (worker → packages → web → api/tests → api/src) + ROADMAP/REQUIREMENTS wording fix + inline ME-02 issue body
**UI hint**: no

### Phase 17: Trusted Local TLS + Production ACME (v2)
**Goal**: A first-time operator runs `make tls-trust` once, and `https://web.localhost` / `https://api.localhost` open in their browser without a cert warning; production deploys with `--with-ingress` (compose) or `ingress.enabled=true` (Helm) wire up Let's Encrypt ACME automatically.
**Depends on**: Phase 15 (host split locks the canonical mkcert host list)
**Requirements**: TLS-01, TLS-02, TLS-03, TLS-04, TLS-05, TLS-06
**Success Criteria** (what must be TRUE):
  1. `make tls-trust` wraps `mkcert -install` + cert generation for the canonical 10-host explicit list (`localhost`, `api.localhost`, `web.localhost`, `app.localhost`, `auth.localhost`, `grafana.localhost`, `minio-console.localhost`, `mailpit.localhost`, `api.example.test`, `auth.example.test`, plus IPs `127.0.0.1` + `::1` — NOT a `*.localhost` wildcard, PITFALLS §13). The host list must match `tools/bootstrap.sh:362-371` byte-for-byte (WR-02 review fix, 2026-05-15). The README quickstart documents `make tls-trust` as step 2 (right after `cp .env.example .env`); a fresh browser does not warn on first run.
  2. Traefik dev profile (`compose/traefik/dynamic.dev.yml`) serves mkcert certs from `compose/traefik/certs/`; production profile (`dynamic.prod.yml`) uses ACME; `--with-ingress` compose overlay auto-wires Let's Encrypt; cert-manager Helm sub-chart (`cert-manager 1.16+`) is gated by `ingress.enabled` on K8s and renders an `Issuer` template.
  3. Dev-cert isolation is enforced — `.dockerignore` excludes `**/rootCA*.pem`; production Dockerfile lint forbids mkcert paths; a Phase 13 Gherkin scenario asserts the production image contains no dev CA artefacts.
  4. Air-gap install path documented for operators without internet access to download mkcert (binary mirroring + manual install steps in `docs/operations.md`); no ship-a-real-CA-root anti-pattern (PITFALLS §13 — CVE territory).
  5. Phase verifier reports PASSED with ≥ 90/90/90/90 coverage on diff; live e2e green; Phase 13 `@cjm-tls-trusted-localhost` scenario GREEN.
**Plans**: 3 plans
  - [ ] 17-01-PLAN.md — Dev toolchain (`make tls-trust`, mkcert wiring, bootstrap.sh SAN de-wildcard, README quickstart)
  - [ ] 17-02-PLAN.md — Isolation enforcement (lint-dockerfile-tls CLI, per-context `.dockerignore`, Phase 17 Gherkin feature, air-gap docs, PITFALLS §16→§13 ref-fix)
  - [ ] 17-03-PLAN.md — Production ACME (Traefik resolver + dynamic.prod.yml + docker-compose.acme.yml overlay) and Helm cert-manager sub-chart (Chart.yaml dep + values extension + issuer.yaml + helm-unittest)
**UI hint**: no

### Phase 18: LDAP / Keycloak SSO — SPEC + ADR Only (v2 — NO code; implementation deferred to v3)
**Goal**: Enterprise operators evaluating self-host see a documented, reviewed path to LDAP/Keycloak SSO with a clear option (a) vs option (b) decision matrix, JIT user provisioning spec, and skeleton red Gherkin scenarios — but v2 ships ZERO production code for SSO so the milestone closes on schedule.
**Depends on**: Phase 13 (red Gherkin scenarios use the harness); orthogonal to all other code phases
**Requirements**: SSO-01, SSO-02, SSO-03, SSO-04, SSO-05
**Success Criteria** (what must be TRUE):
  1. `.planning/phases/18-…/SPEC-ldap-keycloak.md` (≤ 200 lines) documents option (a) Keycloak/Authentik as OIDC frontend over LDAP (recommended — zero Better Auth surgery via existing `genericOAuth` plugin) vs option (b) direct LDAP via `ldapts 8.1.7` + custom Better Auth plugin; decision matrix covers ops cost / corporate familiarity / failure modes / v3-impl LOC estimate.
  2. JIT user provisioning specification covers Better Auth lifecycle hooks, group → role projection, role mapping; the spec names the exact Better Auth extension points it would consume but writes NO code.
  3. Skeleton red Cucumber scenarios live in `tests/e2e-cjm/features/sso/` (tagged `@skip-pending-v3` and excluded from the default run); `compose/test/keycloak.yml` fixture stub committed; v3 plan can `make e2e-cjm SSO=1` and watch them fail meaningfully.
  4. ADR `docs/adrs/0012-ldap-via-keycloak.md` captures the option-(a)-vs-(b) decision after `/gsd-discuss-phase 18`; operator-demand survey documented (PITFALLS §14 prerequisite) — anonymised operator-conversation notes back the option chosen.
  5. Phase verifier reports PASSED — `gaps_found` does NOT trigger on the "no implementation" criterion because Phase 18 is explicitly SPEC-only in v2; the v2 milestone closes with Phase 18 as a `passed_spec_only` artefact.
**Plans**: 1 plan
  - [ ] 18-01-PLAN.md — SPEC + ADR + red Gherkin + Keycloak fixture stub (4 atomic waves: ROADMAP cleanup, SPEC-ldap-keycloak.md, ADR-0012 + operator-demand survey, Gherkin scenarios + compose/test/keycloak.yml + customer-journeys.md rows)
**UI hint**: no
**Open question (deferred to `/gsd-discuss-phase 18`)**: option (a) Keycloak/Authentik vs option (b) direct LDAP. SSO-01 records the decision matrix; the final pick lands in ADR 0012 after discuss-phase.

### Phase 18.1: v2 test-debt closure
**Goal**: Close the v2 milestone debt surfaced by `/V2-MILESTONE-REVIEW.md` and the full `pnpm test` sweep (21 failures / 2293 passed). Make `pnpm test` GREEN, retire stale `@expected-red` tags, backfill Phase 12 + Phase 14 review/security artefacts, and unblock the integration-tests pass. FSL history scrub (15-04) and first real GHA e2e-cjm CI run are explicitly OPERATOR-side and out of scope.
**Depends on**: Phases 12, 13, 14, 15, 16, 17, 18 (v2 milestone closure); none of the v2 prod-code phases is reopened — this is a strict additive fix-up.
**Requirements**: Derived from `.planning/V2-MILESTONE-REVIEW.md` (top-7 followups) + `pnpm test` sweep failures.
**Success Criteria** (what must be TRUE):
  1. `pnpm test` exits 0 across all workspaces; the 7 unique failures classified in V2-MILESTONE-REVIEW are GREEN or explicitly @skip with documented reason. Specifically: `apps/worker/tests/unit/jobs/partman-maintenance.test.ts`, `apps/worker/tests/unit/lib/with-system-context.test.ts`, `apps/api/tests/unit/routes/agent/stream.test.ts` (Test 16), `apps/api/tests/unit/routes/__tests__/diarization.test.ts` (×2 — `failed` + `cancelled`), `apps/api/tests/unit/routes/tokens/__tests__/rate-limit-isolation.integration.test.ts` (T3), `apps/web/src/components/screens/account/__tests__/AccountClient.test.tsx`.
  2. The 4 stale `@expected-red` Gherkin tags — `@cjm-3.1` (password-reset), `@cjm-4.1` (transcribe), `@cjm-1.4` (signup-verify locale ru), `@cjm-6.1` (locale-switch) — are either FLIPPED to GREEN (tag removed) or moved to a different `@after-phase-N` with a justified ADR/note. `tools/lint-cjm-doc.ts` Mode-3 stays green.
  3. Source-contract path bugs from Phase 15-02 STRUCT regression are fixed in a forward-compatible way: tests use `import.meta.url` resolution into `../../src/...` or read via package-relative paths; a lint rule (or eslint-no-restricted-syntax) prevents regression — or a lint exemption added to `tools/lint-colocated-tests.ts` documenting the legitimate `__dirname` source-contract pattern.
  4. The diarization route handler at `apps/api/src/routes/diarization.ts` returns the canonical 502 envelope with `jobId` populated for pyannote job statuses `failed` AND `cancelled` (regression: currently returns undefined for jobId). Test added in same atomic commit per CLAUDE.md TDD constraint.
  5. The rate-limit ordering bug at `apps/api/src/routes/tokens/_rate-limit.ts` (or equivalent plugin wiring) is fixed: unauthenticated requests get 401 BEFORE the rate-limit hook fires; `owrl:ip:*` buckets MUST NOT be created by anonymous traffic. **Security-relevant — anonymous DoS vector**. Test asserts bucket-key set unchanged before/after 35 anon requests.
  6. `apps/web/src/components/screens/account/AccountClient.tsx` renders "Active sessions" exactly once (currently leaks into the section description + heading). Test uses `getAllByText` with explicit count assertion per weak-assertion lint rule.
  7. Phase 12 and Phase 14 retroactively get `12-REVIEW.md` + `12-SECURITY.md` and `14-REVIEW.md` + `14-SECURITY.md` artefacts (slim, code-evidence-first; can each be ≤ 200 lines). Spawned via `/gsd-code-review` per phase scope.
  8. ROADMAP.md "Progress Table" (lines 819-838) reflects the actual v2 state: Phase 13/15/16/17/18 marked closed with completion dates; Phase 18.1 added to table.
  9. Pre-existing typecheck failures cataloged in `.planning/deferred-items.md` §14-04 are EITHER fixed in this phase OR re-confirmed deferred-with-justification (no silent rot).
**Plans** (estimate): 3-5 plans
  - [x] 18.1-01-PLAN.md — Path-fix the 3 ENOENT source-contract tests (6 commits TDD pair; 14/14 GREEN per-workspace) ✅ 2026-05-15
  - [x] 18.1-02-PLAN.md — Rate-limit security fix: authRequired skip-tag closes anon DoS bucket vector (2 commits; T3 GREEN + 49/49 sweep) ✅ 2026-05-15
  - [x] 18.1-03-PLAN.md — Diarization status mapping (failed + cancelled → 502 with jobId) (2 commits; 46/46 GREEN) ✅ 2026-05-15
  - [x] 18.1-04-PLAN.md — AccountClient duplicate "Active sessions" copy (2 commits; 7/7 GREEN; h2 preserved per axe baseline) ✅ 2026-05-15
  - [x] 18.1-05-PLAN.md — REPOINT 4 stale `@expected-red` tags → 19.1/19.2/19.3/19.4 + lint-cjm-doc regex extension + §14-04 typecheck re-confirm (drift 7→1) (1 atomic commit) ✅ 2026-05-15
  - [x] 18.1-06-PLAN.md — Backfill 5 audit artefacts (12-REVIEW + 12-SECURITY + 14-REVIEW + 14-SECURITY + 15-SECURITY); fresh adversarial agents; ZERO new HIGH (0/7/16/4 H/M/L/I) ✅ 2026-05-15
  - [x] 18.1-07-PLAN.md — ROADMAP+STATE.md sync + v2 milestone CLOSED-WITH-FOLLOWUP declaration ✅ 2026-05-15
**UI hint**: minor (AccountClient component copy fix)
**Note**: FSL force-push history scrub (Phase 15-04) + first real GHA `make e2e-cjm` run are OPERATOR-side and excluded from this phase. UICONF-05 axe baseline also operator-side.

### Phase 18.1.1: aggregate-sweep test debt + UICONF drift closure
**Goal**: Close (1) the 14 pre-existing test failures revealed by Phase 18.1-07's aggregate `pnpm test` smoke and (2) the auth-screen UI-SPEC conformance drift that Phase 12 left in `passed_with_gaps` state. Two parallel bucket — system test debt + visual conformance.
**Depends on**: Phase 18.1 (V2-REVIEW inventory must close first to isolate signal).
**Bucket A — System test debt** (empirically derived from `pnpm test` aggregate run on commit `85e7308`):
  - SR-A1: Missing `__fixtures__/*.sse` files — `apps/api/tests/unit/lib/sse-parser.test.ts` (5 cases). NOTE: fixtures exist on disk per Phase 18.1 RESEARCH; failure mode is path resolution under aggregate-run, not absence.
  - SR-A2: `@openwhispr/wire-schemas` resolve failure — `packages/contract-tests/tests/unit/*.test.ts` (5 files). NOTE: package directory exists at `packages/wire-schemas/`; build/exports resolution suspect.
  - SR-A3: ESBuild `await` parse errors — multiple integration tests; likely vitest transform regression.
  - SR-A4: Postgres role permissions drift (CREATEROLE on `openwhispr_app`) — `@openwhispr/data` migrate tests.
  - SR-A5: `otel-bootstrap` first-line invariant — `apps/api/tests/unit/otel-bootstrap.test.ts` (2 cases, Phase 14 supersede deferred).
  - SR-A6: `lint-rls.test.ts` — `tools/`.
  - SR-A7: Integration test suites timing out / not isolated under aggregate run (30+ test files); testcontainer cleanup hygiene per `feedback_testcontainers_cleanup_audit.md`.
**Bucket B — UICONF visual drift** (UICONF-05 axe baseline never executed in Phase 12 per V2-MILESTONE-REVIEW; auth screens drift vs `.planning/phases/07-frontend-ui-spec/design/screens-user.jsx` oracle):
  - SR-B1: `AuthShell` wrapper missing from `apps/web/src/app/(public)/sign-in/`, `sign-up/`, `verify-email/`, `setup/` (oracle uses AuthShell per `ScreenSignIn`); current code wraps content in plain `<Card>`.
  - SR-B2: Sign-in screen missing 3 OIDC button cluster per oracle (Continue with Google / GitHub / SSO ghost) — `OidcButtons` exists but layout/spec divergence TBC by visual diff.
  - SR-B3: Password field missing show/hide eye toggle per oracle.
  - SR-B4: Sign-in form missing "Remember this device" checkbox per oracle.
  - SR-B5: "Forgot password?" is muted static text (per D-UX2 design decision in current code) but oracle has it as accent anchor — `D-UX2` decision predates Phase 19.1 (reset-mail). Resolve disposition: keep muted until 19.1 ships OR add disabled-state anchor with title="coming soon".
  - SR-B6: UICONF-05 axe baseline EXECUTED at least once locally + recorded; failing assertions HALT, no silent skips.
**Success Criteria** (what must be TRUE):
  1. `pnpm test` exits 0 across all 296 test files / 2675 tests; no `--no-verify` anywhere.
  2. Per-category root-cause hypothesis EITHER fixed OR documented as testcontainer-availability gate (Docker MUST be running, real Postgres testcontainer required) in `docs/operations.md`.
  3. `tests/e2e-cjm` GHA workflow first-run executed locally OR documented as operator-deferred with concrete unblock recipe.
  4. Auth screens (sign-in / sign-up / verify-email / setup) visually conformant with `screens-user.jsx` oracle to within UICONF-05 axe baseline tolerance; visual regression test pinned via Playwright screenshot OR Chromatic OR equivalent.
  5. UICONF-05 axe baseline file committed and asserted green by `make test-axe-baseline` (target added if not present).
**Plans**: 8-10 plans (TBC at /gsd-discuss-phase 18.1.1)
**Note**: Phase 18.2 originally carved for auth-redesign; merged into 18.1.1 Bucket B per user direction "не отложить — исправить сейчас".
**Open question**: Are bucket-A failures debt or constitutional regressions? Verifier must categorize via `git log --oneline -- <failing-test>` per file. SR-B5 forgot-password disposition pending.

### Phase 18.1.2: infrastructure-bound test debt — CLOSED 2026-05-15
**Goal (delivered)**: Resolve testcontainer port-exhaustion + 4 non-infra failures via D-02 Docker probe, D-03 shared-pg fixture (15→1 container collapse for the api integration suite), D-04 schema isolation, D-05 singleThread (deferred per HALT-3 option c — withReuse() solo), D-07 BYOK throw-not-exit, D-08 audio path Δ-1 (4-ups→5-ups), D-09 otel onSignal export, D-10 locale en+ru parity, D-11/12 CI Ryuk-disabled + post-step cleanup, D-13 ops docs (local-dev test prerequisites).
**Depends on**: Phase 18.1.1 (closed); Phase 18.1 reaper-helper infrastructure (`tools/testcontainer-reaper-setup.ts`) carried in.
**Requirements** (post-D-24 scope reduction):
  - SR-1: 27 `@openwhispr/api` testcontainer-dependent integration suites — **delivered** via shared-pg + Option A migration across clusters #1 (4 files) + #2 (16 files in apps/api per Δ-2)
  - SR-2: ~~5 `tools/lint-rls.test.ts` partman fixture cases~~ — **DROPPED per D-24**; deferred to D-A2 forward work (out of port-exhaustion scope)
  - SR-3: 3 `@openwhispr/worker` BullMQ + Valkey suites — **delivered** via testcontainer hygiene + Ryuk-disabled CI
  - SR-4: 3 `@openwhispr/data` ledger/migration/audit-log infra suites — **delivered** via setupFile correctness + shared-pg
  - SR-5: 1 `@openwhispr/web` locale-coverage mismatch — **delivered** (D-10/D-21: en+ru parity + AccountClient fixture)
  - SR-6: ~~1 helm-unittest fixture~~ — **DROPPED per D-24**; verified GREEN 163/163 pre-phase, no work needed
  - SR-7: otel-bootstrap signal-handler test — **delivered** (D-09 process.exit mock in test; onSignal export not needed)
  - SR-8: aggregate `pnpm test` exits 0 on Docker-running machine — **delivered** with documented pre-existing 33-failure ledger (SERVER-ERRORS.md Entries 1-5) NOT introduced by Phase 18.1.2 surface
**Success Criteria (delivered surface)**:
  1. Docker availability probe (`tools/testcontainer-availability.ts`) sets `OPENWHISPR_SKIP_TESTCONTAINERS=1` env so integration tests `describe.skip` cleanly when Docker is absent (D-02).
  2. shared-pg fixture + `TESTCONTAINERS_REUSE_ENABLE` collapse 15 per-test containers → 1 reused container across the api integration suite (D-03).
  3. Cluster #1 (4 files) + cluster #2 (16 files in apps/api) migrated to shared-pg via Option A canon (D-04 schema isolation).
  4. CI workflow `.github/workflows/ci.yml` test job aligned with `e2e-phase6-quick` (Ryuk-disabled + post-step sweep) (D-11/12).
  5. `docs/operations.md` "Local development test prerequisites" section published (Docker, mkcert, pnpm-workspace order, `make tls-trust`) (D-13).
  6. v2.1 milestone advances from `CLOSED-WITH-FOLLOWUP` → `CLOSED` (Phase 18.1.1 followup work resolved here).
**Plans**: 6 plans (~26 atomic commits, ZERO production edits — hard rule from CLAUDE.md upheld throughout).
  - [x] 18.1.2-01-PLAN.md — Docker probe + setupFile correctness (D-02) ✅ 2026-05-15
  - [x] 18.1.2-02-PLAN.md — shared-pg fixture + singleThread + reaper hardening (D-03/04/05) ✅ 2026-05-15
  - [x] 18.1.2-03-PLAN.md — integration cluster #1 migration (4 files) + pgpartman image fix ✅ 2026-05-15
  - [x] 18.1.2-04-PLAN.md — Bucket B + C fixes (BYOK + audio Δ-1 + otel + locale) ✅ 2026-05-15
  - [x] 18.1.2-05-PLAN.md — integration cluster #2 (16 files in apps/api) + CI/CD adoption + ops docs ✅ 2026-05-15
  - [x] 18.1.2-06-PLAN.md — ROADMAP + STATE sync + v2.1 milestone CLOSED declaration ✅ 2026-05-15
**Open question (resolved)**: Docker availability is a **soft gate** via `tools/testcontainer-availability.ts` probe — sets `OPENWHISPR_SKIP_TESTCONTAINERS=1` env so integration tests `describe.skip` cleanly. Documented in `docs/operations.md` (D-13). Hard gate via CI config (D-11/12) requires Docker daemon up on the test job.

### Phase 19: Server-error closure (production-fix phase)
**Goal**: Resolve production-side defects accumulated in `.planning/phases/08-client-server-audit/SERVER-ERRORS.md` Entries 1-5 (surfaced by Phases 18.1.2 + earlier under CLAUDE.md Hard Rule #1 "never edit prod from test-debt phases"). This is THE explicit production-fix phase — every entry has user-approved scope.
**Depends on**: Phase 18.1.2 (SERVER-ERRORS.md ledger initialized). CLAUDE.md Hard Rule #1 carries: each entry was deferred from a test-debt phase; this phase reads the ledger + executes the suggested production fixes.
**Requirements** (one per SERVER-ERRORS.md Entry):
  - SR-19.1: Migration SQL schema-aware refactor — Entry 1 (production migration `public.tenants` FK refs blocking test isolation). Decision: Option (i) strip `"public".` prefixes OR Option (ii) `OPENWHISPR_DB_SCHEMA` env knob. Advisor recommends in discuss-phase.
  - SR-19.2: Fastify FastifyRequest types — Entry 2 (`apps/api/src/types/fastify.d.ts` with `declare module 'fastify'` for `user` + `tenant` decorators). Closes Phase 14-04 typecheck-deferral root cause.
  - SR-19.3: BYOK guard refactor `process.exit(1)` → `throw BYOKGuardError` — Entry 4. Export `BYOKGuardError` class. Update `apps/api/src/index.ts:54-56` + `apps/worker/src/index.ts:7-9` callers to catch+log+exit. Library throws; entrypoint exits.
  - SR-19.4: otel-bootstrap export `onSignal` — Entry 5 (single-character `export` keyword). Allows test to invoke directly without SIGTERM-emit cascade.
  - SR-19.5: docs/operations.md "Local development test prerequisites" — Entry 3 follow-up. Document `openwhispr/postgres:17.5-pgpartman` image + `make build-pg-partman` (if target) or `docker pull` registry path.
**Success Criteria**:
  1. SERVER-ERRORS.md Entries 1-5 transition `Owner: unassigned` → `Owner: Phase 19 (commit <SHA>)` + linked atomic commits.
  2. `pnpm typecheck` exit 0 (closes Phase 14-04 deferral via SR-19.2 + SR-19.3).
  3. `pnpm test` aggregate: 0 failed (from 8 residual after Phase 18.1.2 — these are the entries we close).
  4. Phase 18.1.2 test-side workarounds removed where production fix supersedes (BYOK test mocks reverted to real assertion; otel test reverted to direct invoke; locale-coverage already real).
  5. Phase 14-04 typecheck deferred-items entry updated to CLOSED.
**Plans**: 3-5 plans (TBC at /gsd-discuss-phase 19).
**Open question**: SR-19.1 production migration strategy — Option (i) strip `public.` prefixes from 18 migrations + re-stamp `_journal.json` hashes OR Option (ii) introduce `OPENWHISPR_DB_SCHEMA` env knob. Multi-tenant + RLS implications differ. Advisor decides.

### Phase 19.1: reset-mail wiring (sendResetPassword) — CLOSED 2026-05-16
**Goal (delivered)**: Flip `@cjm-3.1` (password-reset) from `@expected-red @after-phase-19.1` to GREEN. Wire Better Auth `sendResetPassword` lifecycle hook to enqueue a `password_reset` email through the existing worker email pipeline. Adds the missing downstream code for the first of 4 repointed `@cjm` tags from Phase 18.1-05.

**Outcome**: Hook + 10 unit tests landed via commits `664f979` / `c8be1f5` / `e703314` (Plan 01). End-to-end validation deferred at Plan 01 close (compose-stack defects) — closed in cascade by Phase 19a (byok-guard Dockerfile + cucumber + Drizzle role) + Phase 19b (Traefik STRUCT-05 + locale auth opt-out). Final proof: `make e2e-cjm SCENARIO="@cjm-3.1"` → 1/1 GREEN (1.2s) on 2026-05-16. Plan 02 (round-trip extension) NOT executed — the `@cjm-3.1` scenario already exercises signup → request-reset → mailpit fetch → `/api/auth/reset-password` → re-sign-in with new password; explicit Plan 02 round-trip would be redundant coverage.
**Depends on**: Phase 13 (E2E CJM harness), Phase 19 (BYOK + Fastify types green for clean integration baseline).
**Requirements**:
  - SR-19.1.1: `apps/api/src/auth.ts` Better Auth config registers `emailAndPassword.sendResetPassword({ user, url, token }, request)` lifecycle hook that calls the email enqueue path.
  - SR-19.1.2: `packages/email/src/templates/password-reset.ts` (NEW) — i18n-aware template (en+ru parity per D-43 Phase 14) with subject + body + CTA URL.
  - SR-19.1.3: Worker BullMQ job processes `password_reset` jobs and dispatches via `EmailSender` (existing).
  - SR-19.1.4: `tests/e2e-cjm/features/password-reset.feature` `@cjm-3.1` scenario flips from `@expected-red` to GREEN: signup → request reset → mailpit shows email with reset URL → POST `/api/auth/reset-password` with token → sign-in with new password succeeds.
  - SR-19.1.5: Step definitions in `tests/e2e-cjm/steps/password-reset.steps.ts` cover the full round-trip (already real per Phase 18.1-A3, may need extension).
**Success Criteria**:
  1. `@cjm-3.1` scenario GREEN against full compose stack (api + worker + mailpit + valkey).
  2. en+ru i18n parity for template subject + body in SAME atomic commit.
  3. `pnpm test` per-package GREEN; no new failures introduced.
  4. `docs/customer-journeys.md` `@cjm-3.1` row updated (remove `@expected-red` annotation).
**Plans**: 2-3 plans (TBC at /gsd-discuss-phase 19.1).
**Open question**: Email template format — plain text + HTML, or HTML-only? React-email or hand-rolled? Advisor decides per existing `packages/email/src/EmailSender.ts` conventions.

### Phase 19a: compose infra hot-fix (byok-guard Dockerfile + cjm-lint @after-docker-up) — CLOSED 2026-05-16
**Goal**: Unblock all compose-based e2e harness runs (Phase 13 cjm, Phase 17 TLS, traefik-host-split, locale-switch — every `@expected-red @after-phase-19.*` repointed scenario plus all 6 `@after-docker-up` ones). Close SERVER-ERRORS.md Entries 7 + 8.
**Depends on**: Phase 19.1 (surfaced Entries 7+8). Hard rule INVERSION authorized per ledger-consuming-phase pattern (mirrors Phase 19 authorization for Entries 1-5).
**Requirements**:
  - SR-19a.1: `apps/api/Dockerfile` adds `packages/byok-guard/` to both builder-stage manifest list (after line 55) AND source-copy block (after line 69) AND prod-deps manifest list (after line 98). Mirrors Phase 13 `packages/email/` insertion pattern.
  - SR-19a.2: `apps/worker/Dockerfile` adds `packages/byok-guard/` to builder + prod-deps manifest lists (after existing observability/email blocks).
  - SR-19a.3: `tools/lint-cjm-doc.ts` accepts `@after-docker-up` as a valid `@expected-red` pairing alongside `@after-phase-N`. Unit test extension in `tools/__tests__/lint-cjm-doc.test.ts` covers both forms.
  - SR-19a.4: Verify `docker compose -p e2e-cjm --profile default build migrate api worker` exits 0 (golden e2e infra gate).
  - SR-19a.5: Verify `pnpm tsx tools/lint-cjm-doc.ts --features tests/e2e-cjm/features --check-expected-red` exits 0 (no offenders).
**Success Criteria**:
  1. Docker build green for migrate + api + worker images.
  2. cjm-doc lint exits 0 with all 6 prior offenders accepting `@after-docker-up`.
  3. `E2E_CJM=1 make e2e-cjm SCENARIO="@cjm-3.1"` reaches scenario execution (passes Plan 19.1-01 round-trip verification — closes Phase 19.1's deferred e2e validation).
  4. SERVER-ERRORS.md Entries 7 + 8 transition to CLOSED with commit SHA owners.
**Plans**: 1-2 plans (Dockerfile fix + cjm-lint fix; trivial scope).
**Estimated**: ~30min total. Hard rule INVERSION authorized for production Dockerfile + lint edits.

### Phase 19b: Traefik STRUCT-05 host-split regression fix — CLOSED 2026-05-16
**Goal (delivered)**: Restore Phase 15 STRUCT-05 host-split — `api.localhost` reaches Fastify, `web.localhost` reaches Next.js — closing SERVER-ERRORS Entry 10. Unblock end-to-end validation of `@cjm-3.1` (Phase 19.1 deferred) AND `@cjm-traefik-host-split[+web]` (Phase 15 deferred since carve).
**Depends on**: Phase 19a (e2e harness build-infra) + Phase 19.1 (sendResetPassword hook).
**Requirements (all delivered)**:
  - SR-19b.1: `tools/lint-traefik-routes.ts` + `tools/lint-traefik-routes.test.ts` — 5 violation classes (V1..V5), 3/3 vitest GREEN, scans both `docker-compose.yml` AND `compose/docker-compose.embedded-litellm.yml` plus dynamic.dev.yml + ingress + static traefik.yml.
  - SR-19b.2: `docker-compose.yml`, `compose/docker-compose.embedded-litellm.yml`, `compose/traefik/dynamic.dev.yml`, `compose/docker-compose.ingress.yml`, `compose/traefik/traefik.yml` — path-B fix (file-provider single source of truth, hybrid for admin auth's env interpolation). Drops the wrong `web@docker` router on Host(api.localhost), corrects upstream port (3001→3000), mounts both dynamic files into `/etc/traefik/dynamic/` (mirroring ACME overlay shape), moves `providers.file.directory:` into static yaml to dodge Traefik 3 merge defects.
  - SR-19b.3: `tests/e2e-cjm/steps/locale.steps.ts` real bindings for @cjm-traefik-host-split[+web] + `tests/e2e-cjm/steps/__tests__/locale.steps.test.ts` (6/6 vitest GREEN per `feedback_cjm_steps_need_unit_tests.md`) + `tests/e2e-cjm/features/traefik-host-split.feature` `@expected-red` removed. Companion production-fix: `apps/api/src/routes/locale.ts` adds `config: { auth: false, … }` (Phase 15 latent bug surfaced when scenario became executable). `Makefile e2e-cjm` target layers ingress overlay + `--build` for fresh image pickup.
**Success Criteria (delivered)**:
  1. `tools/lint-traefik-routes` 3/3 GREEN — regression sentinel + synthetic GOOD/BAD fixtures.
  2. `make e2e-cjm SCENARIO="@cjm-traefik-host-split"` → 2/2 GREEN (684ms) — Phase 15 STRUCT-05 spec satisfied at runtime.
  3. `make e2e-cjm SCENARIO="@cjm-3.1"` → 1/1 GREEN (1.2s) — Phase 19.1's deferred e2e validation closed end-to-end through Traefik+api+worker+mailpit.
  4. SERVER-ERRORS Entry 10 CLOSED with 4 closing commit SHAs.
**Plans** (delivered as 4 sequential commits, ~2h actual including smoke-debug):
  - [x] `b2ebf24` test(19b-01): red — lint-traefik-routes captures STRUCT-05 host-split regression
  - [x] `62d87d7` fix(19b-02): route api.localhost to api-svc, declare web.localhost in file provider
  - [x] `6a5d638` fix(19b-02b): close STRUCT-05 — eliminate duplicate web labels + fix file provider
  - [x] `e82a390` fix(19b-03): unstick @cjm-traefik-host-split[+web] — real bindings + locale auth opt-out
**Hard-rule INVERSION**: production-fix scope authorized per Phase 19a precedent (compose orchestration yaml + locale route are production deploy artifacts; Phase 15 STRUCT-05 Gherkin spec is authoritative).
**Memory lessons captured (~/.claude/projects/-Users-nick-openwhispr-server/memory/)**:
  - `feedback_smoke_before_full_e2e.md` — lint → build → per-service-up → stack → playwright (cheap → expensive), never serialize discovery of independent failures behind 60s compose roundtrips.
  - `feedback_check_loki_after_tests.md` — Loki+Grafana collect everything; first diagnostic is container logs, not playwright trace.zip.
  - `feedback_cjm_steps_need_unit_tests.md` — every `tests/e2e-cjm/steps/*.steps.ts` MUST have vitest unit coverage; coverage waivers banned.

### Phase 19.2: stt-fixture (@cjm-4.1 transcribe-happy-path) — CLOSED 2026-05-16
**Goal (delivered)**: Flip `@cjm-4.1` (transcribe happy-path) from `@expected-red @after-phase-19.2` to GREEN. Wire `/api/transcribe` round-trip against LiteLLM proxy with a deterministic small WAV/MP3 fixture; cjm step bindings assert non-empty transcription text + `content-type: application/json`.

**Outcome**: SERVER-ERRORS Entry 11 surfaced and unfolded into a 3-layer production cascade — all three layers landed atomically under Hard-Rule INVERSION (mirrors Phase 19a/19b precedent):
- Layer 1 (client query-param, `1f60ff0`): append `?model=...` to upstream URL — forward-compat for alt LiteLLM forks.
- Layer 2 (client multipart-injection, `9e1db63`): prepend `Content-Disposition: form-data; name="model"` part to multipart body via PassThrough — canonical LiteLLM proxy reads model ONLY from form data; streaming-no-buffering invariant preserved.
- Layer 3 (LiteLLM config prefix, `c4a49d6`): `compose/litellm/litellm_config.yaml:41` `model: whisper-large-v3` → `model: groq/whisper-large-v3` — LiteLLM Router silently dropped the deployment without provider prefix.
Final verification: `E2E_CJM=1 SCENARIO="@cjm-4.1" pnpm exec playwright test → 1 passed (1.8s)` end-to-end through real Traefik+api+worker+litellm+postgres+valkey+mailpit. Closing commits: `8680485` (vitest unit cov) → `e80b047` (SERVER-ERRORS Entry 11) → `c2a5e79` (client RED) → `1f60ff0` (client GREEN layer 1) → `c5112d9` (route wire-up) → `9e1db63` (client layer 2) → `c4a49d6` (config layer 3 + tag flip + customer-journeys.md).
**Depends on**: Phase 13 (E2E CJM harness), Phase 19a (compose-build infra), Phase 19b (Traefik host-split). Phase 5 audio routes are the canonical wire surface.
**Requirements**:
  - SR-19.2.1: deterministic audio fixture under `tests/e2e-cjm/fixtures/audio/` (~30 KB WAV; SPDX in companion `.license` file per FSL conventions); chosen to produce reproducible non-empty text under faster-whisper-tiny-en in `compose/mock-litellm`.
  - SR-19.2.2: `tests/e2e-cjm/steps/transcribe.steps.ts` real bindings with `undici.fetch` (multipart `audio` field, `application/octet-stream`, signed BA session bearer) against `https://api.localhost/api/transcribe`.
  - SR-19.2.3: `tests/e2e-cjm/steps/__tests__/transcribe.steps.test.ts` vitest unit coverage per `feedback_cjm_steps_need_unit_tests.md` (URL + multipart shape + auth header + response-shape assertions).
  - SR-19.2.4: `tests/e2e-cjm/features/transcribe.feature` — remove `@expected-red` from the happy-path scenario; keep negative twins as-is.
  - SR-19.2.5: ensure default LiteLLM model alias for STT matches mock-litellm's faster-whisper exposure (no env override needed for e2e harness).
  - SR-19.2.6 (smoke-paid escape hatch): a separate `@cjm-4.1-paid` scenario gated by `OPENWHISPR_LOADTEST_ALLOW_PAID=1` proves the OpenAI/Groq cloud path; default scenario stays mock-litellm (per `feedback_loadtest_cost_discipline.md`).
**Success Criteria**:
  1. `make e2e-cjm SCENARIO="@cjm-4.1"` → 1/1 GREEN against full compose stack with mock-litellm.
  2. Step-binding vitest unit coverage ≥ 90/90/90/90.
  3. `docs/customer-journeys.md` `@cjm-4.1` row updated (remove `@expected-red` annotation; add CLOSED date).
  4. ZERO `--no-verify` across all commits; conventional commits per Phase 19a/19b precedent.
**Plans**: 2-3 plans (TBC at /gsd-discuss-phase 19.2). Estimated ~2-3h.
**Open question**: smoke-paid scenario — keep gated behind env in same feature file, or carve to `transcribe-paid.feature`? Advisor decides at discuss-phase.

### Phase 19.3: ba-i18n localized error envelopes (@cjm-1.4) — CLOSED 2026-05-16
**Goal (delivered)**: Flip `@cjm-1.4` (sign-up form validation error in Russian) from `@expected-red @after-phase-19.3` to GREEN. Better Auth error envelopes localize the human-readable `message` field via i18next per `Accept-Language`. Closes UICONF-03 silent-fallback failure mode.

**Outcome**: Better Auth emits its own `{message, code}` envelope from inside its universal handler, bypassing our Fastify error-handler (which only catches THROWN errors). The fix intercepts response bodies with status >= 400 in `apps/api/src/routes/better-auth-handler.ts` and re-serializes them with a localized `message` looked up via `req.i18n.t("errors.<code>", { defaultValue: original })`. Pure-string in/out preserves the streaming contract; short-circuits to original body on missing code/message/req.i18n or unknown code. 13 BA-specific error codes added to `apps/api/src/i18n/locales/{en,ru}.json` with en+ru parity (D-43 Phase 14 convention).

Coverage: 11/11 vitest for `maybeLocalizeBetterAuthError` + 6/6 vitest for the @cjm-1.4 step binding (per `feedback_cjm_steps_need_unit_tests.md`) + 12/12 existing `better-auth-handler.test.ts` regression cases stay GREEN. Production landed via Phase 33 research-cascade commit `c8c6b33`. Final verification: `E2E_CJM=1 SCENARIO="@cjm-1.4" make e2e-cjm` → 1/1 GREEN (127ms).
**Depends on**: Phase 10 (i18next bootstrap + en/ru bundles), Phase 12 (sign-up form), Phase 19a/19b (compose harness GREEN).
**Requirements**:
  - SR-19.3.1: extend i18next en+ru locale bundles in `packages/i18n/locales/{en,ru}/errors.json` with Better Auth validation message keys (per-field messages for invalid email, weak password, etc.); maintain en+ru parity in the SAME atomic commit (D-43 Phase 14 convention).
  - SR-19.3.2: `apps/api/src/auth.ts` Better Auth `errorMessages` (or `messages`) localization hook reads `req.language` (set by i18nPlugin) and replaces `message` with localized string; `code` remains stable English token.
  - SR-19.3.3: Fastify global error handler honors `req.language` for ANY error envelope it emits (not just BA's) — covers existing typed-error codes from Phase 10-01 to ensure consistent localization across surface.
  - SR-19.3.4: `apps/web/` sign-up form renders the server-localized `message` directly; no client-side re-localization needed for server-emitted errors.
  - SR-19.3.5: `tests/e2e-cjm/features/signup-verify.feature` — remove `@expected-red` from `@cjm-1.4` scenario; step bindings assert Russian copy via i18next-loaded fixture phrases (NOT hardcoded strings — avoid translation rot).
  - SR-19.3.6: step bindings + vitest unit coverage per memory rule.
**Success Criteria**:
  1. `make e2e-cjm SCENARIO="@cjm-1.4"` → 1/1 GREEN.
  2. en+ru parity test in `packages/i18n/__tests__/parity.test.ts` (existing) green; CI i18n-completeness gate green.
  3. `docs/customer-journeys.md` `@cjm-1.4` row updated.
  4. Step-binding vitest ≥ 90/90/90/90.
**Plans**: 2 plans (TBC at /gsd-discuss-phase 19.3). Estimated ~1-2h.
**Open question**: Better Auth 1.6.9 message-localization surface — `errorMessages` config vs error-handler middleware vs onAPIError plugin hook? Advisor decides per BA vendored docs.

### Phase 19.4: locale-e2e (@cjm-6.1 en↔ru cookie set)
**Goal**: Flip `@cjm-6.1` (locale-switch end-to-end) from `@expected-red @after-phase-19.4` to GREEN. End-to-end proof: `LanguageSwitcher` writes the `i18next` cookie; subsequent server-rendered pages honor it; `/api/locale` returns the switched locale; `user.locale` persisted on next BA session-touch; worker email template selection (e.g., welcome email) honors the persisted locale.
**Depends on**: Phase 10-02 (web edge middleware + LanguageSwitcher), Phase 19.1 (worker email pipeline), Phase 19b (locale route auth opt-out).
**Requirements**:
  - SR-19.4.1: `apps/web/` `LanguageSwitcher` cookie-write asserted via Playwright DOM interaction (click → cookie present); cookie name + max-age + path + samesite verified.
  - SR-19.4.2: server-rendered subsequent navigation honors the cookie (web edge middleware reads it; SSR locale switches without full-page hard reload).
  - SR-19.4.3: `/api/locale` round-trip returns the cookie-selected locale.
  - SR-19.4.4: `user.locale` column updated on next authenticated request (BA session-touch hook or explicit `/api/profile/locale` endpoint — advisor decides at discuss-phase).
  - SR-19.4.5: worker email job (re-use `password_reset` from Phase 19.1) renders Russian template when `user.locale = 'ru'`.
  - SR-19.4.6: `tests/e2e-cjm/features/locale-switch.feature` — remove `@expected-red` from `@cjm-6.1`; step bindings cover the full chain.
  - SR-19.4.7: step bindings + vitest unit coverage per memory rule.
**Success Criteria**:
  1. `make e2e-cjm SCENARIO="@cjm-6.1"` → 1/1 GREEN against full compose stack.
  2. Mailpit assertion: at least one email body rendered with Russian template-derived markers (subject + greeting).
  3. `docs/customer-journeys.md` `@cjm-6.1` row updated.
  4. Step-binding vitest ≥ 90/90/90/90.
**Plans**: 2-3 plans (TBC at /gsd-discuss-phase 19.4). Estimated ~1-2h.
**Open question**: Should `user.locale` persist via explicit profile endpoint OR auto-sync on BA session-touch? Latter is more transparent but adds an implicit write per request. Advisor decides.

### Phase 20: Compose+Helm Production Guardrails (P0 audit remediation)
**Goal**: Close the production blockers and HIGH-severity findings from the 2026-05-16 compose+Helm audit (`/Users/dev/.claude/plans/synchronous-forging-ripple.md`) so the deployment surfaces meet the 1000-concurrent-user HA SLO target with no resource-governance, crash-recovery, or container-hardening gaps. Both compose (single-host OSS quickstart + load-test profiles) and the Helm chart (cloud HA) must satisfy the same guardrail contract.
**Depends on**: Phase 9 (Helm chart baseline), Phase 14 (slim core + overlay structure), Phase 19b (compose host-split — overlay merge semantics).
**Requirements**:
  - SR-20.1 (compose resource limits): every long-running service in `docker-compose.yml` + every overlay in `compose/*.yml` declares `deploy.resources.limits` (memory, optionally cpu). Postgres ≥ 2G, LiteLLM/api/worker ≥ 512M, web ≥ 384M, observability stack right-sized. New lint script `tools/lint-compose-resources.ts` fails CI when a service is missing limits.
  - SR-20.2 (compose restart policies): Traefik (`compose/docker-compose.ingress.yml`), PgBouncer (`compose/docker-compose.pgbouncer.yml`), MinIO (`compose/docker-compose.storage.yml`), and all 5 LGTM services (`compose/docker-compose.observability.yml`) declare `restart: unless-stopped`. Lint script extension covers this.
  - SR-20.3 (Helm startup probes): `charts/openwhispr/templates/api-deployment.yaml`, `web-deployment.yaml`, `worker-deployment.yaml`, `litellm-deployment.yaml` each declare a `startupProbe` with `failureThreshold: 30`, `periodSeconds: 10` (300 s startup budget) using the existing readiness probe path/port. helm-unittest assertions verify presence on all four Deployments.
  - SR-20.4 (Helm topology spread): every Deployment + the OTel Collector DaemonSet declares `topologySpreadConstraints` with `maxSkew: 1`, `topologyKey: kubernetes.io/hostname`, `whenUnsatisfiable: ScheduleAnyway`, label selector matching the workload. Values-driven so operators can override.
  - SR-20.5 (Helm securityContext): api/web/worker/litellm Deployments get pod-level `securityContext` (`runAsNonRoot: true`, `runAsUser: 1000`, `fsGroup: 1000`, `seccompProfile: { type: RuntimeDefault }`) AND container-level `securityContext` (`readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, `capabilities: { drop: [ALL] }`). Required image-runtime audit: container images must run as uid 1000 — if any image refuses, file an in-phase production-fix sub-task to rebuild it. OTel Collector keeps `runAsUser: 0` (hostmetrics constraint, documented) but gains `allowPrivilegeEscalation: false` + `seccompProfile: RuntimeDefault`. Where `readOnlyRootFS` breaks a service, add a minimal writable `emptyDir` mount and document.
  - SR-20.6 (CI compose-lint job): new `.github/workflows/ci.yml` job `compose-lint` runs `docker compose -f docker-compose.yml -f compose/docker-compose.<overlay>.yml … --profile <p> config > /dev/null` across all 8 profile combinations (default, contract-test, observability, pgbouncer, storage, load-test-mock, load-test-realistic, e2e). Job runs in parallel with helm-lint, gates merge to main.
  - SR-20.7 (test-first per constitutional TDD): every change lands as RED commit (failing lint/helm-unittest/vitest) → GREEN commit. No production-code-only commits without preceding RED.
**Success Criteria** (what must be TRUE after closure):
  1. `tools/lint-compose-resources.ts` exists, has vitest coverage ≥ 90/90/90/90, and exits non-zero on a deliberately broken fixture; runs in CI on every PR touching `docker-compose*.yml` or `compose/**/*.yml`.
  2. Running the lint against the current tree returns 0 violations.
  3. `helm-unittest tests/openwhispr/*.yaml` includes 4 new startupProbe assertions + 4 new topologySpread assertions (api/web/worker/litellm Deployments only; OTel Collector DaemonSet is exempt because the DaemonSet controller already enforces one-pod-per-node — spread would be a no-op, see `20-RESEARCH.md §5`) + ≥ 8 new securityContext assertions (pod + container per workload, plus LiteLLM relaxed-shape assertion and OTel-completion assertion); all helm-unittest cases PASS.
  4. `helm template charts/openwhispr/ --debug | yq` shows every api/web/worker pod spec carries `runAsNonRoot: true` and all three container-level hardening keys (`readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`). LiteLLM is held to a **relaxed hardening shape** (`allowPrivilegeEscalation: false` + `seccompProfile: RuntimeDefault` + `capabilities.drop: [ALL]` only) per the documented Option-A exception — upstream `ghcr.io/berriai/litellm:main-v1.83.14-stable` runs as uid 0 and writes Prisma client to `/app/.prisma`; rebuilding as non-root is filed as deferred-item "LiteLLM non-root image fork".
  5. CI `compose-lint` job is green on `main` and on PR HEAD; deliberately breaking one overlay YAML (test in PR) turns the job red.
  6. Live `helm install` against kind (per Phase 09.1 precedent) lands all pods `1/1 Running` within 90 s — proves new probes don't regress boot time.
  7. `docker compose --profile default up -d --wait` succeeds locally with new restart policies + limits; manual `docker kill` of pgbouncer/traefik/minio/loki/grafana shows container auto-restart within 5 s. **20-01 carries this as a `checkpoint:human-verify` task after Wave A** — operator runs the kill-and-observe shell and signs off before 20-03 proceeds. This flips 20-01's `autonomous: true → false`.
  8. The original audit plan (`/Users/dev/.claude/plans/synchronous-forging-ripple.md`) sections A1–A7 + B1–B3 + C1 all flip from open to resolved.
**Plans** (suggested split; planner to finalize):
  - 20-01 compose resource-limit lint + apply across all services + restart policies (single atomic wave; lint script first per TDD).
  - 20-02 Helm startupProbe + topologySpread + securityContext (split if helm-unittest matrix gets unwieldy; 1–2 plans).
  - 20-03 CI compose-lint job + matrix profile coverage.
**Out of scope** (deferred to P1/P2 from audit roadmap, future phases): POSIX `cap_drop` / `read_only` on compose (audit P1); NetworkPolicy templates (audit P1); HPA/PDB on web+litellm (audit P2); `checksum/config` annotations (audit P2); `docs/SELF_HOSTING.md` (audit P2).

### Phase 31: Constitutional Lockers (v2.2 — ships FIRST as the gate Phases 32–41 are tested against)
**Goal**: A contributor who tries to commit production code containing `as any`, `if (NODE_ENV === 'test')` in a runtime path, a hardcoded `localhost:3000`, a Fastify route without zod, a dead export, an Error class leaking full upstream bodies, or a `bash -c "${DATABASE_URL}"` interpolation finds the commit REFUSED by lefthook AND the PR REFUSED by GitHub Actions CI, with a precise `file:line` + remediation pointer. The four new constitutional rules (11–14) live in `.planning/DISCIPLINE.md` and `CLAUDE.md`, shipped in the SAME atomic commit as the linter source so discipline doc and tool can never drift.
**Depends on**: Nothing (greenfield tooling phase; no production-code edits beyond pre-existing-violation bulk fixes in 31-08).
**Requirements**: LOCKER-01, LOCKER-02, LOCKER-03, LOCKER-04, LOCKER-05, LOCKER-06, LOCKER-07, LOCKER-08, LOCKER-09
**Success Criteria** (what must be TRUE):
  1. `pnpm lint:lockers` runs in CI on every PR and is BLOCKING; the six lockers (`lint-no-env-branches`, `lint-no-suppressions`, `lint-no-hardcode`, `lint-prod-readiness`, `lint-secret-shape-in-error`, `lint-shell-credential-interpolation`) each exit non-zero on a deliberately-broken fixture and exit 0 against `main` HEAD.
  2. Per-locker vitest suites at ≥ 90/90/90/90 (lines / branches / functions / statements) per DISCIPLINE Rule 2. E2E `tests/e2e/lockers.spec.ts` runs each locker binary against a temp file with a known violation and asserts non-zero exit + expected `file:line` in stderr (real binaries, real exit codes, no mocks per DISCIPLINE Rule 4).
  3. A synthetic PR that introduces `if (process.env.NODE_ENV === 'test')` in `apps/api/src/routes/foo.ts`, a route without zod schema, an Error class with `public readonly bodyText: string`, or a `spawn('bash', ['-c', \`...${"$"}{dbUrl}...\`])` is REFUSED by lefthook AND by CI. The `make lint:lockers` target reproduces the same result locally.
  4. `tools/lint-*-allowlist.txt` allowlists seeded with the current main inventory; each entry has a tracking-issue ID; CI fails on any net addition (migration-debt mode).
  5. `.planning/DISCIPLINE.md` Rules 11–14 land + are mirrored to `CLAUDE.md` § Engineering Discipline in the SAME commit as the linter source — phase verifier rejects split commits.
**Plans**: TBD via `/gsd-plan-phase 31` (proposed split: 31-01..06 one locker per plan; 31-07 DISCIPLINE+CLAUDE amend + lefthook + ci.yml + nightly.yml wiring + `make lint:lockers`; 31-08 bulk-fix pre-existing MEDIUM/LOW violations not covered by Phases 32–41).
**UI hint**: no

### Phase 32: RLS fail-closed (v2.2 — CR-7 closure)
**Goal**: Any query that escapes `withTenant()` on a tenant-scoped table RAISES a Postgres permission error (RLS policy denies) instead of silently binding to the default tenant and returning default-tenant rows. The 0000_initial.sql comment claiming "Fail-closed by design" becomes materially true again after Phase 01's `0003_better_auth_tenant_defaults.sql:46-57` regression is reversed.
**Depends on**: Phase 31 (lockers — every edit in this phase must pass `pnpm lint:lockers`).
**Requirements**: CRIT-FIX-01 (also closes HIGH-FIX-DATA HI-04 multiplier on the same finding).
**Success Criteria** (what must be TRUE):
  1. Migration `0018_rls_fail_closed.sql` exists; reverses `ALTER ROLE openwhispr_app SET app.tenant_id` from 0003; drops the GUC-bound `tenant_id` column DEFAULT on the four Better Auth tables; RLS policies use `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid` (NULLIF avoids the PG-planner short-circuit hazard of an explicit AND-chain). Migration applies clean forward on real Postgres in CI (per TEST-MIGRATION-01); companion `.down.sql` exists as documented rescue script.
  2. Property test on real Postgres testcontainer (per DISCIPLINE Rule 5) covers **128 combinations = 16 tenant-scoped tables × 4 ops (SELECT/INSERT/UPDATE/DELETE) × 2 contexts (with-tenant / without)** and asserts: with-context → allow same-tenant rows only; without-context → SELECT/UPDATE/DELETE return rowCount=0 (silent deny-read), INSERT raises PG `42501` (raise-on-write). Variant (a) silent-deny-read + raise-write chosen over variant (b) raise-everywhere; route-level cleanup of legitimate empty-read paths is Phase 41 content.
  3. E2E test (per DISCIPLINE Rule 3) boots full `docker compose` stack + a route that intentionally bypasses `withTenant` returns 500 with the canonical redacted server-error envelope — NOT a 200 with default-tenant rows.
  4. `tenant-context.ts` no longer "falls back" — callers that forget `withTenant()` get a typed PG error with a clear message; updated unit tests document the new contract.
  5. Phase verifier reports PASSED with ≥ 90/90/90/90 coverage on diff per DISCIPLINE Rule 7; passes Phase 31 lockers (`pnpm lint:lockers` exit 0); audit trail complete (PLAN.md + SUMMARY.md + REVIEW.md + VERIFICATION.md + `32-COVERAGE.md`) per DISCIPLINE Rule 10.
**Plans**: TBD via `/gsd-plan-phase 32`.
**UI hint**: no

### Phase 33: Envelope encryption wired to Better Auth credential columns (v2.2 — CR-8 closure)
**Goal**: Every Better Auth credential column (`account.{access_token, refresh_token, id_token, password}`, `verification.value`, `sessions.{token, previous_token}`, `oauth_state.code_verifier`) is stored as envelope-encrypted `bytea` (AES-256-GCM, per-row DEK, 12-byte IV, GCM auth tag, KEK from `MASTER_KEK` env). A DB dump no longer leaks third-party IdP OAuth tokens, session bearers, or password-reset tokens. The currently-dead `packages/data/src/encryption/envelope.ts` module gets its first production consumers; encryption/decryption is a Drizzle-level lens — Better Auth ↔ DB plaintext boundary is never crossed.
**Depends on**: Phase 31 (lockers); **Phase 32 (RLS fail-closed)** — both migrations touch the Better Auth credential schemas; encryption-at-rest on top of a still-leaky-RLS posture would leave the multi-tenant invariant violated against the new bytea columns.
**Requirements**: CRIT-FIX-02
**Success Criteria** (what must be TRUE):
  1. Migration pair `0019_envelope_encrypt_secret_columns_add.sql` (additive — 48 nullable bytea sidecars matching `EncryptedRow` shape: `{dek_wrapped, dek_iv, dek_auth_tag, value_iv, value_auth_tag, value_ciphertext}` per credential × 8 credentials, plus `sessions.token_fp` + `previous_token_fp` SHA-256 fingerprint sidecars + partial-unique / partial indexes) + Node-side backfill (Plan 33-03) + `0020_envelope_encrypt_secret_columns_drop_plaintext.sql` (drops the 8 plaintext columns + `sessions_token_unique`, flips `sessions.token_fp` to NOT NULL) AFTER the encryption lens is wired and integration tests green. Forward + rollback both verified on real Postgres in CI.
  2. Integration test (real Postgres testcontainer per DISCIPLINE Rule 5) round-trips Better Auth sign-in + sign-out + password-reset; asserts the stored bytea is ciphertext (not plaintext), the lens decrypts to original plaintext, tampered ciphertext is rejected, wrong-KEK decrypt fails. KEK rotation property test (old + new KEK both decrypt during overlap; old KEK retirement causes decrypt failure).
  3. App refuses to start (loud-fail per Phase 14 BYOK convention) when `MASTER_KEK` env is unset OR wrong length; integration test asserts non-zero exit + typed error code on bare boot.
  4. New locker `tools/lint-no-plaintext-secret-columns.ts` (becomes DISCIPLINE Rule 15) AST-scans `packages/data/src/schema/**` and refuses `text("access_token"|"refresh_token"|"password"|"id_token"|"value"|"token"|"previous_token"|"code_verifier")`; ≥ 90/90/90/90 coverage on the linter; wired into `pnpm lint:lockers`.
  5. `docs/security.md` documents encryption-at-rest scope, `MASTER_KEK` rotation runbook, and KMS provisioning recipes (AWS KMS / GCP KMS / Azure Key Vault / HashiCorp Vault). E2E sign-in flow GREEN end-to-end (DISCIPLINE Rule 3). Phase verifier reports PASSED with ≥ 90/90/90/90 coverage on diff; passes Phase 31 lockers; audit trail complete.
**Plans**: TBD via `/gsd-plan-phase 33`.
**UI hint**: no

### Phase 34: tenantPlugin retirement (v2.2 — CR-1 closure)
**Goal**: A forged `x-tenant-id: <other-uuid>` header on any authenticated route CANNOT escalate access — either because `tenantPlugin` is entirely deleted (preferred — Phase 2 dual-auth migrated real routes off `req.tenantId`) or because it has been renamed to `req.untrustedTenantHint: string | null` with a runtime guard that throws when both `req.tenant` (authoritative) and `req.untrustedTenantHint` are present and disagree. The lying TS module-augmentation (`tenantId: string`) is gone.
**Depends on**: Phase 31 (lockers).
**Requirements**: CRIT-FIX-03
**Success Criteria** (what must be TRUE):
  1. `apps/api/src/middleware/tenant.ts` is deleted OR refactored to expose `req.untrustedTenantHint` only; `apps/api/src/index.ts:382` registration follows suit; module-augmentation in `apps/api/src/types/**` is audited and no longer claims `tenantId: string`.
  2. E2E `tests/e2e/tenant-isolation.spec.ts` (DISCIPLINE Rule 3) asserts: `GET /api/*` with a forged `x-tenant-id` matching no real tenant is rejected (or no-ops on the forged value); `GET /api/*` with `x-tenant-id` for a tenant OTHER than the authenticated user's is REFUSED, not silently overriding `req.tenant`. Real `docker compose` stack, real Better Auth, real session.
  3. Grep at phase-verifier time proves zero non-test readers of `req.tenantId` remain across `apps/**/src/**` and `packages/**/src/**`; Phase 31's `lint-prod-readiness` dead-export detection AND a targeted regression test both catch any future re-introduction.
  4. Phase verifier reports PASSED with ≥ 90/90/90/90 coverage on diff per DISCIPLINE Rule 7; passes Phase 31 lockers; audit trail complete (PLAN.md + SUMMARY.md + REVIEW.md + VERIFICATION.md + `34-COVERAGE.md`) per DISCIPLINE Rule 10.
**Plans**: TBD via `/gsd-plan-phase 34`.
**UI hint**: no

### Phase 35: api-routes-rest bundle (v2.2 — CR-2 + CR-3 + CR-4 closure)
**Goal**: Public bootstrap endpoints (`/api/locale`, `/api/auth/providers`, `/api/setup-state`) return 200 (not 401) under the global `dualAuthHook`; multi-cookie Better Auth responses emit N independent `Set-Cookie` headers (not one comma-joined-broken cookie); `/api/setup-admin` cannot wedge the instance into `setup_state=completed` with no admin user when the step-4 role flip fails.
**Depends on**: Phase 31 (lockers).
**Requirements**: CRIT-FIX-04 (35.a), CRIT-FIX-05 (35.b), CRIT-FIX-06 (35.c)
**Success Criteria** (what must be TRUE):
  1. **35.a**: `apps/api/src/routes/{locale,auth-providers,setup-state}.ts` each register with `config: { auth: false }`; integration test boots the full app via `bootstrap()` (NOT bare Fastify per DISCIPLINE Rule 4 — no mocks of internal logic) and asserts `GET /api/locale` / `GET /api/auth/providers` / `GET /api/setup-state` return 200 (not 401). E2E `tests/e2e/bootstrap-public-endpoints.spec.ts` covers all three via real `docker compose` stack.
  2. **35.b**: `apps/api/src/lib/better-auth-handler.ts:179-182` calls `headers.getSetCookie()` and emits one `reply.header('set-cookie', v)` per cookie value; RED test asserts a multi-cookie Better Auth response yields N independent `set-cookie` reply headers (not comma-joined). E2E `tests/e2e/sign-in-cookies.spec.ts` round-trips a real Better Auth sign-in flow + asserts the browser receives a parseable session + CSRF cookie pair.
  3. **35.c**: `apps/api/src/routes/setup-admin.ts:234` wraps the step-4 role flip + `setup_state=completed` write in a single Postgres transaction with rollback (or moves the role flip BEFORE the state flip); RED test injects a `pg` failure during the role flip and asserts the next `POST /api/setup-admin` returns 409 with a recoverable-error envelope, NOT `alreadyCompleted: true` with no admin user.
  4. Each sub-plan ships its own atomic RED → GREEN commit per DISCIPLINE Rule 1; ≥ 90/90/90/90 coverage on each of the three diffs per DISCIPLINE Rule 2.
  5. Phase verifier reports PASSED — all three sub-plans GREEN on E2E + unit + integration; passes Phase 31 lockers (`pnpm lint:lockers` exit 0); audit trail complete per DISCIPLINE Rule 10.
**Plans**: TBD via `/gsd-plan-phase 35` (three sub-plans: 35.a public endpoints, 35.b Set-Cookie fix, 35.c setup-admin rollback).
**UI hint**: no

### Phase 36: worker bundle (v2.2 — CR-5 + CR-6 closure)
**Goal**: `DATABASE_URL` (with password) NEVER appears in `ps aux`, BullMQ `failedReason`, or Loki structured logs after a `pg_dump` failure in audit-archive — the `bash -c` shell interpolation is replaced with a Node-side `spawn` pipeline using `PGPASSWORD` env. The `reconciliation-discrepancy` BullMQ handler stops lying about its return type and either honestly implements the windowed backfill or is honestly deleted.
**Depends on**: Phase 31 (lockers — LOCKER-06 `lint-shell-credential-interpolation` is the regression guard for 36.a).
**Requirements**: CRIT-FIX-07 (36.a), CRIT-FIX-08 (36.b)
**Success Criteria** (what must be TRUE):
  1. **36.a**: `apps/worker/src/jobs/audit-archive.ts:96-128` uses `spawn('pg_dump', [...args])` with `PGPASSWORD` env (NOT URL interpolation); Node-side streams pipe stdout → gzip → `mc`/`aws` (each spawned separately, stdio piped in Node, no shell). RED test (redact-audit) injects a `pg_dump` failure and asserts NO `DATABASE_URL` / password substring appears in `failedReason`, in error.stderr, or in worker structured log output. Partition-name regex validation preserved.
  2. **36.b**: `apps/worker/src/jobs/reconciliation-discrepancy.ts:45-61` either (A — preferred) reads `since/until/tenant_id` from job payload, extends `runIngestOnce` signature with an explicit-window code path, returns a real `Promise<{rowsProcessed, rowsScanned}>` (no `as unknown as` cast), and is covered by a RED test that destructures the awaited result against a fixture; OR (B) the job + its BullMQ enqueuer are deleted with rationale documented in SUMMARY.md.
  3. LOCKER-06 (`lint-shell-credential-interpolation`) re-runs against the post-fix tree and exits 0; a synthetic regression PR that re-introduces `bash -c "...${DATABASE_URL}..."` is REFUSED by lefthook + CI.
  4. E2E (DISCIPLINE Rule 3) boots the worker via `docker compose` profile, triggers an audit-archive job, and asserts the produced gzip lands in MinIO with the expected partition name; redact-audit observer asserts no credential leakage across the full job lifecycle.
  5. Phase verifier reports PASSED with ≥ 90/90/90/90 coverage on both diffs; passes Phase 31 lockers; audit trail complete per DISCIPLINE Rule 10.
**Plans**: TBD via `/gsd-plan-phase 36` (two sub-plans: 36.a DATABASE_URL out of bash, 36.b reconciliation-discrepancy truth-telling).
**UI hint**: no

### Phase 37: LitellmUpstreamError bodyText truncation (v2.2 — CR-9 closure)
**Goal**: A pino structured log of a `LitellmUpstreamError` contains NO full upstream body — `bodyText` is truncated at construction (`.slice(0, 200)`), marked `private readonly`, and `toJSON()` is overridden to return `{name, message, status}` only. Pino's own-property serializer can no longer exfiltrate prompt echoes, provider traces, or forwarded response data to Loki on every 502.
**Depends on**: Phase 31 (lockers — LOCKER-05 `lint-secret-shape-in-error` is the regression guard).
**Requirements**: CRIT-FIX-09
**Success Criteria** (what must be TRUE):
  1. `packages/litellm-client/src/errors.ts` truncates `bodyText` at construction, marks the field `private readonly`, and overrides `toJSON()` to emit only `{name, message, status}`.
  2. RED test asserts `JSON.stringify(new LitellmUpstreamError(500, 'x'.repeat(10000)))` is < 500 bytes; a separate integration test forces a 502 through the API + asserts the pino-emitted structured log line contains no `bodyText` / no fragment of the upstream body beyond the 200-char truncated `message`.
  3. LOCKER-05 (`lint-secret-shape-in-error`) re-runs against the post-fix tree and exits 0; a synthetic regression PR that re-introduces `public readonly bodyText: string` on an Error subclass is REFUSED by lefthook + CI.
  4. Existing T-03-03-01 mitigation tests remain green; the file header comment claiming the mitigation is implemented becomes materially true.
  5. Phase verifier reports PASSED with ≥ 90/90/90/90 coverage on diff; passes Phase 31 lockers; audit trail complete per DISCIPLINE Rule 10.
**Plans**: TBD via `/gsd-plan-phase 37`.
**UI hint**: no

### Phase 38: @openwhispr/auth retirement (v2.2 — CR-10 closure)
**Goal**: `@openwhispr/auth` cannot be published on npm under a load-bearing name carrying a placeholder shell — either the package is deleted entirely (preferred — zero production importers; only its own tests reference it) or it is renamed to `@openwhispr/auth-stub` with `private: true` in `package.json` so npm publish refuses. Stryker config + any other config referencing the package is updated.
**Depends on**: Phase 31 (lockers — LOCKER-04 part (b) dead-export detection is the regression guard).
**Requirements**: CRIT-FIX-10
**Success Criteria** (what must be TRUE):
  1. Either `packages/auth/` is removed from the monorepo + every reference in `pnpm-workspace.yaml`, root `package.json`, Stryker config, Helm chart, Dockerfiles, and `tsconfig` paths is excised; OR the package is renamed to `@openwhispr/auth-stub`, its `package.json` carries `"private": true`, and every reference is migrated to the new name.
  2. `pnpm install` succeeds clean; `pnpm -r build` succeeds; `pnpm -r test` exits 0; no broken imports anywhere.
  3. `pnpm publish --dry-run` from the package directory (if renamed-to-stub path chosen) refuses with the `private: true` guard; a manual attempt to publish under the load-bearing `@openwhispr/auth` name is structurally impossible.
  4. Phase 31's `lint-prod-readiness` dead-export check (LOCKER-04 part b) catches any future similar shell package on every PR.
  5. Phase verifier reports PASSED with ≥ 90/90/90/90 coverage on any new test files; passes Phase 31 lockers; audit trail complete per DISCIPLINE Rule 10.
**Plans**: TBD via `/gsd-plan-phase 38`.
**UI hint**: no

### Phase 39: wire-schemas HIGH sweep (v2.2 — HIGH-FIX-WIRE-01..04 closure)
**Goal**: Every input zod schema in `packages/wire-schemas/` rejects unknown keys (`.strict()`); every output schema enforces real type primitives (`z.string().uuid()` / `.datetime({offset:true})` / `.url()`); long-text bodies and `metadata` records are bounded by `.max()` per BACKEND_SPEC limits; enums are symmetrical on input AND output; counts/durations are `z.number().int().nonneg()`. The contract surface stops accepting malformed garbage at the boundary.
**Depends on**: Phase 31 (lockers).
**Requirements**: HIGH-FIX-WIRE-01, HIGH-FIX-WIRE-02, HIGH-FIX-WIRE-03, HIGH-FIX-WIRE-04
**Success Criteria** (what must be TRUE):
  1. `.strict()` lands on NoteInput, FolderInput, ConversationInput, TranscriptionInput, StreamingUsageBody, WebSearchRequest, CreateApiKeyOptions (and any other input schema in `packages/wire-schemas/`); property test rejects unknown keys with a 400 envelope.
  2. Every output schema's IDs / timestamps / URLs use `.uuid()` / `.datetime({offset:true})` / `.url()`; property test rejects malformed values; existing contract suite (against `BACKEND_SPEC.md`) remains green — no wire breakage.
  3. Long-text body fields and `metadata: z.record(...)` bounded by `.max()` per BACKEND_SPEC limits; `note_type` and other previously-asymmetrical enums become symmetrical; `z.number()` counts/durations become `.int().nonneg()`.
  4. Existing `tests/contract/**` suite passes unchanged; new property tests at ≥ 90/90/90/90 coverage on the diff per DISCIPLINE Rule 2.
  5. Phase verifier reports PASSED — contract suite GREEN, property tests GREEN, E2E unchanged (no user-visible behavior change beyond stricter rejection); passes Phase 31 lockers; audit trail complete per DISCIPLINE Rule 10.
**Plans**: TBD via `/gsd-plan-phase 39`.
**UI hint**: no

### Phase 40: byok-guard + contract-tests HIGH sweep (v2.2 — HIGH-FIX-BYOK-01..03 closure)
**Goal**: API routes stop importing wire schemas from a test-helper package (`@openwhispr/contract-tests` flipped to `private: true`); `redactUrl` masks query-string credentials, AWS SigV4 signatures, URL userinfo, and bearer-token-shaped path segments — with a drift-as-failure parity test that enumerates every `process.env.*_API_KEY` actually read by the codebase; `fetchAndParse` enforces the error envelope on every non-2xx and raises `MalformedUpstreamEnvelopeError` on non-JSON / empty body.
**Depends on**: Phase 31 (lockers).
**Requirements**: HIGH-FIX-BYOK-01, HIGH-FIX-BYOK-02, HIGH-FIX-BYOK-03
**Success Criteria** (what must be TRUE):
  1. Every wire schema currently imported from `@openwhispr/contract-tests` by `apps/api/src/routes/**` (and `apps/web/**` / `apps/worker/**` if applicable) moves to `@openwhispr/wire-schemas` and is re-exported there; `contract-tests/package.json` gains `"private": true`; grep at phase-verifier time proves zero production importers remain on the test-helper package.
  2. `redactUrl` covers query-string credentials (`api_key`, `token`, `key`, `code`, `secret`), AWS SigV4 `X-Amz-Signature`, URL userinfo (`username`), and bearer-token-shaped path segments (`/sk-[A-Za-z0-9]{32,}`, `/sk-ant-…`, `/AIza…`, `/AKIA…`); 50+ synthetic URLs covered by property tests; `tests/security/redact-completeness.test.ts` at test-time greps `apps/**/src/**` for `process.env.*_API_KEY` actually read, constructs a fake URL containing each variable name + a fake key, and asserts `redactUrl` masks it — drift becomes a test failure.
  3. `fetchAndParse` removes the `typeof body === "object"` guard; every non-2xx runs through `ErrorEnvelope.parse()`; non-JSON / empty / `text/plain` body raises a typed `MalformedUpstreamEnvelopeError`; unit tests cover all four branches.
  4. E2E (DISCIPLINE Rule 3) round-trips a request through the BYOK path against a hermetic mock-LiteLLM that returns various non-2xx envelopes; the API surfaces typed errors, not silent passes; redact-audit confirms no credential leakage in any structured log.
  5. Phase verifier reports PASSED with ≥ 90/90/90/90 coverage on diff; passes Phase 31 lockers; audit trail complete per DISCIPLINE Rule 10.
**Plans**: TBD via `/gsd-plan-phase 40`.
**UI hint**: no

### Phase 41: Residual HIGH sweep (v2.2 — HIGH-FIX-API-CORE / AGENT-STREAM / WEB / WORKER / DATA / LITELLM / SMALL closure)
**Goal**: Every remaining HIGH finding from the 11-agent pre-publication review across api-core, api-routes-transcriptions, web, worker, data, litellm-client, and small-pkgs is closed under strict TDD with ≥ 90/90/90/90 coverage on each diff. Seven sub-plans, each shipping its RED → GREEN → REFACTOR atomic commit.
**Depends on**: Phase 31 (lockers); some sub-plans inherit closures from earlier v2.2 phases (e.g., 41.e account-token TTL becomes practical after Phase 33 encrypts the columns; 41.e HI-04 is already closed by Phase 32 — kept here only for traceability).
**Requirements**: HIGH-FIX-API-CORE (41.a), HIGH-FIX-AGENT-STREAM (41.b), HIGH-FIX-WEB (41.c), HIGH-FIX-WORKER (41.d), HIGH-FIX-DATA (41.e), HIGH-FIX-LITELLM (41.f), HIGH-FIX-SMALL (41.g)
**Success Criteria** (what must be TRUE):
  1. **41.a** api-core: hardcoded `"00000000-..."` tenant UUID at `apps/api/src/auth.ts:330, 380` replaced with `resolveDefaultTenantId()` so password-reset emails attribute to the correct tenant; `apps/api/src/placeholder.ts` deleted (phase-0 dead code, no Stryker config justifies keeping it); residual bootstrap concerns audited. RED test asserts audit-log entries carry the correct tenant_id after a password-reset enqueue.
  2. **41.b** api-routes-transcriptions: `apps/api/src/routes/agent/stream.ts` — `DEFAULT_AGENT_MODEL` reconciled with `compose/litellm/litellm_config.yaml` (single source of truth — no more `qwen/qwen3.6-plus` vs `qwen3.6-plus` drift); body zod validation added via a new schema in `packages/wire-schemas` (closes "no zod on the most expensive endpoint" — caught by Phase 31 LOCKER-04); per-user `rateLimit` config added to the route (caught by Phase 31 LOCKER-04 part a).
  3. **41.c** web: app-level RSC role-check guard added to `/admin/*` layout reading role from session (defense-in-depth on top of Traefik basic-auth — closes the D-ADMIN-1 "gateless if `ADMIN_BASIC_AUTH_USERS` unset" hole); `PLAYWRIGHT_DISABLE_SSR_PREFETCH` removed from 5 production RSC pages (test-only branches belong in test fixtures, NOT shipped code — CLAUDE.md hard-rule #1 surface). Phase 31 LOCKER-01 (`lint-no-env-branches`) enforces the latter going forward.
  4. **41.d** worker: bare `pino()` in `apps/worker/src/index.ts` + `ingest-litellm-spend.ts` replaced with shared redact factory (PII leak closed); `reconciliation-daily-check` loop bound corrected (tenants, not distinct users — comment was wrong); module-level OTel gauge callbacks refactored to read fresh `driftStore` (no more 23h-stale false-positive alerts); minutes-priced model `metadata.duration` validation + warn-log + counter metric on non-numeric values (silent zero-billing closed).
  5. **41.e** data: `packages/data/src/migrate.ts` LiteLLM-init idempotency enforced; migration `0019` replaces 0005's destructive `TRUNCATE TABLE` with an idempotent UPSERT; account-token `expires_at` enforcement wired (now meaningful after Phase 33 encrypts the columns — TTL check still belongs at the application layer). HI-04 (tenant_id GUC DEFAULT) is already closed by Phase 32; listed here for traceability only.
  6. **41.f** litellm-client: `chatCompletions`, `audioTranscriptions`, `passthrough` each accept and require an `AbortSignal` + observe `headersTimeout` + `bodyTimeout`; SSRF dispatcher asserted at module load (throw if `getGlobalDispatcher()` is not our wrapped Agent — closes the worker/CLI bypass); model alias drift fixed via single-source-of-truth read from `compose/litellm/litellm_config.yaml` at boot; `streamOptions` spread refactored so callers can opt OUT of `include_usage`.
  7. **41.g** small-pkgs: `@openwhispr/i18n` ships real en/ru locale bundles OR is renamed to `-stub` with `private: true` (decision after verifying Phase 10's full-i18n coverage already lives elsewhere); CI parity test between `byok-guard` provider list and `observability/redact` provider list (drift = test failure); `EmailSender.ts:115` `SMTP_SECURE` parser accepts `1`/`true`/`yes`/`on` case-insensitive (closes silent TLS downgrade). All seven sub-plans GREEN at ≥ 90/90/90/90 coverage per diff; passes Phase 31 lockers; E2E (per DISCIPLINE Rule 3) for each user-visible route touched; audit trail complete per DISCIPLINE Rule 10.
**Plans**: TBD via `/gsd-plan-phase 41` (seven sub-plans 41.a..41.g — one per package scope; can parallelize within the phase per gsd-executor wave logic).
**UI hint**: no
### Phase 21: Anti-shortcut Locker Infrastructure (v2.1 — CRITICAL)
**Goal**: Make all subsequent Phase 22..39 work safe from agent shortcuts. Ship 5 new linters that the pre-commit hook, CI, and branch-protection refuse to merge without. After this phase, no agent can introduce `.skip`/`.only` Gherkin, `retries > 0` in any playwright.config.ts, a `*.steps.ts` without a sibling `__tests__/*.test.ts`, a `[test-fix]`-labelled PR that touches production source, or per-phase coverage below 90/90/90/90 on strict packages.
**Depends on**: nothing — must land first.
**Requirements** (all RED→GREEN per constitutional TDD; each linter ships with its `.test.ts` in the SAME atomic commit):
  - SR-21.1 `tools/lint-gherkin-tags.ts` — reject `.skip`/`.only`/`@skip`/`@focus` in `*.feature`; reject `@cjm-*` tag without matching anchor in `docs/customer-journeys.md` (overlap with existing `lint-cjm-doc.ts` is intentional belt-and-suspenders); reject scenario without negative-twin in the same `.feature`; reject `@expected-red` without `@after-phase-X.Y` or `@after-docker-up` companion.
  - SR-21.2 `tools/lint-playwright-config.ts` — reject `retries: N` where N > 0 in any `playwright.config.ts`; reject `workers > 1` in `tests/e2e-cjm/playwright.config.ts`; reject `test.skip`/`test.only`/`test.fixme` outside `**/__tests__/**`.
  - SR-21.3 `tools/lint-steps-have-unit-tests.ts` — enforce every `tests/e2e-cjm/steps/*.steps.ts` has a sibling `__tests__/<name>.test.ts`; reject if the vitest file does not mock the HTTP boundary (heuristic: must import `vi.spyOn` OR `nock` OR `msw` OR contain `mockFetch`).
  - SR-21.4 `tools/lint-no-prod-edit-with-test-only-pr.ts` — CI-only; reads `gh pr diff`; if PR description carries `[test-fix]` tag and diff touches `apps/*/src/**`, `packages/*/src/**`, `compose/**/*.yml`, or `Makefile` → exit 1. Enforces `CLAUDE.md` Hard Rule §1.
  - SR-21.5 `tools/lint-coverage-floor-per-phase.ts` — for files committed in current PR, exit 1 if coverage on diff < 90/90/90/90 on any strict package (api, web, worker, data, byok-guard, email, litellm-client). Reads `coverage/coverage-summary.json` produced by `pnpm test --coverage`.
  - SR-21.6 wiring — add 5 `pnpm` scripts; lefthook.yml pre-commit; `.github/workflows/ci.yml` jobs (5 new); `scripts/branch-protection.json` 5 new required contexts (→ 21 total); `.github/CODEOWNERS` pin sensitive paths (playwright.config.ts, tools/lint-*.ts, branch-protection.json, lefthook.yml, .github/workflows/, .planning/qa-audit/, docs/customer-journeys.md); `.github/PULL_REQUEST_TEMPLATE.md` QA checklist section.
**Success Criteria**:
  1. Each new `tools/lint-*.ts` has sibling `.test.ts` at ≥ 90/90/90/90 line/branch/function/statement coverage.
  2. `pnpm lint:gherkin-tags`, `pnpm lint:playwright-config`, `pnpm lint:steps-have-unit-tests`, `pnpm lint:prod-edit-guard`, `pnpm lint:coverage-floor` all exit 0 on the current tree.
  3. Intentional-violation test: a temporary fixture with `.skip` in a `.feature` causes pre-commit hook to refuse the commit; deleting the fixture restores GREEN.
  4. `gh api /repos/<owner>/<repo>/branches/main/protection` reports 21 required status checks (16 existing + 5 new) after the wiring commit.
  5. CI workflow ci.yml runs all 5 new jobs as required on every PR.
**Plans** (suggested split; one atomic RED→GREEN commit per linter + one wiring commit):
  - 21-01 lint-gherkin-tags (linter + test + script + lefthook + ci.yml job)
  - 21-02 lint-playwright-config (linter + test + script + lefthook + ci.yml job)
  - 21-03 lint-steps-have-unit-tests (linter + test + script + lefthook + ci.yml job)
  - 21-04 lint-prod-edit-guard (linter + test + ci-only job, not lefthook)
  - 21-05 lint-coverage-floor-per-phase (linter + test + ci-only job, depends on coverage-summary.json artifact)
  - 21-06 branch-protection + CODEOWNERS + PR template (single atomic wiring commit)

### Phase 22..Phase 39
Detail specs deferred — written in-line in the phase-list above. Each phase's CONTEXT.md will be authored when the phase is picked up by `/gsd-discuss-phase N` per workflow. The phase-list entry IS the goal-statement; success criteria are paraphrased from `.planning/qa-audit/2026-05-16-cjm-coverage.md` (G1..G10) and `.planning/qa-audit/2026-05-16-test-layering.md` (L1..L8).

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Repo Bootstrap & Constitutional CI | 5/6 | In progress | - |
| 1. Core Infra & Multi-Tenant Data | 0/6 | Planned | - |
| 2. Auth + Wire-API Skeleton + Conformance | 0/7 | Planned | - |
| 3. LiteLLM Integration + Bundled OSS Models | 0/0 | Not started | - |
| 4. Streaming + Realtime | 0/0 | Not started | - |
| 5. Operational Endpoints | 0/0 | Not started | - |
| 6. Observability + Ops Hardening + Workers | 0/0 | Not started | - |
| 7. Frontend UI-SPEC | 7/7 | Complete | 2026-05-12 |
| 8. Load Test, Tuning & SLO Publication | 8/8 | Complete | 2026-05-13 |
| 9. Helm Chart & Cloud Deploy | 11/11 | Complete | 2026-05-13 |
| 10. i18n + Docs + OSS Housekeeping | 7/5 | Complete   | 2026-05-13 |
| 11. Cloud Profile Refactor | 1/5 | In progress | - |
| **— v2.1 milestone (CLOSED-WITH-PARTIAL-DEBT 2026-05-15 — SR-19.1b carry) —** | | | |
| 13. E2E + CJM Harness | 2/2 | Complete | 2026-05-14 |
| 12. Admin Onboarding + UI-SPEC Conformance | 6/6 | Complete | 2026-05-14 |
| 14. Slim Core + BYOK Profiles | 7/7 | Complete | 2026-05-14 |
| 15. Repo Refactor + FSL + History Scrub | 3/4 | Complete-with-operator-followup | 2026-05-15 |
| 16. Phase-Tag Comment Audit | 2/2 | Complete | 2026-05-15 |
| 17. Trusted Local TLS + Production ACME | 3/3 | Complete | 2026-05-15 |
| 18. LDAP / Keycloak SSO (SPEC only) | 1/1 | Complete-spec-only | 2026-05-15 |
| 18.1. v2 test-debt closure | 7/7 | Complete-with-followup | 2026-05-15 |
| 18.1.1. aggregate sweep + AuthShell oracle | 6/6 | Complete-with-followup | 2026-05-15 |
| 18.1.2. infrastructure-bound test debt | 6/6 | Complete | 2026-05-15 |
| 19. Server-error closure (production-fix phase) | 3/3 | Complete-with-partial-debt | 2026-05-15 |

## Coverage Map

v1: 101 requirements → 11 phases (no orphans, no duplicates). v2: 61 requirements → 7 phases (12–18) (no orphans, no duplicates).

### v1 Coverage

| Requirement | Phase |
|-------------|-------|
| WIRE-01 | 2 |
| WIRE-02 | 2 |
| WIRE-03 | 2 |
| WIRE-04 | 2 |
| WIRE-05 | 3 |
| WIRE-06 | 3 |
| WIRE-07 | 4 |
| WIRE-08 | 5 |
| WIRE-09 | 5 |
| WIRE-10 | 5 |
| WIRE-11 | 5 |
| WIRE-12 | 5 |
| WIRE-13 | 4 |
| WIRE-14 | 4 |
| WIRE-15 | 4 |
| WIRE-16 | 5 |
| WIRE-17 | 2 |
| WIRE-18 | 2 |
| WIRE-19 | 2 |
| WIRE-20 | 2 |
| AUTH-01 | 2 |
| AUTH-02 | 2 |
| AUTH-03 | 2 |
| AUTH-04 | 2 |
| AUTH-05 | 2 |
| AUTH-06 | 2 |
| AUTH-07 | 2 |
| DATA-01 | 1 |
| DATA-02 | 1 |
| DATA-03 | 3 |
| DATA-04 | 6 |
| DATA-05 | 1 |
| DATA-06 | 1 |
| DATA-07 | 1 |
| LITELLM-01 | 3 |
| LITELLM-02 | 3 |
| LITELLM-03 | 3 |
| LITELLM-04 | 3 |
| LITELLM-05 | 3 |
| LITELLM-06 | 3 |
| LITELLM-07 | 3 |
| PROVIDER-01 | 3 |
| PROVIDER-02 | 1 |
| PROVIDER-03 | 2 |
| PROVIDER-04 | 2 |
| SCALE-01 | 6 |
| SCALE-02 | 8 |
| SCALE-03 | 6 |
| SCALE-04 | 6 |
| SCALE-05 | 4 |
| SCALE-06 | 8 |
| SCALE-07 | 8 |
| OBS-01 | 6 |
| OBS-02 | 6 |
| OBS-03 | 6 |
| OBS-04 | 6 |
| OBS-05 | 6 |
| UI-SPEC-01 | 7 |
| UI-SPEC-02 | 7 |
| UI-SPEC-03 | 7 |
| DEPLOY-01 | 9 |
| DEPLOY-02 | 9 |
| DEPLOY-03 | 9 |
| DEPLOY-04 | 9 |
| DEPLOY-05 | 9 |
| TDD-01 | 0 |
| TDD-02 | 0 |
| CI-01 | 0 |
| CI-02 | 0 |
| CI-03 | 0 |
| CONTRACT-01 | 2 |
| TEST-COV-01 | 0 |
| TEST-MUTATION-01 | 0 |
| TEST-LOAD-01 | 8 |
| TEST-MIGRATION-01 | 1 |
| TEST-I18N-01 | 10 |
| TEST-RLS-01 | 1 |
| DEVEX-01 | 0 |
| I18N-01 | 10 |
| I18N-02 | 10 |
| DOCS-01 | 10 |
| DOCS-02 | 10 |
| DOCS-03 | 10 |
| DOCS-04 | 10 |
| DOCS-05 | 10 |
| DOCS-06 | 10 |
| DOCS-07 | 10 |
| DOCS-08 | 10 |
| DOCS-09 | 10 |

### v2 Coverage

| Requirement | Phase |
|-------------|-------|
| E2E-01 | 13 |
| E2E-02 | 13 |
| E2E-03 | 13 |
| E2E-04 | 13 |
| E2E-05 | 13 |
| E2E-06 | 13 |
| E2E-07 | 13 |
| E2E-08 | 13 |
| E2E-09 | 13 |
| E2E-10 | 13 |
| E2E-11 | 13 |
| E2E-12 | 13 |
| ADMIN-01 | 12 |
| ADMIN-02 | 12 |
| ADMIN-03 | 12 |
| ADMIN-04 | 12 |
| ADMIN-05 | 12 |
| ADMIN-06 | 12 |
| UICONF-01 | 12 |
| UICONF-02 | 12 |
| UICONF-03 | 12 |
| UICONF-04 | 12 |
| UICONF-05 | 12 |
| UICONF-06 | 12 |
| UICONF-07 | 12 |
| SLIM-01 | 14 |
| SLIM-02 | 14 |
| SLIM-03 | 14 |
| SLIM-04 | 14 |
| BYOK-01 | 14 |
| BYOK-02 | 14 |
| BYOK-03 | 14 |
| STRUCT-01 | 15 |
| STRUCT-02 | 15 |
| STRUCT-03 | 15 |
| STRUCT-04 | 15 |
| STRUCT-05 | 15 |
| STRUCT-06 | 15 |
| STRUCT-07 | 15 |
| FSL-01 | 15 |
| FSL-02 | 15 |
| FSL-03 | 15 |
| FSL-04 | 15 |
| FSL-05 | 15 |
| FSL-06 | 15 |
| FSL-07 | 15 |
| COMMENT-01 | 16 |
| COMMENT-02 | 16 |
| COMMENT-03 | 16 |
| COMMENT-04 | 16 |
| TLS-01 | 17 |
| TLS-02 | 17 |
| TLS-03 | 17 |
| TLS-04 | 17 |
| TLS-05 | 17 |
| TLS-06 | 17 |
| SSO-01 | 18 |
| SSO-02 | 18 |
| SSO-03 | 18 |
| SSO-04 | 18 |
| SSO-05 | 18 |

**v2 distribution:** Phase 12=13, Phase 13=12, Phase 14=7, Phase 15=14, Phase 16=4, Phase 17=6, Phase 18=5 → 61 total ✓

---
*Roadmap created: 2026-05-08 after baseline pivot (defer Stripe/referrals/quotas to v2; bundle LiteLLM with OSS models; UI-SPEC only)*
*Last updated: 2026-05-09 — Phase 02.7 plan list populated (7 plans across 3 waves).*
*Last updated: 2026-05-14 — v2 milestone opened. 7 v2 phases appended (12–18) covering 61 REQ-IDs; work-order 13 → 12 → 14 → 15 → 16 → 17 → 18; 4 open questions deferred to /gsd-discuss-phase per phase.*
