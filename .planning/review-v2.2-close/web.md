# Re-review: web (apps/web) — v2.2 milestone close audit

Branch: main @ b830cc4
Scope: `apps/web/src/**`
Baseline: `.planning/review/web.md` (main @ 1832f28; CRITICAL=0 HIGH=2 MEDIUM=5 LOW=4)

## Summary

- Files re-examined: ~60 production source files under `apps/web/src/{app,components,lib}`, `middleware.ts`, `next.config.ts`. Tests at `apps/web/tests/**` skip-scanned (admin-guard unit suite read in full).
- Phase 41.c (commits `aff9393`, `9e6afeb`) closes **both HIGH findings** from the baseline review. Verified by Read tool against HEAD.
- New tally vs. previous run: CRITICAL=0 HIGH=0 MEDIUM=5 (was 5) LOW=4 (was 4). Two NEW WARNING-tier issues introduced by the HI-1 patch: stale in-source D-ADMIN-1 comments contradicting the new guard, and an untranslated 403 surface. Both are quality defects, not regressions of the fix.
- **Publication readiness:** No BLOCKER. Recommended to land two trivial cleanups (W-NEW-1 + W-NEW-2) before publication; they are doc-hygiene class but visible to any first-time external reader of the admin layer.

## Top 3 residual risks for public GitHub release

1. **CSP `script-src 'unsafe-inline'` site-wide** (was MED in baseline, still open). Phase 41 deferred nonce-based CSP to v2.3. Public-release marketing should not lean on "strict CSP" while `next.config.ts` still ships `unsafe-inline` for scripts.
2. **Untranslated `403 — Forbidden` surface in `(admin)/layout.tsx:27-32`** (NEW — introduced by HI-1 patch). Project mandate is en+ru parity; the new Forbidden surface is hardcoded English. Low-effort fix.
3. **Three header-comment annotations now contradict the code they describe** (NEW — introduced by HI-1 patch). Future maintainers reading `ConfigClient.tsx:13`, `admin/config/page.tsx:8,15`, and `admin/observability/page.tsx:10-12` will see "no application-layer role check" — but the layout above them now enforces one. Hazard: somebody removes the layout guard "to match the comments" during a refactor.

---

## Closure delta (vs baseline `.planning/review/web.md`)

### [CLOSED] HI-1 — Admin layout enforces NO application-layer auth
- Status: **CLOSED** by commit `aff9393` (`feat(41c): app-level role guard for admin layout`).
- Evidence verified:
  - `apps/web/src/app/(admin)/layout.tsx:38-48` — now an `async` RSC that resolves `getServerSession()` and consults `checkAdminAccess(session)`. On `"forbidden"` it returns an inline `<AdminForbidden />` instead of `<AdminShell>{children}</AdminShell>`, so the admin subtree never renders for signed-in non-admin users.
  - `apps/web/src/lib/admin-guard.ts:38-43` — pure, side-effect-free three-branch decision (`null → allow`, `role==='admin' → allow`, otherwise `forbidden`). Decision matches `.planning/phases/41-residual-high-sweep/41-c-DECISIONS.md` §D-1.
  - `apps/web/tests/unit/lib/__tests__/admin-guard.test.ts:27-43` — four cases (anonymous, admin, role=user, role missing) covering all three branches plus the defense-in-depth "missing-role" case.
- Verdict: **defense-in-depth gate is in place**. Anonymous visitors still pass through unchanged (Traefik basic-auth remains primary — operator-runbook flow preserved). The exact hole the baseline cited ("any signed-in user gains operator config visibility via cookie") is closed: a signed-in non-admin user's request to `/admin/*` short-circuits to `<AdminForbidden />` before any descendant page renders.
- Residual notes (W-NEW-1, W-NEW-2 below) are about doc/i18n hygiene, NOT about the guard's correctness.

