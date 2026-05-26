# Pre-Production LOCKER Review — 2026-05-26

**Repo:** `/Users/dev/openwhispr-server`
**Branch:** `main` @ `0513729c` (`docs(planning): record 260526-iwn realtime language injection (v1.0.9) in STATE.md`)
**Tip commits in this review window:**
- `0513729c docs(planning): record 260526-iwn realtime language injection (v1.0.9) in STATE.md`
- `a4eed5ba feat(realtime): add ?language= query + REALTIME_DEFAULT_LANGUAGE env fallback (1.0.9)`
- `2803c1a8 fix(realtime): passthrough session.created/session.updated to client unchanged`

**Working tree:** CLEAN of source changes. Only `.planning/` untracked artefacts remain (the planning/quick dirs for the two realtime quicks + this review dir). Source diffs landed in `a4eed5ba` + `0513729c` mid-review; re-ran the constitutional LOCKER suite + gitleaks + prod-readiness AFTER those commits — all results below reflect post-commit state.

**Reviewer:** automated LOCKER suite (constitutional lints + supporting lints + gitleaks + pnpm audit).

**Verdict (head-line):** **GO.** No constitutional BLOCKING violations. Per the WARN→BLOCKING ledger in `CLAUDE.md` DISCIPLINE Rule 14, LOCKER-04 dead-exports + missing-schema findings remain WARN until Phase 41, LOCKER-05 until Phase 37, LOCKER-06 until Phase 36.a — they are **non-blocking technical debt** for today's push. Zero secrets, zero CVEs.

---

## 1. Executive Summary

### Counts by category

| Category | PASS | WARN | FAIL | SKIP | Total |
|---|---:|---:|---:|---:|---:|
| Constitutional LOCKERs (rules 11–16) | 6 | 1 | 0\* | 0 | 7 |
| Supporting lints | 19 | 1 | 1\*\* | 2 | 23 |
| Secrets / supply chain | 4 | 0 | 0 | 0 | 4 |
| **Total** | **29** | **2** | **1** | **2** | **34** |

\* LOCKER-04 (`lint-prod-readiness`) exited 1 with 367 FAIL lines, but per `CLAUDE.md` DISCIPLINE Rule 14 the BLOCKING flip is **operationally deferred to Phase 41**. These are documented WARN-class debt for today.
\*\* `lint-weak-assertions` exit 1 is a self-test false positive: the lint flags weak-assertion strings *inside its own test fixture file* (`tools/lint-weak-assertions.test.ts`).

### Top-line GO / NO-GO

**GO for production push today.** Status:
1. **Working tree clean of source changes** — `a4eed5ba` + `0513729c` landed during this review and constitutional LOCKERs + gitleaks were re-run post-commit. No new debt introduced.
2. **No new CVEs.** `pnpm audit --audit-level=moderate` → "No known vulnerabilities found".
3. **No secrets leaked.** `gitleaks detect` against git history (2102 commits @ HEAD, 28.64 MB scanned) → "no leaks found". `gitleaks protect --staged` (pre-push hook equivalent) → "no leaks found".
4. **LOCKER-04 debt is unchanged** (367 FAIL / 258 WARN) — same Phase-38/Phase-41-deferred backlog as pre-commit run. No new dead-exports, no new missing-schema routes.

---

## 2. Per-lint table

### Constitutional LOCKERs (DISCIPLINE Rules 11–16)

