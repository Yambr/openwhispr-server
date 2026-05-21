# Web App Adversarial Review — `apps/web/src/**`

Scope: Next.js 15 App Router source under `apps/web/src/`. Excludes `tests/`, `__tests__/`. Branch HEAD `6e43588`. Reviewed 2026-05-20 against checklist in prompt.

## Summary

The web tier has solid bones: admin gate is a pure role check via `checkAdminAccess()`, middleware preserves `?from=` on `/app/*` redirects, RSC fetch wrappers throw on non-2xx (the prior 5xx-swallowing bug listed in the checklist has been closed), `dangerouslySetInnerHTML` / `eval` / `new Function` are entirely absent, all `process.env` reads sit on the server boundary, no NODE_ENV branches outside config, the verify-email token is regex-validated before reaching the client, observability hrefs are http(s)-allowlist gated, and the search client UUID-shape-guards rendered hrefs. The bulkfix work tracked in plan 51-11 left a clean RSC error path on every list/detail page.

But several real defects remain:

- **Multiple files carry STALE security comments** referencing the retired Traefik basic-auth / `D-ADMIN-1` / "edge-auth" model. The actual gate (admin role + Better Auth session) is correct, but the inline rationale on `/admin` pages, `AdminShell`, `ConfigClient`, and middleware all still say the opposite. A future reader following the comments would weaken the gate. Listed as HIGH because the 55-18 cleanup only touched `admin-guard.ts`.
- **AdminShell has no sign-out button by design**, with the rationale "auth is enforced at Traefik basic-auth." With basic-auth retired, admin users on `/admin/*` must hand-navigate to `/app/account` to sign out. UX defect, HIGH.
- **`SessionsTable` receives `row.token` (the Better Auth bearer) for every session** from `listSessions()` and calls `revokeSession({ token })` with it. The Phase 51 CR-4 fix renamed the prop but the underlying API response still ships bearers into the JS heap — defeating HttpOnly cookie protection. HIGH (likely a Better Auth library shape, but the leak surface lives here).
- **`SignInForm` ignores middleware's `?from=` deep-link query**, hardcoding `callbackURL: "/app"` and `router.push("/app")`. Middleware sets `?from=<path>` for `/app/notes/123` style redirects; the form discards it, so deep-link recovery is silently dead. HIGH.
- **`NotesListClient` extends the dehydrated query key with a `{folder}` cursor field** that the RSC prefetch in `notes/page.tsx` does not include. The SSR-hydrated cache never matches the client-side key — every `/app/notes` paint refetches even though the data is already in the dehydrated tree. HIGH.
- **Query-key duplication across 11 invalidate sites** uses inline string tuples instead of the `queryKeys.*` factory in `lib/query-keys.ts`. Drift hazard: change a key shape and these invalidations silently miss. MEDIUM.
- **Direct `fetch()` calls bypass the `clientFetch` wrapper** in 7 components (ConfigClient, ResetPasswordForm, ForgotPasswordForm, useAuthProviders, SetupForm, DeleteAccountDialog, language-switcher, plus a duplicate `fetchJson` helper in ConfigClient). MEDIUM.
- **`apps/web/src/lib/axe-baseline.ts` is test-only** but lives under `src/`. LOCKER-04 mandates every exported symbol have a non-test importer. MEDIUM.
- **`signOutAction` server action is dead** — `AppShell` calls `signOut()` from `auth-client` directly. LOCKER-04 dead-export, MEDIUM.
- **Hardcoded `v1.0.4` version string** in `AuthShell.tsx:66`. MEDIUM (will silently go stale on next release).
- **Hardcoded English** in `AdminLayout` 403 surface, `ErrorBoundary` fallback, three `aria-label` attributes (AppShell "Primary", AdminShell "Admin", FoldersSidebar "Folders"). MEDIUM each.
- **Hardcoded `:3000` port in `internal-api.ts:22`** technically violates LOCKER-03 (`:3000|:4000|:8080` refused outside allowlisted dirs). HIGH if LOCKER-03 is BLOCKING for apps/web/src/.

No CRITICAL findings — admin gate is correctly fail-closed, no basic-auth / edge-auth references in executable code paths, no secrets in client bundle, no XSS sinks, no dangerouslySetInnerHTML / eval / new Function. The HIGH items are real defects users will hit; the MEDIUM items are LOCKER-floor / drift hazards.

---

## Findings

### CRITICAL

None.

### HIGH

