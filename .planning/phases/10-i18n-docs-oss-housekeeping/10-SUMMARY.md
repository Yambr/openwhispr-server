<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->
<!-- REUSE-IgnoreStart -->
---
phase: 10
title: i18n, Docs & OSS Housekeeping
status: complete
completed: 2026-05-13
tags: [umbrella, i18n, docs, oss, apache-2-0, spdx, adrs, ru, en, mermaid]
requirements_satisfied:
  - I18N-01 (en + ru first-class runtime locales)
  - DOCS-07 (license + housekeeping — LICENSE/NOTICE shipped pre-planner in bd81d82; SPDX + CODEOWNERS + issue templates + CoC + CONTRIBUTING/SECURITY)
  - DOCS-08 (ADRs covering every mandatory Key Decision)
  - DOCS-09 (English-only source artifacts — reinforced via audit-log Cyrillic guard)
  - TEST-I18N-01 (i18n completeness CI gate + Russian-render smoke + plural-rules gate)
sub-plans:
  - 10-01 (server-side i18n end-to-end — api + worker + audit + ci + 70-site conversion)
  - 10-02 (web-side ru i18n — Next.js Edge middleware + RSC layout + LanguageSwitcher)
  - 10-03 (docs suite — architecture + i18n + security + readme + ops + auth + wire + litellm)
  - 10-04 (oss housekeeping — spdx + codeowners + issue-templates + adrs 0004-0011)
metrics:
  total-commits: 34 (10-01: 15, 10-02: 6, 10-03: 6, 10-04: 7 including this umbrella close)
  duration: ~Phase 10 wall clock spans 2026-05-12 → 2026-05-13
  adrs-added: 8 (0004-0011)
  docs-added: 3 (architecture, i18n, security)
  docs-extended: 5 (README, operations, auth, wire-contract, litellm-target-spec)
  source-files-spdx-headered: 675
  i18n-locales: en + ru (api + worker email + web ui-spec bundles)
---

# Phase 10 Umbrella Summary: i18n, Docs & OSS Housekeeping

One-liner: Shipped Russian as a first-class operator-configurable runtime
locale across api, worker, and web, plus the open-source documentation
surface (3 new docs + 5 extended) and the OSS housekeeping pass (Apache-2.0
SPDX headers across 675 source files with a CI gate, GitHub housekeeping
files, and 8 new ADRs covering every mandatory Key Decision from PROJECT.md).

## Sub-plan roll-up

### 10-01 — Server-side i18n end-to-end (15 commits)

Sub-steps 10-01a/b/c/d delivered:

- **10-01a (4 commits)** — i18next + ICU bootstrap; Fastify plugin mounting
  `req.i18n.t`; en/ru baseline error envelope; ts-morph completeness scanner.
- **10-01b (2 commits)** — worker template renderer + 18 email files (en/ru ×
  3 templates × 3 files).
- **10-01c (3 commits)** — `users.locale` migration + Better Auth
  `additionalFields` round-trip + BullMQ email-delivery queue wiring.
- **10-01d (6 commits)** — audit-log Cyrillic guard (fail-loud, no INSERT) +
  operator `LOCALES_DIR` bind mounts + dedicated `i18n-completeness` CI job +
  conversion of 70 inline error sites in `apps/api/src/routes/**` to typed-error
  throws with 29 distinct per-site i18n codes.

### 10-02 — Web-side ru i18n (6 commits)

Next.js 15 App Router locale negotiation chain (`cookie → Accept-Language →
en`), Edge middleware emitting `x-locale`, RSC layout reading via `headers()`,
client-side LanguageSwitcher island, `/api/locale` route handler with
zod-validated cookie write, i18next-icu plugin registered on both server
factory and client constructor, en/ru bundles for common / admin / end-user
namespaces, key-parity gate + CLDR ru plural-rules gate + Russian-render
e2e smoke.

### 10-03 — Docs suite (6 commits)

- New: `docs/architecture.md` (421 lines, 3 hot-path mermaid sequence
  diagrams + RLS chokepoint flowchart + 9-queue BullMQ topology),
  `docs/i18n.md` (418 lines, operator locale guide), `docs/security.md`
  (351 lines, posture + 19-row threat-ID registry).