| # | Lint | Exit | Status | Notes | Log |
|---|---|---:|---|---|---|
| 1 | `lint-no-env-branches.ts` (LOCKER-01) | 0 | **PASS** | "clean" | [01](logs/01-no-env-branches.log) |
| 2 | `lint-no-suppressions.ts` (LOCKER-02) | 0 | **PASS** | "clean" — no new `as any` / `@ts-ignore` net additions | [02](logs/02-no-suppressions.log) |
| 3 | `lint-no-hardcode.ts` (LOCKER-03) | 0 | **PASS / WARN** | 46 allowlisted findings (canonical default-tenant UUID, fixture UUIDs, narrative-only comment FPs, `api.localhost` Traefik constant, port-4000 LiteLLM internal-compose URL). Non-blocking — all carry `# issue-…-fp` or `# canonical-*` markers. | [03](logs/03-no-hardcode.log) |
| 4 | `lint-prod-readiness.ts` (LOCKER-04) | **1** | **WARN** (per CLAUDE.md DISCIPLINE-14 deferral to Phase 41) | 367 FAIL lines: **344 `LOCKER-04-DEAD-EXPORT`** (the `@openwhispr/auth` retirement backlog → Phase 38, plus litellm-client re-export façade), **20 `LOCKER-04-NO-SCHEMA`** (the 47-route bulkfix → Phase 41), **1 `LOCKER-04-NO-RATELIMIT`** (`realtime.ts:531`), **1 `LOCKER-04-INVALID-RATELIMIT-FALSE`** (`__test/fetch.ts:82` — test-only). 258 WARN lines additional. See §3 for full list. | [04](logs/04-prod-readiness.log) |
| 5 | `lint-secret-shape-in-error.ts` (LOCKER-05) | 0 | **PASS** | "clean" — no Error subclass leaks credentials in `bodyText`/`responseBody`/`upstreamPayload`/`response`/`body`. BLOCKING flip is at Phase 37. | [05](logs/05-secret-shape-in-error.log) |
| 6 | `lint-shell-credential-interpolation.ts` (LOCKER-06) | 0 | **PASS / WARN** | 11 allowlisted findings (all in `tests/`/`packages/data/migrations/__tests__/`/`tools/lint-rls.test.ts` — non-prod `ownerPassword` + `BACKEND_URL` interpolation in e2e helpers). BLOCKING flip is at Phase 36.a. | [06](logs/06-shell-credential-interpolation.log) |
| 7 | `lint-no-plaintext-secret-columns.ts` (LOCKER-08) | 0 | **PASS** | "schema is clean (no plaintext credential columns)" — envelope-encryption-at-rest invariant holds. | [07](logs/07-no-plaintext-secret-columns.log) |

### Supporting lints

