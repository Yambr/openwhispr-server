# Roadmap: OpenWhispr Server

**Created:** 2026-05-08 (rebaselined after pivot)
**Granularity:** standard
**Total v1 requirements:** 89
**Coverage:** 89/89 mapped (100%)

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
- [ ] **Phase 6: Observability + Ops Hardening + Workers** — OTel/Prom/Loki end-to-end + audit log + BullMQ workers + tenant-context job middleware + anti-abuse rate limit + SSRF defense **← NEXT**
- [x] **Phase 7: Frontend UI-SPEC** — Admin console + end-user self-service specs targeting Next.js 15 + shadcn/ui v2; design tokens; component inventory. CLOSED 2026-05-12 (15/15 verifier must-haves PASS; tools/lint-ui-spec.ts coverage 96.81/92.24/94.59/96.77; three design-gap markers encoded for Claude Design re-engagement; apps/web/ scaffold deferred to Phase 8).
- [x] **Phase 07.1: Web App Implementation** — `apps/web/` Next.js 15 + React 19 + Tailwind 4 + shadcn/ui v2 implementing every UI-SPEC screen (A2, A3, U1–U13) same-origin behind Traefik. CLOSED 2026-05-12 (27 atomic commits; 510 unit + 85 e2e tests; coverage 98.53/92.99/97.79/97.62; size-limit 168.84 kB max gz across 15 routes; Traefik basic-auth admin gate verified; Better Auth wired end-to-end; WEB-IMPL-01..04 Complete).
- [ ] **Phase 8: Load Test, Tuning & SLO Publication** — k6 1000-concurrent nightly; PgBouncer/FD/sizing-matrix tuning; SLOs published only after this passes
- [x] **Phase 08.1: Deferral Fixes + Mock Re-run** — gap-closure of 08-07 CLOSED 2026-05-12 with partial-live-validation: anomaly #1 (99.93% error rate) → transcribe + reason 200 LIVE, agent-stream api-side issue escalated; anomaly #2 (realtime-ws p95=0) → code-closed via custom Trend; anomaly #3 (pgbouncer_admin SCRAM) → LIVE SHOW POOLS returns rows. 30-min plateau is operator hand-off via `make load-test PROFILE=mock`.
- [ ] **Phase 08.2: agent-stream undici dispatcher fix** — escalation from 08.1: `apps/api/src/routes/agent/stream.ts` uses `undici.fetch` which throws `upstream_error` despite SSRF gate passing and Fastify body parser accepting; sibling routes using shared litellm-client (`undici.request`) work. Two candidate fixes documented in 08.1 RUN-LOG: (a) replace fetch with shared client, (b) explicit dispatcher injection. Unblocks 08-08 (INSERTED 2026-05-12)
- [ ] **Phase 9: Helm Chart & Cloud Deploy** — CNPG + Traefik 3 + online-migration discipline + upgrade-matrix CI + first-launch SLO test
- [ ] **Phase 10: i18n + Docs + OSS Housekeeping** — en+ru ICU plurals + DOCS-01..08 + ADRs + CONTRIBUTING/SECURITY/COC

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
- [ ] 00-06-PLAN.md — README/CONTRIBUTING/SECURITY/COC/operations + ADRs 0000-0003 + integration smoke (Wave 3)
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
- [ ] TBD (run /gsd-plan-phase 01.2 to break down)

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
- [ ] TBD (run /gsd-plan-phase 02.21 to break down)

### Phase 02.20: Group I — verification-status test for unverified user; signInFixture verified:false branch flips email_verified=true via owner pool, signs in to get real BA cookie, flips back to false in try/finally; exploits BA getSession not re-checking emailVerified; preserves prod requireEmailVerification:true posture (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.20 to break down)

### Phase 02.19: Group F E2E closure — configure Traefik forwardedHeaders.trustedIPs for openwhispr_internal docker network so contract-test runner-injected X-Forwarded-For survives the edge to Better Auth rate-limiter; Phase 02.18 unit fix is correct, this enables E2E delivery (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.19 to break down)