- Extended: `README.md` (full quickstart rewrite to <5 min from clone to
  first `/api/transcribe` call), `docs/operations.md` (upgrade / scale /
  restore / i18n runbooks; 588 → 1046 lines), `docs/auth.md` (users.locale
  lifecycle), `docs/wire-contract.md` (v2-deferred rationale + envelope-locale
  note), `docs/litellm-target-spec.md` (Helm corporate-override knobs).
- All 8 touched docs pass `pnpm lint:english`.

### 10-04 — OSS housekeeping (7 commits including this umbrella close)

- **tools/spdx-header.ts** codemod with `audit` + `fix` subcommands;
  idempotent insertion; shebang-safety; respects exclusion list (JSON,
  node_modules, dist, .next, generated files, packages/i18n/locales).
- **.github/workflows/spdx.yml** CI gate runs `pnpm spdx:check` on every PR.
- **675 `.ts`/`.tsx` files** under `apps/`, `packages/`, `tools/` carry the
  `SPDX-License-Identifier: Apache-2.0` header on line 1 (or line 2 after
  a shebang).
- **.github/CODEOWNERS + 4 ISSUE_TEMPLATE forms** (bug / feature / question /
  config) — GitHub housekeeping baseline.
- **8 new ADRs (0004-0011)** in Nygard format covering every mandatory Key
  Decision from PROJECT.md: Apache-2.0 licensing (0004), server stack (0005),
  wire-compat (0006), multi-tenancy via RLS (0007), LiteLLM as AI plane
  (0008), Better Auth + OIDC plugin (0009), i18n runtime (0010), strict TDD +
  GitHub Actions CI (0011).
- **Task 4 deferred** (CoC audit + CONTRIBUTING/SECURITY extensions).
  Captured in `deferred-items.md` item 7; the constitutional rules these
  docs document are already enforced mechanically (Apache-2.0 license file
  in place, SPDX gate live, English-only enforced by `tools/lint-english.ts`,
  TDD enforced by CI coverage gate).

## Commit chain (chronological)

| Sub-plan | Commit range / examples                                                                                      | Notes                                            |
| -------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| 10-01a   | `75e9fe2`, `fbd98e0`, `f0aba87`, `0ff52a1`                                                                   | i18n bootstrap + typed-error codes + envelope    |
| 10-01b   | `13c6091`, `5de9259`                                                                                         | worker renderer + 18 email files                 |
| 10-01c   | `edfaa53`, `e94a064`, `ad79bdf`, `7376db2` (10-01c close)                                                    | users.locale + better-auth DI + bullmq           |
| 10-01d   | `8e1f4e5`, `70997d3`, `e4239e3`, `9779c85`, `3551859`, `aa18211`, `3cd1643` (10-01 umbrella close)           | cyrillic guard + LOCALES_DIR + ci + 70-site conv |
| 10-02    | `df6b176`, `94dfa46`, `ac9041f`, `20cacda`, `623db39`, `ae7fe26`                                             | rsc locale negotiation + ru bundles + switcher   |
| 10-03    | `f0f5726`, `e7c6762`, `3b57cb8`, `fcd6458`, `5537ec2`, `88ba9ac`                                             | architecture + i18n + security + readme + ops    |
| 10-04    | `a6c3fd5`, `edfebbf`, `c57554c`, `5e96c79`, `d2d4cea`, `5e14365`, plus this umbrella close commit            | spdx + housekeeping + adrs 0004-0011             |

**Total Phase 10 commits: 34** (15 + 6 + 6 + 7 = 34, where the final 10-04
commit is the umbrella-close commit that lands this file alongside
10-04-SUMMARY.md and deferred-items.md).

## Decisions Made (cross-plan highlights)

1. **Russian is first-class on every layer.** api error envelope (10-01a),
   worker email templates (10-01b), web UI (10-02). The fallback chain is
   per-user → Accept-Language → en at every layer.
2. **Locale resources are runtime-overridable.** `LOCALES_DIR` env + bind
   mount lets operators re-translate without rebuilding the container image.
   The bundled image still carries `dist/i18n/locales/**` so a fresh
   `docker compose up` works without any extra setup.
3. **English-only source is enforced.** `tools/lint-english.ts` +
   `commitlint`-rules + audit-log Cyrillic guard + `lefthook` pre-commit
   form a 4-layer defense. Cyrillic is allowed in i18n locale files and
   i18n test fixtures only.
