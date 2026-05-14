# Phase 13 — Security Audit Report

**Phase:** 13 — e2e-cjm-harness-v2-ships-first
**Audited commits:** `17c603e` (13-01), `df91de2` (13-02), `4eedcf4` + `b6e7ad4` (docs)
**Audited:** 2026-05-14
**ASVS Level:** 2 (target)
**Stance:** adversarial — every mitigation grep-verified in implementation

---

## Executive verdict

**Zero HIGH or CRITICAL findings.** All 11 declared threats (7 in 13-01, 4 in 13-02) plus the 8 prompt-supplied surface areas are either VERIFIED-MITIGATED or correctly classified as accepted / deferred-RED with machine-enforced markers. Two LOW observations are recorded for transparency only — neither blocks the phase.

---

## Threat register verification (declared in `<threat_model>`)

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-13-01 | Info disclosure (email log content) | mitigate | **MITIGATED with note** | `packages/email/src/EmailSender.ts:132,138`: `log.info({to, subject, messageId, event}, …)` and `log.error({err, to, subject, event}, …)`. Body (`text`/`html`) NEVER logged. **Note:** mitigation plan text claims "subject ... never logged"; subject IS logged. Subject strings are static template names ("Verify your OpenWhispr account") not user-controlled — treated as low-sensitivity. `to` is recipient email (PII) — logged per pre-existing pattern. Low — see Observation 1. |
| T-13-02 | DoS (silent SMTP failure in prod) | mitigate | **MITIGATED** | `packages/email/src/EmailSender.ts:74-83`: `if (!host) { if (env.NODE_ENV === "production") throw new Error("SMTP_HOST is required in production (event:email.smtp_required_in_production)") }`. Test coverage 100% (24 tests in `EmailSender.test.ts` incl. prod loud-fail branch). |
| T-13-03 | Tampering (testcontainer prune scope) | accept | **VERIFIED** | `.github/workflows/e2e-cjm.yml:47-55` filters by `label=org.testcontainers=true`; `tools/global-vitest-teardown.ts` uses same label scoping. Prune cannot reach unlabeled containers. |
| T-13-04 | Repudiation (shared auth state) | accept | **VERIFIED** | `tests/e2e-cjm/support/fixtures.ts:49`: `email: \`e2e+${slug}@local.test\`` — per-scenario UUID slug. Per-scenario tenant isolation (D-13). |
| T-13-05 | Spoofing (mailpit query collision) | mitigate | **MITIGATED** | `tests/e2e-cjm/support/mailpit-helper.ts` polls by exact `to:` match against per-scenario unique emails. UUID-keyed. |
| T-13-06 | Privilege elevation (real SMTP creds in CI) | mitigate | **MITIGATED** | `.github/workflows/e2e-cjm.yml` does NOT define `SMTP_USER`/`SMTP_PASSWORD` env or `secrets.*` references — CI uses mailpit (port 1025, no auth). Production loud-fail prevents accidental dev path in prod. |
| T-13-07 | Info disclosure (`/api/health.migrations_completed`) | mitigate | **MITIGATED** | `apps/api/src/routes/probes.ts:120-143`: returns `{status, migrations_completed: boolean}` only. No schema names, table contents, version strings. Probe errors are caught and surfaced as `false` (no error message leak). |
| T-13-02-01 | Info disclosure (5xx stack-trace leak) | mitigate | **MITIGATED** | `tests/e2e-cjm/features/error-paths.feature` @cjm-8.2: `Then the response is a typed error envelope without a stack trace leak`. Test is GREEN (10/10 in 13-02 live proof). |
| T-13-02-02 | Tampering (`@expected-red` rot) | mitigate | **MITIGATED** | `tools/lint-cjm-doc.ts --check-expected-red` ran exit 0 in verifier proof. 10 `@expected-red` tags all paired with `@after-phase-{12,15}`. |
| T-13-02-03 | Repudiation (CJM doc drift) | mitigate | **MITIGATED** | `tools/lint-cjm-doc.ts --features` cross-checks every Gherkin tag against doc anchors; lints in Makefile + CI before bddgen runs. |
| T-13-02-04 | DoS (tenant-pool exhaustion via freshTenant) | accept | **VERIFIED** | UUID-keyed rows; `down -v` on every CI compose teardown. |

**Closed: 11/11.**

---

## Prompt-supplied surface verification

### 1. SMTP sender — prod loud-fail / credential leak / SMTP injection

**Status: VERIFIED.**

- Prod loud-fail: `packages/email/src/EmailSender.ts:79-83` — throws when `!host && env.NODE_ENV === "production"`.
- Credential leak: env reads `SMTP_USER` / `SMTP_PASSWORD` at L101-102; values used only inside `nodemailer.createTransport({auth: {user, pass}})` (L111, L114-120). Never logged. `grep -n "log\." packages/email/src/EmailSender.ts` shows only `{to, subject, messageId, event}` and `{err, to, subject, event}` — no credentials, no env dump.
- SMTP header injection: `sendMail({from, to, subject, text, html})` passes structured fields through nodemailer. `from` is env-controlled (operator), `to`/`subject` come from Better Auth callback. Template body interpolation (`apps/worker/src/i18n/template-renderer.ts:129`) uses strict regex `/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g` — only matches whitelisted-name placeholders; values inserted as-is into body text (not headers). Better Auth-generated `verification_url` is the only attacker-shaped value into a body field, and it goes through Better Auth's URL signing.

### 2. Mailpit host port binding

**Status: VERIFIED.**

`docker-compose.yml:724` and `docker-compose.embedded-litellm.yml:742`: both pin to `127.0.0.1:8025:8025` (NOT `0.0.0.0`). Not reachable from LAN/WAN.