**HI-01 — `SignInForm` discards middleware's `?from=` deep-link parameter.**
- `apps/web/src/components/screens/auth/SignInForm.tsx:89,99` — hardcodes `callbackURL: "/app"` and `router.push("/app")`. The comment on L88 calls it "Open-redirect mitigation" but middleware (`apps/web/src/middleware.ts:146`) explicitly preserves `?from=<originalPath>` for exactly this recovery flow. Result: a user who deep-links to `/app/notes/123` while signed out is redirected to `/sign-in?from=/app/notes/123` (correct), but lands on `/app` after sign-in (wrong) — their deep link is silently lost. Either consume `?from=` with an allowlist (must start with `/app/` and contain no `://`), or remove the `from=` query in middleware so the design intent is consistent.
- **Status:** CLOSED 2026-05-21 — Phase 68, commit `0f1e9ee7` — `SignInForm` consumes the middleware `?from=` param through a strict same-origin path allowlist (`lib/safe-from-param.ts`: starts with `/app/` or equals `/app`; no `://`, no `\`, no leading `//`; else `/app`).

**HI-02 — `SessionsTable` ships Better Auth bearer tokens into the JS heap.**
- `apps/web/src/components/screens/account/SessionsTable.tsx:30-38,200` — `SessionRow.token: string` and `revokeOne.mutate(row.token)` pass the bearer. `authClient.listSessions()` returns every session's token (required by `revokeSession({ token })`'s API contract). The Phase 51 CR-4 fix renamed `currentSessionToken → currentSessionId` but the row-level bearers are still in the response body and rendered into the React tree. An XSS or compromised dependency reading window state can exfiltrate every session's bearer. Better Auth's revokeSession probably accepts `id` too in newer versions; switch to id-based revocation if so, or document that the bearers are unavoidable and add a CSP-`connect-src` audit.
- **Status:** CLOSED 2026-05-21 — Phase 68, commit `4d8e47f0` — resolved via the documentation route. Better Auth 1.6.9 `revokeSession` accepts ONLY `{ token }` — there is NO id-based revocation overload (confirmed against `better-auth/dist/api/routes/session.d.mts:230-235`), so the bearer-in-heap is unavoidable without a library upgrade. The bearer is kept off every render path (DOM attr / `data-*` / React key — RED-test-pinned); the file header documents the exposure + the CSP `connect-src` containment; the durable fix (a Better Auth upgrade) is logged in `.planning/deferred-items.md` as a v2 item.

**HI-03 — `NotesListClient` query key never matches RSC dehydrated key.**
- `apps/web/src/components/screens/notes/NotesListClient.tsx:121` — `queryKey: [...queryKeys.notes.list(cursor), { folder: folderFilter }]`. RSC prefetch in `apps/web/src/app/(auth)/app/notes/page.tsx:25` uses `queryKeys.notes.list(cursor)` (no folder field). Result: every `/app/notes` first paint thinks the cache is empty and fires a client fetch, wasting the entire SSR prefetch work. Either thread `folderFilter` into the RSC prefetch or drop it from the client query key.
- **Status:** CLOSED 2026-05-21 — Phase 68, commit `08da020c` — dropped the `{ folder }` tuple element from the client query key so it equals the RSC dehydrated key `queryKeys.notes.list(cursor)`; `folderFilter` stays a pure client-side `.filter()` (it never changed the fetched payload). SSR prefetch is now consumed on first paint.

**HI-04 — `AdminShell` has no sign-out button (UX dead end).**
- `apps/web/src/components/screens/AdminShell.tsx:3-7,73` — header has only ThemeSwitcher; the rationale comment says "admin auth is enforced at Traefik basic-auth ... Adding a sign-out here would be misleading." Basic-auth was retired in Phase 55-18-cleanup (see `apps/web/src/lib/admin-guard.ts:20-25`). Admin users on `/admin/*` now have no in-product way to sign out — they have to navigate to `/app/account` first. Add the sign-out button.
- **Status:** CLOSED 2026-05-21 — Phase 68, commit `a1ac295e` — the AdminShell header renders a Better Auth `signOut()` button routing to `/sign-in` (mirrors `AppShell.handleSignOut`); the stale "NO sign-out button / Traefik basic-auth" header comment was purged in the same commit.