### Phase 02.18: Group F — Better Auth rate-limiter cant see client IP behind Traefik (real prod security defect: WARN log Rate limiting skipped); recommended Option B: configure advanced.ipAddress.ipAddressHeaders + per-fixture unique X-Forwarded-For in signInFixture; fixes prod abuse hole AND unblocks 2 verification-status tests (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.18 to break down)

### Phase 02.17: Group E variant — mycorp-whispr scheme test 400 because OPENWHISPR_PROTOCOL accepts only single override; extend parser to comma-list + add mycorp-whispr to contract-test compose env (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.17 to break down)

### Phase 02.16: Group H NEW — api OAuth callback completion 500 (3 oauth-redirect tests); Group G transport closed but server-side handler errors; likely Better Auth genericOAuth token-exchange against fixture-idp /token shape mismatch OR mintBearer issue; needs api debug log capture + diagnosis (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.16 to break down)

### Phase 02.15: Group G — api 302s to https://api.localhost from inside cluster ECONNREFUSED; advisor recommends Option B network-alias variant: add aliases:[api.localhost,auth.localhost] to traefik service network block + mount cert + update-ca-certificates in runner image + flip runner BACKEND_URL/AUTH_URL to https://api.localhost; preserves canonical-public URL byte-for-byte (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.15 to break down)

### Phase 02.14: Group E — host-side contract-test runner cant resolve docker-internal fixture-idp DNS; advisor research recommends Option C: contract-test runner inside compose network (mirror Phase 02.3 seed pattern); one URL one issuer no /etc/hosts mutation (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.14 to break down)

### Phase 02.13: OIDC env provisioning for contract-test profile — apps/api auth.ts silently disables genericOAuth when OIDC_ISSUER_URL/CLIENT_ID/CLIENT_SECRET unset; contract-test profile fixture-idp running on http://fixture-idp:9000 but api container has no env vars pointing at it; result: 5 OAuth contract tests get 503; mechanical fix: add OIDC_* env vars to api service in contract-test profile context (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.13 to break down)

### Phase 02.12: Better Auth session.token field missing — Phase 02 Plan 01 designed sessions.tokenHash bytea (AUTH-04) but BA v1.6.9 expects plain session.token text; advisor research recommends Option C (drop tokenHash, use plain token, defer hash-only to v2 hardening); preserves AUTH-04 5-min overlap contract (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.12 to break down)

### Phase 02.10: Group A — signInFixture helper missing Origin header → 403 MISSING_OR_NULL_ORIGIN on 4 contract tests; mirror seed-time origin: baseUrl pattern from Phase 02.3 conformance.ts; TDD per TDD-01b (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.10 to break down)

### Phase 02.9: Better Auth email-validator rejects @local fixtures — packages/data/src/seed/conformance.ts uses rotation-test@local + similar @local addresses; Better Auth v1.6.9 hardened email validator rejects (no TLD per RFC 5321/5322); surfaced by Phase 02.8 contract-test E2E after UUID mismatch closed. Trivial fix: rewrite 3 fixture emails to @example.com (RFC 2606 reserved TLD for examples). TDD: extend seed-signup-non-2xx-loud test or add fixture-email-rfc-compliance test (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.9 to break down)

### Phase 02.8: Better Auth ID type vs Postgres uuid mismatch — Better Auth v1.6.9 default generateId emits 32-char base32 strings (e.g. '04xaRzi0ScgyXxWRtKwGG74OkqNZb0yO') but users.id (and likely sessions.id, account.id, verification.id) are Postgres uuid columns → 22P02 parse error → 422 from /api/auth/sign-up/email; surfaced by Phase 02.7-04 loud-fail discipline + 02.7-06 E2E. Discuss-phase + research-first required: A) advanced.generateId override in auth.ts, B) schema migration uuid→text on all 4 BA tables incl FK cascade, C) defensive create-user hook (rejected as workaround). Need investigation of related id columns (sessions, account, verification, oauth_state) before locking. BLOCKS Phase 02.7 plan 06+07 closure (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.8 to break down)

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
- [ ] TBD (run /gsd-plan-phase 02.6 to break down)