### [CLOSED] HI-2 — `PLAYWRIGHT_DISABLE_SSR_PREFETCH` test-only branch shipped in five production RSC entries
- Status: **CLOSED** by commit `9e6afeb` (`feat(41c): remove playwright_disable_ssr_prefetch from prod rsc`).
- Evidence verified:
  - `grep -rn "PLAYWRIGHT_DISABLE_SSR_PREFETCH" apps/web/src/` returns five hits, all in **comments only** (each cites Phase 41 / Plan 41-c (HI-2) as the removal commit). Zero remaining runtime reads.
  - The five RSC pages (`app/(auth)/app/page.tsx`, `.../notes/page.tsx`, `.../transcriptions/page.tsx`, `.../conversations/page.tsx`, `.../conversations/[id]/page.tsx`) all call `prefetchQuery(...)` unconditionally now.
- LOCKER-01 cross-check: `grep -rn "process\.env\.NODE_ENV\|process\.env\.PLAYWRIGHT\|process\.env\.NEXT_BUILD" apps/web/src/app/` returns **zero hits**. All remaining `process.env.*` reads are config-style `*_URL` / `*_BASE_URL` lookups, which LOCKER-01 explicitly permits.
- Verdict: **production code no longer encodes "Playwright knows" branches**. The deferred follow-up (Playwright fixture for u4/u6/u8/u11/u12 loading-state specs) is recorded in `.planning/phases/41-residual-high-sweep/41-c-DEFERRED.md`. The test-side migration cost is internalized as future test-infra work, not as production-code debt.

### [STILL OPEN] MEDIUM #1 — Hardcoded "Yes"/"No" in two screens
- Files unchanged at `apps/web/src/components/screens/admin/ConfigClient.tsx:247` and `apps/web/src/components/screens/usage/UsageDashboardClient.tsx:163`. Phase 41.c did not touch i18n strings. Recommend tracking for v2.3.

### [STILL OPEN] MEDIUM #2 — `script-src 'unsafe-inline'` site-wide
- `apps/web/next.config.ts:31-51` unchanged. The TODO at lines 22-26 remains. Confirm whether the v2.2 release notes call this out.

### [STILL OPEN] MEDIUM #3 — `useZodForm` triple-cast through `as any → as unknown as Resolver`
- `apps/web/src/lib/form-utils.ts:30-35` unchanged. Still uses the documented `zodResolver` generic-boundary cast. LOCKER-02 allowlist behavior assumed.

### [STILL OPEN] MEDIUM #4 — Better Auth typed-surface bypassed in 5 sites
- All 4 cast sites unchanged: `SignInForm.tsx:70,110`, `OidcButtons.tsx:57`, `VerifyEmailClient.tsx:82`, plus the `ExtendedAuthClient` in `lib/auth-client.ts:38-42`. Phase 41.c did not centralize.

### [STILL OPEN] MEDIUM #5 — Three env-naming schemes for the upstream API URL
- `internalApiUrl()` helper still duplicated across **8 files** (5 RSC pages + `auth-server.ts:49-52` + `auth-actions.ts:25` + setup-page divergence at `(public)/setup/page.tsx:48`). Setup page still uses `OPENWHISPR_API_URL ?? NEXT_PUBLIC_API_BASE_URL ?? ""` (different chain from everyone else). Not regressed by 41.c, but not extracted either.

### [STILL OPEN] LOW items
- LOW-1 em-dash in SetupForm review: `apps/web/src/components/screens/auth/SetupForm.tsx` — unchanged.
- LOW-2 documented `console.warn` / `console.error` calls in `useAuthProviders.ts` + `error-boundary.tsx` — unchanged.
- LOW-3 AdminIndex/ConfigClient duplication — unchanged.
- LOW-4 `/api/health` always-200 — unchanged.

---

## NEW findings introduced by Phase 41.c

### [WARNING] W-NEW-1 — Three header-comment annotations contradict the new role-guard
- Files:
  - `apps/web/src/components/screens/admin/ConfigClient.tsx:13` — "D-ADMIN-1: NO application-layer role check; Traefik basic-auth gates the surface."
  - `apps/web/src/app/(admin)/admin/config/page.tsx:8-15` — "admin access at the network layer is via Traefik basic-auth (D-ADMIN-1) ... D-ADMIN-1 — layout already lacks a session gate."
  - `apps/web/src/app/(admin)/admin/observability/page.tsx:10-12` — "D-ADMIN-1 — no application-layer role check. The (admin) layout (Plan 06) is also gate-less"
