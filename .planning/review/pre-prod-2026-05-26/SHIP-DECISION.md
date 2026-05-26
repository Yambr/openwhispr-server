# Ship Decision — Pre-Production Review, 2026-05-26

**Branch:** `main` @ `0513729c`
**Reviewer cohort:** 4 parallel agents (security, code-review, LOCKER+secrets, UI)
**Verdict:** **GO-WITH-CAVEATS** — owner may push to production today after the 3 i18n BLOCKERs land (≤30 min of work)

---

## TL;DR

| Track | Verdict | Blockers | Source |
|---|---|---|---|
| Security | GO-WITH-CAVEATS | 0 | [SECURITY-PROD.md](./SECURITY-PROD.md) |
| Code review | GO | 0 | [REVIEW-PROD.md](./REVIEW-PROD.md) |
| LOCKER + secrets | GO | 0 | [LOCKER-PROD.md](./LOCKER-PROD.md) |
| UI | PROVISIONAL GO | 3 (i18n) | [UI-PROD.md](./UI-PROD.md) |

The only true push-blockers are 3 UI strings that bypass i18next entirely — ru-locale users hit them. Everything else is documented deferred debt (Phase 38/41), operator env checklist, or non-blocking follow-ups.

---

## Push-blocking items (must land before `git push`)

These 3 items are the consolidated must-fix list. All UI, all in `apps/web/`, ~30 min total.

| # | File:Line | Issue | Why blocking |
|---|---|---|---|
| **B1** | `apps/web/src/app/(admin)/layout.tsx:16-28` | `AdminForbidden()` page rendered with hardcoded English `"403 — Forbidden"` + explanation | Admin gate fires for every non-admin user; ru users see English; admin journey is THE onboarding journey (first /setup completer = admin) |
| **B2** | `apps/web/src/components/ui/sheet.tsx:75` | `<span className="sr-only">Close</span>` hardcoded | ru-locale screen-reader users hear English verbatim on every sheet close |
| **B3** | `apps/web/src/components/ui/stepper.tsx:146` | `<span className="sr-only">Completed</span>` hardcoded | Fires on /setup wizard — the universal first-launch flow |

**Fix pattern (consistent across all 3):** import `useTranslations()` from `next-intl`, add keys to `apps/web/locales/en.json` + `apps/web/locales/ru.json` (i18n infra is best-in-class — 340 keys with zero parity drift; just add 3 more), reference via `t('...')`. UI report has full sketches.

---

## Operator pre-push env checklist (LOCKER + Security cross-cited)

Owner must confirm these BEFORE the push command, not after:

- [ ] `MASTER_KEK` set, 32 bytes (LOCKER-08 boot-gate exits 78 if missing/short)
- [ ] `OPENWHISPR_KEY_PROVIDER=env` (only supported v1)
- [ ] `LITELLM_BASE_URL` set to prod LiteLLM endpoint
- [ ] `LITELLM_VIRTUAL_KEY` ≠ dev-overlay sentinel (anti-footgun FATAL guard at `apps/api/src/config/litellm.ts:29,63`)
- [ ] `OPENAI_API_KEY` set (default `REALTIME_BACKEND=direct` requires it — Security finding)
- [ ] `OPENWHISPR_ENABLE_TEST_ROUTES` **unset** in prod image (test fetch route ships `rateLimit:false`)
- [ ] `AUTH_URL` + `INGRESS_BASE_URL` = prod URLs
- [ ] Optional: `DATABASE_URL=<prod> pnpm tsx tools/lint-rls.ts` to close the RLS-lint SKIP gap noted by LOCKER track

---

## Same-week 0.0.5 patch (non-blocking, but owner should track)

Sorted by domain. Numbering references each track's report for traceability.

### UI (UI-PROD.md F4–F11)
- **F4** UsageDashboardClient KPI hardcoded `"Yes"/"No"`
- **F5** FoldersSidebar hardcoded `"All notes"`
- **F6** 3 hardcoded `aria-label` landmarks
- **F7** Wire pre-defined `common.error.boundary.*` keys into `ErrorBoundary`
- **F8** Add App Router segment-level `error.tsx` / `loading.tsx` / `not-found.tsx` boundaries
- **F9** Locale-aware `Intl.NumberFormat`
- **F10** Locale-aware date rendering across 6 sites
- **F11** Move password-strength palette to design tokens

### Code review (REVIEW-PROD.md WR-01..WR-04)
- **WR-01** Add `readyState === OPEN` guard to `forwardClientFrame` send (mirror existing symmetric guard at realtime.ts:422)
- **WR-02** Add `REALTIME_DEFAULT_LANGUAGE` to every `.env.*.example` (docs already updated)
- **WR-03** Strengthen M9 "concurrent upgrades" test — currently uses two Fastify apps with two deps copies, vacuous as race-condition probe
- **WR-04** Audit `getDefaultAgentModel()` — still returns `qwen3.6-plus` after leak-1 fix flipped `DEFAULT_STT_MODEL`; alias array order issue

