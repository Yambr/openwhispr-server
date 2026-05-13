# Phase 13: E2E + CJM Harness (v2 — ships first) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 13-e2e-cjm-harness-v2-ships-first
**Areas discussed:** BDD runner pick, Sub-plan split (13.a/13.b), packages/email shape + SMTP env contract, CJM journey roster + ordering rule

---

## BDD runner pick

| Option | Description | Selected |
|--------|-------------|----------|
| Lock Cucumber + playwright-bdd | Keep REQUIREMENTS.md E2E-01 + research SUMMARY default. .feature files are the auditable CJM artefact + non-engineer readable. Pitfall 2's 'CJM.md before features' rule is naturally enforced by Gherkin file structure. Cost: extra runner layer. | ✓ |
| Plain @playwright/test with describe('@cjm-N.M') tags | Drop @cucumber/cucumber + playwright-bdd. CJM.md stays the doc, tests reference it via tags. Simpler runner, native Playwright parallel + retries-off semantics. Cost: no .feature artefact; CJM↔test mapping is convention not file-structure. | |
| Hybrid — Cucumber for auth/onboarding, plain Playwright for other | Cucumber where the CJM artefact value is highest. Plain Playwright for transcribe round-trip, locale-switch, infra journeys. Cost: two runners to maintain. | |

**User's choice:** Lock Cucumber + playwright-bdd
**Notes:** Resolves the roadmap-deferred Open Question §2 (Phase 13 BDD vs plain Playwright). REQUIREMENTS.md E2E-01 stays authoritative.

---

## Sub-plan split (13.a / 13.b)

| Option | Description | Selected |
|--------|-------------|----------|
| Split 13.a (harness + fixes) → 13.b (features + CJM doc) | 13.a: tests/e2e-cjm/ scaffold + cucumber+playwright-bdd config + 1–2 reference scenarios + worker noopSender→nodemailer in new packages/email/ + tools/global-vitest-teardown.ts + SIGINT/SIGTERM + CI prune-in-always + weak-assert ESLint rule + auth __tests__ sweep + Mailpit HTTP helper + readiness probes contract + Makefile e2e-cjm. Unblocks Phase 12 fast. 13.b: docs/customer-journeys.md authored FIRST + remaining ~18 Gherkin features + step coverage. | ✓ |
| Monolithic Phase 13 | Single phase ships harness + all ~20 features + CJM + fixes together. Phase 12 waits longer for the gate. | |
| Three-way split 13.a (fixes) / 13.b (harness) / 13.c (features+CJM) | Isolate worker fix + teardown + weak-assert sweep as 13.a (no harness yet); 13.b harness scaffold; 13.c full CJM + features. More atomic, more orchestration. | |

**User's choice:** Split 13.a (harness + fixes) → 13.b (features + CJM doc)
**Notes:** Atomic-commit guarantee (roadmap success criterion #3 — harness commit AND worker fix as ONE atomic commit) shifts inside 13.a. Plan must enforce single-PR / single-commit gating for that pair. NOT staggered across plan-wave boundaries. Captured in CONTEXT.md D-04.

---

## packages/email shape

| Option | Description | Selected |
|--------|-------------|----------|
| Shared package consumed by both api + worker | Extract existing apps/api/src/email.ts EmailService into packages/email/. Both api and worker import EmailSender + templateRenderer. Aligns with @openwhispr/observability + @openwhispr/litellm-client precedent. | ✓ |
| Worker-only; api retains its own email.ts | packages/email/ is worker-internal. api keeps src/email.ts. Cost: duplicate template logic; risk of drift. | |
| Inline in apps/worker; no new package | Replace noopSender inline; no new package. Cheapest atomic commit but loses reusability. | |

**User's choice:** Shared package consumed by both api + worker
**Notes:** Mirrors existing shared-package precedent.

---

## SMTP env contract

| Option | Description | Selected |
|--------|-------------|----------|
| Loud-fail at worker boot if SMTP_HOST unset in prod; Mailpit default in dev/CI | Env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE, SMTP_REJECT_UNAUTHORIZED. Defaults wire to mailpit:1025 when NODE_ENV ≠ production. In production, refuse to start when SMTP_HOST unset (matches BYOK loud-fail pattern). | ✓ |
| Lazy on first send | Worker boots fine; first email send fails into audit log. Decouples startup from SMTP availability. Cost: silent until first email — brownfield trap pattern returns. | |
| Mailpit always default; SMTP_HOST overrides (no boot-time gate) | Even in prod, default to mailpit:1025. Simplest. Cost: operators who forget SMTP_HOST in prod silently lose all email. | |

**User's choice:** Loud-fail at worker boot if SMTP_HOST unset in prod
**Notes:** Aligns with bootstrap.sh refuse-to-start gate and Phase 14 BYOK loud-fail.

---

## CJM journey roster

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm research roster | 8 .feature files: signup-verify, signin, password-reset, transcribe, admin-onboarding, locale-switch, oidc-providers, error-paths. ~20 scenarios after negative twins. @cjm-N.M tag schema. CJM.md authored FIRST per Pitfall 2. | ✓ |
| Confirm 8 features but defer password-reset to v3 | Drop password-reset.feature; replace with verification-email-resend.feature. | |
| Expand to 10 features | Add api-keys.feature + capabilities-drift.feature. | |

**User's choice:** Confirm research roster
**Notes:** Resend-CTA assertion folds into signin.feature 403-unverified negative twin (E2E-05). api-keys / capabilities-drift deferred (CONTEXT.md `<deferred>`).

---

## CJM ordering rule

| Option | Description | Selected |
|--------|-------------|----------|
| Hard rule: CJM.md complete BEFORE any .feature file lands | Per Pitfall 2 + roadmap success criterion #2. 13.b ships CJM.md in wave 1; features in wave 2. Verifier fails if any .feature exists without matching docs/customer-journeys.md §N.M anchor. | ✓ |
| Soft rule: CJM.md and features co-authored | Allow CJM and features in same plan wave; trusts the planner. | |

**User's choice:** Hard rule
**Notes:** Verifier-enforced. Negative-twin rule (every 2xx scenario has a sibling 4xx/5xx scenario) is also verifier-enforced per CONTEXT.md D-10.

---

## Claude's Discretion

- File subdivision under `tests/e2e-cjm/{features,steps,support}/` — researcher/planner choose step-file domain split.
- Nodemailer transport configuration (pool vs single-shot, retry policy) — researcher chooses; loud-fail at boot non-negotiable.
- `packages/email/` factory vs class shape (`createEmailSender(env)` vs `new EmailSender(env)`).
- Mailpit polling backoff (exponential vs fixed); explicit timeout MANDATORY.

## Deferred Ideas

- Hybrid runner (Cucumber + plain Playwright) — rejected; reconsider only if Cucumber parallel-mode bugs become structural.
- `verification-email-resend.feature` as a standalone — folded into `signin.feature` negative twins.
- `api-keys.feature` + `capabilities-drift.feature` (10-feature roster) — v3 or hypothetical 13.c.
- `apps/web/public/.gitkeep` commit (deferred-items §2) — owned by Phase 15; Phase 13 does NOT pick up.
- Cross-browser matrix (Firefox, WebKit) — Chromium-only in v2.
- Mobile viewports — explicit anti.
- Real SMTP in CI — explicit anti; mailpit only.
