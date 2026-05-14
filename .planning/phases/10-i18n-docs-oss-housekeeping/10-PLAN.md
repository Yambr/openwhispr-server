<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->
<!-- REUSE-IgnoreStart -->
---
phase: 10
plan: 00
type: execute
wave: 0
depends_on: []
files_modified: []
autonomous: true
requirements: [I18N-01, I18N-02, TEST-I18N-01, DOCS-01, DOCS-02, DOCS-03, DOCS-04, DOCS-05, DOCS-06, DOCS-07, DOCS-08]
tags: [i18n, docs, oss, license, apache-2.0, i18next, icu]

must_haves:
  truths:
    - "API emits translated error envelopes when client sends Accept-Language: ru"
    - "Worker renders email subject/body in ru when job payload locale=ru"
    - "Web app renders ru UI when NEXT_LOCALE cookie or Accept-Language indicates ru"
    - "TEST-I18N-01 CI gate fails when en/ru key sets drift"
    - "Operator-mounted /etc/openwhispr/locales overrides baked-in resources without code change"
    - "README quickstart gets a fresh clone to first authenticated /api/transcribe in < 5 min"
    - "docs/architecture.md, docs/i18n.md, docs/security.md exist with required content"
    - "All .ts/.tsx source files carry SPDX-License-Identifier: Apache-2.0 header"
    - "8 new ADRs (0004-0011) exist under docs/adrs/ in Nygard format"
    - ".github/CODEOWNERS, ISSUE_TEMPLATE/, and Contributor Covenant 2.1 CODE_OF_CONDUCT.md present"
  artifacts:
    - path: "apps/api/src/i18n.ts"
      provides: "Fastify i18next bootstrap (i18next + ICU + http-middleware + fs-backend)"
    - path: "packages/i18n/locales/en/errors.json"
      provides: "Server error envelope translations (en)"
    - path: "packages/i18n/locales/ru/errors.json"
      provides: "Server error envelope translations (ru)"
    - path: "packages/i18n/locales/en/email.json"
      provides: "Email template strings (en)"
    - path: "packages/i18n/locales/ru/email.json"
      provides: "Email template strings (ru)"
    - path: "apps/worker/src/lib/template-renderer.ts"
      provides: "TemplateRenderer implementation"
    - path: "apps/web/src/locales/ru/common.json"
      provides: "Russian UI common bundle"
    - path: "apps/web/src/locales/ru/admin.json"
      provides: "Russian admin bundle"
    - path: "apps/web/src/locales/ru/end-user.json"
      provides: "Russian end-user bundle"
    - path: "docs/architecture.md"
      provides: "System decomposition + three hot-path mermaid diagrams"
    - path: "docs/i18n.md"
      provides: "Operator-facing locale guide"
    - path: "docs/security.md"
      provides: "Security posture (SSRF, secrets, log scrubbing, audit-log threat model)"
    - path: "docs/adrs/0004-apache-2-0-licensing.md"
      provides: "ADR for license choice"
    - path: ".github/CODEOWNERS"
      provides: "Default code owner mapping"
    - path: ".github/ISSUE_TEMPLATE/bug.yml"
      provides: "Bug issue form"
    - path: "CODE_OF_CONDUCT.md"
      provides: "Contributor Covenant 2.1"
    - path: ".github/workflows/spdx.yml"
      provides: "CI gate asserting SPDX header presence on new TS files"
  key_links:
    - from: "apps/api/src/error-handler.ts"
      to: "packages/i18n/locales/{en,ru}/errors.json"
      via: "req.i18n.t(`errors.${err.code}`)"
      pattern: "req\\.i18n\\.t\\("
    - from: "apps/worker/src/jobs/email-delivery.ts"
      to: "apps/worker/src/lib/template-renderer.ts"
      via: "TemplateRenderer.render({template_id, locale, variables})"
      pattern: "TemplateRenderer"
    - from: "apps/web/src/app/layout.tsx"
      to: "apps/web/src/locales/{en,ru}/*.json"
      via: "getServerI18n(lng) where lng resolved from cookie/header"
      pattern: "getServerI18n"
    - from: ".github/workflows/ci.yml"
      to: "packages/i18n/__tests__/locale-coverage.test.ts"
      via: "test:i18n-completeness step"
      pattern: "i18n-completeness"