### LOCKER (LOCKER-PROD.md)
- Phase 38 backlog: 344 dead-exports from `@openwhispr/auth` retirement (LOCKER-04 WARN, will flip to BLOCKING at Phase 41 closure per DISCIPLINE rule 14)
- Phase 41 backlog: 20 routes missing Zod schemas + WS upgrade at `realtime.ts:531` missing `config.rateLimit` (mitigate via upstream Traefik throttle today)
- Dep drift awareness (none blocking): next 15→16, pino 9→10, undici 7→8, typescript 5.9→6, testcontainers 11→12, tough-cookie 5→6, @fastify/multipart 9→10
- Implement `tools/lint-compose-healthcheck-target.ts` source (only `.test.ts` exists)
- Fix self-test FP in `tools/lint-weak-assertions.ts` (flags strings inside its own test file)

---

## Accepted v1 debt — NOT findings, do not fix

These were intentionally accepted in earlier milestones; cited here so they're not re-raised by the next reviewer cohort.

- **D2 RLS posture** for 4 Better Auth identity tables (`users`, `sessions`, `account`, `verification`). Single-tenant v1, no live cross-tenant exposure. D3 (request-scoped per-request adapter) is named v2-blocker in `.planning/deferred-items.md`. Boundary test exists at `packages/data/tests/unit/__tests__/rls-posture-boundary.test.ts`. Documented in `docs/security.md §11.1`.
- **LOCKER-04 WARN→BLOCKING ledger** (DISCIPLINE rule 14): operationally deferred from Plan 31-08 to Phase 41 closure. LOCKER-05 flips at Phase 37; LOCKER-06 at Phase 36.a. None of these are pre-push concerns today.
- **Port-4000 LiteLLM internal compose URL** at `apps/api/src/index.ts:1040` — permanently allowlisted as docker-compose internal address; ENV-overridable via `LITELLM_BASE_URL` in prod (covered by operator checklist).

---

## Verified-strong (don't lose these on the next refactor)

Each track surfaced things that are genuinely well-built — worth recording so future reviewers don't accidentally regress them:

- **Envelope encryption at rest** — lens at `packages/data/src/encryption/lens.ts:219` calls `delete target[column]` before INSERT; `validateEncryptionBoot()` gates both api + worker at boot with exit-78 on missing `MASTER_KEK`
- **SSRF dispatcher** — process-globally installed at `apps/api/src/index.ts:167`; no public escape hatch (Phase 08.2 fix held)
- **Error subclasses** — LitellmUpstreamError + 2 Pyannote variants truncate `bodyText` via `Object.defineProperty` non-enumerable + custom `toJSON` (LOCKER-05)
- **Admin gate** — `users.role` only; no Traefik basic-auth; no `ADMIN_EDGE_AUTH_ENFORCED` (matches user MEMORY)
- **Gitleaks defence-in-depth** — Lefthook L1+L2 + CI L3 sharing `.gitleaks.toml`; zero leaks across 2102 commits
- **Supply chain** — zero moderate+ CVEs (`pnpm audit`)
- **i18n infrastructure** — 340 keys × 2 locales, zero parity drift, ICU plurals on both sides, Edge-middleware locale negotiation → `x-locale` header → RSC
- **Web hardening** — CSP nonce per request + `strict-dynamic` (no `unsafe-inline` scripts), axe-driven WCAG AA contrast retuning, reflected-XSS regex on `/verify-email`, open-redirect allowlist on `safeFromParam`, anti-enumeration on forgot-password
- **Realtime delta safety** — 2-language whitelist (en/ru) with double validation (env reader EX_CONFIG-fatal on typo; query reader drop+warn-log+env-fallback on typo); strips `?language=` from upstream URL; shallow clone `{ ...deps.transcription, ...{language} }` prevents singleton mutation under concurrent WS upgrades
- **Realtime incident response** — commit 2803c1a8 closes the 2026-05-26 prod incident (passthrough of `session.created`/`session.updated` to client unchanged — peer wd6g78xz reproduced live)

---

## Recommended push sequence

1. Fix B1 / B2 / B3 (3 hardcoded UI strings) — single commit, RED→GREEN per discipline rule
2. Re-run UI track locally: `pnpm --filter @openwhispr/web test` + visual check on /admin (403 state) + /setup wizard
3. Run operator pre-push env checklist
4. Optional: run RLS lint against prod Postgres (`DATABASE_URL=<prod> pnpm tsx tools/lint-rls.ts`)
5. `git push`

The 4 review reports and per-lint logs are all in `.planning/review/pre-prod-2026-05-26/`.