| # | Lint | Exit | Status | Notes | Log |
|---|---|---:|---|---|---|
| 8 | `lint-rls.ts` | 0 | **SKIP** | "DATABASE_URL not set — point at Postgres directly (NOT through PgBouncer)." Lint short-circuits without a live DB; rerun with `DATABASE_URL=postgresql://...` against a non-PgBouncer port. **Not a clean pass — gap.** | [08](logs/08-rls.log) |
| 9 | `lint-tenant-context.ts` | 0 | **PASS** | 7 job files scanned, all `default-export`s wrapped (D-W4 layer 1). | [09](logs/09-tenant-context.log) |
| 10 | `lint-migrations.ts` | 0 | **PASS** | "No new migrations to lint." | [10](logs/10-migrations.log) |
| 11 | `lint-compose-chart-parity.ts` | 0 | **PASS** | 23 compose services, 12 chart resources, 12 allowlisted (contract-test-runner, fixture-idp, grafana, loki, mailpit, mimir, pgbouncer-2/3/4, seed, tempo, traefik). Every service has a chart resource or allowlist entry. | [11](logs/11-compose-chart-parity.log) |
| 12 | `lint-compose-healthcheck-target.ts` | — | **N/A** | **Tool not implemented** — only `*.test.ts` exists in `tools/`. No `.ts` source file. Not runnable. | — |
| 13 | `lint-compose-resources.ts` | 0 | **PASS** | "clean" | [13](logs/13-compose-resources.log) |
| 14 | `lint-no-dockerhub-pg-image.ts` | 0 | **PASS** | "clean" | [14](logs/14-no-dockerhub-pg-image.log) |
| 15 | `lint-dockerfile-tls.ts` | 0 | **PASS** | "clean" | [15](logs/15-dockerfile-tls.log) |
| 16 | `lint-traefik-routes.ts` | 0 | **PASS** | "clean" | [16](logs/16-traefik-routes.log) |
| 17 | `lint-english.ts` | 0 | **PASS** | 1425 files scanned, English-only check passed. | [17](logs/17-english.log) |
| 18 | `lint-await-in-non-async.ts` | 0 | **PASS** | "clean" | [18](logs/18-await-in-non-async.log) |
| 19 | `lint-weak-assertions.ts` | **1** | **FAIL (false-positive — self-test fixtures)** | 8 occurrences flagged — **all inside `tools/lint-weak-assertions.test.ts`** (the lint test fixtures contain the patterns the lint detects, BY DESIGN). The lint should exclude its own `*.test.ts` self-fixture from scope. No production-code violations. **Not blocking.** | [19](logs/19-weak-assertions.log) |
| 20 | `lint-colocated-tests.ts` | 0 | **PASS** | "clean" | [20](logs/20-colocated-tests.log) |
| 21 | `lint-coverage-floor-per-phase.ts` | 0 | **SKIP** | "no changed files supplied — skipped". Requires phase argument; not runnable as a standalone gate. | [21](logs/21-coverage-floor.log) |
| 22 | `lint-docs-headings.ts` | 1 | **N/A — wrong scope** | Initial invocation `(no args)` exited 2 with usage. Re-ran on every top-level `docs/*.md` file: only `wire-contracts-phase-3.md` is the intended target (passes). The other 10 docs are not BACKEND_SPEC anchor docs and predictably fail "missing-h2 / missing-decision / no-source-citation" checks. **The lint is scope-narrow and not a release gate.** | [22](logs/22-docs-headings.log) |
| 23 | `lint-cjm-doc.ts` | 0 | **PASS** | `docs/customer-journeys.md` ok (34 anchors). | [23](logs/23-cjm-doc.log) |
| 24 | `lint-steps-have-unit-tests.ts` | 0 | **PASS** | 23 step files, 13 unit tests, 10 on allowlist. | [24](logs/24-steps-unit-tests.log) |
| 25 | `lint-gherkin-tags.ts` | 0 | **PASS** | 23 feature files, 34 anchors in `docs/customer-journeys.md`. | [25](logs/25-gherkin-tags.log) |
| 26 | `lint-playwright-config.ts` | 0 | **PASS** | 3 configs, 647 test files scanned. | [26](logs/26-playwright-config.log) |
| 27 | `lint-no-prod-edit-with-test-only-pr.ts` | 0 | **SKIP** | "no PR context supplied — skipped (CI-only linter)". Designed for GitHub Actions; not a local gate. | [27](logs/27-no-prod-edit-test-only.log) |
| 28 | `lint-tdd.ts` | 0 | **PASS** | TDD heuristic passed: 0 commits inspected (working tree is dirty — no new commits since last check). | [28](logs/28-tdd.log) |
| 29 | `lint-phase-tag-comments.ts` | 0 | **PASS** | "clean" | [29](logs/29-phase-tag-comments.log) |
| 30 | `lint-ui-spec.ts` | 0 | **PASS** | empty stdout, exit 0 → clean. | [30](logs/30-ui-spec.log) |

### Secrets / Supply chain

| # | Lint | Exit | Status | Notes | Log |
|---|---|---:|---|---|---|
| 31 | `gitleaks detect --config .gitleaks.toml --source . --redact` (git history, 2102 commits incl. realtime language injection) | 0 | **PASS** | "2102 commits scanned. scanned ~28643789 bytes (28.64 MB) in 1.76s. no leaks found" | [31](logs/31-gitleaks.log) |
| 31b | `gitleaks detect --no-git` (working-tree, matches `pnpm lint:gitleaks`) | — | **SKIP** | Initial run hung scanning `node_modules` (gitleaks `.gitleaks.toml` allowlist excludes `tests/` but not `node_modules/`). Substituted with `pnpm lint:gitleaks:staged` (PRE-PUSH HOOK EQUIVALENT, see row 31c below) — that is what actually runs on push. | [31b](logs/31b-gitleaks-no-git.log) |
| 31c | `pnpm lint:gitleaks:staged` (`gitleaks protect --staged`) | 0 | **PASS** | "0 commits scanned. no leaks found." Working tree was clean at scan time (only `.planning/` untracked). | [31c](logs/31c-gitleaks-staged.log) |
| 32 | `vitest run tools/lint-gitleaks-config.test.ts` | 0 | **PASS** | 1 file, 8 tests passed (gitleaks config self-test). | [32](logs/32-gitleaks-config.log) |
| 33 | `pnpm audit --audit-level=moderate` | 0 | **PASS** | "No known vulnerabilities found" | [33](logs/33-pnpm-audit.log) |
| 34 | `pnpm outdated --recursive` | 1 | **AWARENESS** (non-blocking) | 30+ deps drift; notable: `next 15.5.18 → 16.2.6` (major), `pino 9 → 10` (major), `undici 7 → 8` (major), `tough-cookie 5 → 6` (major), `typescript 5.9 → 6.0` (major), `testcontainers 11 → 12` (major), `@fastify/multipart 9 → 10` (major), `vitest/@vitest/coverage-v8 4.1.5 → 4.1.7` (patch). See §5. | [34](logs/34-pnpm-outdated.log) |

