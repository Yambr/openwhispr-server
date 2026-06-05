---
quick: 260604-tjn-web-add-desktop-client-download-links-to
type: execute
surface: web (Next.js 15 App Router / apps/web)
tdd: true
files_modified:
  - apps/web/src/locales/en/end-user.json
  - apps/web/src/locales/ru/end-user.json
  - apps/web/src/locales/en/common.json
  - apps/web/src/locales/ru/common.json
  - apps/web/src/components/screens/AppShell.tsx
  - apps/web/src/components/screens/__tests__/AppShell.test.tsx
  - apps/web/src/components/screens/auth/SignInForm.tsx
  - apps/web/src/components/screens/auth/__tests__/SignInForm.test.tsx
autonomous: true

must_haves:
  truths:
    - "On the sign-in screen, a 'Download the desktop app' link to /download is visible in BOTH local-login and OIDC-only modes."
    - "In the post-login app shell, a 'Desktop app' sidebar nav item links to /download."
    - "In the post-login app shell header, a compact 'Download' button links to /download."
    - "Every new UI string exists in BOTH en and ru catalogs (i18n parity)."
  artifacts:
    - path: "apps/web/src/components/screens/AppShell.tsx"
      provides: "Sidebar NAV 6th item + header download button, both → /download"
    - path: "apps/web/src/components/screens/auth/SignInForm.tsx"
      provides: "Download CTA link rendered outside the localLogin ternary"
    - path: "apps/web/src/locales/{en,ru}/end-user.json"
      provides: "download.nav.sidebar.label + signin.action.download-link.label"
    - path: "apps/web/src/locales/{en,ru}/common.json"
      provides: "common.download.header.button.label.text"
  key_links:
    - from: "AppShell sidebar NAV"
      to: "/download"
      via: "next/link Link in NAV map"
      pattern: "href=\"/download\""
    - from: "AppShell header"
      to: "/download"
      via: "Button asChild + next/link"
      pattern: "Button asChild.*/download"
    - from: "SignInForm CTA"
      to: "/download"
      via: "next/link Link after the localLogin ternary"
      pattern: "href=\"/download\""
---

<objective>
The internal `/download` page (apps/web/src/app/(public)/download/page.tsx, route `/download`)
already ships and works, but nothing in the app links to it, so users cannot find the
desktop client. Add three discoverability affordances, all pointing at the EXISTING
internal `/download` route (never GitHub directly):

- (A) Sign-in footer link "Download the desktop app" → /download, rendered in BOTH
  local-login and OIDC-only branches.
- (B1) App-shell sidebar nav item "Desktop app" → /download.
- (B2) App-shell header compact "Download" button → /download.

Purpose: close the dead-end where /download is reachable only by typing the URL.
Output: edited AppShell + SignInForm components, 3 new i18n keys (en + ru each),
extended RED-first tests.

Scope: web unit tests only (Testing Library). These components render with no auth/
network/router state beyond mocked next/navigation + next/link, so unit coverage fully
exercises the new surface. A Playwright web e2e is NOT warranted for this change (no new
route, no server behaviour, no auth-gated path) — see <e2e_note>.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<constitutional_gates>
- **Strict TDD**: write the failing test assertion(s) FIRST, run to confirm RED, then
  add the component/i18n edit, run to confirm GREEN. Tests + production code land in the
  SAME atomic commit.
- **i18n parity (HARD RULE)**: every new key MUST exist in BOTH `en` and `ru`. Source is
  English-only; runtime strings are bilingual. Each task that adds a key also adds a
  parity assertion in its own test file (reading both JSONs) so a missing-translation
  regression is caught locally, not just in the conformance sweep.
  NOTE: `apps/web/src/components/screens/__tests__/locale-parity-sweep.test.tsx` is a
  CLOSED-LIST sweep (asserts a fixed set of HI-02 keys); it will NOT auto-detect the new
  keys. Do NOT add the new keys to that sweep — keep parity coverage local to the new
  tests (the sweep is scoped to its Phase 51 charter). Other conformance tests under
  `src/components/__tests__/conformance/*` are likewise scoped and need no edit.
- **Coverage ≥ 90% on diff**: the diff is component JSX + JSON. The new test assertions
  cover every new rendered element and both-locale parity → ≥ 90% trivially met.
- **No type-suppression**: no `as any`, `as unknown as`, `@ts-ignore`. Parity-assertion
  JSON reads use `JSON.parse(...) as <narrow type>` following the existing
  locale-parity-sweep pattern (a declared `NestedLocale` interface), never `as any`.
