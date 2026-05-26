---
quick_id: 260526-lgn
slug: i18n-pre-prod-blockers
title: "Pre-prod i18n BLOCKERS B1/B2/B3 — translate 3 hardcoded EN strings (AdminForbidden, sheet Close, stepper Completed)"
date: 2026-05-26
status: planned
mode: quick
type: execute
autonomous: true
files_modified:
  - apps/web/src/app/(admin)/layout.tsx
  - apps/web/src/components/ui/sheet.tsx
  - apps/web/src/components/ui/stepper.tsx
  - apps/web/src/components/screens/auth/SetupForm.tsx
  - apps/web/src/components/screens/AppShell.tsx
  - apps/web/src/locales/en/common.json
  - apps/web/src/locales/ru/common.json
  - apps/web/src/locales/en/admin.json
  - apps/web/src/locales/ru/admin.json
  - apps/web/src/locales/en/end-user.json
  - apps/web/src/locales/ru/end-user.json
  - apps/web/src/components/__tests__/conformance/admin-forbidden.test.tsx (NEW)
  - apps/web/src/components/__tests__/conformance/sheet-close-i18n.test.tsx (NEW)
  - apps/web/src/components/__tests__/conformance/stepper-completed-i18n.test.tsx (NEW)
commits: 3
must_haves:
  truths:
    - "ru user blocked from /admin sees the 403 page (heading + body) rendered in Russian, not English"
    - "ru user with a screen reader hears the localized 'Close' label (Russian) when the AppShell mobile Sheet close button is announced"
    - "ru user on /setup wizard hears the localized 'Completed' announcement (Russian) when a completed step indicator is read by NVDA/VoiceOver"
    - "en parity preserved — every new key has a non-empty value in both en and ru locale bundles"
    - "no source file under apps/web/src/ contains the literal strings `403 — Forbidden`, `>Close<` (sr-only), or `>Completed<` (sr-only) after the changes"
  artifacts:
    - path: "apps/web/src/locales/en/admin.json"
      provides: "admin.forbidden.{title.text, body.text} keys (B1)"
    - path: "apps/web/src/locales/ru/admin.json"
      provides: "admin.forbidden.{title.text, body.text} keys (B1) — Russian translations"
    - path: "apps/web/src/locales/en/common.json"
      provides: "common.action.close.label key (B2)"
    - path: "apps/web/src/locales/ru/common.json"
      provides: "common.action.close.label key (B2) — Russian translation 'Закрыть'"
    - path: "apps/web/src/locales/en/end-user.json"
      provides: "end-user.setup.step.completed.aria.label key (B3)"
    - path: "apps/web/src/locales/ru/end-user.json"
      provides: "end-user.setup.step.completed.aria.label key (B3) — Russian translation 'Завершено'"
    - path: "apps/web/src/app/(admin)/layout.tsx"
      provides: "Server-component-resolved t() for the 403 surface via getServerI18n(lng, ['admin']) reading lng from headers().get('x-locale')"
    - path: "apps/web/src/components/ui/sheet.tsx"
      provides: "SheetContent receives optional closeLabel prop; sr-only span renders prop value (no hardcoded default fallback)"
    - path: "apps/web/src/components/ui/stepper.tsx"
      provides: "StepIndicator receives required completedLabel prop; sr-only span renders prop value when status='complete'"
  key_links:
    - from: "apps/web/src/app/(admin)/layout.tsx"
      to: "apps/web/src/locales/{en,ru}/admin.json"
      via: "getServerI18n + t('admin:admin.forbidden.title.text') / t('admin:admin.forbidden.body.text')"
    - from: "apps/web/src/components/screens/AppShell.tsx"
      to: "apps/web/src/components/ui/sheet.tsx"
      via: "<SheetContent closeLabel={t('common:common.action.close.label')}>"
    - from: "apps/web/src/components/screens/auth/SetupForm.tsx"
      to: "apps/web/src/components/ui/stepper.tsx"
      via: "<StepIndicator completedLabel={t('end-user:end-user.setup.step.completed.aria.label')} />"
---

# Pre-Prod i18n BLOCKERS B1/B2/B3 — Three Atomic Commits

## 1. Goal

Close the three i18n BLOCKERs surfaced by the UI track of the pre-prod review cohort at `.planning/review/pre-prod-2026-05-26/UI-PROD.md` (F1/F2/F3) so the owner can `git push` to production today. All three are hardcoded English strings on the `apps/web/` UI surface that bypass `react-i18next` entirely and are reachable on first paint by ru-locale users.

This plan ships **three atomic commits, one per blocker**, in strict RED→GREEN TDD order per the CLAUDE.md constitution (test + production code in the SAME commit). en/ru locale parity preserved (verified by per-commit assertions that both bundles define every new key).

## 2. Scope

### In scope (3 blockers × 3 commits)