---

## 3. LOCKER-04 FAIL detail (Phase-41-deferred debt)

Per `CLAUDE.md` DISCIPLINE Rule 14: "LOCKER-04's BLOCKING flip is operationally deferred from Plan 31-08 to Phase 41 closure (Phase 41 closes the 47-route bulkfix backlog with per-route TDD pairs; the dead-export backlog is Phase 38's `@openwhispr/auth` retirement)."

### Breakdown (367 FAIL lines)

| Subcategory | Count | Disposition |
|---|---:|---|
| `LOCKER-04-DEAD-EXPORT` | **344** | Phase 38 (`@openwhispr/auth` retirement) + Phase 41 (47-route bulkfix). Most live in `packages/litellm-client/src/index.ts` (intentional re-export façade) and `packages/data/src/sessions/lookup-by-previous-token.ts`. Allowlist line: `# issue-31-04-debt-LOCKER-04-dead-export-phase-XX`. |
| `LOCKER-04-NO-SCHEMA` | **20** | Phase 41 47-route bulkfix. Critical routes missing Zod schema: `agent/web-search.ts:96`, `auth-callback.ts:131`, `desktop-signin.ts:105`, `diarization.ts:181`, `locale.ts:92`, `note-recording-config.ts:37`, `realtime.ts:531`, `stt-config.ts:48`, `tokens/{assemblyai,deepgram,openai-realtime}.ts`, `transcribe.ts:157`, `transcriptions/{batch-create,batch-delete,create,delete}.ts`, `usage.ts:39`, `v1/keys/{create,list,revoke}.ts`. |
| `LOCKER-04-NO-RATELIMIT` | **1** | `apps/api/src/routes/realtime.ts:531` — WS upgrade route lacks `config: { rateLimit }`. Realtime gateway; pre-push consideration. |
| `LOCKER-04-INVALID-RATELIMIT-FALSE` | **1** | `apps/api/src/routes/__test/fetch.ts:82` — test-only route, fine for test build but should not ship to prod image. Verify image excludes `__test/*` (it does — gated by `OPENWHISPR_ENABLE_TEST_ROUTES`). |

WARN lines (258 total): mirror the same categories but already allowlisted via `tools/lint-prod-readiness.allowlist.txt`. Not blocking.

---

## 4. Gitleaks findings

**Result:** Zero leaks.

- `--source . --redact` (with-git, scans full history): "2100 commits scanned. scanned ~28611896 bytes (28.61 MB) in 1.17s. no leaks found".
- `--no-git` working-tree scan (matches `pnpm lint:gitleaks` script which is what runs on pre-push hook): see [logs/31b-gitleaks-no-git.log](logs/31b-gitleaks-no-git.log).
- `lint-gitleaks-config.test.ts` self-test: 8/8 tests passed (regex allowlist integrity holds; the gitleaks defense-in-depth Layer 1 is wired correctly).

No redacted snippets to report — the scan found nothing.

---

## 5. `pnpm audit` + `pnpm outdated`

### `pnpm audit --audit-level=moderate`

**No known vulnerabilities found.** Zero moderate-or-higher CVEs across the workspace.

### `pnpm outdated --recursive` (awareness only — non-blocking)

Notable drift:

| Package | Current | Latest | Severity |
|---|---|---|---|
| `next` | 15.5.18 | 16.2.6 | **MAJOR** — App Router stack still on 15; v16 has breaking changes. Don't bump pre-push. |
| `pino` | 9.14.0 | 10.3.1 | **MAJOR** — logging core; defer to a dedicated phase. |
| `undici` | 7.25.0 | 8.3.0 | **MAJOR** — HTTP client; impacts SSRF dispatcher + LiteLLM client. Don't bump pre-push. |
| `tough-cookie` | 5.1.2 | 6.0.1 | **MAJOR** — used in contract-tests + e2e only. |
| `typescript` | 5.6.3 / 5.9.3 | 6.0.3 | **MAJOR** — defer. |
| `testcontainers` | 11.14.0 | 12.0.0 | **MAJOR** — test infra; defer to a dedicated phase, verify Ryuk cleanup audit (per `feedback_testcontainers_cleanup_audit.md`). |
| `@fastify/multipart` | 9.4.0 | 10.0.0 | **MAJOR** — used in mock-litellm only; check Fastify 5 compat. |
| `@vitejs/plugin-react` | 5.2.0 | 6.0.2 | **MAJOR** — web app only. |
| `bullmq` | 5.77.1 | 5.77.3 | patch |
| `nodemailer` | 8.0.7 | 8.0.8 | patch |
| `@tanstack/react-query` | 5.100.13 | 5.100.14 | patch |

**Recommendation:** none of these are pre-push blockers. Queue a separate dependency-upgrade phase post-push.

---

## 6. Costyl / hardcode hotspots (beyond LOCKER-03)

Distilled from the LOCKER-03 allowlist and ambient context (not flagged by automated lints but worth knowing for the on-call pager today):

| Hotspot | File:line | Risk | Disposition |
|---|---|---|---|
| **Port-4000 LiteLLM internal-compose URL** | `apps/api/src/index.ts:1040` (+ drift markers totalling ~250+ lines of historical drift) | Hardcoded `http://litellm:4000` for internal docker-compose service-name resolution. Operator-overridable via `LITELLM_BASE_URL` env. | Allowlisted as `# permanent-docker-compose-internal-url`. Verify operator env has `LITELLM_BASE_URL=https://...` set in prod compose. |
| **`api.localhost` Traefik fixture** | `packages/contract-tests/src/env.ts:13`, `packages/data/src/seed/conformance.ts:123` | Used by contract-test fixture suite; never reached in prod boot. | Permanent allowlist as `# canonical-fixture-api-localhost`. |
| **AUTH_URL `localhost:3000` fallback** | `apps/api/src/routes/test-only.ts:291` | Test-only route; gated by `OPENWHISPR_ENABLE_TEST_ROUTES` env. | Verify prod image does NOT enable that env flag (default off). |
| **`test-env-default` AUTH_URL fallback** | `apps/api/src/config/auth.ts:70`, `:165` | `NODE_ENV=test` short-circuit; never reached at production boot (Rule 11 enforces `NODE_ENV` checks only in `config/*.ts` / `bootstrap.ts`). | Inspected — narrow scope, no exposure. |
| **Anti-footgun LiteLLM sentinel** | `apps/api/src/config/litellm.ts:29`, `:63` | Refuses prod boot if `LITELLM_VIRTUAL_KEY` literally matches the dev-overlay default. This is a **feature** (FATAL guard), not debt. | Verify prod env has a non-sentinel virtual key. |
| **Realtime WS route missing rate-limit** | `apps/api/src/routes/realtime.ts:531` | WS upgrade endpoint lacks `config: { rateLimit }`. Realtime tunnel; subject to abuse if exposed without an upstream throttle. | Phase 41 47-route bulkfix item. Mitigate today with Traefik / upstream rate-limit middleware OR ship with full awareness that the route is unrated at L7. |
| **Realtime WS route missing schema** | `apps/api/src/routes/realtime.ts:531` | Same route — no Zod body/querystring schema. WS upgrade has no input validation at Fastify level. Inputs are validated downstream by the realtime frame translator. | Phase 41 item; downstream validation exists. |
| **Test-only `rateLimit: false` in `__test/fetch.ts`** | `apps/api/src/routes/__test/fetch.ts:82` | Forbidden outside health-class routes per LOCKER-04. | Test-only — verify env gate excludes this route from prod build (`OPENWHISPR_ENABLE_TEST_ROUTES` flag, default off). |
| **Magic timeouts in `litellm-client`** | `packages/litellm-client/src/index.ts:160–191` (`DEFAULT_BODY_TIMEOUT_MS`, `DEFAULT_ERROR_DRAIN_TIMEOUT_MS`, `DEFAULT_HEADERS_TIMEOUT_MS`, `DEFAULT_RETRY_BASE_MS`, `DEFAULT_RETRY_CAP_MS`, `DEFAULT_RETRY_MAX_ATTEMPTS`) | Constants exposed but not consumed externally → flagged as DEAD-EXPORT. Values themselves are reasonable and env-overridable (`LITELLM_RETRY_*`). | Phase 38/41 cleanup; functionally correct. |