- Category: Code quality (documentation drift; future-maintainer hazard).
- Evidence: the layout at `apps/web/src/app/(admin)/layout.tsx:38-48` (commit `aff9393`) now resolves a session and renders `<AdminForbidden />` for signed-in non-admin users. The header comments above predate the patch and were not updated alongside it. A future contributor reading these comments could (a) "match the comments to the code" by removing the layout guard, undoing HI-1, or (b) assume defense-in-depth is absent and add a redundant guard inside the page module.
- Fix: replace the three "D-ADMIN-1 — no app-layer check" notes with the updated two-layer model:
  ```text
  Auth model (Phase 41.c):
    PRIMARY      — Traefik basic-auth at the edge (D-ADMIN-1).
    DEFENSE-IN-DEPTH — `checkAdminAccess(session)` in (admin)/layout.tsx
                       (HI-1 fix; commit aff9393). A signed-in non-admin
                       user receives an inline 403 surface; anonymous
                       visitors pass through (Traefik gate authoritative).
  ```
  Also update the source-of-truth annotation block at the top of `(admin)/layout.tsx` already says this — copy that wording to the three downstream files.

### [WARNING] W-NEW-2 — `AdminForbidden` 403 surface is hardcoded English; bypasses i18n
- File: `apps/web/src/app/(admin)/layout.tsx:24-36`
- Category: i18n (project mandate: en+ru runtime parity from day one — see `CLAUDE.md > Constraints > Runtime localization`).
- Evidence:
  ```tsx
  function AdminForbidden(): React.JSX.Element {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="mb-3 text-2xl font-semibold">403 — Forbidden</h1>
        <p className="text-sm text-muted-foreground">
          Your account does not have the <code>admin</code> role. ...
        </p>
      </main>
    );
  }
  ```
  Every visible string is a JSX text literal. No `useTranslation` / `getServerI18n` consumption. A ru user signed in with a non-admin role would see English copy on what is otherwise a localized surface.
- Why it matters: low frequency surface (only signed-in non-admin users hitting `/admin/*` see it), but it is precisely the kind of error/edge-case copy that the project's i18n discipline targets. The base MED-1 finding flags the same anti-pattern on `Yes`/`No` cells — W-NEW-2 is the same defect class but added by the close-out commit, so it should be fixed in the same v2.2 close pass or explicitly deferred.
- Fix: introduce `admin:admin.forbidden.title.heading` and `admin:admin.forbidden.body.text` keys (en + ru), then render via the existing `getServerI18n(lng, ["admin", "common"])` pattern used by `(public)/setup/page.tsx:79-83`. The layout is already `async` so reading `headers()` for the locale is one line.

---

## LOCKER cross-check (Phase 41.c diff only)

| Locker | Status | Notes |
|---|---|---|
| LOCKER-01 (no NODE_ENV/runtime env branches outside bootstrap) | **PASS** | Five `PLAYWRIGHT_DISABLE_SSR_PREFETCH` runtime reads removed by 41.c; remaining `process.env.*` reads in `apps/web/src/app/**` are all `*_URL` / `*_BASE_URL` config-style and not boolean branches. `grep -rn 'process\.env\.NODE_ENV\|process\.env\.PLAYWRIGHT\|process\.env\.NEXT_BUILD' apps/web/src/app/` → 0 hits. |
| LOCKER-02 (no `as any` / `as unknown as` net adds) | **PASS for 41.c diff** | The HI-1 patch introduces zero new suppressions. Pre-existing MED-4 / MED-5 suppressions unchanged. |
| LOCKER-03 (no hardcoded localhost/UUID/secret-shape literals in production) | **PASS** | Phase 41.c diff adds none. Pre-existing `"http://api:3000"` default in `internalApiUrl()` helpers is the canonical container-internal hostname (not `localhost`/`127.0.0.1`) — allowlisted by LOCKER-03's regex shape. |
| LOCKER-04 (route schema + rateLimit) | **N/A for apps/web** | Routes are Next.js handlers, not Fastify. `app/api/locale/route.ts` + `app/api/health/route.ts` are the only two; LOCKER-04 targets `app.route|get|post|...` declarations in Fastify. |