---

# Phase 10 — i18n + Docs + OSS Housekeeping (Umbrella)

## Phase Goal

An operator (or contributor) lands on a fully localized (en+ru) runtime with operator-overridable locale resources, complete OSS documentation, and the OSS housekeeping (CODEOWNERS, SPDX headers, Contributor Covenant 2.1, Apache-2.0 LICENSE already in place) needed to accept the first community contribution.

## Plan Index

| Plan | Wave | Title | Tasks (predicted) | Autonomous |
|------|------|-------|-------------------|------------|
| 10-01 | 1 | Server i18n (API + Worker) | 6 | true |
| 10-02 | 1 | Web Russian translations + locale negotiation | 5 | true |
| 10-03 | 2 | Docs suite (architecture, i18n, security, README/ops/auth/wire extensions) | 5 | true |
| 10-04 | 3 | OSS housekeeping — SPDX, CODEOWNERS, issue templates, CoC 2.1, ADRs 0004-0011 | 6 | true |

**Wave layout:**
- **Wave 1 (parallel):** 10-01 (server) and 10-02 (web) touch disjoint workspaces.
- **Wave 2:** 10-03 docs reference the i18n surface introduced in 10-01.
- **Wave 3:** 10-04 SPDX codemod runs last to avoid churn collisions with 10-01/10-03 file edits.

## Threat Model

### Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Client → API | `Accept-Language` is untrusted; treat as hint only, hard fallback to `en` on parse failure |
| Operator → Filesystem | `LOCALES_DIR` mounts arbitrary JSON; treat as untrusted at i18next init |
| Translator → Repo | Translation PRs introduce ru text; must stay within `packages/i18n/locales/ru/**` and `apps/web/src/locales/ru/**` allowlist |

### STRIDE Threat Register

| ID | Category | Component | Disposition | Mitigation |
|----|----------|-----------|-------------|------------|
| T-10-01 | Tampering | `recordAudit()` payload | mitigate | Runtime Cyrillic-codepoint scan on payload before INSERT (mirrors `lint-english.ts` regex); reject with programmer-error throw if hit. Audit-log payload values stay English (constitutional). |
| T-10-02 | Information Disclosure | i18n bundles | mitigate | i18n strings are NEVER secrets; CI lint forbids `process.env.*`-looking values in locale JSON; CONTRIBUTING.md states the rule. |
| T-10-03 | Denial of Service | Operator-mounted `LOCALES_DIR` | mitigate | Boot-time ICU MessageFormat parser validates every loaded JSON; init fails fast on invalid ICU; documented in `docs/i18n.md` as operator-at-own-risk. |
| T-10-04 | Tampering | SPDX header codemod | mitigate | Codemod excludes `node_modules`, `dist`, `**/migrations/*.generated.*`, JSON files; respects existing shebangs (inserts at line 2). Round-trip test compares biome-formatted output. |
| T-10-05 | Information Disclosure | Log scrubbing in ru | mitigate | pino `redact` paths are key-based (`req.headers.authorization`), language-agnostic; add test asserting redact paths still fire when log values are Cyrillic. |
| T-10-06 | Spoofing | `Accept-Language` driving privileged actions | accept | Locale only affects rendering, never authorization. Documented in `docs/security.md`. |
| T-10-07 | Tampering | Better Auth verification email locale | mitigate | `users.locale` column added via migration; default `"en"`; set at signup from `Accept-Language`; user-changeable via web settings. Hook reads `user.locale` to choose template. |
| T-10-08 | Repudiation | License-headerless new TS files | mitigate | `.github/workflows/spdx.yml` gates every PR; `pnpm spdx:check` runs locally pre-commit. |

## Deferred (Out of Scope)