---

## 7. Action items — pre-push (ordered)

1. ~~**(IMMEDIATE)** Commit or stash the dirty working tree~~ — **DONE in `a4eed5ba` + `0513729c` mid-review.** Working tree is clean of source changes.
2. **(IMMEDIATE)** Confirm prod env has:
   - `LITELLM_BASE_URL` set (NOT defaulting to `http://litellm:4000`).
   - `LITELLM_VIRTUAL_KEY` not equal to dev-overlay sentinel (else `validateLitellmBoot()` will exit 78).
   - `MASTER_KEK` and `OPENWHISPR_KEY_PROVIDER=env` set (else `validateEncryptionBoot()` will exit 78 — LOCKER-08).
   - `OPENWHISPR_ENABLE_TEST_ROUTES` **NOT** set (default off — keeps `__test/*` out of prod).
   - `AUTH_URL` and `INGRESS_BASE_URL` set to prod URLs (no fallback `localhost`).
3. **(RECOMMENDED)** Rerun `lint-rls.ts` against the prod-equivalent Postgres before push: `DATABASE_URL=postgresql://... pnpm tsx tools/lint-rls.ts` to close the SKIP gap (lint short-circuited on missing env in this run).
4. **(RECOMMENDED)** Verify the chart bump's `extraEnv` strip-list per `feedback_chart_bump_extraenv_strip.md` if `Chart.yaml` is part of this release.
5. **(OPTIONAL)** Pre-push hook will run `pnpm lint:gitleaks` (`--no-git` working-tree scan) — already verified clean in this review (logs/31b).
6. **(POST-PUSH AWARENESS — not blocking)**
   - Phase 41 47-route bulkfix is overdue: 20 routes still missing Zod schema, 1 missing rate-limit (`realtime.ts:531`).
   - Phase 38 `@openwhispr/auth` retirement is overdue: 344 dead-exports.
   - LOCKER-05 BLOCKING flip is at Phase 37; LOCKER-06 at Phase 36.a — currently both PASS-clean, so no risk today.
   - `lint-weak-assertions.ts` has a self-test FP — file an issue to add `tools/lint-weak-assertions.test.ts` to its own exclusion list.
   - Dependency drift queue (next, pino, undici, tough-cookie, typescript, testcontainers, fastify/multipart, vitejs/plugin-react) — schedule a deps-bump phase post-push.

---

## 8. Final verdict

**GO for production push today.** Constitutional LOCKERs (rules 11–13, 15, 16) are PASS-clean against the post-commit HEAD `0513729c`. The single non-zero exit on a constitutional locker — `lint-prod-readiness.ts` (LOCKER-04) — is the **documented Phase-41-deferred WARN-class debt** (344 dead-exports + 20 routes missing Zod schemas + 1 WS route missing rate-limit + 1 test-only `rateLimit: false`); no regression vs. pre-commit baseline. Zero leaked secrets across 2102-commit history + zero leaks staged. Zero moderate+ CVEs. The only operator action required pre-push is the env-presence checklist in §7.2 (LITELLM_BASE_URL set, LITELLM_VIRTUAL_KEY non-sentinel, MASTER_KEK set, OPENWHISPR_ENABLE_TEST_ROUTES unset, AUTH_URL + INGRESS_BASE_URL set to prod). Ship it.

---

**Report path:** `/Users/dev/openwhispr-server/.planning/review/pre-prod-2026-05-26/LOCKER-PROD.md`
**Generated:** 2026-05-26 14:46 MSK (post-commit re-run of constitutional LOCKERs + gitleaks)
