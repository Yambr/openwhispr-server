# Review: web (apps/web)

Branch: main @ 1832f28
Scope: apps/web/src/**

## Summary
- Files reviewed: ~55 production source files under `apps/web/src/{app,components,lib}`, `middleware.ts`, `next.config.ts` (tests not adversarially reviewed but skip-scanned).
- Findings: CRITICAL=0 HIGH=2 MEDIUM=5 LOW=4
- Top 3 production risks before public GitHub release:
  1. **Admin surface has zero application-level auth.** `app/(admin)/layout.tsx` ships with no session/role gate and ConfigClient hits `/api/stt-config` + `/api/note-recording-config` with `credentials: "include"` from the browser. The only gate is Traefik basic-auth (D-ADMIN-1), and `next.config.ts` does NOT itself enforce this. Self-hosters who copy the repo without configuring Traefik basic-auth (the OSS quickstart scenario) will boot a wide-open `/admin/*` surface accessible to any signed-in user — or any anonymous visitor if the public host doesn't have the basic-auth middleware applied.
  2. **`PLAYWRIGHT_DISABLE_SSR_PREFETCH` test-only branch is shipped in five production RSC entries.** Five live `/app/*` page routes contain an `if (process.env.PLAYWRIGHT_DISABLE_SSR_PREFETCH === "1")` skip-prefetch escape hatch. The branch is dead code in prod, but the env var name is a runtime read — flip it accidentally (compose override, k8s ConfigMap typo) and SSR prefetch silently disappears, doubling perceived TTFB on the four busiest user routes. Test-only hooks should not be reachable from a production build.
  3. **CSP allows `'unsafe-inline'` for `script-src` on every route, with a TODO-deferred fix.** `next.config.ts:21-26` documents this as a Phase 07.1 / Plan 13 deviation pending per-request nonces. As-shipped to the public, the OpenWhispr server therefore has materially weaker XSS posture than the same surface served with a nonce-based CSP. Combined with the open `/admin/*` surface and `dangerouslySetInnerHTML` not being present (good), the risk is low but it's a documented technical debt that should at least be surfaced in release notes.

## Findings

### [HIGH] Admin layout enforces NO application-layer auth; relies entirely on operator Traefik config
- File: `apps/web/src/app/(admin)/layout.tsx:12`
- Category: Security (authentication bypass risk for misconfigured operators)
- Evidence:
  ```ts
  // NO session check here. Admin gating is performed at the Traefik edge via
  // basic-auth (D-ADMIN-1) — credentials are configured via the
  // ADMIN_BASIC_AUTH_USERS env variable on the web service.
  export default function AdminLayout({ children }: { children: ReactNode }): React.JSX.Element {
    return <AdminShell>{children}</AdminShell>;
  }
  ```
  Confirmed downstream: `app/(admin)/admin/page.tsx`, `.../config/page.tsx`, `.../observability/page.tsx` have no session gate either. The Edge middleware (`src/middleware.ts:76`) only gates `/app/:path*`, not `/admin/*`.
- Why it matters: For the public-release OSS quickstart, a single-VM `docker compose up` without an `ADMIN_BASIC_AUTH_USERS` value, or a misconfigured Traefik label, exposes `/admin/config` (operator STT/diarization endpoints) and `/admin/observability` (env-derived URLs into Grafana/Loki/Tempo/Mimir) to any visitor. The `ConfigClient` sends the browser cookie with `credentials: "include"`, so any signed-in user gains operator config visibility. Defense-in-depth would dictate an app-level role check even if Traefik is the canonical gate.
- Fix: Either (a) add a session+role check in `(admin)/layout.tsx` that 401s when the user is not an admin (defense in depth — Traefik gate remains primary), or (b) ship a startup assertion that fails-closed when `ADMIN_BASIC_AUTH_USERS` is unset in production NODE_ENV. Document the requirement loudly in `README` and `docker-compose.yml` comments, not just in the layout's source comment.

### [HIGH] Test-only env branch (`PLAYWRIGHT_DISABLE_SSR_PREFETCH`) shipped in five production RSC entries
- Files:
  - `apps/web/src/app/(auth)/app/page.tsx:36`
  - `apps/web/src/app/(auth)/app/notes/page.tsx:23`
  - `apps/web/src/app/(auth)/app/transcriptions/page.tsx:23`
  - `apps/web/src/app/(auth)/app/conversations/page.tsx:23`
  - `apps/web/src/app/(auth)/app/conversations/[id]/page.tsx:26`
- Category: Architecture cost / test scaffolding leaking into prod
- Evidence:
  ```ts
  function ssrPrefetchDisabled(): boolean {
    return process.env.PLAYWRIGHT_DISABLE_SSR_PREFETCH === "1";
  }
  if (!ssrPrefetchDisabled()) {
    await queryClient.prefetchQuery({ ... });
  }
  ```
- Why it matters: This is exactly the "test infrastructure invading production code" pattern called out in `CLAUDE.md > Hard Rules > 1`. A typo or stale compose override silently disables SSR prefetch on the four busiest authenticated routes — degrading user-perceived performance with no error signal. The escape hatch was added because Playwright `page.route()` cannot intercept RSC-side fetches; the proper fix is a Playwright-specific request fixture (e.g. point the API container at a deterministic mock), not a runtime branch in the production page module.
- Fix: Move the prefetch-disable branch behind a build-time flag (e.g. `process.env.NEXT_BUILD_PROFILE === "playwright"`) so the dead branch is tree-shaken out of the production build. Long-term, replace with Playwright fixtures that mock at the apps/api boundary (testcontainers / Wiremock) so RSC fetches see the same surface the browser would.

### [MEDIUM] Hardcoded English "Yes"/"No" in two user/admin-visible cells (i18n bypass)
- Files:
  - `apps/web/src/components/screens/admin/ConfigClient.tsx:247` — diarization-enabled badge
  - `apps/web/src/components/screens/usage/UsageDashboardClient.tsx:163` — limit-reached badge
- Category: i18n (project mandate: en+ru parity day one)
- Evidence:
  ```tsx
  {note.data.diarizationEnabled ? "Yes" : "No"}
  // ...
  {data.limitReached ? "Yes" : "No"}
  ```
  Every other label in both files uses `t(...)` — these two are the lone hardcoded English literals in user-facing JSX.
- Why it matters: Project memory and `CLAUDE.md` require runtime localization en+ru minimum. ru users see English "Yes"/"No" in a UI that is otherwise localized — small but a visible inconsistency that signals "untested ru path".
- Fix: Replace with `t("common.yes.label")` / `t("common.no.label")` (or per-screen namespaced keys) and add the keys to `locales/en/common.json` and `locales/ru/common.json`. Add a vitest assertion that scans `components/**/*.tsx` for raw JSX text containing only Latin letters as a regression gate.

### [MEDIUM] `next.config.ts` ships `script-src 'unsafe-inline'` site-wide as a known deferred-fix
- File: `apps/web/next.config.ts:19-45`
- Category: Security (CSP weakness; documented deviation)
- Evidence:
  ```ts
  // [...] Long-term we should switch to per-request nonces via
  // middleware (Next 15 supports this), but that requires a middleware-level
  // rewrite that is outside Plan 13's scope (Phase 07.1 / Plan 13 deviation —
  // Rule 1 fix: unblock hydration so e2e + cross-screen smoke can run).
  const STRICT_AUTH_CSP =
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    ...
  ```
- Why it matters: The "strict" CSP is the same as the app CSP on `script-src`. Public-release marketing of "enterprise-grade" CSP doesn't match the on-the-wire policy. The hydration unblock is a real Next.js 15 concern but the proper fix (nonce middleware, supported since Next 15) is unshipped. No XSS sink is currently present in the codebase, so live exploit risk is low — but the policy claim/implementation gap should be a public-release blocker if marketing leans on CSP.
- Fix: Implement nonce-based CSP via middleware. The pattern is documented in Next.js 15 docs (generate nonce per request, attach to RSC payload via `<Script nonce={...}>`). At minimum, file a tracked issue and remove "STRICT" from the constant name so future readers don't mistake it for actually strict.

### [MEDIUM] `package.json` lists `@hookform/resolvers` but `lib/form-utils.ts` requires a triple-cast through `as any → as unknown as Resolver` to satisfy TS — masks a type-mismatch
- File: `apps/web/src/lib/form-utils.ts:32-35`
- Category: Code quality (suppression masking version skew)
- Evidence:
  ```ts
  const resolver = zodResolver(
    // biome-ignore lint/suspicious/noExplicitAny: zodResolver generic boundary
    args.schema as any,
  ) as unknown as Resolver<Values>;
  ```
- Why it matters: `as any` + `as unknown as` is the textbook signature of resolved-by-cast version drift between `@hookform/resolvers`, `react-hook-form`, and `zod`. This is the constitutional anti-pattern (`feedback_no_workarounds_enterprise.md`). If any of the three packages bump major, the runtime behavior could change (zod v3 → v4 resolver shape) and TS will not catch it — the cast eats the signal.
- Fix: Pin compatible versions in `package.json` and replace the cast with the typed-resolver factory pattern from `@hookform/resolvers/zod` v3.10+, which accepts a generic. If a real version skew exists, surface it in `.planning/deferred-items.md`; do not paper over with `as any`.

### [MEDIUM] `verifyEmail` / `sendVerificationEmail` / `signIn.social` / `signIn.email` / `deleteAccount` cast through `as unknown as { ... }` — Better Auth typed surface bypassed in five places
- Files:
  - `apps/web/src/components/screens/auth/VerifyEmailClient.tsx:82`
  - `apps/web/src/components/screens/auth/SignInForm.tsx:70, 110`
  - `apps/web/src/components/screens/auth/OidcButtons.tsx:57`
  - `apps/web/src/lib/auth-client.ts:38-42` (ExtendedAuthClient cast for `deleteAccount`)
- Category: Code quality (suppression patterns at SDK boundary)
- Evidence: every call to Better Auth's plugin-exposed methods opens with `authClient.signIn as unknown as { email: (args: ...) => ... }`.
- Why it matters: Better Auth 1.6.9 exposes these methods at runtime via Proxy, and the inferred types only cover the plugin-keyed methods. The codebase compensates with five hand-rolled inline interface duplications. A Better Auth minor bump could change argument names (e.g. `rememberMe` → `remember`) and TS will silently accept — runtime will 400.
- Fix: Centralize the extended-client typing in `lib/auth-client.ts` (similar to existing `ExtendedAuthClient`) and re-export typed wrappers (`signInWithEmail`, `signInWithSocial`, `verifyEmail`, `sendVerificationEmail`). Consumers then import strongly-typed thin wrappers instead of recasting `authClient` per call site.

### [MEDIUM] `app/(public)/setup/page.tsx` resolves the setup-state URL from `OPENWHISPR_API_URL` or `NEXT_PUBLIC_API_BASE_URL` but every other RSC uses `INTERNAL_API_URL` with `"http://api:3000"` default — three env naming schemes for the same concept
- Files:
  - `apps/web/src/app/(public)/setup/page.tsx:48` — `OPENWHISPR_API_URL ?? NEXT_PUBLIC_API_BASE_URL`
  - `apps/web/src/app/(auth)/app/page.tsx:16-21`, `notes/page.tsx`, `transcriptions/page.tsx`, `conversations/page.tsx`, `conversations/[id]/page.tsx`, `lib/auth-actions.ts:22`, `lib/auth-server.ts:47` — `INTERNAL_API_URL` defaulting to `"http://api:3000"`
- Category: Architecture cost (config sprawl)
- Evidence: three different env names (`INTERNAL_API_URL`, `OPENWHISPR_API_URL`, `NEXT_PUBLIC_API_BASE_URL`) describe the same upstream — different RSC entries pick different envs.
- Why it matters: An operator setting `INTERNAL_API_URL` will see /app/* prefetch work but /setup boot-race silently fall back to `/api/setup-state` (relative). The `DEFAULT_INTERNAL_API_URL = "http://api:3000"` constant is also duplicated in 7 files instead of being imported from one module.
- Fix: Extract a single `lib/internal-api.ts` exporting `internalApiUrl()` and consume it everywhere, including `setup/page.tsx`. Document one canonical env var in README.

### [LOW] `dd>{watched.name || "—"}</dd>` em-dash literal repeated in SetupForm review section
- File: `apps/web/src/components/screens/auth/SetupForm.tsx:378, 380, 384, 388`
- Category: i18n hygiene (em-dash is universal but typographic punctuation policy varies; ru typography prefers — directly so OK here)
- Why it matters: borderline; flagging only because of the project's strict i18n policy. The em-dash placeholder is a "no value" sentinel — a localized "—" would be safer if some locale uses a different ellipsis convention.
- Fix: Replace with `t("common.no-value.label")` returning `"—"` (en) and the same character (ru).

### [LOW] Five files include a `console.warn` / `console.error` with biome-ignore — verify production observability is intentional, not a leftover
- Files: `apps/web/src/components/screens/auth/useAuthProviders.ts:71`, `apps/web/src/lib/error-boundary.tsx:39`
- Category: Code quality
- Evidence: both are documented intentional ("fail-closed observability hook"), but they ship to the production client bundle and surface in any user's DevTools console.
- Fix: Acceptable as-is; consider routing through a `lib/log.ts` indirection so future Sentry/OTel wiring is one-line.

### [LOW] AdminIndex/ConfigClient both render the same "Configuration" surface — minor duplication
- Files: `apps/web/src/components/screens/AdminIndex.tsx` and `apps/web/src/components/screens/admin/ConfigClient.tsx`
- Category: Code quality (intentional design boundary per AdminIndex.tsx:14-25 — env-LABELS only on index, values on /config) but the title heading + lede paragraph are duplicated visually. Operators clicking "Configuration" from /admin land on /admin/config which re-renders the title. Borderline; flagging for design review.
- Fix: Either remove AdminIndex's "Configuration" framing or rename the index card to "Overview".

### [LOW] `app/api/health/route.ts` returns 200 unconditionally — does not signal compose readiness
- File: `apps/web/src/app/api/health/route.ts:11`
- Evidence: Simple `return new Response("OK")`. The route file explicitly notes "no DB or upstream API check; the web tier is stateless".
- Why it matters: For docker-compose healthcheck this is fine; but combined with the boot-race in `app/(public)/setup/page.tsx` (which falls back to "initializing" copy when `/api/setup-state` 503s), a /healthz that returns OK before the API is ready means orchestrators promote a half-booted web container to "healthy" state. Documented design — note for OSS docs.

## Dead code
None found. AdminIndex, ConfigClient, ObservabilityClient, every screen and lib export traced to a consumer:
- `components/screens/AdminIndex.tsx` → imported by `app/(admin)/admin/page.tsx`
- All `components/screens/{auth,admin,notes,transcriptions,conversations,usage,account}/*.tsx` → imported by their respective RSC pages
- All `lib/*` modules have at least one importer
- `components/__tests__/conformance/__fixtures__/jsx-inventory.ts` is test fixture (out of scope for prod dead-code)

## Suppressed warnings
Inventory of all suppressions in production source (tests excluded):

| File | Line | Suppression | Justification | Verdict |
|---|---|---|---|---|
| `middleware.ts` | 60 | `as unknown as string[]` | converting readonly tuple to mutable string[] for accept-language-parser API | Benign |
| `components/screens/auth/VerifyEmailClient.tsx` | 82 | `authClient as unknown as { verifyEmail: ... }` | Better Auth Proxy method not in inferred types | See MEDIUM #6 |
| `components/screens/auth/SignInForm.tsx` | 70, 110 | `authClient.signIn as unknown as { email: ... }` and `authClient as unknown as { sendVerificationEmail: ... }` | same | See MEDIUM #6 |
| `components/screens/auth/OidcButtons.tsx` | 57 | `authClient.signIn as unknown as { social: ... }` | same | See MEDIUM #6 |
| `components/screens/auth/useAuthProviders.ts` | 70 | `biome-ignore lint/suspicious/noConsole` | intentional observability log | Acceptable, documented |
| `components/screens/usage/UsageDashboardClient.tsx` | 65 | `biome-ignore lint/suspicious/noArrayIndexKey` | skeleton placeholders | Acceptable, idiomatic |
| `components/screens/notes/NotesListClient.tsx` | 195, 198 | same | same | Acceptable |
| `components/screens/transcriptions/TranscriptionsListClient.tsx` | 134, 137 | same | same | Acceptable |
| `components/screens/transcriptions/TranscriptionDetailClient.tsx` | 249 | same | same | Acceptable |
| `components/screens/conversations/ConversationsListClient.tsx` | 111, 114 | same | same | Acceptable |
| `components/screens/conversations/ConversationsSearchClient.tsx` | 112 | same | same | Acceptable |
| `components/screens/account/SessionsTable.tsx` | 109, 112 | same | same | Acceptable |
| `lib/error-boundary.tsx` | 38 | `biome-ignore lint/suspicious/noConsole` | error-boundary fallback log | Acceptable |
| `lib/form-utils.ts` | 33-35 | `biome-ignore lint/suspicious/noExplicitAny` + `as any` + `as unknown as Resolver<Values>` | zodResolver generic boundary | See MEDIUM #5 |
| `next.config.ts` | 101 | `eslint-disable @typescript-eslint/no-require-imports` | dynamic require for bundle-analyzer | Acceptable, gated by `ANALYZE=true` |
| `components/screens/auth/SetupForm.tsx` | 65, 75, 83, 97, 136, 140, 152, 156 | `/* v8 ignore start */` blocks | defensive fallbacks for non-ICU runtimes and SSR | Acceptable, documented; verify coverage isn't being gamed |

## Disabled tests near scope
None found. `grep -rn "\.skip\(|\.todo\(|xit\(|xdescribe\("` returned zero hits across `apps/web/src/`. Good.

## Notes
- **Open-redirect mitigation is correctly enforced.** Both `SignInForm.tsx:87` and `SetupForm.tsx:178` use hardcoded `/app` and `/admin` redirects — no `?next=` reading. Confirmed across all auth-flow client components.
- **No secrets in client bundle.** Only `NEXT_PUBLIC_*` env vars are read from client/`"use client"` files (verified by grep). `INTERNAL_API_URL` is read only from RSC/server modules.
- **No `dangerouslySetInnerHTML` anywhere.** Verified by grep.
- **VerifyEmailClient token handling is correct** — `verify-email/page.tsx` validates the token against a regex before passing to the client (per VerifyEmailClient.tsx:9 comment).
- **`/api/locale` cookie has `httpOnly: false` intentionally** (route.ts:46) — documented and correct for locale-detection fallback. Not flagging.
- **CORS / credentials handling is consistent** — `credentials: "include"` only in two places (`lib/client-fetch.ts:49`, `ConfigClient.tsx:51`); same-origin Traefik routing makes this fine.
- **NoteDetailClient list-then-filter pattern (apps/web/src/components/screens/notes/NoteDetailClient.tsx:47-48 — `MAX_PAGES=5`, `PAGE_LIMIT=50`) is a documented backlog item** (no `GET /api/notes/:id` endpoint exists). Not a bug, but should be tracked publicly for the OSS release — a user with >250 notes will get a "not found" page for older notes accessed by direct URL.
- **Hard rule check:** `CLAUDE.md` forbids editing production code to make tests pass. The `PLAYWRIGHT_DISABLE_SSR_PREFETCH` branch (HIGH #2) is the inverse of that — production was modified to accommodate a test infrastructure limitation. This violates the spirit of the rule and should be on `.planning/deferred-items.md` for a proper fix.