- ADR 0012 (Audit-log single-chokepoint) and ADR 0013 (:8443 Realtime entrypoint) — optional per research; defer to Phase 11 backlog.
- Russian formal/informal dialect variants.
- Additional locales beyond en+ru (RTL, CJK).
- `virtual_key_rotation_notice` template (Phase 6 flow is currently text-free; revisit when notification copy ships).
- `.github/FUNDING.yml`.

## Source Audit

| Source | Item | Plan | Status |
|--------|------|------|--------|
| GOAL | "Fully localized (en+ru) runtime" | 10-01, 10-02 | COVERED |
| GOAL | "Operator-overridable locale resources" | 10-01 (via `LOCALES_DIR`) | COVERED |
| GOAL | "Complete OSS documentation" | 10-03 | COVERED |
| GOAL | "OSS housekeeping for first community contribution" | 10-04 | COVERED |
| REQ | I18N-01 (i18next+ICU, en+ru, CLDR plurals, Accept-Language) | 10-01, 10-02 | COVERED |
| REQ | I18N-02 (operator-override volume) | 10-01 | COVERED |
| REQ | TEST-I18N-01 (CI gate on key drift) | 10-01 (gate + emission completeness), 10-02 (web coverage) | COVERED |
| REQ | DOCS-01 (README) | 10-03 | COVERED |
| REQ | DOCS-02 (architecture.md) | 10-03 | COVERED |
| REQ | DOCS-03 (operations.md) | 10-03 | COVERED |
| REQ | DOCS-04 (litellm-target-spec audit) | 10-03 | COVERED |
| REQ | DOCS-05 (wire-contract audit) | 10-03 | COVERED |
| REQ | DOCS-06 (auth.md audit) | 10-03 | COVERED |
| REQ | DOCS-07 (CONTRIBUTING/SECURITY/CoC/LICENSE/headers) | 10-04 (LICENSE+NOTICE already shipped pre-planner in bd81d82; this plan adds SPDX headers + CoC 2.1 + CONTRIBUTING/SECURITY extension) | COVERED |
| REQ | DOCS-08 (ADRs for every Key Decision) | 10-04 (ADRs 0004-0011) | COVERED |
| RESEARCH | i18next+ICU+http-middleware+fs-backend | 10-01, 10-02 | COVERED |
| RESEARCH | accept-language-parser for RSC | 10-02 | COVERED |
| RESEARCH | TemplateRenderer for 3 templates (verification, password_reset, account_deletion_confirmation) | 10-01 | COVERED |
| RESEARCH | users.locale column migration | 10-01 | COVERED |
| RESEARCH | CLDR ru boundary test (0/1/2/5/11/21/22/25/101/105) | 10-01, 10-02 | COVERED |
| RESEARCH | Emission-completeness source-walk gate | 10-01 | COVERED |
| RESEARCH | NEXT_LOCALE cookie + /api/locale switcher | 10-02 | COVERED |
| RESEARCH | docs/architecture.md three hot paths with mermaid | 10-03 | COVERED |
| RESEARCH | docs/i18n.md operator guide | 10-03 | COVERED |
| RESEARCH | docs/security.md posture | 10-03 | COVERED |
| RESEARCH | SPDX header codemod | 10-04 | COVERED |
| RESEARCH | ISSUE_TEMPLATE (bug/feature/question) | 10-04 | COVERED |
| RESEARCH | CODEOWNERS | 10-04 | COVERED |
| RESEARCH | Contributor Covenant 2.1 (current file is already 2.1; audit) | 10-04 | COVERED |
| CONTEXT | LICENSE/NOTICE (Apache-2.0) — shipped pre-planner in bd81d82 | n/a | DONE (skip in 10-04) |

No unplanned items. No gaps.

## Verification

- `pnpm -r test` green across all packages
- `pnpm test:i18n-completeness` green (TEST-I18N-01)
- `pnpm spdx:check` green
- `pnpm lint:english` green
- `pnpm typecheck` green
- Coverage ≥ 90/90/90/90 on diff for every plan

## Output

Each plan produces a SUMMARY at `.planning/phases/10-i18n-docs-oss-housekeeping/10-{NN}-SUMMARY.md`.
<!-- REUSE-IgnoreEnd -->