---

## Hard-Rules conformance (project `CLAUDE.md`)

- **Hard rule #1** (no editing production code to make tests pass) — **NOW SATISFIED**. The baseline review explicitly cited HI-2 as the inverse anti-pattern (production modified to accommodate Playwright). Commit `9e6afeb` removes the test-shaped branch; deferred-items log captures the test-side follow-up. Discipline restored.
- **Hard rule #2** (surface costly architectural decisions as deferred-items) — **SATISFIED**. The Playwright fixture / Suspense refactor alternatives for HI-2 are recorded in `.planning/phases/41-residual-high-sweep/41-c-DEFERRED.md` per the DECISIONS doc §D-2.

---

## Dead code

No new dead code introduced. `admin-guard.ts` is imported by `(admin)/layout.tsx`. `AdminForbidden` is a private function inside the layout file (no export concern). The five `PLAYWRIGHT_DISABLE_SSR_PREFETCH` `ssrPrefetchDisabled()` helpers were inlined into the page modules; commit `9e6afeb` removed them along with the env read.

## Disabled tests near scope

`grep -rn '\.skip\(\|\.todo\(\|xit\(\|xdescribe\(' apps/web/src/ apps/web/tests/` returns zero hits across the production tree and the unit test added in 41.c. Loading-state e2e specs (u4-usage / u6-trx-list / u8-notes-list / u11-conv-list / u12-conv-detail) are NOT in `apps/web/tests/` — they live under `tests/e2e-cjm/` and `tests/e2e/` and are out of this scope; their handling is the deferred follow-up of 41.c §D-2.

## Notes

- The `(admin)/layout.tsx` Forbidden surface deliberately does NOT wrap in `<AdminShell>` — verified by reading the early-return. This prevents the shell's nav bar from rendering with admin links a non-admin would only see disabled, which is the correct UX choice.
- Verified `(auth)/layout.tsx:22-23` continues to enforce the (auth) gate via `getServerSession()` + `redirect("/sign-in")` — `/app/*` routes remain protected. Phase 41.c did not regress this.
- `middleware.ts` cookie gate on `/app/:path*` (line 76) is unchanged. Still intentionally not matching `/admin/*` per D-ADMIN-1 — Traefik basic-auth remains primary, layout-guard is defense-in-depth. Correct architecture.
- No new `dangerouslySetInnerHTML`. No new client-side reads of non-`NEXT_PUBLIC_*` env. No secret-shape literals introduced.

---

## Closure-delta verdict

**Phase 41.c CLOSES both HIGH findings from `.planning/review/web.md`.** Verified by:
- (a) commits `aff9393` and `9e6afeb` present on HEAD `b830cc4`
- (b) file contents at HEAD match the claims (Read tool confirmation against `(admin)/layout.tsx`, `admin-guard.ts`, all five `(auth)/app/**/page.tsx` files)
- (c) corresponding unit test (`admin-guard.test.ts`) exists with 4 cases covering all three decision branches plus defense-in-depth no-role case
- (d) grep audits confirm zero residual `PLAYWRIGHT_DISABLE_SSR_PREFETCH` runtime reads and zero new LOCKER-01 violations.

Two NEW WARNING-tier issues (W-NEW-1 doc drift, W-NEW-2 i18n bypass on the 403 surface) were introduced by the HI-1 patch. They are both trivial fixes (< 30 lines of edits total, no test infrastructure needed) and should ideally be landed before the v2.2 publication tag. If v2.2 ships as-is, both are tractable v2.3 cleanup; neither blocks a public release.

Pre-existing MEDIUM and LOW findings from the baseline review are unchanged.
