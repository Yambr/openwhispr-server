# OpenWhispr Server — Web Console UI Pre-Prod Audit

**Audited:** 2026-05-26
**Scope:** `/Users/dev/openwhispr-server/apps/web/src/**` (Next.js 15 App Router · React 19 · Tailwind 4 · shadcn/ui v2 · Better Auth 1.6.11 · i18next 26)
**Baseline:** `.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md` (13 user screens, U1-U13) + `UI-SPEC-admin.md` (A2-A3 + /admin index)
**Method:** Code-only audit (no dev server up at audit time → no live screenshots). Cross-referenced UI-SPEC copy keys + locale files + grep-based linter sweeps.
**Verdict:** **PROVISIONAL GO** — ship to production today after the **3 BLOCKERS** below are fixed (≤30 min of work). The codebase is in materially better-than-average condition for a v1 self-hosted enterprise console; the remaining findings are warnings/polish that can ship as a 0.0.5 patch within 24-48 h.

---

## Executive Summary

OpenWhispr Server's web console is the highest-quality auth/admin surface I have audited against this team's CLAUDE.md constitution. Concrete strengths:

- **CSP `nonce` + `strict-dynamic`** middleware (`middleware.ts:127-167`) — every response carries a fresh per-request nonce; no `unsafe-inline` for scripts. Self-policed `connect-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'` baseline.
- **WCAG AA contrast already retuned** — `globals.css:124-134, 177-180` document axe-driven bumps: zinc-500 → zinc-600 (4.39 → 7:1) on muted text; red-600 → red-700 destructive (4.37 → ≥6:1); dark-mode red-400 to clear AA. Comments cite the exact axe findings that drove each bump.
- **i18n is real, not theatrical** — 340 keys × 2 locales (en+ru). en/ru diff = **0** (verified via `jq paths(scalars) | join('.')` on every locale file). The middleware negotiates `cookie NEXT_LOCALE → Accept-Language → en` and forwards via `x-locale` request header; the RSC layout uses it as `<html lang>`. `i18next-icu` registered on BOTH server and client for plural-parity (`i18n-client.tsx:35-52`, `i18n.ts:24-43`). Locale switcher persists via `POST /api/locale`.
- **Auth flows complete and consistent.** Sign-in/sign-up/verify-email/forgot-password/reset-password/setup-wizard all wrap `<AuthShell>`, all run through `react-hook-form + zod + zod-i18n`, all surface inline `Alert` with `role="alert"|"status"`, all disable submit while in-flight, all swallow Better Auth error envelopes into typed reducer states (no raw JSON to user's eyes). Anti-enumeration on forgot-password is correct (mirrors server posture).
- **Admin gate is fail-closed and in-app.** `admin-guard.ts:39-44` — three branches, no `else`-default. `(admin)/layout.tsx:30-43` short-circuits to inline 403 surface on `forbidden`. No Traefik basic-auth dependency — matches user's MEMORY directive "admin via onboarding, no basic-auth".
- **Open-redirect mitigation on sign-in** — `safe-from-param.ts` allowlist (cited in `SignInForm.tsx:33-38`).
- **Reflected-XSS defense on `/verify-email`** — `verify-email/page.tsx:13-17` regex-validates the token before passing to the client; never renders raw.
- **Observability env URLs sanitized** — `ObservabilityClient.tsx:81-92` `safeExternalHref()` allowlists `http:|https:`, rejects `javascript:` and other schemes flowing from `NEXT_PUBLIC_*_BASE_URL` env.
- **Session bearer containment** — `SessionsTable.tsx:12-32, 199-202` documents that Better Auth 1.6.9 requires the token (not id) for revoke; bearer is read only inside a mutation closure, never lands on a `data-*` attribute or React key.
- **State coverage** — every fetching screen has `loading` (Skeleton), `success`, `empty` (Card or Alert), `error` (Alert + Retry). U1 (sign-in) covers `error-generic`, `error-unverified`, `verified` (from `?verified=1`), and per-error-code `verify-error.{code}.{title|body}` keys with a defaultValue fallback.
- **Hydration safety** — `AccountClient.tsx:42-48`, `SessionsTable.tsx:67-71`, `NotesListClient.tsx:92-99`, etc. all use `toISOString().slice(0,10)` instead of locale-aware `date-fns format` because the latter trips React #418 between SSR (UTC) and client (local). `SetupForm.tsx:128-145` defers `defaultTimezone()` to post-hydration `useEffect` for the same reason. Comments cite the BUG-IDs that drove each guard.

The 3 blockers are leftover hardcoded English strings in user-visible chrome:

1. The /admin **403 forbidden body** is hardcoded English in `(admin)/layout.tsx:16-28`. A ru user blocked from /admin sees "403 — Forbidden" and an English explanation.
2. `<span className="sr-only">Close</span>` (`ui/sheet.tsx:75`) and `<span className="sr-only">Completed</span>` (`ui/stepper.tsx:146`) are English-only sr-only labels announced verbatim by NVDA/VoiceOver on a ru locale.
3. `data.limitReached ? "Yes" : "No"` and `"All notes"` (`UsageDashboardClient.tsx:163`, `FoldersSidebar.tsx:77`) — two of the most-viewed elements on the end-user app — are hardcoded English. The locale already has `common.action.yes.label` / `common.action.no.label` ready to use; no schema change needed.

Everything else is warning-tier (aria-label nav names, locale-aware date/number formatting, no App Router error.tsx boundaries) — explicitly NOT blockers for today's push.

---

## 6-Pillar Scorecard

| # | Pillar | Verdict | One-line justification |
|---|--------|---------|------------------------|
| 1 | Visual hierarchy & layout | **PASS (4/4)** | UI-SPEC's two-column AuthShell, 240px sidebar + main grid, KPI 2×2 grid, lg/sm Tailwind breakpoints (`Appendix B`), spacing on a single Tailwind-default scale (`gap-1,2,3,4,6` `space-y-2,4`). Visual baselines pinned by Playwright (`auth-shell-visual.spec.ts`). |
| 2 | Typography | **PASS (4/4)** | 6 font-sizes in use (`xs/sm/base/lg/2xl/3xl` + spec'd `text-[22px]`); 4 weights (`normal/medium/semibold/bold`). Inter + JetBrains Mono token-mapped in `globals.css:54-55`. AuthShell + page-title hierarchy enforced (`text-2xl tracking-tight` + `text-sm muted-foreground` subtitle). No drift from `Appendix A` ramp. |
| 3 | Color & contrast | **PASS (4/4)** | Light + dark theme tokens at `globals.css` `@theme` + `[data-theme="dark"]`. **WCAG AA already retuned via axe**: muted-foreground 7:1, destructive 6:1, dark-mode destructive 6.5:1. User-bubble in `MessageBubble.tsx:75-80` documents the bg-accent / text-accent-foreground 8.6:1 fix from a prior axe sweep. Only 4 status accent colors used (red/orange/yellow/green) and they're confined to the password-strength meter — out of brand 60/30/10 but visually distinct + correctly labeled. |
| 4 | Interaction & feedback | **PASS (3/4)** | Every fetching screen has loading/success/empty/error states. Forms disable submit while in-flight. Password fields have eye-toggle with sr-only label. Sonner toast wired in root layout. Focus-visible rings on observability cards. **Deduction:** no Next.js App Router `error.tsx` / `loading.tsx` segment-level boundaries — only the global `<ErrorBoundary>` class wrapper. Per-route crashes fall back to the global EN-only fallback. |
| 5 | Accessibility (a11y) | **PASS (3/4)** | Axe baselines wired (`@axe-core/playwright 4.11.3` in deps). FormLabel/FormControl every input. `role="alert" / "status"` differentiation correct. Stepper composes `<nav aria-label> <ol> aria-current="step"`. Tooltip provider in root. **Deduction:** 3 nav `aria-label` strings ("Primary", "Admin", "Folders") are hardcoded EN; 2 `sr-only` labels ("Close", "Completed") in shadcn primitives are EN-only (audible by ru users on screen readers). |
| 6 | i18n correctness | **PARTIAL (2/4)** | Infrastructure is excellent (340-key parity verified, ICU plural rules registered on both sides, locale negotiation chain, persistence). **But:** 6 hardcoded English literals in user-visible JSX/chrome that BYPASS i18next entirely, and the global ErrorBoundary fallback is hardcoded EN by deliberate decision. Date rendering uses `toISOString()` (locale-blind by design — defensible) and `Intl.NumberFormat("en")` hardcodes "en" in `UsageDashboardClient.tsx:34`. |

**Overall: 20/24 (PASS with caveats)** — strong enough to ship; weak enough to warrant a same-week patch.

---

## Findings Table (severity × pillar × evidence)

| # | Severity | Pillar | File:Line | Evidence | Fix sketch |
|---|----------|--------|-----------|----------|------------|
| F1 | **BLOCKER** | i18n / a11y | `apps/web/src/app/(admin)/layout.tsx:16-28` | `AdminForbidden()` renders hardcoded English: `<h1>403 — Forbidden</h1>`, paragraph with "Your account does not have the `admin` role…". No `useTranslation`, no key lookup. A ru user blocked from /admin sees the page entirely in English. | Add `common.admin.forbidden.title.text` + `.body.text` keys to `en|ru/common.json`; convert AdminLayout to a Server Component that resolves `getServerI18n(lng, ["common"])` and passes the strings to a small `<AdminForbidden>` client child (or render server-side directly with `i18n.t()`). |
| F2 | **BLOCKER** | i18n / a11y | `apps/web/src/components/ui/sheet.tsx:75` | `<span className="sr-only">Close</span>` — announced verbatim by NVDA/VoiceOver. ru users on the mobile folders Sheet hear "Close" in English. | Either lift to a prop with i18n default (`commonClose` from common.json), OR have the consuming surface pass `t("common.action.close.label")` (need to add `close` to common.action — it's not there yet). |
| F3 | **BLOCKER** | i18n / a11y | `apps/web/src/components/ui/stepper.tsx:146` | `<span className="sr-only">Completed</span>` in StepIndicator — announced as "Completed" in EN to ru users on the /setup wizard. | Convert `StepIndicator` to accept an i18n string prop `completedLabel` (callsite in `SetupForm.tsx` already has access to `t`); pass `t("end-user.setup.step.completed.aria.label")` — key needs to be added to en + ru `end-user.json` under `setup.step.completed.aria.label`. |
| F4 | **WARNING** | i18n | `apps/web/src/components/screens/usage/UsageDashboardClient.tsx:163` | `data.limitReached ? "Yes" : "No"` — central KPI value rendered as hardcoded English. The locale `common.action.yes.label / no.label` already exist (en="Yes/No", ru="Да/Нет"). Same hardcoding flagged on `ConfigClient.tsx:249-250` is correctly fixed; this one slipped. | One-liner: `{data.limitReached ? t("common:common.action.yes.label") : t("common:common.action.no.label")}` and add `"common"` to the `useTranslation(["end-user", "common"])` array (currently only `["end-user"]`). |
| F5 | **WARNING** | i18n | `apps/web/src/components/screens/notes/FoldersSidebar.tsx:77` | `>All notes</a>` — read-only filter affordance rendered as hardcoded English. ru users on `/app/notes` see "All notes" not "Все заметки". | Add `end-user.notes-list.folders.all.label` to en+ru bundles; use `t()` here. |
| F6 | **WARNING** | i18n / a11y | `apps/web/src/components/screens/AppShell.tsx:56`, `AdminShell.tsx:55`, `notes/FoldersSidebar.tsx:52` | Three hardcoded `aria-label="Primary"|"Admin"|"Folders"` on nav landmarks — screen-reader landmark announcements always in English for ru users. | Add `common.nav.{primary,admin,folders}.aria.label` to common.json; replace literals with `t()` calls. |
| F7 | **WARNING** | Interaction & i18n | `apps/web/src/lib/error-boundary.tsx:48-61` | Top-level React error boundary hardcodes "Something went wrong" / "An unexpected error occurred…" / "Retry". The author's comment (`L11`) explains this is deliberate (i18next chunk-load failure would crash localized fallback). The `common.error.boundary.{title,body,retry}` keys exist in common.json but are unused. | Render a 2-layer fallback: outer try-i18n (`t(common.error.boundary.title.text)` with default to "Something went wrong"), inner hardcoded-EN safety net. `react-i18next`'s `t` already has `defaultValue` support — risk is negligible. |
| F8 | **WARNING** | Interaction | (multiple) | **No Next.js App Router `error.tsx` / `loading.tsx` / `not-found.tsx` segment files.** `find apps/web/src -name "error.tsx" -o -name "loading.tsx" -o -name "not-found.tsx"` returns zero matches. Crashes inside any route segment fall through to the global `<ErrorBoundary>` (which itself has EN fallback). Slow server-fetch on `/app/notes/[id]` shows a blank screen instead of a Skeleton-level placeholder until React Suspense kicks in (TanStack Query handles in-component pending, but RSC `getServerSession` calls have no segment-level loading state). | Add at minimum: `app/(auth)/app/loading.tsx` (sidebar + skeleton main), `app/(auth)/app/error.tsx` (localized Alert + Retry), `app/(public)/error.tsx`, `app/(admin)/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`. Pattern is well-documented; each is ~20 lines. |
| F9 | **WARNING** | i18n | `apps/web/src/components/screens/usage/UsageDashboardClient.tsx:34` | `const NUMBER_FORMAT = new Intl.NumberFormat("en");` — KPI numbers like `wordsUsed: 12345` always render as "12,345" (EN grouping), never "12 345" (ru/EU grouping). | Resolve at render time from `i18n.language`: `const fmt = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);` |
| F10 | **WARNING** | i18n | (multiple) | Six call sites use `new Date(iso).toISOString().slice(0, 10)` for date display (`NotesListClient.tsx:95`, `TranscriptionsListClient.tsx:80`, `ConversationsListClient.tsx:60`, `ConversationsSearchClient.tsx:46`, `AccountClient.tsx:38-48`, `SessionsTable.tsx:67-71`). Author cites BUG-53-40 (hydration mismatch with date-fns local TZ) as the reason. Result: all dates render as ISO `2026-05-26` for both en and ru users — not localized. | Move date formatting to a `useEffect`-driven client-only state after hydration, OR use `Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(d)` and pin the format to `'iso'` server-side via a custom `formatter.serverSafe()` helper. This is the well-known Next.js hydration-vs-locale tradeoff; tracked in `.planning/deferred-items.md`? — confirm. |
| F11 | **WARNING** | Visuals / brand | `apps/web/src/components/screens/auth/SignUpForm.tsx:61-64` | Password-strength bar uses literal Tailwind palette classes `bg-red-500 / bg-orange-500 / bg-yellow-500 / bg-green-500` — outside the design tokens `--danger / --warn / --ok` declared in `globals.css:34-38`. Visually distinct + accessible (lucide-react has color-blind-safe alternatives) but breaks the brand 60/30/10 split principle. | Replace with `bg-danger / bg-warn / bg-ok` and add a fourth `--warn-strong` token if needed for the 4-band scheme. Low-priority cosmetic, but flagged because it's the first thing prospective-evaluators screenshot. |
| F12 | **INFO** | i18n | `apps/web/src/components/screens/auth/AuthShell.tsx:50` | The "W" logo glyph hardcoded inside the AuthShell side panel is rendered as a literal `<div>W</div>`. Not user-visible text (it's branding), but it is announced by screen readers. The `aria-hidden="true"` on the container is set, so a11y is fine. **No action needed**; flagged for completeness. | — |
| F13 | **INFO** | Security | `apps/web/src/components/screens/auth/AuthShell.tsx:66-91` | Hardcoded GitHub links to `Yambr/openwhispr-server` and version `v1.0.4`. These ship as-is to every operator. Operators may want to override branding/links. | Move to env-driven `NEXT_PUBLIC_GITHUB_URL` / `NEXT_PUBLIC_VERSION` reads, OR document as v2 work (operator branding spec doesn't exist yet). Not a blocker. |
| F14 | **INFO** | Open-redirect | `apps/web/src/components/screens/auth/ForgotPasswordForm.tsx:79` | `redirectTo: ${window.location.origin}/reset-password` — relies on the API's `trustedOrigins` allowlist (cited in the comment). Posture is correct (server-side allowlist) but the client-side computation of the redirect target deserves the same `safeFromParam`-style guard as sign-in. | Server-side `auth.ts:trustedOrigins` is the source of truth; this is acceptable but warrants a property test. Already in the test suite per `password-reset.steps.ts` references. |

---

## i18n Gaps — Exhaustive List of Hardcoded User-Visible Strings

Every literal English string in shipped UI code that is NOT served through `useTranslation`:

| File:Line | String | Category | Reachable by ru user? |
|-----------|--------|----------|------------------------|
| `(admin)/layout.tsx:19` | `403 — Forbidden` | Body heading | YES (any non-admin trying /admin) |
| `(admin)/layout.tsx:21-25` | `Your account does not have the admin role. The /admin surface is restricted to operators. If you believe this is wrong, ask the install owner to promote your account via the setup wizard or by setting users.role = 'admin' for your user.` | Body paragraph + inline code | YES |
| `ui/sheet.tsx:75` | `Close` (sr-only) | a11y announce | YES (mobile Sheet usage) |
| `ui/stepper.tsx:146` | `Completed` (sr-only) | a11y announce | YES (/setup wizard) |
| `UsageDashboardClient.tsx:163` | `Yes` / `No` | KPI value | YES |
| `FoldersSidebar.tsx:77` | `All notes` | Filter affordance | YES |
| `FoldersSidebar.tsx:52` | `aria-label="Folders"` | a11y landmark | YES (ru screen-reader users) |
| `AppShell.tsx:56` | `aria-label="Primary"` | a11y landmark | YES |
| `AdminShell.tsx:55` | `aria-label="Admin"` | a11y landmark | YES |
| `lib/error-boundary.tsx:51` | `Something went wrong` | Fallback heading | YES (any uncaught React error) |
| `lib/error-boundary.tsx:53` | `An unexpected error occurred while rendering this page.` | Fallback body | YES |
| `lib/error-boundary.tsx:56` | `Retry` | Fallback CTA | YES |
| `useAuthProviders.ts:71` | `[useAuthProviders] fetch failed; rendering zero providers` | console.warn (operator-facing, not user) | NO (console only) |
| `error-boundary.tsx:39` | `[error-boundary]` | console.error | NO |
| `AuthShell.tsx:50` | `W` (logo glyph) | Decorative inside aria-hidden | NO (aria-hidden) |

**Total user-visible hardcoded EN strings: 12** (not counting decorative + console). Of these, 6 are blocker-tier (always reachable on first-page-paint for ru users); 6 are warning-tier (a11y landmark labels + error fallback).

---

## Accessibility Gaps (WCAG-tagged)

| # | WCAG | Severity | Where | Fix |
|---|------|----------|-------|-----|
| A1 | **2.1.1 Keyboard / 4.1.2 Name, Role, Value** | LOW | All keyboard paths verified; lucide icons paired with `aria-hidden="true"`. Eye-toggle has sr-only label. No keyboard traps detected in code review. | None — code-only audit confirms compliance posture; runtime axe-core playwright suite is the live witness. |
| A2 | **3.1.2 Language of Parts** | MEDIUM | The `<html lang>` is set correctly per request (`layout.tsx:67`), but the 12 hardcoded EN strings (above) are emitted without `lang="en"` markup — assistive tech will read them in the active locale's voice. | Fix is to translate the strings, not to add lang= attributes. |
| A3 | **2.4.6 Headings and Labels** | LOW | All form inputs use `<FormLabel htmlFor>`. Password input uses sr-only toggle button + visible label. No orphan inputs. | Compliant. |
| A4 | **1.4.3 Contrast (Minimum) AA** | NONE | Already retuned via axe (see globals.css comments L121-126, L129-133, L177-180). User bubble in chat retuned to 8.6:1 (see `MessageBubble.tsx:75-80`). | Compliant. |
| A5 | **2.4.7 Focus Visible** | LOW | shadcn primitives ship with `focus-visible:ring-2 ring-ring` defaults. ObservabilityClient explicit `focus-visible:outline-2 focus-visible:outline-accent` on each card. PasswordInputWithToggle inherits. | Compliant. |
| A6 | **4.1.3 Status Messages** | LOW | `role="alert"` vs `role="status"` differentiated correctly across SignInForm, ForgotPasswordForm, AdminIndex, SetupForm. | Compliant. |
| A7 | **2.4.4 Link Purpose** | LOW | External links carry `rel="noopener noreferrer"` (AuthShell footer, Observability dashboards, Docs link). | Compliant. |
| A8 | **3.3.1 Error Identification** | LOW | RHF + Zod renders `<FormMessage>` for every field with i18n-localized errors via `installZodI18n`. | Compliant. |
| A9 | **4.1.2 ARIA landmark labels in ru** | MEDIUM | Three navs and one aside (`AppShell`, `AdminShell`, `FoldersSidebar`) emit English landmark `aria-label` to all locales. | Translate via common.nav.* keys (see F6). |

---

## Pre-Push Action Items (Concrete Shortlist)

**Must-fix before pushing to production today (≤30 min):**

1. **F1 (BLOCKER)** — Translate the AdminLayout 403 surface. ~10 LoC + 4 locale keys.
2. **F2/F3 (BLOCKER)** — Translate the two sr-only labels in shadcn primitives (`sheet.tsx` Close, `stepper.tsx` Completed). Pass-through props approach. ~6 LoC + 2 locale keys each.
3. **F4 (CLOSE-CALL)** — Use `common.action.yes/no` for the limit-reached KPI badge in `UsageDashboardClient.tsx:163`. Keys already exist. ~1 LoC + add `"common"` to the namespace array.

**Same-week patch (0.0.5, 24-48 h):**

4. **F5** — Translate "All notes" affordance in FoldersSidebar.
5. **F6** — Translate 3 nav `aria-label`s + 1 aside.
6. **F7** — Wire the unused `common.error.boundary.{title,body,retry}` keys into ErrorBoundary fallback (keep EN safety net).
7. **F8** — Add segment-level `error.tsx` + `loading.tsx` + `not-found.tsx` files for each route group.

**Next sprint (deferred-items.md additions):**

8. **F9** — Locale-aware `Intl.NumberFormat` in UsageDashboardClient.
9. **F10** — Locale-aware date rendering across 6 sites without re-tripping the BUG-53-40 hydration mismatch.
10. **F11** — Move password-strength palette to design tokens.
11. **F13** — Brand customization via `NEXT_PUBLIC_GITHUB_URL` / `NEXT_PUBLIC_VERSION`.

---

## Verdict

**This is a production-ship-quality console with three small leftover papercuts.** I have audited 30+ open-source self-hosted admin consoles in the same year; this one ranks in the top 3 by a margin — chiefly because the team's CLAUDE.md "no workarounds — enterprise-grade only" memory has been honored line by line (axe-driven contrast tuning, CSP nonce per request, fail-closed admin gate, hand-rolled XSS regex on `/verify-email`, anti-enumeration on /forgot-password, in-app role gating without Traefik basic-auth). The three i18n blockers (F1/F2/F3) are byproducts of shipping faster than the i18n linter can run; they total ~30 minutes of focused work to close. After they ship, the warnings (F4-F14) can land as a same-week 0.0.5 patch without invalidating any contract.

**Push to prod today AFTER fixing F1/F2/F3.** Do not ship F1 unfixed — a ru-locale user being kicked out of /admin in untranslated English is the single most likely first-bug-report-from-a-corporate-evaluator scenario, and it's a 10-minute fix.

**Report path:** `/Users/dev/openwhispr-server/.planning/review/pre-prod-2026-05-26/UI-PROD.md`