- **B1 — AdminForbidden 403 surface i18n.** `apps/web/src/app/(admin)/layout.tsx` `AdminForbidden()` renders hardcoded `"403 — Forbidden"` + English body paragraph. AdminLayout is already a Server Component (`async function`) — switch to `getServerI18n(lng, ['admin'])` reading `lng` from `headers().get('x-locale')` (same pattern as the existing RSC root layout). Add `admin.forbidden.{title.text, body.text}` keys to `apps/web/src/locales/{en,ru}/admin.json`. Body includes the literal `<code>admin</code>` token from the original copy — keep the role-name token in English (it's a literal column value, not a UI string) by composing the i18n message with `<Trans>` or by splitting into two keys (prefix + suffix) around the `<code>` element. Decision: split into `body_prefix.text` + `body_suffix.text` keys to avoid pulling in `<Trans>` for one surface. The original paragraph has two `<code>` tokens (`admin` and `users.role = 'admin'`); both stay literal English. The two text spans become two i18n keys.

- **B2 — Sheet close button sr-only i18n.** `apps/web/src/components/ui/sheet.tsx` line 75 `<span className="sr-only">Close</span>` is the audible label that NVDA/VoiceOver announces every time a ru user closes the mobile-folders Sheet. The shadcn primitive is intentionally presentational (vendored, excluded from `vitest.config.ts` coverage `src/components/ui/**`), so it does not call `useTranslation()` itself. Add a `closeLabel: string` prop to `SheetContent` (REQUIRED — no English-fallback default; force callsites to localize). The sole call site in `apps/web/src/components/screens/AppShell.tsx` (already a `"use client"` component holding `t`) passes `closeLabel={t("common:common.action.close.label")}`. Add `common.action.close.label` to `apps/web/src/locales/{en,ru}/common.json` under the existing `common.action.*` siblings (alongside `cancel`, `confirm`, `copy`, `yes`, `no`).

- **B3 — Stepper completed-step sr-only i18n.** `apps/web/src/components/ui/stepper.tsx` line 146 `<span className="sr-only">Completed</span>` is announced verbatim on every completed step indicator of the /setup wizard (universal first-launch flow). Add `completedLabel: string` REQUIRED prop to `StepIndicator`. The sole call site in `apps/web/src/components/screens/auth/SetupForm.tsx` (already holds `t`) passes `completedLabel={t("end-user:end-user.setup.step.completed.aria.label")}`. Add the key to `apps/web/src/locales/{en,ru}/end-user.json` under a new `setup.step.completed.aria.label` path.

### NOT in scope (do not touch)

- F4–F14 from `UI-PROD.md` (same-week 0.0.5 patch — KPI Yes/No, "All notes", nav aria-labels, error boundary keys, segment-level error.tsx, Intl.NumberFormat, locale-aware dates, password-strength palette). These are warning-tier; explicitly deferred by the SHIP-DECISION.md verdict.
- The realtime ?language= injection delta from `260526-iwn-realtime-language-injection/` (already shipped as commit `a4eed5ba`).
- The LiteLLM canonical alias rename (already shipped as commit `ce608926`).
- The realtime passthrough session.created/session.updated fix (already shipped as commit `2803c1a8`).
- F8 (segment-level error.tsx) — same-week patch, not pre-push.
- F12/F13/F14 (Info-only findings) — no action needed.

## 3. Files Modified

| Path | Commit | Nature of change | LOC est. |
|------|--------|------------------|---------:|
| `apps/web/src/app/(admin)/layout.tsx` | 1 (B1) | Make `AdminForbidden` a server component that receives resolved strings; AdminLayout reads `lng` from `headers()` and calls `getServerI18n(lng, ["admin"])`, passes `t("admin:admin.forbidden.title.text")` + body prefix/suffix into `<AdminForbidden>`. Two `<code>` tokens (`admin`, `users.role = 'admin'`) stay literal. | ~25 |
| `apps/web/src/locales/en/admin.json` | 1 (B1) | Add `admin.forbidden.{title.text, body_prefix.text, body_suffix.text}` keys with the existing English copy split around the two `<code>` tokens. | ~6 |
| `apps/web/src/locales/ru/admin.json` | 1 (B1) | Add the same three keys with Russian translations. Suggested copy: `title.text` = `"403 — Доступ запрещён"`; `body_prefix.text` = `"У вашей учётной записи нет роли "`; `body_suffix.text` = `". Раздел /admin доступен только операторам. Если это ошибка — попросите владельца установки повысить вашу учётную запись через мастер настройки или установив "`; plus a third `body_tail.text` = `" для вашего пользователя."` Decision: split into 3 keys, not 2, because the original paragraph has TWO `<code>` tokens not one. Final key set: `title.text`, `body_prefix.text`, `body_middle.text`, `body_suffix.text`. | ~7 |
| `apps/web/src/components/__tests__/conformance/admin-forbidden.test.tsx` | 1 (B1) | NEW. RED-first test. Asserts (a) AdminForbidden renders `t("admin:admin.forbidden.title.text")` content, (b) source file `app/(admin)/layout.tsx` contains `getServerI18n(` + `headers()` + `t("admin:admin.forbidden.title.text"`, (c) source file does NOT match `/403 — Forbidden/`, (d) both en and ru `admin.json` define `admin.forbidden.title.text`, `body_prefix.text`, `body_middle.text`, `body_suffix.text` with non-empty values, (e) ru values differ from en values (loose i18n smoke check). Use `readFileSync` + `JSON.parse` for parity assertions (mirror `locale-parity-sweep.test.tsx` pattern). Render test uses a stub `getServerI18n` that returns a fixed `t` function — wrap component invocation in `await` since AdminForbidden is async. | ~80 |
| `apps/web/src/components/ui/sheet.tsx` | 2 (B2) | Add `closeLabel: string` REQUIRED prop to `SheetContent`'s prop type; replace `<span className="sr-only">Close</span>` with `<span className="sr-only">{closeLabel}</span>`. No English fallback default — caller MUST pass a localized string. Update only when `showCloseButton !== false`. Conditional render: when `showCloseButton` is true, `closeLabel` MUST be defined (TS-enforced by making it part of a discriminated union OR required-when-shown via a runtime invariant). Decision: make `closeLabel` always required on `SheetContent` (simpler typing); when `showCloseButton={false}`, the prop is still required but unused — acceptable trivial overhead. | ~6 |
| `apps/web/src/components/screens/AppShell.tsx` | 2 (B2) | Update the existing `<SheetContent>` callsite to pass `closeLabel={t("common:common.action.close.label")}`. AppShell already holds `t` from `useTranslation(["end-user", "common"])` per the existing imports (verify the ns array; if it lacks `"common"`, extend it). | ~3 |
| `apps/web/src/locales/en/common.json` | 2 (B2) | Add `"close": { "label": "Close" }` under `common.action.*` (alongside cancel/confirm/copy/yes/no). | ~1 |
| `apps/web/src/locales/ru/common.json` | 2 (B2) | Add `"close": { "label": "Закрыть" }` at the parallel path. | ~1 |
| `apps/web/src/components/__tests__/conformance/sheet-close-i18n.test.tsx` | 2 (B2) | NEW. RED-first test. Asserts (a) `sheet.tsx` source file contains `closeLabel: string` (or the equivalent in a destructured prop type) AND `{closeLabel}` inside the sr-only span, (b) `sheet.tsx` source does NOT match `/sr-only">Close</`, (c) `AppShell.tsx` source contains `closeLabel={t("common:common.action.close.label")` (or the same with single quotes — match both), (d) both en and ru `common.json` define `common.action.close.label` with non-empty values. Source-file readFileSync pattern mirrors `locale-parity-sweep.test.tsx`. No render test for `sheet.tsx` because it's coverage-excluded vendored shadcn; the AppShell callsite render test stays implicit via the existing AppShell test (verify it still passes after the prop addition; if AppShell.test.tsx renders `<AppShell>` without a Sheet open, it should be unaffected). | ~75 |
| `apps/web/src/components/ui/stepper.tsx` | 3 (B3) | Add `completedLabel: string` REQUIRED prop to `StepIndicatorProps`; replace `<span className="sr-only">Completed</span>` with `<span className="sr-only">{completedLabel}</span>`. The prop is required on every render; callers pass it via JSX. | ~5 |
| `apps/web/src/components/screens/auth/SetupForm.tsx` | 3 (B3) | Update the `<StepIndicator>` JSX at line ~236 to pass `completedLabel={t("end-user:end-user.setup.step.completed.aria.label")}`. SetupForm already holds `t` from `useTranslation(["end-user", "common"])`. | ~2 |
| `apps/web/src/locales/en/end-user.json` | 3 (B3) | Add `setup.step.completed.aria.label = "Completed"` (or the equivalent path under the existing `setup.step.*` siblings — read the file first and place the key at the lowest-disruption position). | ~1 |
| `apps/web/src/locales/ru/end-user.json` | 3 (B3) | Add the same key with value `"Завершено"`. | ~1 |
| `apps/web/src/components/__tests__/conformance/stepper-completed-i18n.test.tsx` | 3 (B3) | NEW. RED-first test. Asserts (a) `stepper.tsx` source contains `completedLabel: string` AND `{completedLabel}` inside the sr-only span when `status === "complete"`, (b) `stepper.tsx` source does NOT match `/sr-only">Completed</`, (c) `SetupForm.tsx` source contains `completedLabel={t("end-user:end-user.setup.step.completed.aria.label")` (or single-quote variant), (d) both en and ru `end-user.json` define `setup.step.completed.aria.label` with non-empty values. Parity assertion via readFileSync + JSON.parse. | ~75 |

## 4. Tasks

<tasks>

<task type="auto" tdd="true">
  <name>Task 1 (Commit 1, B1): Translate AdminForbidden 403 surface via getServerI18n</name>
  <files>
    apps/web/src/app/(admin)/layout.tsx,
    apps/web/src/locales/en/admin.json,
    apps/web/src/locales/ru/admin.json,
    apps/web/src/components/__tests__/conformance/admin-forbidden.test.tsx
  </files>
  <behavior>
    RED-first (test fails before edits to layout.tsx + locale JSON):
    - Test 1.1 (source check): `apps/web/src/app/(admin)/layout.tsx` source MUST contain `getServerI18n(` and `headers()` AND a call to `t("admin:admin.forbidden.title.text"` (substring match, allow trailing whitespace).
    - Test 1.2 (literal removed): same file MUST NOT match the regex `/403 — Forbidden/` (em-dash, copy preserved from original literal).
    - Test 1.3 (en parity): `apps/web/src/locales/en/admin.json` MUST parse to an object whose `admin.forbidden.title.text`, `admin.forbidden.body_prefix.text`, `admin.forbidden.body_middle.text`, `admin.forbidden.body_suffix.text` are all non-empty strings.
    - Test 1.4 (ru parity): same four paths exist + non-empty in `apps/web/src/locales/ru/admin.json`.
    - Test 1.5 (translation differs): for each of the four paths, en value !== ru value (loose smoke check — catches accidental copy-paste of English into ru bundle).
    Tests live at `apps/web/src/components/__tests__/conformance/admin-forbidden.test.tsx` (next to existing conformance tests). Use `readFileSync` + `JSON.parse` for parity (mirror `src/components/screens/__tests__/locale-parity-sweep.test.tsx` pattern). No render test because AdminLayout is an `async` Server Component and the test surface is the existing Playwright `/admin` 403 flow (separate spec, not regenerated here).
  </behavior>
  <action>
Step A — Author RED tests in `apps/web/src/components/__tests__/conformance/admin-forbidden.test.tsx`. Mirror the style of `apps/web/src/components/screens/__tests__/locale-parity-sweep.test.tsx`: top-of-file `WEB_ROOT = resolve(__dirname, "../../../..")` (verify the relative depth from the new file path — `conformance/` is one level deeper than `screens/__tests__/`, so the relative-up count differs; compute it as `resolve(__dirname, "../../../..")` from `src/components/__tests__/conformance/`, which resolves to `apps/web/`). Five `describe` cases per the behavior block above. Run `pnpm --filter @openwhispr/web test src/components/__tests__/conformance/admin-forbidden.test.tsx` — confirm RED (all 5 assertions fail because the production code is still hardcoded EN).

Step B — Add the four keys to `apps/web/src/locales/en/admin.json` under a NEW top-level `admin.forbidden` sub-object (read the file first; place the sub-object alphabetically near other `admin.*` siblings):
```
"forbidden": {
  "title": { "text": "403 — Forbidden" },
  "body_prefix": { "text": "Your account does not have the " },
  "body_middle": { "text": " role. The /admin surface is restricted to operators. If you believe this is wrong, ask the install owner to promote your account via the setup wizard or by setting " },
  "body_suffix": { "text": " for your user." }
}
```
The two `<code>` tokens (`admin` and `users.role = 'admin'`) stay literal in JSX, NOT inside the locale value — they are programmatic role-name + SQL fragment, not localizable copy. Copy was extracted from the existing literal at `(admin)/layout.tsx:19-25` and split at the two `<code>` boundaries.

Step C — Add the parallel Russian translations to `apps/web/src/locales/ru/admin.json`:
```
"forbidden": {
  "title": { "text": "403 — Доступ запрещён" },
  "body_prefix": { "text": "У вашей учётной записи нет роли " },
  "body_middle": { "text": ". Раздел /admin доступен только операторам. Если это ошибка — попросите владельца установки повысить вашу учётную запись через мастер настройки или установив " },
  "body_suffix": { "text": " для вашего пользователя." }
}
```

Step D — Rewrite `apps/web/src/app/(admin)/layout.tsx`:
- Add imports: `import { headers } from "next/headers";` and `import { getServerI18n } from "@/lib/i18n";`.
- Change `AdminForbidden` from a sync component to an `async function AdminForbidden(): Promise<React.JSX.Element>`. It awaits `headers()`, reads `lng = h.get("x-locale") ?? "en"`, calls `const i = await getServerI18n(lng, ["admin"]);` and uses `const t = i.t.bind(i);`. Render:
  - `<h1>{t("admin:admin.forbidden.title.text")}</h1>`
  - `<p>` containing: `{t("admin:admin.forbidden.body_prefix.text")}<code>admin</code>{t("admin:admin.forbidden.body_middle.text")}<code>users.role = 'admin'</code>{t("admin:admin.forbidden.body_suffix.text")}</p>`
- In `AdminLayout` (already `async`), update the call site: `if (checkAdminAccess(session) === "forbidden") return await AdminForbidden();`. Because `AdminForbidden` returns a Promise of JSX, the parent must `await` it (RSC pattern).

Step E — Re-run `pnpm --filter @openwhispr/web test src/components/__tests__/conformance/admin-forbidden.test.tsx`. Confirm GREEN (all 5 assertions pass).

Step F — Run `pnpm --filter @openwhispr/web typecheck` to confirm no TS errors from the async refactor. If `next/headers` `headers()` returns a Promise in Next 15.5, await it correctly. Per Next 15 App Router, `headers()` is sync in stable but Promise-returning in canary — match the existing usage in `apps/web/src/app/layout.tsx` (the root layout — read it to confirm the call shape).

Step G — Atomic commit:
```
git add apps/web/src/app/\(admin\)/layout.tsx \
        apps/web/src/locales/en/admin.json \
        apps/web/src/locales/ru/admin.json \
        apps/web/src/components/__tests__/conformance/admin-forbidden.test.tsx
git commit -m "fix(web-i18n): translate AdminForbidden 403 surface via getServerI18n (B1, pre-prod blocker)"
```
DO NOT use `--no-verify`. Gitleaks/Biome/LOCKER pre-commit hooks MUST pass.
  </action>
  <verify>
    <automated>cd apps/web && pnpm test src/components/__tests__/conformance/admin-forbidden.test.tsx && pnpm typecheck</automated>
  </verify>
  <done>
    - admin-forbidden.test.tsx GREEN (5/5 assertions).
    - typecheck passes.
    - `grep -F '403 — Forbidden' apps/web/src/app/\(admin\)/layout.tsx` returns 0 hits.
    - `git log -1 --oneline` shows the new B1 commit on HEAD; `git status --short` clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2 (Commit 2, B2): Translate sheet.tsx sr-only Close via required closeLabel prop</name>
  <files>
    apps/web/src/components/ui/sheet.tsx,
    apps/web/src/components/screens/AppShell.tsx,
    apps/web/src/locales/en/common.json,
    apps/web/src/locales/ru/common.json,
    apps/web/src/components/__tests__/conformance/sheet-close-i18n.test.tsx
  </files>
  <behavior>
    RED-first:
    - Test 2.1 (sheet.tsx prop): `apps/web/src/components/ui/sheet.tsx` source MUST contain `closeLabel: string` (literal substring) AND `{closeLabel}` (literal substring inside the sr-only span).
    - Test 2.2 (literal removed): `sheet.tsx` source MUST NOT match `/sr-only">Close</` (the original literal pattern).
    - Test 2.3 (AppShell callsite): `apps/web/src/components/screens/AppShell.tsx` source MUST contain a regex match for `closeLabel={\s*t\(\s*["']common:common\.action\.close\.label["']` (allow either quote style).
    - Test 2.4 (en parity): `apps/web/src/locales/en/common.json` MUST parse to an object with `common.action.close.label` as a non-empty string.
    - Test 2.5 (ru parity): same path in `apps/web/src/locales/ru/common.json` is non-empty AND differs from the en value.
    Tests at `apps/web/src/components/__tests__/conformance/sheet-close-i18n.test.tsx`. readFileSync pattern.
  </behavior>
  <action>
Step A — Author RED tests in `apps/web/src/components/__tests__/conformance/sheet-close-i18n.test.tsx`. Five assertions per the behavior block. Run `pnpm --filter @openwhispr/web test src/components/__tests__/conformance/sheet-close-i18n.test.tsx` — confirm RED.

Step B — Add `"close": { "label": "Close" }` to `apps/web/src/locales/en/common.json` under `common.action.*` (place it alphabetically OR at the end of the action sub-object — read the existing structure; it lists `cancel`, `confirm`, `copy`, `yes`, `no`, so the natural alphabetical slot is between `cancel` and `confirm`).

Step C — Add `"close": { "label": "Закрыть" }` at the parallel path in `apps/web/src/locales/ru/common.json`. The Russian translation `Закрыть` is the standard accessibility-context translation (matches Tailwind UI Pro ru, Material ru, Radix UI ru community translations).

Step D — Edit `apps/web/src/components/ui/sheet.tsx`:
- Extend the `SheetContent` prop type:
  ```
  React.ComponentProps<typeof SheetPrimitive.Content> & {
    side?: "top" | "right" | "bottom" | "left";
    showCloseButton?: boolean;
    closeLabel: string;
  }
  ```
  The `closeLabel` prop is REQUIRED. No default. Even when `showCloseButton={false}` the caller MUST pass it (acceptable trivial overhead; simpler typing than a discriminated union).
- Destructure `closeLabel` in the function signature alongside `className`, `children`, `side`, `showCloseButton`.
- Replace line 75 `<span className="sr-only">Close</span>` with `<span className="sr-only">{closeLabel}</span>`.

Step E — Edit `apps/web/src/components/screens/AppShell.tsx`:
- Verify `useTranslation` call includes `"common"` in the namespace array. If currently `useTranslation(["end-user"])`, extend to `useTranslation(["end-user", "common"])`.
- Find the existing `<SheetContent>` element (mobile-folders Sheet); add `closeLabel={t("common:common.action.close.label")}` to the prop list. If multiple `<SheetContent>` elements exist in this file, update ALL of them.

Step F — Audit other callsites: run `grep -rn "<SheetContent" apps/web/src --include="*.tsx" | grep -v __tests__`. Per the discovery scan, AppShell.tsx is the only callsite. If any other file shows up, add the same prop. Do NOT add closeLabel to test files.

Step G — Re-run `pnpm --filter @openwhispr/web test src/components/__tests__/conformance/sheet-close-i18n.test.tsx`. Confirm GREEN (5/5).

Step H — Run `pnpm --filter @openwhispr/web typecheck` — must pass (caller-side prop is now required; any missed callsite surfaces here).

Step I — Re-run the locale-parity-sweep test to confirm no regression: `pnpm --filter @openwhispr/web test src/components/screens/__tests__/locale-parity-sweep.test.tsx`.

Step J — Atomic commit:
```
git add apps/web/src/components/ui/sheet.tsx \
        apps/web/src/components/screens/AppShell.tsx \
        apps/web/src/locales/en/common.json \
        apps/web/src/locales/ru/common.json \
        apps/web/src/components/__tests__/conformance/sheet-close-i18n.test.tsx
git commit -m "fix(web-i18n): translate sheet close sr-only via required closeLabel prop (B2, pre-prod blocker)"
```
DO NOT use `--no-verify`.
  </action>
  <verify>
    <automated>cd apps/web && pnpm test src/components/__tests__/conformance/sheet-close-i18n.test.tsx src/components/screens/__tests__/locale-parity-sweep.test.tsx && pnpm typecheck</automated>
  </verify>
  <done>
    - sheet-close-i18n.test.tsx GREEN (5/5).
    - locale-parity-sweep.test.tsx still GREEN (no regression).
    - typecheck passes (the new required prop forces all callsites to be localized).
    - `grep -E 'sr-only">Close<' apps/web/src/components/ui/sheet.tsx` returns 0 hits.
    - `git log -1 --oneline` shows the new B2 commit on HEAD.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3 (Commit 3, B3): Translate stepper.tsx sr-only Completed via required completedLabel prop</name>
  <files>
    apps/web/src/components/ui/stepper.tsx,
    apps/web/src/components/screens/auth/SetupForm.tsx,
    apps/web/src/locales/en/end-user.json,
    apps/web/src/locales/ru/end-user.json,
    apps/web/src/components/__tests__/conformance/stepper-completed-i18n.test.tsx
  </files>
  <behavior>
    RED-first:
    - Test 3.1 (stepper.tsx prop): `apps/web/src/components/ui/stepper.tsx` source MUST contain `completedLabel: string` AND `{completedLabel}` inside the sr-only span (the conditional `status === "complete"` branch).
    - Test 3.2 (literal removed): `stepper.tsx` source MUST NOT match `/sr-only">Completed</`.
    - Test 3.3 (SetupForm callsite): `apps/web/src/components/screens/auth/SetupForm.tsx` source MUST contain a regex match for `completedLabel={\s*t\(\s*["']end-user:end-user\.setup\.step\.completed\.aria\.label["']` (allow either quote style).
    - Test 3.4 (en parity): `apps/web/src/locales/en/end-user.json` MUST parse to an object with `setup.step.completed.aria.label` as a non-empty string.
    - Test 3.5 (ru parity): same path in `apps/web/src/locales/ru/end-user.json` is non-empty AND differs from the en value.
    Tests at `apps/web/src/components/__tests__/conformance/stepper-completed-i18n.test.tsx`.
  </behavior>
  <action>
Step A — Author RED tests in `apps/web/src/components/__tests__/conformance/stepper-completed-i18n.test.tsx`. Five assertions. Run vitest — confirm RED.

Step B — Read `apps/web/src/locales/en/end-user.json` to locate the existing `setup.*` sub-tree. Insert under it (or create if absent):
```
"step": {
  "completed": {
    "aria": { "label": "Completed" }
  }
}
```
If `setup.step.*` already exists for other purposes, splice the `completed` sibling alongside.

Step C — Add the parallel ru translation to `apps/web/src/locales/ru/end-user.json`:
```
"step": {
  "completed": {
    "aria": { "label": "Завершено" }
  }
}
```
`Завершено` is the canonical past-participle neuter form used in Russian-language step indicators (matches Material UI ru, Ant Design ru).

Step D — Edit `apps/web/src/components/ui/stepper.tsx`:
- Extend the `StepIndicatorProps` interface (line 114):
  ```
  export interface StepIndicatorProps extends React.ComponentProps<"div"> {
    status: StepStatus;
    index: number;
    completedLabel: string;
  }
  ```
- Destructure `completedLabel` in the `StepIndicator` function signature alongside `status`, `index`, `className`.
- Replace line 146 `<span className="sr-only">Completed</span>` with `<span className="sr-only">{completedLabel}</span>`.

Step E — Edit `apps/web/src/components/screens/auth/SetupForm.tsx`:
- Verify `useTranslation` already covers `["end-user", "common"]` (line 106 per the discovery read — it does).
- Find the `<StepIndicator status={status} index={idx + 1} />` JSX at line ~236; add `completedLabel={t("end-user:end-user.setup.step.completed.aria.label")}` to the prop list.

Step F — Audit other `<StepIndicator>` callsites: `grep -rn "<StepIndicator" apps/web/src --include="*.tsx" | grep -v __tests__`. If any others exist, add the same prop. (Per Phase 12 / Plan 12-03 the Stepper is the /setup wizard primitive; SetupForm is expected to be the only call site, but verify.)

Step G — Re-run `pnpm --filter @openwhispr/web test src/components/__tests__/conformance/stepper-completed-i18n.test.tsx`. Confirm GREEN.

Step H — Run `pnpm --filter @openwhispr/web typecheck`. Must pass.

Step I — Run the full apps/web test suite once before committing to catch any indirect regression: `pnpm --filter @openwhispr/web test`. (Optional but recommended given the prop signature is a breaking change at the TS layer — TS will catch missed callsites, but failing render-tests would still appear here.)

Step J — Atomic commit:
```
git add apps/web/src/components/ui/stepper.tsx \
        apps/web/src/components/screens/auth/SetupForm.tsx \
        apps/web/src/locales/en/end-user.json \
        apps/web/src/locales/ru/end-user.json \
        apps/web/src/components/__tests__/conformance/stepper-completed-i18n.test.tsx
git commit -m "fix(web-i18n): translate stepper completed sr-only via required completedLabel prop (B3, pre-prod blocker)"
```
DO NOT use `--no-verify`.
  </action>
  <verify>
    <automated>cd apps/web && pnpm test src/components/__tests__/conformance/stepper-completed-i18n.test.tsx && pnpm typecheck && pnpm test</automated>
  </verify>
  <done>
    - stepper-completed-i18n.test.tsx GREEN (5/5).
    - Full `pnpm --filter @openwhispr/web test` suite GREEN (no regression in SetupForm/Stepper-related existing tests).
    - typecheck passes (required prop forces SetupForm to be the sole compiling callsite).
    - `grep -E 'sr-only">Completed<' apps/web/src/components/ui/stepper.tsx` returns 0 hits.
    - `git log -3 --oneline` shows three new commits (B1, B2, B3) in order on HEAD.
  </done>
</task>

</tasks>

## 5. Verification

### Per-task verification
Each task's `<verify>` block above runs vitest + typecheck against the surface it touched. The required-prop pattern on `SheetContent` and `StepIndicator` makes TS the safety net for any missed callsite — `pnpm --filter @openwhispr/web typecheck` MUST pass after each commit.

### End-of-plan smoke
After all 3 commits land:

```bash
cd apps/web
pnpm test                   # Full vitest run — every test GREEN, no regressions
pnpm typecheck              # No TS errors
pnpm lint                   # Biome clean

# Visual smoke (manual, owner-driven, per SHIP-DECISION.md step 2):
# 1. Start dev server: pnpm --filter @openwhispr/web dev
# 2. Visit /admin while signed in as a non-admin user → see localized 403
#    (toggle locale via the language switcher to confirm en + ru both render)
# 3. Visit /setup wizard, complete step 1 → confirm the completed-step
#    indicator's sr-only label is translated (inspect DOM)
# 4. On mobile viewport (or simulated), open the AppShell folders Sheet →
#    confirm close button's sr-only label is localized
```

### Coverage
`apps/web/src/components/ui/**` is excluded from `vitest.config.ts` coverage (`exclude` list at L52) — sheet.tsx and stepper.tsx changes do NOT count against the 90/90/90/90 floor. The new conformance tests live at `src/components/__tests__/conformance/*.tsx` (not under `ui/`) and DO count; they are 100% source-string + JSON-parity assertions (no production code branches to cover beyond import lines).

For `apps/web/src/app/(admin)/layout.tsx` (B1): the `src/app/**/layout.tsx` glob is in the coverage `exclude` list (L48 — "RSC routes are exercised end-to-end by Playwright, not vitest"). So the AdminLayout edit also does NOT drag the floor; B1's correctness is enforced by the conformance test's source-grep + parity assertions, NOT by render-test coverage.

For `apps/web/src/components/screens/AppShell.tsx` and `apps/web/src/components/screens/auth/SetupForm.tsx`: these ARE in the coverage scope. Pre-existing tests (`AppShell.test.tsx`, `setup.test.tsx`) should still pass — verify with the full `pnpm test` at end of Task 3.

## 6. Constraints honored

- **TDD constitutional (CLAUDE.md DISCIPLINE 1):** Each commit starts with a RED test, ends with GREEN production code, both in the SAME commit (no fix-without-test, no test-without-fix).
- **Atomic commits, one per blocker (user's hard rule from prompt):** B1 → commit 1; B2 → commit 2; B3 → commit 3. Three commits land cleanly on `main`.
- **en+ru parity (zero drift preserved per UI track):** every new key has a non-empty value in BOTH locale files; per-commit parity assertion in the conformance test file is the gate.
- **Gitleaks hooks NOT bypassed (CLAUDE.md hard rule 4):** no `--no-verify`. Pre-commit lefthook (gitleaks L1) + pre-push (L2) MUST fire and pass. If a hook surfaces a false positive on test placeholders, FIX `.gitleaks.toml` allowlist + regression assertion per `tools/lint-gitleaks-config.test.ts`, do NOT bypass.
- **No production code edits to make tests pass (CLAUDE.md hard rule 1):** the production edits here ARE the fix; tests assert the fix landed. Not the inverted pattern.
- **Surgical scope:** no touches outside the 5 source + 4 locale + 3 new test files. Realtime delta, LiteLLM aliases, F8 seeds untouched.
- **No `next-intl` confusion:** the project uses `react-i18next` + `i18next-icu` (per `package.json` deps + `lib/i18n.ts` + `lib/i18n-client.tsx`). The prompt mentioned next-intl; this is a label confusion in the source-of-truth review report. Plan implements via the actual `useTranslation` + `getServerI18n` pattern.
- **shadcn primitives stay presentational:** sheet.tsx and stepper.tsx do NOT import `useTranslation`. They take label strings as props from the localized parent. Mirrors the existing pattern (see how SetupForm passes `aria-label={t(...)}` into Stepper at line 230).
- **No new lockers triggered:** no NODE_ENV branches, no type suppressions, no hardcoded localhost/ports, no plaintext credential columns — none of these surfaces apply here.

## 7. Risk register

| ID | Risk | Mitigation |
|----|------|-----------|
| R1 | TS-required `closeLabel` / `completedLabel` props break an existing callsite that grep missed. | `pnpm typecheck` after each commit; required prop is a compile error, not a runtime surprise. |
| R2 | AdminForbidden async refactor trips React `headers()` typing differences between Next 15.5 stable and canary. | Read the existing `apps/web/src/app/layout.tsx` to mirror the live call shape; mirror sync-vs-async exactly. |
| R3 | Russian translation copy lands non-idiomatic and a native-speaker reviewer flags it post-push. | Suggested copy follows industry-standard ru a11y patterns (Material/Radix/Tailwind UI ru bundles); owner has final sign-off; can be tweaked in 0.0.5 patch without breaking key shape. |
| R4 | `pnpm test` full-suite run in Task 3 surfaces an indirect failure (e.g., a screenshot baseline that captured the EN string). | If a Playwright visual-baseline snapshot exists for /admin 403 or /setup completed step, regenerate it on the same task — out-of-scope but flag as PR comment. The repo Playwright suite is not gating local; CI will re-baseline. |
| R5 | Locale-parity-sweep test (Phase 51 / Plan 51-11e) does not auto-extend to the new keys. | The new tests carry their own parity assertions per blocker — no dependency on the sweep test. Sweep test stays green because it asserts only the original 8 keys it was authored for. |

## 8. Push sequence (owner-driven, post-plan)

Per SHIP-DECISION.md §"Recommended push sequence":

1. Run all three tasks → 3 atomic commits on `main`.
2. Local smoke: `pnpm --filter @openwhispr/web test` + `typecheck` + manual locale toggle on /admin (403) + /setup wizard.
3. Run operator pre-push env checklist (MASTER_KEK, LITELLM_BASE_URL, AUTH_URL, INGRESS_BASE_URL, OPENAI_API_KEY).
4. `git push`.

The 4 review reports remain in `.planning/review/pre-prod-2026-05-26/` as the audit trail.

---

**Plan path:** `/Users/dev/openwhispr-server/.planning/quick/260526-lgn-i18n-pre-prod-blockers/260526-lgn-PLAN.md`