- **No new deps**: `next/link` Link + shadcn `Button asChild` (Slot, already in
  components/ui/button.tsx line 50) only.
- **Run command**: `pnpm --filter @openwhispr/web test:unit <pattern>`.
</constitutional_gates>

<i18n_keys>
Final chosen keys + exact strings (add to BOTH en and ru):

1. Sidebar nav label — namespace `end-user`, follows the NAV `*.nav.sidebar.label`
   pattern verbatim. File: src/locales/{en,ru}/end-user.json under `end-user`.
   - key path: `end-user.download.nav.sidebar.label`
   - t() call (AppShell default ns is `["end-user","common"]`, end-user first):
     used via the NAV `key` string `"end-user.download.nav.sidebar.label"`, resolved by
     `t(item.key)` exactly like the other 5 rows.
   - en: "Desktop app"
   - ru: "Десктоп-приложение"

2. Header button label — namespace `common`, reusable short label. File:
   src/locales/{en,ru}/common.json under `common.download` (the download block already
   exists at common.download; add a new `header` sub-block — do NOT collide with the
   existing heading/primary/platform/variant/version/fallback/releases/signin children).
   - key path: `common.download.header.button.label.text`
   - t() call from AppShell (end-user default ns) MUST be cross-ns qualified:
     `t("common:common.download.header.button.label.text")`
   - en: "Download"
   - ru: "Скачать"

3. Sign-in footer link label — namespace `end-user`, under signin.action (sibling of
   the existing `signup-link`, `forgotPassword`, `resendVerification`). File:
   src/locales/{en,ru}/end-user.json under `end-user.signin.action`.
   - key path: `end-user.signin.action.download-link.label`
   - t() call from SignInForm (default ns `["end-user","common"]`):
     `t("end-user.signin.action.download-link.label")`
   - en: "Download the desktop app"
   - ru: "Скачать десктоп-приложение"

Verified ns/call-site conventions:
- AppShell: `useTranslation(["end-user","common"])` (line 39); existing NAV rows use
  bare `end-user.*` keys, common keys use the `common:common.*` cross-ns prefix
  (e.g. line 81 `t("common:common.signout.label")`). MATCH this exactly.
- SignInForm: `useTranslation(["end-user","common"])` (line 72); existing sign-up link
  uses bare `t("end-user.signin.action.signup-link.label")` (line 331). MATCH this.