### Phase 02.5: Better Auth drizzle schema — drizzleAdapter missing schema option AND @openwhispr/data lacks Better Auth required tables (user/session/account/verification — singular names per Better Auth convention vs our pluralized users/sessions/accounts/verifications); add tables, pass schema to drizzleAdapter(db, {provider:pg, schema}), re-run drizzle migrate, make contract-test passes end-to-end → 02-HUMAN-UAT.md Item 1 finally flippable; TDD per CLAUDE.md TDD-01b (≥90% on touched files) (INSERTED)

**Goal:** Close the Better Auth ↔ Drizzle binding gap surfaced at Phase 02.3 — `drizzleAdapter` receives an explicit canonical-name schema map (D-01), and a new migration 0003 binds `app.tenant_id` per openwhispr_app connection (D-02) plus column DEFAULTs on Better Auth tables (D-03), so Better Auth's tenant-blind INSERTs satisfy FORCE RLS transparently. After this phase, `make contract-test` runs end-to-end (signup → verify-skipped → signin → token rotation), unblocking 02-HUMAN-UAT.md Item 1.
**Requirements**: TDD-01, TDD-01b, DATA-01, AUTH-01, AUTH-04, CONTRACT-01
**Depends on:** Phase 2
**Plans:** 3/5 plans executed

Plans:
- [x] 02.5-01-PLAN.md — Wave 1: RED tests (auth-schema-mapping unit + 0003 testcontainer integration) + contract-test RED baseline capture
- [x] 02.5-02-PLAN.md — Wave 2: migration 0003_better_auth_tenant_defaults.sql (D-02 ALTER ROLE + D-03 column DEFAULTs) + journal append; turns Plan 01 integration test GREEN
- [x] 02.5-03-PLAN.md — Wave 2: apps/api/src/auth.ts explicit schema map (D-01); turns Plan 01 unit test GREEN; coverage ≥90%
- [ ] 02.5-04-PLAN.md — Wave 3: end-to-end `make contract-test` run + capture GREEN witness
- [ ] 02.5-05-PLAN.md — Wave 3: SUMMARY + 3-scenario reverse-patch evidence + 02-HUMAN-UAT.md Item 1 flip

### Phase 02.4: Backfill TDD test coverage for Phase 02.x Yolo cascade — 6 production fixes (commits 451e9b3, 26eaa69, 7ccb8bb, 059b948, 5f274e6) shipped without per-fix tests, violating constitutional ≥90% per-phase coverage floor; test-only phase (no production code changes); aggregate coverage on touched files must reach ≥90%; vitest+CI green; MUST land before Phase 02.5 better-auth drizzle schema (INSERTED)

**Goal:** Backfill TDD test coverage for the Phase 02.x Yolo cascade. Six production fixes (commits 451e9b3, 26eaa69, 7ccb8bb, 059b948, 5f274e6) shipped without per-fix tests, violating PROJECT.md TDD-01b (≥90% per-phase coverage). Test-only phase — zero production code changes. Aggregate coverage on touched files reaches ≥90%; vitest+CI green; reverse-patch evidence per test group. MUST land before Phase 02.5.
**Requirements**: TDD-01, TDD-01b
**Depends on:** Phase 2
**Plans:** 4/6 plans executed

Plans:
- [x] 02.4-01-PLAN.md — G1: tools/bootstrap.sh interpolate + three-way value semantics (Wave 1)
- [x] 02.4-02-PLAN.md — G3: api Dockerfile no-pnpm-deploy + tsup external pg/pg-native/better-auth (Wave 1)
- [ ] 02.4-03-PLAN.md — G5a + G5b: better-auth handler bridge + AUTH_TRUSTED_ORIGINS_EXTRA (Wave 1)
- [x] 02.4-04-PLAN.md — G2: postgres role init idempotency via testcontainer (Wave 2)
- [x] 02.4-05-PLAN.md — G4: docker compose obs-only stack-up smoke (Wave 2)
- [ ] 02.4-06-PLAN.md — Aggregate coverage report + reverse-patch verification + atomic commit + SUMMARY (Wave 3)

### Phase 02.3: Add seed compose service for contract-test — make contract-test seed:conformance step runs from host shell with internal-only postgres hostname; needs in-network compose service like migrate (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.3 to break down)

### Phase 02.2: Externalize pg native module from api tsup bundle — Phase 02.1 noExternal pulled pg in via drizzle and broke ESM (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.2 to break down)

