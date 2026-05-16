# Phase 41.c — DECISIONS (autonomous; user offline)

## D-1 — HI-1 admin role-guard UX (Forbidden vs. redirect)

**Choice:** **Inline 403 Forbidden render** for signed-in non-admin users; NO action for anonymous visitors (Traefik basic-auth remains the primary gate).

**Rationale:**

- The cited hole in `web.md` HI-1 is "any signed-in user gains operator
  config visibility" — that is the specific defense-in-depth concern.
  An anonymous (no-session) visitor is already handled by Traefik
  basic-auth (D-ADMIN-1, the documented operator runbook). Forcing
  anonymous visitors to `/sign-in?next=/admin` would BREAK the
  operator-engineer flow where the ops user has no OpenWhispr account
  but has the basic-auth credentials.
- A signed-in user with `role != "admin"` is the new attack surface this
  guard closes. Rendering an inline `<Forbidden />` (with a heading +
  short message + sign-out link) is more discoverable than a redirect to
  `/sign-in` (which would imply "your session is the problem"; the
  problem is "your role is the problem"). UI-SPEC Phase 07 has no
  dedicated 403 route; an inline render keeps the surface within the
  admin route group without requiring a new app route.
- `redirect("/sign-in?next=/admin")` was the alternative; rejected
  because it (a) creates a sign-in loop for non-admin sessions (the user
  has a valid session, signing-out-and-back-in does not change role)
  and (b) leaks the existence of /admin to non-admin signed-in users
  via the `next` parameter (minor info-disclosure).
- `notFound()` was a third alternative; rejected because it would
  confuse operators who DO have the basic-auth credentials but lack a
  role (e.g. ops engineer signed in for unrelated reasons) — they would
  see a 404 and assume the install is broken.

**Three-branch decision matrix (encoded in `lib/admin-guard.ts`):**

| Session state                           | Decision     | Why                                                                          |
| --------------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `session === null` (anonymous)          | `"allow"`    | Traefik basic-auth is the primary gate; do not break the operator runbook.   |
| `session.user.role === "admin"`         | `"allow"`    | Authorized.                                                                  |
| Otherwise (signed-in with non-admin role) | `"forbidden"` | The defense-in-depth case this guard exists for.                             |

**Test surface:** unit-test the helper directly (RSC layout is excluded
from vitest coverage per `vitest.config.ts:44-45`). Three cases above
verify all branches at 100% line/branch/function/statement coverage.

## D-2 — HI-2 PLAYWRIGHT_DISABLE_SSR_PREFETCH replacement mechanism

**Choice:** **Delete the env branch entirely from all 5 RSC pages.**
No replacement. SSR prefetch runs unconditionally in production. The
test-side migration is deferred.

**Rationale:**

- The review explicitly cites this as a CLAUDE.md hard-rule #1 surface:
  production code modified to accommodate test infrastructure. The
  most direct fix is removal — anything else (build-time DEFINE,
  `NEXT_BUILD_PROFILE`, indirection helper) re-encodes "production
  knows about Playwright" with extra ceremony.
- The Suspense alternative (refactor 5 RSC pages + 5 client components
  to use streaming + `useSuspenseQuery`, then loading state is
  server-rendered and `page.route()` mocks at the apps/api boundary)
  would be a multi-day refactor — disproportionate to a single HIGH
  finding in a residual-sweep phase.
- The Playwright route-interception alternative ("mock at apps/api
  boundary via testcontainers or a fixture") requires net-new test
  infrastructure (a shadow apps/api container or Traefik-level mock
  layer) — out of scope for 41.c.
- The realistic state of the e2e suite in CI is already that
  `PLAYWRIGHT_DISABLE_SSR_PREFETCH` is unset (`.env.full.example`
  default is empty; CI workflows do not export it) — the loading-state
  e2e specs (u4, u6, u8, u11, u12) that rely on the env var to skip
  SSR prefetch may already be silently broken in CI. Removing the
  branch makes that breakage explicit and surfaces it to the deferred
  inventory for a future targeted test-infra phase.

**Deferred follow-up** (recorded in `41-c-DEFERRED.md`):

- u4-usage / u6-trx-list / u8-notes-list / u11-conv-list /
  u12-conv-detail loading-state specs need a Playwright fixture that
  intercepts the RSC-side fetch (e.g. a shadow apps/api proxy through
  Traefik when `BASE_URL` has a mock-mode flag, or a refactor to
  Suspense + `useSuspenseQuery` so the boundary moves to the client).
- The local-dev `.env` setting `PLAYWRIGHT_DISABLE_SSR_PREFETCH=1`
  becomes a harmless no-op (Next.js will not read it). Documented in
  the env example so users know.

**Compose / env cleanup in scope for this commit:**

- Remove `PLAYWRIGHT_DISABLE_SSR_PREFETCH: ${PLAYWRIGHT_DISABLE_SSR_PREFETCH:-}`
  from `docker-compose.yml` and
  `compose/docker-compose.embedded-litellm.yml` (the env was only
  passed through to feed the now-removed branch).
- Remove `PLAYWRIGHT_DISABLE_SSR_PREFETCH=` and the commented-out
  example from `.env.full.example`.