</i18n_keys>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: App-shell sidebar nav item + header download button (RED→GREEN, one commit)</name>
  <files>
    apps/web/src/components/screens/__tests__/AppShell.test.tsx
    apps/web/src/components/screens/AppShell.tsx
    apps/web/src/locales/en/end-user.json
    apps/web/src/locales/ru/end-user.json
    apps/web/src/locales/en/common.json
    apps/web/src/locales/ru/common.json
  </files>
  <behavior>
    RED first — extend AppShell.test.tsx (Testing Library, existing next/link + next/navigation mocks already render Link as a plain <a href>). Add to the `resources` test fixture the two new label nodes so the rendered labels are deterministic:
      - resources["end-user"]["end-user"].download = { nav: { sidebar: { label: "Desktop app" } } }
      - resources.common.common.download = { header: { button: { label: { text: "Download" } } } }
    New assertions:
      - it("renders a sidebar nav item linking to /download"): the link named /desktop app/i has attribute href="/download". Use getByRole("link", { name: /desktop app/i }).
      - it("renders a compact download button in the header linking to /download"): getByRole("link", { name: /^download$/i }) has href="/download". (Button asChild + next/link mock renders as <a>, so it is a link role with the button's text; assert href="/download" and that it is distinct from the sidebar item via the /^download$/i exact-name match vs /desktop app/i.)
      - it("both locales define the new download keys (parity)"): read src/locales/{en,ru}/end-user.json and {en,ru}/common.json, assert end-user.download.nav.sidebar.label and common.download.header.button.label.text are non-empty strings in BOTH locales. Type the parsed JSON via a declared narrow interface (no `as any`), mirroring locale-parity-sweep.test.tsx.
    Run `pnpm --filter @openwhispr/web test:unit AppShell` → MUST be RED (new assertions fail: keys missing from fixture-less prod catalogs / nav item + button absent).
  </behavior>
  <action>
    GREEN — make the RED assertions pass:
    1. AppShell.tsx NAV array (lines 30-36): append a 6th item AFTER the account row:
       `{ href: "/download", key: "end-user.download.nav.sidebar.label" }`. The existing
       `NAV.map` + `t(item.key)` + `pathname === item.href` active-highlight handle it
       unchanged. (`/download` is a public route outside /app; clicking it leaves the
       shell — acceptable for a download page per the owner decision.)
    2. AppShell.tsx header (insert BEFORE `<LanguageSwitcher />` at line 78, making it the
       leftmost element in the right-aligned header): a compact link-button —
       `<Button asChild size="sm" variant="outline"><Link href="/download">{t("common:common.download.header.button.label.text")}</Link></Button>`.
       `Button` and `Link` are already imported (lines 18, 14); `asChild` is supported via
       Slot (button.tsx line 50). Do NOT add imports.
    3. i18n — add the keys (exact strings from <i18n_keys>) to ALL FOUR catalogs:
       - en/end-user.json: under `end-user`, add `"download": { "nav": { "sidebar": { "label": "Desktop app" } } }`
       - ru/end-user.json: same path, label "Десктоп-приложение"
       - en/common.json: under existing `common.download`, ADD a `"header": { "button": { "label": { "text": "Download" } } }` child (keep all existing download children intact)
       - ru/common.json: same path, text "Скачать"
    Run `pnpm --filter @openwhispr/web test:unit AppShell` → MUST be GREEN. Confirm the
    pre-existing 5 AppShell tests still pass (no regression to nav-count assertions — the
    existing test asserts the 5 named rows by name, not a hard count of 5, so the 6th row
    does not break it; verify by reading the green output).
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/web test:unit AppShell</automated>
  </verify>
  <done>
    AppShell renders 6 sidebar rows (incl. "Desktop app" → /download) and a header
    "Download" button → /download; all AppShell tests green incl. the new parity test;
    new keys present in all four catalogs. RED was observed before GREEN. Tests + prod
    code + i18n in ONE commit.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Sign-in download CTA in both login modes (RED→GREEN, one commit)</name>
  <files>
    apps/web/src/components/screens/auth/__tests__/SignInForm.test.tsx
    apps/web/src/components/screens/auth/SignInForm.tsx
    apps/web/src/locales/en/end-user.json
    apps/web/src/locales/ru/end-user.json
  </files>
  <behavior>
    RED first — SignInForm.test.tsx already exists (next/link mocked as <a href>,
    next/navigation mocked, providers fetch stubbed). Add to its `resources` fixture:
      resources["end-user"]["end-user"].signin.action["download-link"] = { label: "Download the desktop app" }
    New assertions:
      - it("renders a 'Download the desktop app' link to /download in local-login mode"):
        default beforeEach stubs all 3 providers + local login enabled → render → the link
        named /download the desktop app/i has href="/download".
      - it("renders the download link in OIDC-only mode too"): drive the OIDC-only branch
        by stubbing the providers endpoint to report local login disabled. The component
        reads `useAuthProviders().localLoginEnabled`; to force the OIDC-only branch in this
        test, stub the providers fetch response to include `localLogin: { enabled: false }`
        (mirror the shape used in SignInForm.local-login.test.tsx — read that sibling test
        to copy the exact stub shape and any extra mocks). Assert the form is hidden
        (queryByLabelText(/email/i) is null) AND the download link with href="/download" is
        STILL present. This proves the CTA sits outside the localLogin ternary.
      - it("both locales define signin download-link key (parity)"): read
        src/locales/{en,ru}/end-user.json, assert end-user.signin.action["download-link"].label
        is a non-empty string in BOTH. Narrow-typed parse, no `as any`.
    Run `pnpm --filter @openwhispr/web test:unit SignInForm` → MUST be RED.
    (Run the base SignInForm.test.tsx; the OIDC-only assertion may instead be cleaner to
    add in SignInForm.local-login.test.tsx if that file owns the disabled-local-login
    fixture — executor's call: read SignInForm.local-login.test.tsx first and place the
    OIDC-only assertion in whichever file already has the disabled stub, to avoid
    duplicating fetch-stub plumbing. Either placement is acceptable; both files are in
    files_modified-eligible scope — add the chosen one to files_modified if it differs.)
  </behavior>
  <action>
    GREEN — SignInForm.tsx: insert the CTA AFTER the `{localLoginEnabled ? (...) : (...)}`
    ternary (which closes at line 342) and BEFORE the closing `</div>` at line 343, so it
    renders in BOTH branches. Match the existing sign-up cross-link styling (lines 326-333):
      `<p className="text-center text-sm"><Link href="/download" className="text-primary underline underline-offset-4 hover:opacity-80">{t("end-user.signin.action.download-link.label")}</Link></p>`
    `Link` is already imported (line 41); `t` is in scope (line 72). No new imports.
    i18n — add `"download-link": { "label": "..." }` under `end-user.signin.action` in
    BOTH en/end-user.json (label "Download the desktop app") and ru/end-user.json
    (label "Скачать десктоп-приложение"). (Note: end-user.json was also touched in Task 1
    for a different key — that is the previous commit; this commit adds only the
    signin.action.download-link key.)
    Run `pnpm --filter @openwhispr/web test:unit SignInForm` → MUST be GREEN, including
    the existing ~40 SignInForm tests (no regression). Verify both the base file and
    SignInForm.local-login.test.tsx are green.
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/web test:unit SignInForm</automated>
  </verify>
  <done>
    SignInForm renders a /download CTA in both local-login and OIDC-only branches; new
    key present in en + ru end-user.json; all SignInForm tests green incl. parity. RED
    observed before GREEN. Tests + prod code + i18n in ONE commit.
  </done>
</task>

</tasks>

<commit_strategy>
TWO atomic commits (justification: each commit is a self-contained TDD RED→GREEN unit
that ships its own failing-then-passing test alongside its production + i18n edit, per the
constitutional "tests + code SAME commit" rule; splitting keeps each commit's diff
reviewable and each test run independently green; AppShell and SignInForm touch disjoint
components):

Commit 1 (Task 1):
  feat(web): add desktop-app sidebar nav item + header download button → /download

  Sidebar gains a 6th "Desktop app" row and the app-shell header gains a compact
  "Download" link-button, both targeting the existing internal /download route, so the
  desktop client is discoverable from the post-login shell. RED-first AppShell tests
  cover both affordances + en/ru i18n parity for the two new keys.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

Commit 2 (Task 2):
  feat(web): add "Download the desktop app" CTA to sign-in in both login modes

  The sign-in screen gains a footer link to /download placed outside the localLogin
  ternary, so it renders in both local-login and OIDC-only modes. RED-first SignInForm
  tests cover both branches + en/ru i18n parity for the new key.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

(Both commits run through the lefthook pre-commit + the pre-push test-evidence gate — do
NOT use --no-verify. JSON-only + JSX edits carry no credential shapes, so gitleaks is a
no-op, but the hooks still run.)
</commit_strategy>

<e2e_note>
Project memory flags bifurcated client surfaces (verify-email, OAuth, deep links) as
needing BOTH web AND desktop e2e. This change is NOT in that category: it adds in-app
navigation to an already-shipped internal route, touches no server wire, no auth-gated
flow, and no desktop bridge. The components render fully under Testing Library with mocked
router/link, so unit tests give complete coverage of the new surface. A Playwright web e2e
would only re-assert "clicking a link navigates to /download" — already guaranteed by
next/link + the href assertions. Recommendation: web unit tests are sufficient; do NOT add
a Playwright e2e for this Quick task. (If a future phase adds a real download-funnel
acceptance flow, fold it there.)
</e2e_note>

<verification>
1. `pnpm --filter @openwhispr/web test:unit AppShell` — green, includes new sidebar +
   header + parity assertions.
2. `pnpm --filter @openwhispr/web test:unit SignInForm` — green, includes both-mode CTA +
   parity assertions.
3. `grep -n 'href="/download"' apps/web/src/components/screens/AppShell.tsx
   apps/web/src/components/screens/auth/SignInForm.tsx` — three hits (sidebar nav via NAV
   key resolves at runtime so grep the literal in header + signin; sidebar literal is the
   NAV `href: "/download"`). Expect: AppShell shows NAV `href: "/download"` + header
   `<Link href="/download">`; SignInForm shows the CTA `<Link href="/download">`.
4. en/ru parity: all three new key paths resolve to non-empty strings in both locales
   (asserted by the new parity tests — no extra manual step).
</verification>

<success_criteria>
- Sign-in shows a /download CTA in BOTH local-login and OIDC-only modes.
- App shell shows a "Desktop app" sidebar row AND a header "Download" button, both →
  /download.
- 3 new keys exist in en AND ru (parity tests green).
- Both commits are RED-first TDD, tests + code + i18n together, hooks not bypassed.
- No new deps, no type-suppression, no server/route changes.
</success_criteria>

<output>
After completion, append a one-line entry to STATE.md / the Quick ledger noting the three
download affordances shipped and the two commit SHAs.
</output>
