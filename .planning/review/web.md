# Review: web
Branch: main @ 13f0864
Files reviewed: 60 production source files under `apps/web/src/{app,components,lib,locales}` plus `middleware.ts` and `next.config.ts`

## Summary
- CRITICAL: 3 / HIGH: 6 / MEDIUM: 7 / LOW: 6
- Top 3 production risks before first public GitHub release:
  1. **Better Auth session token serialized into RSC payload of `/app/account`.** Server reads the HttpOnly cookie, extracts `session.session.token`, and passes it as a plaintext `currentSessionToken` prop down to `AccountClient` → `SessionsTable` (rendered into HTML / `__NEXT_DATA__`). This defeats the entire purpose of Better Auth's HttpOnly cookie strategy — any script in the page (XSS, browser extension, or a future `unsafe-inline` payload — see #2) can read the live session token from `window`/the DOM and replay it. Worse, the full list of *every* active session token across all the user's devices is also flowed through `listSessions()` to the client and stored in TanStack Query cache.
  2. **CSP allows `'unsafe-inline'` for `script-src` on EVERY route — including `/sign-in`, `/sign-up`, `/verify-email`, `/app/*`, `/admin/*`.** `next.config.ts:31-51` documents the deviation as Phase 07.1 / Plan 13 technical debt. Any reflected-XSS sink (e.g. via the existing leak vector in #1 + a future bug) executes unimpeded. Combined with the session-token-in-RSC issue, this is the single largest production risk in the web tier.
  3. **`/admin/*` auth model is structurally fragile.** `checkAdminAccess(session)` returns `"allow"` for `session === null` — and `getServerSession()` returns null on *any* failure (network blip, malformed cookie, upstream 5xx, fetch reject). A forged/expired/invalid session cookie therefore bypasses the role check and falls through to Traefik basic-auth. In the OSS quickstart (single-host docker-compose), if the operator does not configure `ADMIN_BASIC_AUTH_USERS` correctly — or runs `docker compose up` before reading the docs — `/admin/*` is reachable by *any unauthenticated visitor*. The depth check exists but is gated on a value (session presence) that the attacker controls.

## Findings

### [CRITICAL] CR-01: Better Auth session token leaked from RSC into client bundle / DOM

**Files:**
- `apps/web/src/app/(auth)/app/account/page.tsx:27`
- `apps/web/src/components/screens/account/AccountClient.tsx:30,42,93`
- `apps/web/src/components/screens/account/SessionsTable.tsx:53-56,172`

**Issue:** The RSC reads `session.session.token` (the canonical Better Auth bearer for that session row) and passes it as a plain prop into the `"use client"` subtree:

```ts
// account/page.tsx
const currentSessionToken = (session.session.token as string | undefined) ?? null;
return <AccountClient currentSessionToken={currentSessionToken} user={user} />;
```

That string is serialized into the streamed RSC payload (visible in page source / `__NEXT_DATA__` / `self.__next_f.push(...)`) and is then live in the JavaScript heap inside `SessionsTable` until the page unmounts. The HttpOnly cookie that Better Auth ships exists precisely to keep that token out of JS-readable surfaces (D-SEC-2 comment in `auth-client.ts:17` even calls this out — "NO localStorage; Better Auth uses HttpOnly cookies"). This implementation bypasses that protection.

Compounding the leak: `listSessions()` returns *every active session's `row.token`* to the client (used at line 193, `revokeOne.mutate(row.token)`). So an attacker with a foothold (XSS, malicious browser extension) does not just grab the current session — they grab a list of every device the user is signed in on, with a working bearer for each.

Note `unsafe-inline` CSP (CR-02) means a single reflected-XSS sink anywhere in the app drains all of the user's session tokens.

**Fix:** Do NOT pass the session token to the client. The "this device" badge can be flagged server-side: in the RSC, call `listSessions()` server-to-server, mark which row matches the current request's session row by ID (not token), and pass only `{ id, isCurrent: boolean }` plus the rendered metadata down to the client. For revocation, expose a server action that takes `sessionId` and lets Better Auth look up the token server-side from the authenticated session. If the Better Auth API genuinely requires the token client-side, document the threat model explicitly and rotate to a per-request CSRF-bound revoke API.

---

### [CRITICAL] CR-02: CSP `script-src 'unsafe-inline'` shipped on every route

**File:** `apps/web/src/next.config.ts:31-51`

**Issue:** Both `STRICT_AUTH_CSP` (sign-in / sign-up / verify-email) and `APP_CSP` (everything else) include `script-src 'self' 'unsafe-inline'`. The inline comment (lines 19-26) acknowledges this is a deviation pending per-request nonces but ships the weak policy anyway. As-shipped, the OpenWhispr web tier provides no script-injection mitigation beyond `frame-ancestors 'none'` and `X-Content-Type-Options: nosniff`. Combined with the session-token surface in CR-01, this is the single largest attack-surface increase relative to "what shadcn/Next.js gives you out of the box."

**Fix:** Implement the documented nonce migration. Next.js 15 supports per-request CSP nonces via middleware (`headers().get('x-nonce')` + `Script` component `nonce` prop). Move CSP to middleware so every response carries a fresh `script-src 'self' 'nonce-<base64>'` value, and remove `'unsafe-inline'`. Until that lands, at minimum the public release notes must surface this so operators can decide whether to front the surface with an external WAF.

---

### [CRITICAL] CR-03: `/admin/*` auth bypass when `getServerSession()` returns null

**Files:**
- `apps/web/src/lib/admin-guard.ts:38-43`
- `apps/web/src/lib/auth-server.ts:67-85`
- `apps/web/src/app/(admin)/layout.tsx:44`

**Issue:** `checkAdminAccess`:
```ts
if (session === null) return "allow";        // <-- bypass
const role = (session.user as { role?: unknown }).role;
if (role === "admin") return "allow";
return "forbidden";
```

`getServerSession()` returns `null` on every error path: missing cookie, non-2xx upstream, fetch rejection, JSON parse failure, malformed body. That means an attacker who can disturb the api→web HTTP path (network blip, transient 502, container restart race) or who simply visits `/admin/*` with no cookie at all is *allowed through the application gate*. The doc comment frames this as an operator-runbook concession ("ops engineer with basic-auth credentials but no OpenWhispr account"), but in the OSS quickstart on a fresh `docker compose up` without operator-side Traefik basic-auth applied, this means `/admin/observability` and `/admin/config` are world-reachable. ConfigClient pulls `/api/stt-config` and `/api/note-recording-config` and would expose them to whoever lands on the page.

There is no test that asserts `ADMIN_BASIC_AUTH_USERS` is non-empty at boot, no startup-time refusal-to-serve, and no documentation link from the README to the runbook step that wires basic-auth into Traefik.

**Fix:**
1. Flip the default: `checkAdminAccess(null)` should return `"forbidden"`, not `"allow"`. The ops-engineer-without-OpenWhispr-account flow should authenticate (Traefik basic-auth issues a Set-Cookie that creates a session) or get a dedicated `OPS_BYPASS=1` env that toggles the null branch explicitly.
2. Add a boot-time check in the api / web that refuses to start without an admin authentication mode configured (basic-auth in Traefik OR an OpenWhispr admin role).
3. Add an e2e test that boots the stack WITHOUT basic-auth and asserts `/admin/*` returns 401/403 to anonymous visitors.

---

### [HIGH] HI-01: Server-Action `signOutAction` lacks any CSRF token / origin check

**File:** `apps/web/src/lib/auth-actions.ts:29-41`

**Issue:** Next.js Server Actions are POSTed to the same origin and Next.js performs its own origin-allowlist check internally — but the upstream `apps/api` sign-out is invoked with the user's cookie attached and no CSRF token of its own. If `next.config.ts` is later configured with custom `allowedOrigins` or if a future refactor exposes the action over a non-RSC endpoint, the server-side cookie-only auth would leave it CSRF-able. There is no defence in depth (CSRF token, double-submit cookie, custom header check).

**Fix:** Use `authClient.signOut()` from a client component on a click handler instead of a Server Action (Better Auth's client lib enforces its own SameSite/CSRF guarantees), OR add an explicit `same-origin` Origin/Referer assertion at the top of `signOutAction`. Reference `headers().get('origin')` against an allowlist before forwarding the cookie.

---

### [HIGH] HI-02: Hardcoded English strings outside locale files — 8+ user-visible sites

**Files (literal text → suggested key):**
- `apps/web/src/components/screens/AdminShell.tsx:38` — `"OpenWhispr — Admin"`
- `apps/web/src/components/screens/AdminShell.tsx:63` — `"Admin mode"`
- `apps/web/src/components/screens/AppShell.tsx:51` — `"OpenWhispr"` (sidebar header)
- `apps/web/src/components/screens/auth/AuthShell.tsx:54` — `"OpenWhispr Server"`
- `apps/web/src/components/screens/account/SessionsTable.tsx:183` — `"this device"` badge
- `apps/web/src/components/screens/account/DeleteAccountDialog.tsx:102` — `<AlertDialogCancel>Cancel</AlertDialogCancel>`
- `apps/web/src/components/screens/notes/NotesListClient.tsx:267` — `<AlertDialogCancel>Cancel</AlertDialogCancel>`
- `apps/web/src/components/screens/notes/NoteDetailClient.tsx:254` — `<AlertDialogCancel>Cancel</AlertDialogCancel>`
- `apps/web/src/components/screens/transcriptions/TranscriptionDetailClient.tsx:234` — `<AlertDialogCancel>Cancel</AlertDialogCancel>`
- `apps/web/src/components/screens/transcriptions/TranscriptionsListClient.tsx:243` — `Cancel`
- `apps/web/src/components/screens/conversations/ConversationsListClient.tsx:212` — `Cancel`
- `apps/web/src/components/screens/conversations/ConversationDetailClient.tsx:227` — `Cancel`
- `apps/web/src/components/screens/notes/NotesSearchClient.tsx:158` — `"(untitled)"` (rendered for results without titles)
- `apps/web/src/components/screens/admin/ConfigClient.tsx:247` — `"Yes"` / `"No"` for diarization badge
- `apps/web/src/lib/error-boundary.tsx:51-57` — `"Something went wrong"`, `"An unexpected error occurred while rendering this page."`, `"Retry"`

`apps/web/src/locales/{en,ru}/common.json` already define `common.cancel.label` ("Cancel" / "Отмена") — the literals are simply not wired up. For a Russian user, every confirmation dialog mixes Russian labels with an untranslated "Cancel" button.

**Fix:** Replace each literal with `t("common.cancel.label")` / dedicated keys; add `account.sessions.thisDevice.label`, `admin.shell.title.label`, `admin.shell.mode.label`, `app.shell.title.label`, `auth.shell.title.label`, `notes.untitled.label`, `admin.config.note.yesno.{yes,no}.label`, `error.boundary.{title,body,retry}.label` to both locales. The error-boundary case is justifiable as a defence-against-i18n-chunk-failure (comment at line 11-12), but should still be reviewed.

---

### [HIGH] HI-03: `process.env.INTERNAL_API_URL` default falls back to `http://api:3000` plaintext — six sites

**Files:**
- `apps/web/src/lib/auth-server.ts:47-52`
- `apps/web/src/lib/auth-actions.ts:22-27`
- `apps/web/src/app/(auth)/app/page.tsx:16-21`
- `apps/web/src/app/(auth)/app/notes/page.tsx:14-19`
- `apps/web/src/app/(auth)/app/transcriptions/page.tsx:14-19`
- `apps/web/src/app/(auth)/app/conversations/page.tsx:14-19`
- `apps/web/src/app/(auth)/app/conversations/[id]/page.tsx:17-22`

**Issue:** Each file duplicates the identical helper:
```ts
const DEFAULT_INTERNAL_API_URL = "http://api:3000";
function internalApiUrl(): string {
  const raw = process.env.INTERNAL_API_URL;
  return raw && raw.length > 0 ? raw : DEFAULT_INTERNAL_API_URL;
}
```

Three problems:
1. **Plaintext HTTP default** — CLAUDE.md says "HTTPS only: never plaintext HTTP on any externally reachable port." The `http://api:3000` default is intended for the internal docker network only, but the env-var-absent fallback means any deployment that fails to wire `INTERNAL_API_URL` *will* silently emit plaintext requests carrying the user's cookie. There is no boot-time refusal to start.
2. **DRY violation x7** — same constant in seven files; one operator-side rename (`API_INTERNAL_URL` typo) will silently desync, with no central place to fix.
3. **No URL validation** — if an operator sets `INTERNAL_API_URL=https://evil.example.com`, every authenticated RSC fetch forwards the user's session cookie to `evil.example.com`. There is no allowlist, no scheme check, no protection against accidental misconfiguration leaking credentials cross-origin.

**Fix:** Extract to a single `apps/web/src/lib/internal-api.ts` that (a) reads the env var, (b) refuses-to-start if missing in production, (c) validates the URL is `http://`-only-in-docker-network OR `https://`, (d) is mocked at test boundary. Replace every duplicated helper with the central import.

---

### [HIGH] HI-04: `<a href={loki}>` etc. trust unvalidated `NEXT_PUBLIC_*_BASE_URL` env values

**File:** `apps/web/src/components/screens/admin/ObservabilityClient.tsx:154-191`

**Issue:** The `loki`, `mimir`, `tempo`, `grafana` values come from `NEXT_PUBLIC_*_BASE_URL` env vars and are passed directly to `<a href={loki}>`. If an operator (or attacker who controls the build environment, e.g. compromised CI) sets `NEXT_PUBLIC_LOKI_BASE_URL=javascript:alert(1)`, the resulting HTML is `<a href="javascript:alert(1)">` — clicking it executes JS in the admin's origin. CSP `unsafe-inline` does not block `javascript:` URLs.

NEXT_PUBLIC envs are baked at build time so this is not a runtime injection, but it's still a defence-in-depth gap: there is zero validation on a value that flows directly into an HTML attribute on the admin surface.

**Fix:** `function safeUrl(value: string | undefined, fallback: string): string { if (!value) return fallback; try { const u = new URL(value); if (!['http:','https:'].includes(u.protocol)) return fallback; return u.toString(); } catch { return fallback; } }`. Apply to all four env reads.

---

### [HIGH] HI-05: `<a className="hover:underline" href={`/app/notes/${row.id}`}>` — no schema validation on `row.id`

**File:** `apps/web/src/components/screens/notes/NotesSearchClient.tsx:157`

**Issue:** The API response payload is typed as `CloudNote` and `row.id` is treated as a trusted string. If the upstream API ever returns a malformed id containing `../../../admin` or javascript-protocol fragments, the link substitutes them in. Same pattern repeats in `ConversationsListClient` and similar lists. Risk is low because the API is server-controlled, but the wire-schemas validation is not enforced at the client boundary.

**Fix:** Validate the API response with `zod` (the project already uses zod + `packages/wire-schemas`). Reject responses that don't parse and render the error state.

---

### [HIGH] HI-06: `OidcButtons` and similar use `as unknown as { social: ... }` to extend Better Auth types

**Files:**
- `apps/web/src/components/screens/auth/SignInForm.tsx:70-80,110-114`
- `apps/web/src/components/screens/auth/OidcButtons.tsx:57-59`
- `apps/web/src/components/screens/auth/VerifyEmailClient.tsx:82-87`

**Issue:** Each call site casts `authClient.signIn` / `authClient` through `as unknown as <inline-type>`. This pattern violates `CLAUDE.md` engineering discipline rule 12 ("No type-suppression. `as any`, `as unknown as`, ... are REFUSED in production code"). The comment in `auth-client.ts:33-42` already documents that the runtime surface includes methods not in the inferred type — and provides one cast (`ExtendedAuthClient`) for `deleteAccount`. The remaining four call sites should be unified through the same extension type rather than re-casting at every call site.

Additionally, the project linter `tools/lint-no-suppressions.ts` (LOCKER-02) should be catching these. If it is allowlisting them, the allowlist needs review; if it isn't, the linter is missing these. CLAUDE.md says "Allowlist exists for pre-existing debt; net additions REFUSE the PR" — these may have grown unchecked.

**Fix:** Extend `ExtendedAuthClient` in `auth-client.ts` with the full set of methods actually consumed (`signIn.email`, `signIn.social`, `sendVerificationEmail`, `verifyEmail`). Replace every inline `as unknown as` with a clean `authClient.signIn.email(...)` call against the strengthened type.

---

### [MEDIUM] MD-01: `NotesListClient`, `TranscriptionsListClient` etc. force `useState`-driven `searchParams` into URL without server-side sanitization

**File:** `apps/web/src/components/screens/notes/NotesListClient.tsx:148`, `NotesSearchClient.tsx:71`

**Issue:** `router.push(`/app/notes/search?q=${encodeURIComponent(q)}`)` — the encoding is correct, but the receiving page just consumes `searchParams.get("q")` and passes it to a POST body. No length cap (a 1MB string would still encode and hit the API). The API likely caps it but the client should also bound it.

**Fix:** Cap `q` length to ~512 chars on the client before issuing the navigation.

---

### [MEDIUM] MD-02: `client-fetch.ts` echoes `detail.slice(0, 200)` from upstream response into thrown `Error.message`

**File:** `apps/web/src/lib/client-fetch.ts:60-68`

**Issue:** When an API call returns non-2xx, the thrown Error includes `body=${detail.slice(0, 200)}`. If the upstream response body contains an internal-error message that includes a secret-shape (api key in a stack trace, cookie value in a debug echo), the secret transits into `Error.message` and through React Query's error reporting → potentially into telemetry/Sentry/console. CLAUDE.md LOCKER-05 / LOCKER-08 invariants for error secret truncation apply to *production* `Error` subclasses; this is a thrown vanilla `Error`, so it bypasses LOCKER-05 — but the same risk pattern exists.

**Fix:** Either drop the body from the Error message entirely (status code + URL is enough) or redact known secret-shapes (`Bearer ...`, `sk-...`, etc.) before slicing.

---

### [MEDIUM] MD-03: `console.warn` / `console.error` in production code without operator-controlled toggle

**Files:**
- `apps/web/src/components/screens/auth/useAuthProviders.ts:71`
- `apps/web/src/lib/error-boundary.tsx:39`

**Issue:** Both sites use `biome-ignore lint/suspicious/noConsole` to ship console output to production. The comments justify them ("fail-closed observability hook", "best-effort console logging only — production telemetry routes through the OTel browser SDK in a later plan"), but if the upstream error object contains user data or cookie shapes, it lands in the browser console where any user can see it. For an enterprise self-hosted product, leaking internal error structures via `console.error` is a low-grade information disclosure.

**Fix:** Replace with a stub `report(error)` function that no-ops in production until the OTel browser SDK lands. Once OTel browser SDK is wired (later plan), route through that.

---

### [MEDIUM] MD-04: `setBefore` / pagination state in `ConversationDetailClient` accumulates indefinitely; no cap

**File:** `apps/web/src/components/screens/conversations/ConversationDetailClient.tsx:80`

**Issue:** `olderPages` is a `useState<CloudMessage[]>` that grows unbounded as the user clicks "Load earlier messages." For long conversations (10k+ messages) the user can eventually exhaust browser memory by repeatedly clicking. No load cap, no virtualisation.

**Fix:** Either cap accumulated pages (e.g. 10 × 50 = 500 max in DOM) or virtualise the list (react-virtual / TanStack Virtual).

---

### [MEDIUM] MD-05: `setupSchema` posts `password` over `fetch('/api/setup/admin')` without explicit `credentials: 'same-origin'` (browser default works, but contract not enforced)

**File:** `apps/web/src/components/screens/auth/SetupForm.tsx:167-171`

**Issue:** `fetch('/api/setup/admin', { method, headers, body })` does not pass `credentials`. Browser default is `same-origin` which works, but the contract isn't pinned by code — a future refactor that adds explicit `credentials: 'omit'` would silently drop the user's CSRF-protective cookie path. Compare to `useAuthProviders.ts:60` which explicitly opts out (`credentials: 'omit'`).

**Fix:** Always pass an explicit `credentials` field at every `fetch()` call site, or migrate every call through `clientFetch()` (which already does this).

---

### [MEDIUM] MD-06: `MessageBubble.ROLE_LABEL_KEY[role] ?? ROLE_LABEL_KEY.user!` swallows unknown roles silently

**File:** `apps/web/src/components/screens/conversations/MessageBubble.tsx:33-35`

**Issue:** If the API ever returns a role outside `user|assistant|system|tool`, the message renders as a "user" message (right-aligned, accented). This silently misattributes assistant output as user input — bad for trust, particularly in a chat UI. Also the non-null assertion `!` is the kind of suppression CLAUDE.md flags.

**Fix:** Render unknown roles with a neutral "unknown" label and a distinct visual treatment. Drop the non-null assertion by setting a default via `??`.

---

### [MEDIUM] MD-07: Disabled (`test.skip(true, ...)`) e2e tests without a tracking issue

**Files:**
- `apps/web/tests/e2e/u-setup.spec.ts:21`
- `apps/web/tests/e2e/auth-shell-visual.spec.ts:61`

**Issue:** Two `test.skip(true, "setup already completed — ...")` patterns conditionally skip when the test environment is in a particular state. Both messages indicate a real test-isolation gap (setup is not reset between runs), not a planned skip. CLAUDE.md mandates "strict TDD" and "maximum test automation."

**Fix:** Make the test fixture reset setup state before each spec instead of skipping. Tracked in `.planning/deferred-items.md` if reset is non-trivial.

---

### [LOW] LO-01: `auth-server.ts` cookie-cache caveat documented but mitigation deferred

**File:** `apps/web/src/lib/auth-server.ts:21-29`

**Issue:** The comment block describes a real Better Auth bug (better-auth#7008 — cookie cache can return null in RSC) and concludes "Mitigation deferred — flag for the verifier and Plan 07 (sign-in flow) e2e." Two phases later this is still deferred.

**Fix:** Add an e2e regression that asserts RSC session resolution does not return null after a sign-in. If the bug ever surfaces, the test will catch it.

---

### [LOW] LO-02: Duplicate `useMutation` patterns across all detail screens

**Files:** `NoteDetailClient.tsx`, `TranscriptionDetailClient.tsx`, `ConversationDetailClient.tsx`

**Issue:** Identical delete-mutation patterns (use clientFetch → invalidate list → router.push back to list) are duplicated three times.

**Fix:** Extract a `useDeleteEntity({ endpoint, listQueryKey, redirectTo })` hook.

---

### [LOW] LO-03: `findNoteByPaging` / `findTranscriptionByPaging` are advertised as Branch B with a 250-row cap

**Files:**
- `apps/web/src/components/screens/notes/NoteDetailClient.tsx:72-89`
- `apps/web/src/components/screens/transcriptions/TranscriptionDetailClient.tsx` (similar)

**Issue:** The "list-then-filter" workaround is documented but a user with ≥250 notes will get a false "not found" for older items. The fix is a real `GET /api/notes/:id` endpoint. Tracked in Phase 7.x backlog per the comment.

**Fix:** Ship the upstream endpoint and switch to direct fetch.

---

### [LOW] LO-04: `passwordStrength` heuristic is naive (4 boolean signals, no zxcvbn)

**File:** `apps/web/src/components/screens/auth/SignUpForm.tsx:54-64`

**Issue:** `length≥12 + has-upper + has-digit + has-symbol` rates `Aaaaaaaaaaa1!` as "strong" — clearly weak. Industry standard is zxcvbn (already widely used) but the comment cites D-44 ("no new top-level deps") as the reason for the inline helper. The cost-benefit is debatable: zxcvbn ships in ~30kB gzipped, which is small for a security-critical heuristic.

**Fix:** Either keep but acknowledge limitation in inline label ("approximate") or revisit D-44 for this one case.

---

### [LOW] LO-05: `SetupForm` `defaultTimezone()` and `listTimezones()` carry `/* v8 ignore start */` blocks for "ancient runtimes" — but the fallback never includes UTC offset names properly

**File:** `apps/web/src/components/screens/auth/SetupForm.tsx:66-97`

**Issue:** Fallback list `["UTC", "Europe/London", "Europe/Berlin", "Europe/Moscow", "America/New_York"]` is biased toward operator origin. Users in Asia/Australia/SAm get a confusing default. The v8-ignore blocks also mean the fallback is untested.

**Fix:** Drop the fallback (Node 24 + evergreen browsers always have `Intl.supportedValuesOf`); the v8-ignore is masking the fact that the fallback is never exercised. If you must keep it, expand to the full IANA list.

---

### [LOW] LO-06: `ConfigClient` Skeleton table renders empty `<TableHead>` cells via `{/* labels */}` comments

**File:** `apps/web/src/components/screens/admin/ConfigClient.tsx:154-156, 207-209`

**Issue:** `<TableHead className="w-1/2">{/* labels */}</TableHead>` renders a visually empty cell that screen readers will announce as a blank column header. Accessibility regression.

**Fix:** Either add an `aria-label` for the column or use a `<caption>` describing the table, or render visible labels.

---

## Dead code

No completely-unused exported components found in the production surface; every component under `apps/web/src/components/screens/**` has at least one importer in `apps/web/src/app/**` or one of its sibling tests, and shadcn UI primitives are all consumed.

`apps/web/src/lib/axe-baseline.ts` exports `compareOrWriteBaseline` and is consumed only by tests; this is acceptable (it's a test helper that lives in `src/` for shared import-from-vitest-fixtures convenience).

## Suppressed warnings

Five `as unknown as` casts in production code (HI-06 above). Two `biome-ignore lint/suspicious/noConsole` directives (MD-03 above). Skeleton placeholder `biome-ignore lint/suspicious/noArrayIndexKey` directives (~6 sites) are justified (stable count, no mutation) and not flagged.

No `@ts-ignore`, `@ts-nocheck`, `as any`, or `eslint-disable` in production code outside tests. The `@ts-expect-error issue-NNNN:` convention is respected throughout.

## Notes

- `apps/web/src/middleware.ts:60` uses `as unknown as string[]` — exempted in HI-06 above as a tightly-scoped local cast for `acceptLanguageParser.pick`'s typing gap.
- `apps/web/src/app/(public)/verify-email/page.tsx` correctly validates the `?token=` query param against a `z.string().min(1).max(512).regex(/^[A-Za-z0-9._-]+$/)` schema BEFORE passing to the client component — the documented reflected-XSS defence. This is well-executed.
- `apps/web/src/components/screens/auth/SignInForm.tsx:87,97` correctly hardcodes the post-signin redirect to `/app` and explicitly comments that `?next=` is never read — open-redirect mitigation is well-documented.
- `apps/web/src/components/screens/auth/SetupForm.tsx:178` similarly hardcodes the post-setup redirect to `/admin`.
- No `dangerouslySetInnerHTML` usages found in `apps/web/src/`. Good.
- No `localStorage` / `sessionStorage` writes outside the theme-provider (theme is explicitly allowed by D-SEC-2). No auth tokens or PII stored client-side.
- No bare `document.cookie` reads on auth cookies (the only `document.cookie` usage is none — all auth state flows through HttpOnly cookies via Better Auth).
- No `t(userInput)` patterns; all i18n keys are static literals.
- The middleware matcher `["/((?!_next/|favicon|.*\\..*).*)"]` is correctly written; no path-traversal bypass surface.
- en/ru locale parity verified by jq path-diff: zero divergence in `common.json`, `admin.json`, `end-user.json` namespaces — except that `end-user.json` has 882 lines in ru vs 880 in en (minor: likely formatting/trailing-newline; not a missing-key gap).
- `next.config.ts` includes `frame-ancestors 'none'`, `X-Frame-Options: DENY`, HSTS with `preload`, Referrer-Policy `strict-origin-when-cross-origin`, Permissions-Policy disabling camera/mic/geo/FLoC — these are correctly tightened.
