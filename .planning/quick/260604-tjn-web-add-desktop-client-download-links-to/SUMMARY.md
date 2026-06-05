---
phase: quick-260604-tjn
plan: 01
subsystem: apps/web (login + app shell)
tags: [web, download-links, i18n, ux]
status: complete
requires: []
provides:
  - "Desktop-client download links reachable from the login page footer (both local-login and OIDC-only modes)"
  - "Post-login app shell: sidebar 'Desktop app' nav item + header Download button → /download"
affects:
  - apps/web
decisions:
  - "Links target the EXISTING internal /download route (OS-autodetect + per-OS installers), not GitHub directly"
  - "Login CTA placed OUTSIDE the localLogin ternary so it renders in BOTH local-login and OIDC-only modes"
  - "Post-login = BOTH sidebar nav item AND header button (per owner)"
metrics:
  completed: 2026-06-04
  commits: 2
  tasks: 2
---

# Quick 260604-tjn: Web desktop-download links

The `/download` page existed and worked (GitHub releases Yambr/openwhispr, OS autodetect,
per-OS installers, en+ru) but was unreachable from the UI. Added links in 3 places, all
targeting the existing `/download` route, via 2 RED→GREEN atomic commits (strict TDD).

## Commits

| Task | SHA | Subject | Test result |
|---|-----|---------|-------------|
| 1 | `40e5c9bb` | feat(web): add desktop-app sidebar nav item + header download button | RED 3 failed → GREEN 8/8 |
| 2 | `1639467c` | feat(web): add desktop-app download CTA to sign-in in both login modes | RED 3 failed → GREEN 41/41 |

Full web suite (orchestrator re-run): **Test Files 81 passed (81), exit 0**.

## Edits (actual line numbers)

- `apps/web/src/components/screens/AppShell.tsx:36` — 6th NAV item `{ href: "/download", key: "end-user.download.nav.sidebar.label" }`.
- `apps/web/src/components/screens/AppShell.tsx:79-80` — header `<Button asChild size="sm" variant="outline"><Link href="/download">{t("common:common.download.header.button.label.text")}</Link></Button>` before `<LanguageSwitcher/>`.
- `apps/web/src/components/screens/auth/SignInForm.tsx:347-356` — `<p className="text-center text-sm"><Link href="/download" …>{t("end-user.signin.action.download-link.label")}</Link></p>` placed AFTER the localLogin ternary, before the closing `</div>` (renders in both modes).
- Tests: `AppShell.test.tsx` (sidebar item + header button), `SignInForm.test.tsx` (local-login mode CTA), `SignInForm.local-login.test.tsx` (OIDC-only mode CTA).

## i18n keys added (en + ru)

| Key | en | ru |
|---|---|---|
| `end-user.download.nav.sidebar.label` (end-user.json) | Desktop app | Десктоп-приложение |
| `common.download.header.button.label.text` (common.json) | Download | Скачать |
| `end-user.signin.action.download-link.label` (end-user.json) | Download the desktop app | Скачать десктоп-приложение |

## Constitutional compliance

RED-before-GREEN for both tasks (tests+code+i18n same commit); every new string in en AND ru;
zero `as any`/`@ts-ignore`/`@ts-nocheck` added (parity tests use a narrow `NestedLocale`
interface); no `--no-verify` (gitleaks/biome/english/web-typecheck/lockers/commitlint passed);
no new routes, no server changes, no new deps. Playwright e2e not warranted (no new
route/server/auth surface — Testing Library unit coverage is complete).

## Independent orchestrator verification (hard rule 3)

- (a) commits `40e5c9bb` + `1639467c` on HEAD via git log.
- (c) edits present: NAV @36, header button @79-80, SignInForm CTA @350/353 (grep-confirmed).
- en+ru parity confirmed for all 3 keys via JSON parse.
- zero new type-suppressions in the diff.
- (b) web suite re-run by orchestrator: 81 files passed, exit 0.
- (d) tree clean.

## Release

NOT released in this task — on main, awaiting owner batch-release signal (will fold into the
next server/web release; amd64-only hand-tag per the standing arm64 directive).