### 3. `/api/health migrations_completed` — schema leak / auth bypass

**Status: VERIFIED.**

- Schema leak: response shape is `{status: "ok", migrations_completed: boolean}` — boolean only.
- Probe-error suppression: `apps/api/src/routes/probes.ts:134-139` catches all throws and returns `false`. No schema/table/connection-string in response.
- Auth bypass: `config: { auth: false, rateLimit: false }` at L123. This is intentional and matches `/livez` (probe alias for kubelet). No state mutation, no secret exposure.

### 4. Owner-role pool — `max=1` / scope

**Status: VERIFIED.**

- `apps/api/src/index.ts:637`: `new PgPool({ connectionString: ownerUrl, max: 1 })`.
- Scope: only referenced inside the `migrationsCheck` closure at L638-651 (entrypoint scope). Not exported, not attached to `buildOpts`/`app` as a request-handler-accessible field. Search `grep -rn "probeOwnerPool" apps/api/src/` confirms references confined to `index.ts`.
- Owner-pool query is `SELECT count(*)::text FROM _meta.__drizzle_migrations` only — no DDL, no user-data SELECTs.

### 5. Harness primitives — committed credentials / SSRF deferral

**Status: VERIFIED.**

- No real credentials: `tests/e2e-cjm/support/fixtures.ts:50` ships a static test password `"Cjm2Pass!23"` (per-scenario UUID email, local-only). `tests/e2e-cjm/fixtures/` contains only `silent.wav`. No `.env`, no real OIDC client secrets, no API keys.
- SSRF deferral correctness: `tests/e2e-cjm/features/transcribe.feature:6` — `@cjm-4.1 @expected-red @after-phase-12` for the api→litellm transcribe round-trip. Confirmed in 13-02-PLAN deviation §4 ("SSRF guard blocks api → litellm round-trip"). The SSRF guard is in-place; the scenario is a RED acceptance test for the future allow-list addition (NOT a landed regression). `--grep-invert "@expected-red"` filters this in CI per `Makefile:e2e-cjm`.

### 6. GHA workflow `.github/workflows/e2e-cjm.yml`

**Status: VERIFIED.**

- No `pull_request_target` — uses `pull_request` (L14) which runs under fork's restricted token, not the base repo's secrets.
- No `secrets.*` reference anywhere in the workflow.
- testcontainer prune in `always()`: L47-55 `if: always()` with label filter `label=org.testcontainers=true`. Canary fails the job if leaks remain.
- `actions/upload-artifact@v4` (L58) used `if: failure()` only — no secret upload risk.

### 7. Better Auth verification flow fix

**Status: VERIFIED.**

- Correct key: `apps/api/src/auth.ts:317` — `emailVerification: { sendVerificationEmail: ... }` at top level of Better Auth options (matches Better Auth 1.6.9 `api/routes/sign-up.mjs:239` lookup path). The previous incorrect placement under `emailAndPassword.sendVerificationEmail` is gone — `grep -n "emailAndPassword.*sendVerificationEmail" apps/api/src/auth.ts` returns no matches.
- HTTPS only: `AUTH_URL` defaults to `https://api.localhost` in both compose files (`docker-compose.yml:422`, `docker-compose.embedded-litellm.yml:443`). The single `http://api:3000` occurrence (`docker-compose.yml:785`) is the **intra-cluster** in-network URL used by web→api SSR fetches and never used to build verification URLs sent to users. Better Auth assembles verification URLs from `AUTH_URL`/`baseURL`, which is the HTTPS public origin.
- Single-use tokens: Better Auth's `verify-email` route is the upstream-managed single-use mechanism — phase 13 did not modify token handling, only fixed the closure-key wiring.

### 8. `docs/customer-journeys.md` — PII / credential leaks

**Status: VERIFIED.**

`grep -rnE "(SECRET|API_KEY|PASSWORD|TOKEN)\s*[:=]\s*['\"]" docs/customer-journeys.md` returns no matches. All example emails use `e2e.test` / `local.test` synthetic suffixes; no real names, no real domains, no real keys.

---

## Observations (LOW, non-blocking)

**Observation 1 — Subject is logged despite mitigation note.**
`packages/email/src/EmailSender.ts:132,138` logs `subject` alongside `to` and `messageId`. The T-13-01 mitigation plan text in 13-01-PLAN.md L564 reads "subject and body never logged" — this is incorrect with respect to subject. **Impact:** none; subject strings are static template captions (e.g., "Verify your OpenWhispr account") — no user-controlled content. **Action:** consider correcting the plan text or, in a future phase, dropping `subject` from the structured log to match the documented intent. Not a blocker.

**Observation 2 — Recipient email logged.**
The `to` field is logged in `email.sent` / `email.skipped` / `email.failed` events. This is PII-adjacent (recipient identifier). The pattern is pre-existing (carried over verbatim from `apps/api/src/email.ts` per the file header) and is consistent with operational requirements (operators need to trace delivery failures to specific users). No regression from phase 13; flagging for awareness only.

---

## Unregistered flags

13-01-SUMMARY `## Threat Flags`: "None new." 13-02-SUMMARY `## Threat Flags`: "None new beyond the threat model in the plan body." No threat flags require unregistered-flag handling.

---

## Coverage / completeness

- Every threat in both `<threat_model>` blocks is verified.
- Every prompt-supplied surface area (8/8) is verified by grep + file inspection.
- Implementation files were NOT modified during audit (read-only).
- No HIGH or CRITICAL findings.

**Recommendation:** Phase 13 is **CLEARED for ship**. No blockers.

---

_Audited: 2026-05-14_
_Auditor: gsd-secure-phase (Opus 4.7 1M)_