**HI-05 — Stale security comments contradicting current admin model.**
Multiple files document the retired Traefik basic-auth model. Misleading next to security-critical code; a future contributor following the comments would weaken the gate.
- `apps/web/src/app/(admin)/admin/page.tsx:5-7` — "NO session check at the page level — D-ADMIN-1 keeps Traefik basic-auth as the single source of truth"
- `apps/web/src/app/(admin)/admin/config/page.tsx:5-15` — "admin access at the network layer is via Traefik basic-auth (D-ADMIN-1)" + "D-ADMIN-1 — layout already lacks a session gate"
- `apps/web/src/app/(admin)/admin/observability/page.tsx:10-12` — "(admin) layout ... is also gate-less; Traefik basic-auth at the edge is the single source of truth for admin access"
- `apps/web/src/components/screens/admin/ConfigClient.tsx:13` — "D-ADMIN-1: NO application-layer role check; Traefik basic-auth gates the surface"
- `apps/web/src/components/screens/admin/ObservabilityClient.tsx:1-2` — comment header references retired `D-ADMIN-1`
- `apps/web/src/components/screens/AdminShell.tsx:2-7` — see HI-04
- `apps/web/src/components/screens/AdminIndex.tsx:27` — "Phase 07.1 D-ADMIN-1"
- `apps/web/src/middleware.ts:23-25` — "Auth matcher is NOT widened to /admin/* — D-ADMIN-1 keeps the Traefik basic-auth gate authoritative for admin"
- **Status:** CLOSED 2026-05-21 — Phase 68, commit `42a839e1` — every stale `D-ADMIN-1` / Traefik-basic-auth comment across the 7 files (AdminShell folded into HI-04's commit) was purged or corrected to describe the real model (admin = `users.role='admin'` enforced by `checkAdminAccess()`; see `admin-guard.ts`). `admin-guard.ts` + `(admin)/layout.tsx` already correct — left untouched. Comment-only; zero behaviour change.

**HI-06 — Hardcoded `:3000` port in production source.**
- `apps/web/src/lib/internal-api.ts:22` — `const DEFAULT_INTERNAL_API_URL = "http://api:3000"`. LOCKER-03 (CLAUDE.md DISCIPLINE rule 13) lists `:3000|:4000|:8080` as REFUSED outside `tests/`, `.env.*.example`, `compose/`, `docs/`, `charts/`, `tools/`. `apps/web/src/lib/` is not on the allowlist. Either add an explicit lint exemption + comment why, or require `INTERNAL_API_URL` to be set (fail-closed) instead of falling back. Comments on lines 13-17 already acknowledge "Operators wiring a hostile env value bear responsibility; defence-in-depth URL-shape validation is deferred to Plan 51-18 (LOW)" — the URL-shape validation should land before public release.
- **Status:** CLOSED 2026-05-21 — Phase 68, commit `b72a23c0` — `internalApiUrl()` is now fail-closed (throws when `INTERNAL_API_URL` is unset/empty — docker-compose + Helm always set it); the `:3000` literal is removed and the 3 transitional `lint-no-hardcode.allowlist.txt` entries for `internal-api.ts` are deleted. `pnpm lint:lockers` green.

### MEDIUM

**MED-01 — RSC `getServerSession` treats 5xx as anonymous.**
- `apps/web/src/lib/auth-server.ts:71` — `if (!res.ok) return null;` collapses 401, 500, 502, 504 into "no session". A transient API outage causes a mass redirect to `/sign-in`, which is jarring UX and indistinguishable from "session expired." Distinguish 401-class (return null) from 5xx-class (let the layout render an outage banner or throw).

**MED-02 — Query-key duplication across 11 sites (drift hazard).**
Files inline `queryKey: ["notes", "list"]` etc. instead of using the `queryKeys.notes.list()` factory:
- `notes/NoteDetailClient.tsx:134`
- `notes/NotesListClient.tsx:132`
- `transcriptions/TranscriptionsListClient.tsx:108,179,207`
- `transcriptions/TranscriptionDetailClient.tsx:124`
- `conversations/ConversationsListClient.tsx:90,156,184`
- `conversations/ConversationDetailClient.tsx:94,208`

**MED-03 — Direct `fetch()` bypasses `clientFetch` wrapper.**
Wrapper exists at `apps/web/src/lib/client-fetch.ts` but is ignored by:
- `components/screens/admin/ConfigClient.tsx:48-57` (declares its own duplicate `fetchJson`)
- `components/screens/auth/ForgotPasswordForm.tsx:80`
- `components/screens/auth/ResetPasswordForm.tsx:100`
- `components/screens/auth/useAuthProviders.ts:60`
- `components/screens/auth/SetupForm.tsx:183`
- `components/screens/account/DeleteAccountDialog.tsx:55`
- `components/screens/language-switcher.tsx:32`

Drift hazard: any future change to retry/auth-header policy in `clientFetch` won't apply to these sites.

**MED-04 — `axe-baseline.ts` is test-only code living in production source.**
- `apps/web/src/lib/axe-baseline.ts` — consumed only by `apps/web/tests/e2e/fixtures/axe.ts` and its unit test. LOCKER-04 says every exported symbol must have a non-test importer. Move to `apps/web/tests/lib/` or under the fixtures directory.

**MED-05 — `signOutAction` is dead code.**
- `apps/web/src/lib/auth-actions.ts:24` — exported but no non-test importer. `AppShell` calls Better Auth's `signOut()` from `auth-client` instead. Either delete `auth-actions.ts` or migrate `AppShell.handleSignOut` to use the server action (preferred — it explicitly invalidates the server-side session row).

**MED-06 — Hardcoded `v1.0.4` version string.**
- `apps/web/src/components/screens/auth/AuthShell.tsx:66` — `<span className="font-mono">v1.0.4</span>`. Will silently desync from `package.json` on every release. Either inject via `NEXT_PUBLIC_APP_VERSION` from `process.env` at build time or read from `package.json` via a build-time constant.

**MED-07 — Sign-up vs setup password policy mismatch.**
- `apps/web/src/lib/schemas/auth.ts:14,22` — sign-up password is `.min(8).max(200)`.
- `apps/web/src/lib/schemas/setup.ts:27-40` — setup password is `.min(12).max(200)` + upper/lower/digit refine.
- `SignUpForm` renders a strength meter (`apps/web/src/components/screens/auth/SignUpForm.tsx:55-65`) but does not block weak passwords. Either strengthen sign-up to match setup, or document the asymmetry. The current state confuses users: the meter says "Weak" and the form still submits.

**MED-08 — `AdminLayout` 403 surface hardcodes English copy.**
- `apps/web/src/app/(admin)/layout.tsx:16-28` — `<h1>403 — Forbidden</h1>` and the descriptive `<p>` are English literals. Should route through `useTranslation` / server i18n like every other surface. Constitutional rule says EN + RU minimum from day one for user-visible copy.

**MED-09 — Hardcoded English `aria-label` attributes.**
- `apps/web/src/components/screens/AppShell.tsx:56` — `aria-label="Primary"`
- `apps/web/src/components/screens/AdminShell.tsx:43` — `aria-label="Admin"`
- `apps/web/src/components/screens/notes/FoldersSidebar.tsx:52` — `aria-label="Folders"`

Screen readers in `ru` locale will announce English.

**MED-10 — `ErrorBoundary` fallback uses hardcoded English.**
- `apps/web/src/lib/error-boundary.tsx:51-57` — "Something went wrong", "An unexpected error occurred", "Retry". The L9-12 comment justifies this ("stays useful when i18next failed to load"), which is a defensible design choice — but it should still surface a static `ru` variant via `navigator.language` rather than EN-only. Document the tradeoff in DISCIPLINE notes if accepted as-is.

**MED-11 — `DeleteAccountDialog` non-2xx path has no UI feedback.**
- `apps/web/src/components/screens/account/DeleteAccountDialog.tsx:59-62` — comment says "Stay open on error" but no error Alert is rendered; the user clicks "Delete" and sees nothing. Add a destructive Alert above the input on `res.ok === false`.

**MED-12 — `language-switcher.tsx` silently swallows fetch failures.**
- `apps/web/src/components/screens/language-switcher.tsx:32-39` — `await fetch("/api/locale", ...); router.refresh()`. If the POST fails (5xx, network), the cookie is never set but `router.refresh()` still runs; the user clicks "Русский" and nothing changes. Render a toast on failure.

### LOW

**LO-01 — `SetupForm.errorKind: "duplicate"` is declared and never set.**
- `apps/web/src/components/screens/auth/SetupForm.tsx:56,197-199` — only `"generic"` is ever set. Duplicate-admin (409 race-loser) falls into the generic copy instead of the dedicated `error.duplicate.*` keys (the keys may not exist, in which case remove the type member entirely).

**LO-02 — `passwordStrength` returns score 1 for empty string.**
- `apps/web/src/components/screens/auth/SignUpForm.tsx:55-65` — `if (s <= 1) return weak`. An empty password renders a red "Weak" band before the user has typed anything, which is misleading. Special-case `value.length === 0 → null/hidden`.

**LO-03 — `auth-actions.ts:27-31` POSTs to sign-out with `content-type: application/json` and no body.**
- Fastify's JSON parser may 400 on empty body + json content-type (`FST_ERR_CTP_EMPTY_JSON_BODY`) — the same class of bug fixed in `DeleteAccountDialog` per the 55-01-b commit. Verify the `/api/auth/sign-out` route accepts this combination; if not, drop the content-type header. Currently unreachable (dead code per MED-05), but worth fixing before any caller wires it up.

**LO-04 — `(auth)/layout.tsx` redirects to `/sign-in` without `?from=`.**
- `apps/web/src/app/(auth)/layout.tsx:23` — only fires when middleware sees a cookie but the upstream session is invalid (race after sign-out, cookie tamper). Deep-link is lost in that narrow case. Acceptable.

**LO-05 — `resolveLocale` exported only for tests.**
- `apps/web/src/middleware.ts:111` — `export function resolveLocale`. Only consumed inside `middleware.ts` for the runtime path; the export exists so tests can introspect it. LOCKER-04 borderline; document why with a `@public-for-test` annotation.

**LO-06 — Hardcoded marketing/repo URLs in `AuthShell`.**
- `apps/web/src/components/screens/auth/AuthShell.tsx:69,77,85` — `https://github.com/openwhispr/openwhispr-server*` literals. Move to a constants module so a fork doesn't have to grep-and-replace.

**LO-07 — `middleware.ts:117` uses `as unknown as string[]`.**
- Library type-narrowing escape hatch. LOCKER-02 borderline (no `issue-NNNN` comment). Acceptable, but add a brief comment.

**LO-08 — `auth-client.ts:77` uses `as unknown as ExtendedAuthClient`.**
- Documented (L34-46) as the centralisation of Better Auth runtime-Proxy methods. Worth adding an `issue-NNNN: better-auth-typing` reference per LOCKER-02 spec.

**LO-09 — `form-utils.ts:33-35` chains `as any` + `as unknown as`.**
- Documented (L30-31) as zodResolver generic-narrowing. Same LOCKER-02 documentation comment improvement.

---

## Dead code

- `apps/web/src/lib/auth-actions.ts:24` — `signOutAction()` server action exported, zero non-test importers.
- `apps/web/src/lib/axe-baseline.ts` — test-only helper living under production source.
- `apps/web/src/components/screens/auth/SignUpForm.tsx` — `ErrorKind = "duplicate"` member of the discriminated union is declared and never set (`setErrorKind` is called with `"generic"` or `null` only); the `error.duplicate.*` rendering branch is unreachable. Same dead branch in `SetupForm.tsx:56` (LO-01).

No other dead exports detected. Page components under `app/**` are App Router route entries (skipped per checklist).

## Suppressed warnings

All justified inline; none hide an obvious real bug:

- `apps/web/src/middleware.ts:117` — `as unknown as string[]` for `acceptLanguageParser.pick` (library typing escape). LOW.
- `apps/web/src/lib/form-utils.ts:33-35` — `as any` + `as unknown as Resolver<Values>` for zodResolver generic boundary. Documented L30-31. LOW.
- `apps/web/src/lib/auth-client.ts:77` — `as unknown as ExtendedAuthClient` for Better Auth runtime-Proxy methods. Documented L34-46. LOW.
- `apps/web/src/components/screens/auth/useAuthProviders.ts:70` — `biome-ignore lint/suspicious/noConsole` — intentional observability hook. Justified.
- `apps/web/src/lib/error-boundary.tsx:38` — `biome-ignore lint/suspicious/noConsole` — error-boundary fallback log. Justified.
- `apps/web/src/components/screens/usage/UsageDashboardClient.tsx:65`, `notes/NotesListClient.tsx:206,209`, `transcriptions/TranscriptionsListClient.tsx:134,137`, `transcriptions/TranscriptionDetailClient.tsx:249`, `conversations/ConversationsListClient.tsx:111,114`, `conversations/ConversationsSearchClient.tsx:112`, `account/SessionsTable.tsx:115,118` — `biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, stable count`. Justified.

## Hardcoded i18n strings (user-visible)

- `apps/web/src/app/(admin)/layout.tsx:19-25` — `<h1>403 — Forbidden</h1>` + descriptive paragraph (entire `AdminForbidden` component).
- `apps/web/src/lib/error-boundary.tsx:51-57` — "Something went wrong", "An unexpected error occurred while rendering this page.", "Retry".
- `apps/web/src/components/screens/AppShell.tsx:56` — `aria-label="Primary"`.
- `apps/web/src/components/screens/AdminShell.tsx:43` — `aria-label="Admin"`.
- `apps/web/src/components/screens/notes/FoldersSidebar.tsx:52` — `aria-label="Folders"`.
- `apps/web/src/components/screens/auth/AuthShell.tsx:50` — `W` logo glyph (design intentional, but worth keying for forks).
- `apps/web/src/components/screens/auth/AuthShell.tsx:66` — `v1.0.4` (also MED-06).

No Cyrillic or other-locale literals leaked into source (the `tools/lint-english.ts` scanner remains clean).

---

_Generated 2026-05-20 against `apps/web/src/**` at branch main HEAD `6e43588`. Review describes only; no fixes applied._