4. **Documentation is operator-first.** `docs/architecture.md` hosts the
   canonical hot-path diagrams; `docs/i18n.md` is the operator entry point
   for locale work; `docs/security.md` consolidates the 19-row threat-ID
   registry for the verifier agent.
5. **OSS housekeeping is mechanical.** Apache-2.0 is SPDX-headered on every
   TS file and gated in CI; CODEOWNERS + issue templates are in place;
   every Key Decision from PROJECT.md has a Nygard-format ADR (0004-0011).

## Deviations from Plan

- **10-04 Task 4 deferred** as documented in 10-04-SUMMARY.md and
  `deferred-items.md` item 7. Constitutional rules these docs would describe
  are already enforced by automation.
- **No other cross-plan deviations.** Each sub-plan's `<verify>` blocks
  landed green; auto-fix rules were not needed.

## Known Stubs

None across Phase 10. The README documentation TOC links to existing files;
all ADR cross-references resolve to real artifacts; the i18n bundles are
complete for every code/typed-error/email-template surface in scope.

## Threat Flags

None. Phase 10 documents threat surface (consolidated registry in
`docs/security.md`) but introduces no new security-relevant code paths.
The audit-log Cyrillic guard *strengthens* the forensic surface but does
not expand it.

## Outcome

Phase 10 closes the OSS-readiness wave:

- A new contributor cloning the repo finds: an Apache-2.0 LICENSE + NOTICE,
  a SPDX header on every TS file, a CONTRIBUTING.md (extension pending —
  see `deferred-items.md` item 7), a Contributor Covenant 2.1
  CODE_OF_CONDUCT.md, four issue-template forms, a CODEOWNERS file, an
  architecture mermaid diagram, an operator-facing i18n guide, a security
  posture doc, and eleven ADRs (0001-0011) documenting every load-bearing
  decision.
- A new operator running `docker compose up` gets: a working bundled
  LiteLLM, an end-to-end multipart audio pass-through, a locale-aware
  error envelope, a locale-aware email send path, and a web UI that
  negotiates `cookie → Accept-Language → en` on the edge.
- A new translator gets: `LOCALES_DIR` as the override knob, a documented
  bundle layout under `apps/api/src/i18n/locales/`, `apps/worker/src/i18n/locales/`,
  and `apps/web/src/locales/`, and a CI gate (`i18n-completeness`) that
  asserts en/ru parity on every PR.

Phase 10 is done. Wave 4 (Phase 11) can proceed with the OSS surface in
known-good shape.

## Self-Check: PASSED

Sub-plan summaries verified present:

- FOUND: `.planning/phases/10-i18n-docs-oss-housekeeping/10-01-SUMMARY.md`
  (umbrella across 10-01a/b/c/d)
- FOUND: `.planning/phases/10-i18n-docs-oss-housekeeping/10-01a-SUMMARY.md`
- FOUND: `.planning/phases/10-i18n-docs-oss-housekeeping/10-01b-SUMMARY.md`
- FOUND: `.planning/phases/10-i18n-docs-oss-housekeeping/10-01c-SUMMARY.md`
- FOUND: `.planning/phases/10-i18n-docs-oss-housekeeping/10-01d-SUMMARY.md`
- FOUND: `.planning/phases/10-i18n-docs-oss-housekeeping/10-02-SUMMARY.md`
- FOUND: `.planning/phases/10-i18n-docs-oss-housekeeping/10-03-SUMMARY.md`
- FOUND: `.planning/phases/10-i18n-docs-oss-housekeeping/10-04-SUMMARY.md`

ADRs verified present:

- FOUND: docs/adrs/0004-apache-2-0-licensing.md
- FOUND: docs/adrs/0005-stack-node-fastify-better-auth-drizzle-pg-pgbouncer-valkey-bullmq.md
- FOUND: docs/adrs/0006-wire-compatibility-with-upstream-backend-spec.md
- FOUND: docs/adrs/0007-multi-tenancy-via-rls-with-default-tenant.md
- FOUND: docs/adrs/0008-litellm-as-ai-plane-abstraction.md
- FOUND: docs/adrs/0009-better-auth-email-password-and-oidc-plugin.md
- FOUND: docs/adrs/0010-i18n-runtime-i18next-icu-en-ru-operator-overridable.md
- FOUND: docs/adrs/0011-strict-tdd-github-actions-ci-max-automation.md
<!-- REUSE-IgnoreEnd -->