### Phase 02.1: Fix apps/api/Dockerfile pnpm v10 ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE — replace broken pnpm deploy with proper enterprise fix (NOT --legacy); inject-workspace-packages or multi-stage Dockerfile; api+migrate images build clean, full stack up --wait succeeds, no workspace regressions, unblocks Phase 01.1 Plan 05 (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 02.1 to break down)

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
- [ ] 06-12-PLAN.md — Wave 3: 8 e2e tests flipped GREEN (horizontal-scale, ssrf-block, audit-log-write, reconciliation-drift, log-scrub-sentinel, probes-dependency, rate-limit-layered, otel-trace-propagation) + coverage ≥90/90/90/90 gate + nightly CI
**UI hint**: no

### Phase 06.1: Add tempo + mimir minimal filesystem-backed configs — both crash on default empty backend; uncovered after Phase 02.2 brought api healthy (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 6
**Plans:** 15/16 plans executed

Plans:
- [ ] TBD (run /gsd-plan-phase 06.1 to break down)

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
  1. `make load-test` runs the k6 scenario on the local docker-compose stack with 1000 concurrent active users (5m ramp-up → 20m sustained → 5m ramp-down = 30m total) at the documented v1 assumed mix ratios (50% transcribe, 25% reason, 15% agent/stream, 10% WSS realtime) and records per-endpoint p95 latencies. Nightly CI cadence is explicitly deferred (manual on-demand only; document in operations.md).
  2. Two compose profiles support the load test: (a) `load-test-mock` — LiteLLM returns static responses with simulated latency (sleep(1500ms) for /v1/audio/transcriptions, sleep(300ms) for /v1/chat/completions) → measures gateway/auth/DB/Valkey p95 in isolation; (b) `load-test-realistic` — real Speaches (Whisper-large-v3 + pyannote) inside compose → measures end-to-end p95. Both baselines published.
  3. PgBouncer is sized for 1000 concurrent (server-pool 100 × 4 instances) in transaction-mode and verified under load; file-descriptor limits raised to 65535 on api + traefik containers and a startup probe verifies (default 1024 must NOT silently regress).
  4. A documented sizing matrix per topology (compose / Helm / GPU pool) published to `docs/operations.md` with measured numbers from the on-Mac live run — not extrapolated estimates.
  5. Per-endpoint p95 SLO budgets (baseline + 20% headroom) published in `docs/operations.md` only after this phase passes (constitutional rule). On-demand re-runs after architectural changes are operator-initiated; regression discipline is documented but not auto-enforced in Phase 8.
  6. The first live `make load-test` run actually executes on the developer's Mac (48GB RAM) and produces both mock and realistic baselines; raw k6 output + summary embedded in `08-SUMMARY.md`.
  7. Tests written first (TDD); all CI checks green.
**Plans**: 8 plans (5 waves)
- [x] 08-01 — rate-limit env switch (Wave 0)
- [x] 08-02 — load-test workspace scaffold (Wave 0)
- [x] 08-03 — mock-litellm Fastify scaffold (Wave 0)
- [x] 08-04 — FD probe scripts (Wave 0)
- [x] 08-05 — docker-compose load-test profiles (Wave 1)
- [x] 08-06 — k6 flows + Makefile (Wave 2)
- [x] 08-07 — live baseline run on Mac (Wave 3)
- [ ] 08-08 — operations.md + SLO publication + closure (Wave 4)
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
**Plans**: TBD (1–2 plans expected — fix + retroactive coverage if needed)
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
**Plans**: TBD
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
**Plans**: TBD
**UI hint**: no

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
| 8. Load Test, Tuning & SLO Publication | 0/0 | Not started | - |
| 9. Helm Chart & Cloud Deploy | 0/0 | Not started | - |
| 10. i18n + Docs + OSS Housekeeping | 0/0 | Not started | - |

## Coverage Map

89 v1 requirements → 11 phases, no orphans, no duplicates.

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

---
*Roadmap created: 2026-05-08 after baseline pivot (defer Stripe/referrals/quotas to v2; bundle LiteLLM with OSS models; UI-SPEC only)*
*Last updated: 2026-05-09 — Phase 02.7 plan list populated (7 plans across 3 waves).*
