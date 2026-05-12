---
surface: end-user
phase: 07-frontend-ui-spec
generated_at: 2026-05-12
requirements: [UI-SPEC-02, UI-SPEC-03]
---

# OpenWhispr Server — End-User UI-SPEC

**Purpose.** Specify the end-user self-service surface (13 screens: U1–U13 —
auth flow, account, and read-only own-resource viewers) at a level of detail
sufficient for Claude Design (visual) and Claude Code (Next.js 15 + shadcn/ui
v2 implementation) to deliver without follow-up questions.

**Steering rule.** "Толкаемся от спеки бэка" (D-S1) — when design diverges from
the existing API, simplify the screen, re-engage Claude Design, or defer to
Phase 7.x. No new API endpoints are introduced by Phase 7.

<!-- Screen sections U1..U13 are appended by Plan 05. -->
<!-- Shared appendix (design tokens, breakpoint matrix, i18n key index, full API endpoint index) is appended by Plan 06. -->

<!-- Screen ordering: auth-first (U1..U3), then account (U4..U5), then own resources (U6..U13). Writer's discretion per D-ART; auth-first matches user mental model. -->

## Conventions

These conventions apply to every U1..U13 section below. They are stated once
here rather than repeated per screen.

- **Auth gate.** Better Auth session cookie. Next.js middleware does a cookie
  presence check on `/app/**`; the `app/(app)/layout.tsx` performs full session
  validation via `GET /api/auth/get-session` and redirects to `/sign-in` on
  401. Public routes (`/sign-in`, `/sign-up`, `/verify-email`) bypass the
  middleware via the matcher. See `07-RESEARCH.md` § Pattern 1.
- **i18n.** Every visible string carries a copy key
  `end-user.<screen>.<section>.<element>.<prop>` (5-level dotted hierarchy
  per D-ART4). English values are inline in each screen's Copy keys table.
  Russian translation is deferred to Phase 10.
- **State patterns.** Every fetching screen specifies all four states
  (`loading`, `success`, `empty`, `error`). `N/A` with a reason is allowed.
- **Delete pattern.** A single shared `<DeleteConfirmDialog>` primitive
  (defined in the Plan 06 appendix) wraps every destructive action. It
  renders an `AlertDialog`, requires a click-confirm, calls the matching
  `DELETE /api/<resource>/delete` endpoint, then invalidates the relevant
  TanStack Query keys.
- **Export pattern.** All export-to-file actions (Copy / Export .md /
  Export .json) operate client-side on the already-fetched payload, producing
  a `Blob` and triggering a synthetic anchor click. No server-side export
  endpoint exists (D-API3 carry-forward).
- **TanStack Query keys.** Each screen names its canonical `queryKeys.*`
  factory keys in its Data subsection. List screens use keyset cursors
  (`{ limit, before, since }`) in the key.

## U1 — Sign in

### Purpose

Public landing for unauthenticated users. Authenticates with Better Auth via
email + password (D-UX1) or one of three OIDC buttons (Google, GitHub, generic
"Continue with SSO" per D-UX4). On success, redirects to `/app`.

### Roles

Public surface. Any visitor can reach `/sign-in`. Authenticated visitors are
redirected to `/app` by the route group layout.

### Route

`/sign-in` (Next.js App Router segment under `app/(public)/sign-in/page.tsx`).
Not in the admin matcher. Bypasses the auth-cookie middleware via matcher.

### Data

No initial fetch. Form state is local (`react-hook-form` + `zod`). On submit,
`POST /api/auth/sign-in/email` returns `{ session, user }` and sets the
Better Auth session cookie. OIDC buttons navigate the browser to
`GET /api/auth/sign-in/social/:provider` which performs an HTTP 302 to the
upstream IdP.

| Field      | Source                                                     | Notes                                                |
|------------|------------------------------------------------------------|------------------------------------------------------|
| `email`    | form input (zod `z.string().email()`)                      | Required, lowercased before submit                   |
| `password` | form input (zod `z.string().min(8)`)                       | Required, never logged                               |
| Providers  | `process.env.NEXT_PUBLIC_OIDC_PROVIDERS` (comma list)      | Optional; hides a button when its provider is absent |

TanStack Query keys: none (form is imperative, not query-driven).

### Actions

- **Submit form** → `POST /api/auth/sign-in/email` with `{ email, password }`.
  On 200: read `Set-Cookie`, navigate to `/app`. On 401: show inline error.
- **Continue with Google** → navigate top-level to
  `GET /api/auth/sign-in/social/google`.
- **Continue with GitHub** → navigate top-level to
  `GET /api/auth/sign-in/social/github`.
- **Continue with SSO** → navigate top-level to
  `GET /api/auth/sign-in/social/oidc` (the generic OIDC provider configured
  by the operator).
- **Forgot password?** → static disabled text only (D-UX2). No navigation;
  no API call. Hover tooltip explains the disabled state.
- **Sign up** link → navigates to `/sign-up`.

### States

| State    | Trigger                                                    | UI                                                                  |
|----------|------------------------------------------------------------|---------------------------------------------------------------------|
| loading  | Form `isSubmitting` true                                   | Submit button shows `Loader2` spinner; inputs disabled              |
| success  | Idle and on first paint                                    | Form rendered; OIDC button row below; "Forgot password?" disabled   |
| empty    | N/A                                                        | No empty state — form is always rendered                            |
| error    | `POST /api/auth/sign-in/email` returns 401 / 400 / network | Inline `Alert` above the form with `end-user.signin.error.body.text`|

### User journey

1. Visitor lands on `/sign-in` (deep-link or sign-out redirect).
2. Visitor enters email + password and clicks Sign in.
3. On success, Better Auth sets the session cookie and the page redirects
   to `/app`.
4. On failure, an inline alert appears and the password field is cleared.
5. Alternatively, visitor clicks one of the three OIDC buttons and is
   bounced through the IdP, returning to `/app` on success.

### Copy keys

| Key                                                                | English value                                                |
|--------------------------------------------------------------------|--------------------------------------------------------------|
| `end-user.signin.title.heading.text`                               | Sign in to OpenWhispr                                        |
| `end-user.signin.subtitle.body.text`                               | Use your email or your organization SSO.                     |
| `end-user.signin.form.email.label`                                 | Email                                                        |
| `end-user.signin.form.password.label`                              | Password                                                     |
| `end-user.signin.form.submit.label`                                | Sign in                                                      |
| `end-user.signin.oidc.google.label`                                | Continue with Google                                         |
| `end-user.signin.oidc.github.label`                                | Continue with GitHub                                         |
| `end-user.signin.oidc.sso.label`                                   | Continue with SSO                                            |
| `end-user.signin.action.forgotPassword.link.disabled`              | Forgot password? — coming soon, contact your operator.       |
| `end-user.signin.action.signup-link.label`                         | Don't have an account? Sign up                               |
| `end-user.signin.error.title.text`                                 | Sign-in failed                                               |
| `end-user.signin.error.body.text`                                  | Check your email and password, then try again.               |

### Wireframe

```text
+--------------------------------------------------------------+
|                       OpenWhispr                             |
|                                                              |
|        +----------------------------------------+            |
|        | Sign in to OpenWhispr                  |            |
|        | Use your email or your organization.   |            |
|        |                                        |            |
|        | Email     [.............................]          |
|        | Password  [.............................]          |
|        |                                        |            |
|        | [ Sign in                           ]  |            |
|        |                                        |            |
|        | Forgot password? (coming soon)         |            |
|        |                                        |            |
|        | ---------------- or ----------------   |            |
|        |                                        |            |
|        | [ Continue with Google             ]   |            |
|        | [ Continue with GitHub             ]   |            |
|        | [ Continue with SSO                ]   |            |
|        |                                        |            |
|        | Don't have an account? Sign up         |            |
|        +----------------------------------------+            |
+--------------------------------------------------------------+
```

Desktop ≥1024px: centered card 420px wide. Tablet 640–1024: centered card
preserved. Mobile <640: full-width card with 16px gutters.

See visual: design/screens-user.jsx#ScreenSignIn

### shadcn primitives

`Card`, `Input`, `Label`, `Button`, `Alert`, `Separator`, `Tooltip`, `Form`

<!-- DESIGN-GAP D-UX2: Visual treatment of the disabled "Forgot password?" affordance — re-engage Claude Design. -->

## U2 — Sign up

### Purpose

Public registration screen. Creates a Better Auth user record via email +
password and triggers the verification email flow. Same OIDC button row as U1.

### Roles

Public surface. Any visitor can reach `/sign-up`. Authenticated visitors are
redirected to `/app`.

### Route

`/sign-up` (Next.js App Router segment under `app/(public)/sign-up/page.tsx`).
Bypasses the auth-cookie middleware via matcher.

### Data

No initial fetch. Form state is local (`react-hook-form` + `zod`). On submit,
`POST /api/auth/sign-up/email` returns `{ user }` and dispatches a
verification email server-side.

| Field             | Source                                       | Notes                                          |
|-------------------|----------------------------------------------|------------------------------------------------|
| `email`           | form input (zod `z.string().email()`)        | Required                                       |
| `password`        | form input (zod `z.string().min(8)`)         | Required, 8 char minimum                       |
| `confirmPassword` | form input (zod refine: equals `password`)   | Required                                       |
| `name`            | form input (zod `z.string().min(1).max(80)`) | Required, display name                         |

TanStack Query keys: none.

### Actions

- **Submit form** → `POST /api/auth/sign-up/email` with
  `{ email, password, name }`. On 200: navigate to a "Check your email"
  confirmation screen (inline state, no separate route). On 409 (duplicate
  email): show inline error and link to U1.
- **Continue with Google / GitHub / SSO** → same as U1 (OIDC users skip the
  verify-email step).
- **Sign in** link → navigates to `/sign-in`.

### States

| State    | Trigger                                                    | UI                                                                |
|----------|------------------------------------------------------------|-------------------------------------------------------------------|
| loading  | Form `isSubmitting` true                                   | Submit button shows `Loader2`; inputs disabled                    |
| success  | Idle on first paint, or 200 from submit                    | Form rendered; on 200, replaced with "Check your email" panel     |
| empty    | N/A                                                        | No empty state                                                    |
| error    | `POST /api/auth/sign-up/email` returns 4xx / network       | Inline `Alert` above the form                                     |

### User journey

1. Visitor lands on `/sign-up` from U1's "Sign up" link or marketing CTA.
2. Visitor enters name, email, password, confirms password, clicks Sign up.
3. On success, the form is replaced with a "Check your email" panel
   instructing the visitor to follow the link in the verification email.
4. Visitor opens the email, clicks the verification link, lands on U3.
5. On failure (duplicate email, weak password), inline alert appears.

### Copy keys

| Key                                                                | English value                                                |
|--------------------------------------------------------------------|--------------------------------------------------------------|
| `end-user.signup.title.heading.text`                               | Create your OpenWhispr account                               |
| `end-user.signup.subtitle.body.text`                               | A confirmation email is sent to verify your address.         |
| `end-user.signup.form.name.label`                                  | Name                                                         |
| `end-user.signup.form.email.label`                                 | Email                                                        |
| `end-user.signup.form.password.label`                              | Password                                                     |
| `end-user.signup.form.confirmPassword.label`                       | Confirm password                                             |
| `end-user.signup.form.submit.label`                                | Sign up                                                      |
| `end-user.signup.oidc.google.label`                                | Continue with Google                                         |
| `end-user.signup.oidc.github.label`                                | Continue with GitHub                                         |
| `end-user.signup.oidc.sso.label`                                   | Continue with SSO                                            |
| `end-user.signup.action.signin-link.label`                         | Already have an account? Sign in                             |
| `end-user.signup.success.title.text`                               | Check your email                                             |
| `end-user.signup.success.body.text`                                | We sent a verification link to your address. Open it to continue. |
| `end-user.signup.error.duplicate.text`                             | This email is already registered. Sign in instead.           |
| `end-user.signup.error.generic.text`                               | Sign-up failed. Please review the form and try again.        |

### Wireframe

```text
+--------------------------------------------------------------+
|                       OpenWhispr                             |
|                                                              |
|        +----------------------------------------+            |
|        | Create your OpenWhispr account         |            |
|        |                                        |            |
|        | Name             [....................] |          |
|        | Email            [....................] |          |
|        | Password         [....................] |          |
|        | Confirm password [....................] |          |
|        |                                        |            |
|        | [ Sign up                           ]  |            |
|        |                                        |            |
|        | ---------------- or ----------------   |            |
|        |                                        |            |
|        | [ Continue with Google             ]   |            |
|        | [ Continue with GitHub             ]   |            |
|        | [ Continue with SSO                ]   |            |
|        |                                        |            |
|        | Already have an account? Sign in       |            |
|        +----------------------------------------+            |
+--------------------------------------------------------------+
```

Desktop ≥1024px: centered card 420px wide. Tablet/mobile mirrors U1.

See visual: design/screens-user.jsx#ScreenSignUp

### shadcn primitives

`Card`, `Input`, `Label`, `Button`, `Alert`, `Separator`, `Form`

## U3 — Verify email

### Purpose

Public landing for the verification link sent during U2. Reads the `token`
query parameter, calls Better Auth's verify endpoint, and shows success or
error states with a sign-in CTA.

### Roles

Public surface. Any visitor with a valid token can complete verification.

### Route

`/verify-email?token=<jwt>` (Next.js App Router segment under
`app/(public)/verify-email/page.tsx`). Bypasses the auth-cookie middleware.

### Data

On mount, the page issues `POST /api/auth/verify-email` with the token from
the query string. The Better Auth catch-all handler validates the token and
returns 200 or 400.

| Field   | Source                                         | Notes                                       |
|---------|------------------------------------------------|---------------------------------------------|
| `token` | `searchParams.token` (Next.js server component) | Required; missing token renders error state |

TanStack Query keys: none (single one-shot mutation on mount).

### Actions

- **Verify** (automatic on mount) → `POST /api/auth/verify-email` with
  `{ token }`. On 200: render success panel. On 400 / 410 (expired): render
  error panel.
- **Sign in** button (on success panel) → navigates to `/sign-in`.
- **Resend verification email** (on error panel) → currently inert in v1
  (no UI affordance to trigger `POST /api/auth/send-verification-email`
  without a signed-in session); shows guidance copy to sign up again.

### States

| State    | Trigger                                              | UI                                                                |
|----------|------------------------------------------------------|-------------------------------------------------------------------|
| loading  | Initial mount, mutation in flight                    | Centered `Loader2` with "Verifying..." caption                    |
| success  | Mutation 200                                         | Green checkmark, "Email verified" headline, Sign in CTA           |
| empty    | N/A                                                  | No empty state — token is either present or it isn't              |
| error    | Mutation 4xx, or `token` query param missing         | Red icon, "Verification failed" headline, guidance text           |

### User journey

1. User clicks the link in the verification email; browser navigates to
   `/verify-email?token=...`.
2. Page renders with the loading state while the verify mutation runs.
3. On success, the page swaps to the success panel and the user clicks
   "Sign in" to land on U1.
4. On failure (expired or invalid token), the page swaps to the error panel
   with guidance to start over from `/sign-up`.

### Copy keys

| Key                                                       | English value                                                       |
|-----------------------------------------------------------|---------------------------------------------------------------------|
| `end-user.verify.title.heading.text`                      | Verify your email                                                   |
| `end-user.verify.loading.body.text`                       | Verifying your email...                                             |
| `end-user.verify.success.title.text`                      | Email verified                                                      |
| `end-user.verify.success.body.text`                       | Your email is confirmed. You can now sign in.                       |
| `end-user.verify.success.cta.label`                       | Sign in                                                             |
| `end-user.verify.error.title.text`                        | Verification failed                                                 |
| `end-user.verify.error.body.text`                         | This verification link is invalid or has expired. Sign up again.    |
| `end-user.verify.error.cta.label`                         | Back to sign up                                                     |

### Wireframe

```text
+--------------------------------------------------------------+
|                       OpenWhispr                             |
|                                                              |
|        +----------------------------------------+            |
|        |          [check icon]                  |            |
|        |          Email verified                |            |
|        |  Your email is confirmed. You can now  |            |
|        |  sign in.                              |            |
|        |                                        |            |
|        | [ Sign in                           ]  |            |
|        +----------------------------------------+            |
+--------------------------------------------------------------+
```

Desktop ≥1024px: centered 420px card. Tablet/mobile: full-width card.

See visual: design/screens-user.jsx#ScreenVerify

### shadcn primitives

`Card`, `Button`, `Alert`, `Skeleton`

## U4 — Usage dashboard

### Purpose

Authenticated landing for the end-user app. Surfaces the four KPI cards that
the live `GET /api/usage` endpoint actually returns: `wordsUsed`,
`wordsRemaining`, `plan`, `limitReached`. Per **A2/A3 REFUTED** and **D-API6**,
no Requests/day line chart, no Audio-minutes/day bar chart, no By-provider
breakdown, and no Latest-activity feed appear in v1 — the underlying data
fields do not exist in the API. Grid rebalancing is a tracked design gap.

### Roles

Authenticated end-user surface. Layout-level session validation guards
`/app/**`.

### Route

`/app` (Next.js App Router segment under `app/(app)/app/page.tsx`). Sidebar
entry labelled by copy key `end-user.usage.nav.sidebar.label`.

### Data

Two endpoints:

| Field             | Source                                            | Notes                                                           |
|-------------------|---------------------------------------------------|-----------------------------------------------------------------|
| `wordsUsed`       | `GET /api/usage` response                         | KPI card                                                        |
| `wordsRemaining`  | `GET /api/usage` response                         | KPI card                                                        |
| `plan`            | `GET /api/usage` response                         | KPI card (string label, e.g. `unlimited`)                       |
| `limitReached`    | `GET /api/usage` response                         | KPI card (boolean → green / red badge)                          |
| Streaming session | `POST /api/streaming-usage` (HTTP method: POST)   | Called by the desktop client; the web dashboard only reads `/api/usage`. POST shown here for completeness — UI does NOT call it. |

TanStack Query keys:
- `queryKeys.usage()` — for `GET /api/usage`.
- `queryKeys.streamingUsage()` — reserved for future use; not currently
  invoked by the web dashboard.

### Actions

- **Refresh** button → `queryClient.invalidateQueries({ queryKey: queryKeys.usage() })`.
- **Sign out** (header) → `POST /api/auth/sign-out`.

There are no destructive actions on this screen.

### States

| State    | Trigger                                                 | UI                                                                 |
|----------|---------------------------------------------------------|--------------------------------------------------------------------|
| loading  | `GET /api/usage` in flight (first paint or refetch)     | Four `Skeleton` cards in the KPI grid                              |
| success  | 200 response                                            | Four KPI cards populated                                           |
| empty    | N/A — `wordsUsed` defaults to 0; KPI cards always show  | Not applicable                                                     |
| error    | 401 / 5xx / network                                     | `Alert` block above the grid with Retry button                     |

### User journey

1. Authenticated user lands on `/app` after sign-in.
2. The KPI grid shows skeletons briefly then populates with four cards.
3. User reviews `wordsUsed` and `wordsRemaining`, sees plan label
   (`unlimited` for self-host).
4. If `limitReached` is true, the corresponding KPI card shows a red badge
   and an inline tip directing to operator contact.
5. User navigates to other resource screens via the sidebar.

### Copy keys

| Key                                                       | English value                                                       |
|-----------------------------------------------------------|---------------------------------------------------------------------|
| `end-user.usage.nav.sidebar.label`                        | Dashboard                                                           |
| `end-user.usage.title.heading.text`                       | Usage                                                               |
| `end-user.usage.subtitle.body.text`                       | Your current consumption against the active plan.                   |
| `end-user.usage.kpi-words-used.title.label`               | Words used                                                          |
| `end-user.usage.kpi-words-used.body.text`                 | Across all transcriptions and notes.                                |
| `end-user.usage.kpi-words-remaining.title.label`          | Words remaining                                                     |
| `end-user.usage.kpi-words-remaining.body.text`            | Quota left on your current plan.                                    |
| `end-user.usage.kpi-plan.title.label`                     | Plan                                                                |
| `end-user.usage.kpi-plan.body.text`                       | Active subscription plan.                                           |
| `end-user.usage.kpi-limit-reached.title.label`            | Limit reached                                                       |
| `end-user.usage.kpi-limit-reached.body.text`              | Whether you are currently throttled.                                |
| `end-user.usage.action.refresh.label`                     | Refresh                                                             |
| `end-user.usage.error.title.text`                         | Could not load usage                                                |
| `end-user.usage.error.body.text`                          | Retry, or check the api container logs in Grafana.                  |
| `end-user.usage.error.retry.label`                        | Retry                                                               |

### Wireframe

```text
+--------------------------------------------------------------+
| Sidebar     | Usage                              [Refresh]   |
| - Dashboard | Your current consumption.                      |
| - Trx       |                                                |
| - Notes     | +-----------+ +-----------+                    |
| - Convs     | | Words     | | Words     |                    |
| - Account   | | used      | | remaining |                    |
|             | | 12 345    | | 987 654   |                    |
|             | +-----------+ +-----------+                    |
|             | +-----------+ +-----------+                    |
|             | | Plan      | | Limit     |                    |
|             | | unlimited | | reached   |                    |
|             | |           | | No        |                    |
|             | +-----------+ +-----------+                    |
+--------------------------------------------------------------+
```

Desktop ≥1024px: 2x2 KPI grid in the main column. Tablet 640–1024: 2x2
preserved. Mobile <640: 1-column vertical stack.

See visual: design/screens-user.jsx#ScreenUsage

### shadcn primitives

`Card`, `Skeleton`, `Badge`, `Alert`, `Button`, `Separator`

<!-- DESIGN-GAP A2/A3 + D-API6: U4 charts (Requests/day line, Audio-minutes/day bar, By-provider panel) and "Latest activity" feed are removed because the live API does not expose dailySeries / providerBreakdown / activity feed. Grid balance after removal needs a fresh visual pass — re-engage Claude Design. -->

## U5 — Account

### Purpose

Authenticated profile + sessions + delete-account surface. Reads profile from
the Better Auth session, lists active sessions, allows individual or bulk
session revoke, and gates a hard account deletion behind a typed-email
confirmation.

### Roles

Authenticated end-user surface. Operates strictly on the signed-in user's
own data (Better Auth scopes the session-management endpoints to the caller).

### Route

`/app/account` (Next.js App Router segment under
`app/(app)/app/account/page.tsx`). Sidebar entry labelled by copy key
`end-user.account.nav.sidebar.label`.

### Data

Three endpoint groups (all Better Auth catch-all per D-API2):

| Field           | Source                                            | Notes                                                  |
|-----------------|---------------------------------------------------|--------------------------------------------------------|
| Profile         | `GET /api/auth/get-session`                       | Read-only display of `user.name`, `user.email`, `user.emailVerified`, `user.createdAt` |
| Sessions        | `GET /api/auth/list-sessions`                     | Array of sessions (id, userAgent, ipAddress, createdAt, expiresAt) — D-API2 |
| Revoke session  | `POST /api/auth/revoke-session` body `{ token }`  | Per-row action — D-API2                                |
| Revoke others   | `POST /api/auth/revoke-other-sessions`            | Bulk action — D-API2                                   |
| Delete account  | `DELETE /api/auth/delete-account`                 | Cookie-only auth (Bearer/PAK rejected); clears all 4 cookie variants |

TanStack Query keys:
- `queryKeys.session()` — `GET /api/auth/get-session`.
- `queryKeys.sessions()` — `GET /api/auth/list-sessions`.

### Actions

- **Revoke session** (per-row) → `POST /api/auth/revoke-session` with the
  session token. On 200: invalidate `queryKeys.sessions()`.
- **Revoke all other sessions** → `POST /api/auth/revoke-other-sessions`.
  On 200: invalidate `queryKeys.sessions()`.
- **Sign out** (current session) → `POST /api/auth/sign-out`, redirect to
  `/sign-in`.
- **Delete account** → opens a `<DeleteConfirmDialog>` requiring the user to
  type their email address into a confirmation input; the Delete button is
  disabled until the typed value equals the session user's email. On confirm:
  `DELETE /api/auth/delete-account`, clear all local caches, redirect to
  `/sign-in`.

PAK management (D-UX3) is intentionally absent from this screen.

### States

| State    | Trigger                                                | UI                                                                  |
|----------|--------------------------------------------------------|---------------------------------------------------------------------|
| loading  | Either fetch in flight                                 | `Skeleton` rows in profile and sessions tables                      |
| success  | Both 200                                               | Profile card + sessions table + danger-zone card                    |
| empty    | Sessions list returns zero rows (cannot happen if user is signed in) | Empty-state placeholder in the table                  |
| error    | 401 / 5xx on either fetch                              | `Alert` per-section with Retry                                      |

### User journey

1. User opens Account from the sidebar.
2. Profile card shows name, email, verification badge, signup date.
3. Sessions table lists active sessions with user-agent strings.
4. User clicks Revoke on a row to log that session out remotely.
5. User clicks "Revoke all other sessions" to nuke every session except the
   current one.
6. User scrolls to the danger zone, clicks Delete account, types their email
   in the confirm dialog, clicks Delete.
7. On success, the account is gone and the user is redirected to `/sign-in`.

### Copy keys

| Key                                                            | English value                                                       |
|----------------------------------------------------------------|---------------------------------------------------------------------|
| `end-user.account.nav.sidebar.label`                           | Account                                                             |
| `end-user.account.title.heading.text`                          | Account                                                             |
| `end-user.account.subtitle.body.text`                          | Manage your profile, active sessions, and account deletion.         |
| `end-user.account.profile.title.label`                         | Profile                                                             |
| `end-user.account.profile.name.label`                          | Name                                                                |
| `end-user.account.profile.email.label`                         | Email                                                               |
| `end-user.account.profile.verified.label`                      | Verified                                                            |
| `end-user.account.profile.created.label`                       | Member since                                                        |
| `end-user.account.sessions.title.label`                        | Active sessions                                                     |
| `end-user.account.sessions.col-device.label`                   | Device                                                              |
| `end-user.account.sessions.col-ip.label`                       | IP address                                                          |
| `end-user.account.sessions.col-created.label`                  | Started                                                             |
| `end-user.account.sessions.col-expires.label`                  | Expires                                                             |
| `end-user.account.sessions.action-revoke.label`                | Revoke                                                              |
| `end-user.account.sessions.action-revoke-others.label`         | Revoke all other sessions                                           |
| `end-user.account.danger.title.label`                          | Danger zone                                                         |
| `end-user.account.danger.delete.label`                         | Delete account                                                      |
| `end-user.account.danger.dialog-title.text`             | Delete your OpenWhispr account                                      |
| `end-user.account.danger.dialog-body.text`              | This deletes your transcriptions, notes, conversations, and sessions. Type your email to confirm. |
| `end-user.account.danger.dialog-input.label`            | Type your email to confirm                                          |
| `end-user.account.danger.dialog-confirm.label`          | Delete account                                                      |
| `end-user.account.error.title.text`                            | Could not load account                                              |
| `end-user.account.error.retry.label`                           | Retry                                                               |

### Wireframe

```text
+--------------------------------------------------------------+
| Sidebar     | Account                                        |
| - Dashboard | Manage your profile and sessions.              |
| - Trx       |                                                |
| - Notes     | +--------------------------------------------+ |
| - Convs     | | Profile                                    | |
| - Account   | | Name      Alice Operator                   | |
|             | | Email     alice@example.com [Verified]     | |
|             | | Created   2025-08-12                       | |
|             | +--------------------------------------------+ |
|             | +--------------------------------------------+ |
|             | | Active sessions      [Revoke all others]   | |
|             | | Device         IP        Started  [Revoke] | |
|             | | Chrome / mac   1.2.3.4   Today    [Revoke] | |
|             | | Firefox / lin  5.6.7.8   Yest.    [Revoke] | |
|             | +--------------------------------------------+ |
|             | +--------------------------------------------+ |
|             | | Danger zone                                | |
|             | | [ Delete account ]                         | |
|             | +--------------------------------------------+ |
+--------------------------------------------------------------+
```

Desktop ≥1024px: single column, cards stacked. Tablet/mobile preserved.

See visual: design/screens-user.jsx#ScreenAccount

### shadcn primitives

`Card`, `Table`, `Skeleton`, `Badge`, `Button`, `AlertDialog`, `Input`, `Label`, `Alert`, `Separator`

## U6 — Transcriptions list

### Purpose

Authenticated, paginated table of the user's own transcriptions. Read-only
listing with row-level Delete and click-through to U7.

### Roles

Authenticated end-user surface. Server scopes results to the signed-in user.

### Route

`/app/transcriptions` (Next.js App Router segment under
`app/(app)/app/transcriptions/page.tsx`). Sidebar entry labelled by copy
key `end-user.trx-list.nav.sidebar.label`.

### Data

| Field             | Source                                         | Notes                                                |
|-------------------|------------------------------------------------|------------------------------------------------------|
| Rows              | `GET /api/transcriptions/list?limit=&before=`  | Keyset paginated; each row matches `rowToCloudTranscription` |
| Visible columns   | `created_at`, `text` (truncated), `word_count`, `audio_duration_ms`, `provider`, `model`, `language`, `status` | — |

TanStack Query keys:
- `queryKeys.transcriptions.list({ limit, before, since })`.

### Actions

- **Row click** → navigate to `/app/transcriptions/[id]` (U7).
- **Row Delete** → `<DeleteConfirmDialog>` →
  `DELETE /api/transcriptions/delete` with `{ id }`. On 200: invalidate
  `queryKeys.transcriptions.list(*)`.
- **Load more** (keyset cursor) → refetch with `before=<oldest_created_at>`.
- **Refresh** → invalidate the list query.

### States

| State    | Trigger                                                | UI                                                                  |
|----------|--------------------------------------------------------|---------------------------------------------------------------------|
| loading  | Initial fetch in flight                                | Five `Skeleton` rows                                                |
| success  | 200 with rows                                          | `Table` with rows, footer load-more button                          |
| empty    | 200 with zero rows                                     | Empty-state card with "No transcriptions yet" + desktop-client CTA  |
| error    | 401 / 5xx / network                                    | `Alert` above the table with Retry                                  |

### User journey

1. User clicks Transcriptions in the sidebar.
2. Table loads; user scans rows and previews truncated text.
3. User clicks a row to open U7, or clicks the row's Delete kebab.
4. Delete dialog confirms; on success the row vanishes.
5. User clicks Load more to fetch the next keyset page.

### Copy keys

| Key                                                            | English value                                                       |
|----------------------------------------------------------------|---------------------------------------------------------------------|
| `end-user.trx-list.nav.sidebar.label`                          | Transcriptions                                                      |
| `end-user.trx-list.title.heading.text`                         | Transcriptions                                                      |
| `end-user.trx-list.subtitle.body.text`                         | All audio you have transcribed with the desktop client.             |
| `end-user.trx-list.table.col-created.label`                          | Created                                                             |
| `end-user.trx-list.table.col-preview.label`                          | Preview                                                             |
| `end-user.trx-list.table.col-words.label`                            | Words                                                               |
| `end-user.trx-list.table.col-duration.label`                         | Duration                                                            |
| `end-user.trx-list.table.col-provider.label`                         | Provider                                                            |
| `end-user.trx-list.table.col-model.label`                            | Model                                                               |
| `end-user.trx-list.table.col-language.label`                         | Language                                                            |
| `end-user.trx-list.table.col-status.label`                           | Status                                                              |
| `end-user.trx-list.row.action-delete.label`                    | Delete                                                              |
| `end-user.trx-list.action.loadmore.label`                      | Load more                                                           |
| `end-user.trx-list.empty.title.text`                           | No transcriptions yet                                               |
| `end-user.trx-list.empty.body.text`                            | Record audio in the desktop client and your transcriptions show up here. |
| `end-user.trx-list.error.title.text`                           | Could not load transcriptions                                       |
| `end-user.trx-list.error.retry.label`                          | Retry                                                               |

### Wireframe

```text
+--------------------------------------------------------------+
| Sidebar     | Transcriptions                       [Refresh] |
| - Dashboard |                                                |
| - Trx       | Created   Preview            Words Dur Prov ...|
| - Notes     | -----------------------------------------------|
| - Convs     | Today      "Meeting notes..." 412   2m  openai |
| - Account   | Yest.      "Lunch idea..."    18    8s  whisper|
|             | 2025-11-12 "Phone call..."    1.2k  6m  groq   |
|             | ...                                            |
|             |                              [Load more]       |
+--------------------------------------------------------------+
```

Desktop ≥1024px: full-width Table. Tablet 640–1024: Table preserved with
horizontal scroll. Mobile <640: cards-per-row layout.

See visual: design/screens-user.jsx#ScreenTrxList

### shadcn primitives

`Card`, `Table`, `Skeleton`, `Button`, `Badge`, `DropdownMenu`, `AlertDialog`, `Alert`

## U7 — Transcription detail

### Purpose

Authenticated, read-only deep-view of one transcription. **Renders the
transcript as flat paragraphs with no timecodes** (D-API1) — the live API
returns `text`, `raw_text`, and metadata but no word-level timestamps. The
00:00 / 00:42 markers in Claude Design's mockup are decorative only and are
not implemented.

### Roles

Authenticated end-user surface. The API filters by `user_id` server-side.

### Route

`/app/transcriptions/[id]` (Next.js App Router dynamic segment under
`app/(app)/app/transcriptions/[id]/page.tsx`).

### Data

| Field             | Source                                                | Notes                                                |
|-------------------|-------------------------------------------------------|------------------------------------------------------|
| Transcript        | `GET /api/transcriptions/list` filtered client-side   | The list endpoint accepts keyset cursors but not `?id=`. Client fetches the latest page and locates the row by id; if not found, refetches with `before=<id-created_at>` until found. Documented fallback because no `/api/transcriptions/:id` endpoint exists (the list endpoint is the only read path in v1) |
| `text`            | Row field                                             | Rendered as flat paragraphs (D-API1: no timecodes)   |
| Metadata sidebar  | Row fields: `word_count`, `audio_duration_ms`, `provider`, `model`, `language`, `status`, `created_at` | Right-side panel |

TanStack Query keys:
- `queryKeys.transcriptions.detail(id)` — resolves the row from the list cache.

### Actions

- **Copy to clipboard** → `navigator.clipboard.writeText(row.text)`. Toast.
- **Export .md** → client-side `Blob` of `# <created_at>\n\n<text>`.
- **Export .json** → client-side `Blob` of the full row.
- **Delete** → `<DeleteConfirmDialog>` → `DELETE /api/transcriptions/delete`
  with `{ id }`. On 200: navigate back to U6 and invalidate
  `queryKeys.transcriptions.list(*)`.
- **Back** → navigates to `/app/transcriptions`.

### States

| State    | Trigger                                                | UI                                                                  |
|----------|--------------------------------------------------------|---------------------------------------------------------------------|
| loading  | Fetch in flight                                        | `Skeleton` paragraphs in main column; `Skeleton` rows in sidebar    |
| success  | Row located                                            | Transcript paragraphs + metadata sidebar                            |
| empty    | Row not found after keyset scan                        | "Transcription not found" card with Back-to-list CTA                |
| error    | 401 / 5xx / network                                    | `Alert` with Retry                                                  |

### User journey

1. User clicks a row in U6.
2. Detail page loads; main column shows flat paragraphs; sidebar shows
   word count, duration, provider, model, language, status, created-at.
3. User copies to clipboard, exports as .md or .json, or deletes the row.
4. On delete, user is bounced back to U6 with the list refreshed.

### Copy keys

| Key                                                       | English value                                                       |
|-----------------------------------------------------------|---------------------------------------------------------------------|
| `end-user.trx-detail.title.heading.text`                  | Transcription                                                       |
| `end-user.trx-detail.action.back.label`                   | Back to list                                                        |
| `end-user.trx-detail.action.copy.label`                   | Copy                                                                |
| `end-user.trx-detail.action.export-md.label`              | Export as Markdown                                                  |
| `end-user.trx-detail.action.export-json.label`            | Export as JSON                                                      |
| `end-user.trx-detail.action.delete.label`                 | Delete                                                              |
| `end-user.trx-detail.metadata.title.label`                | Details                                                             |
| `end-user.trx-detail.metadata.words.label`                | Word count                                                          |
| `end-user.trx-detail.metadata.duration.label`             | Audio duration                                                      |
| `end-user.trx-detail.metadata.provider.label`             | Provider                                                            |
| `end-user.trx-detail.metadata.model.label`                | Model                                                               |
| `end-user.trx-detail.metadata.language.label`             | Language                                                            |
| `end-user.trx-detail.metadata.status.label`               | Status                                                              |
| `end-user.trx-detail.metadata.created.label`              | Created                                                             |
| `end-user.trx-detail.empty.title.text`                    | Transcription not found                                             |
| `end-user.trx-detail.empty.body.text`                     | This transcription does not exist or was deleted.                   |
| `end-user.trx-detail.error.title.text`                    | Could not load transcription                                        |
| `end-user.trx-detail.error.retry.label`                   | Retry                                                               |

### Wireframe

```text
+--------------------------------------------------------------+
| Sidebar     | Transcription          [Copy][.md][.json][Del] |
| - Dashboard | (transcript rendered as flat paragraphs — no   |
| - Trx       |  timecodes — D-API1)                           |
| - Notes     |                                                |
| - Convs     | Paragraph one of the transcript text.          |
| - Account   | Paragraph two of the transcript text.          |
|             | Paragraph three ...                            |
|             |                                                |
|             |                  +--------------------------+  |
|             |                  | Details                  |  |
|             |                  | Words      412           |  |
|             |                  | Duration   2m 14s        |  |
|             |                  | Provider   openai        |  |
|             |                  | Model      whisper-1     |  |
|             |                  | Language   en            |  |
|             |                  | Status     done          |  |
|             |                  | Created    2026-05-12    |  |
|             |                  +--------------------------+  |
+--------------------------------------------------------------+
```

Desktop ≥1024px: two-column (main + 280px sidebar). Tablet 640–1024:
sidebar collapses below main. Mobile <640: single-column.

See visual: design/screens-user.jsx#ScreenTrxDetail

### shadcn primitives

`Card`, `Skeleton`, `Button`, `DropdownMenu`, `AlertDialog`, `Badge`, `Separator`, `Alert`

## U8 — Notes list

### Purpose

Authenticated, two-pane view of the user's notes: a read-only folders sidebar
(D-UX5 — no folder CRUD UI; desktop client owns folder writes) plus a
paginated notes table on the right. Search affordance navigates to U10.

### Roles

Authenticated end-user surface. Folders and notes are user-scoped server-side.

### Route

`/app/notes` (Next.js App Router segment under `app/(app)/app/notes/page.tsx`).
Sidebar entry labelled by copy key `end-user.notes-list.nav.sidebar.label`.

### Data

| Field            | Source                                                | Notes                                                       |
|------------------|-------------------------------------------------------|-------------------------------------------------------------|
| Folders tree     | `GET /api/folders/list?limit=&before=`                | Read-only navigation (D-UX5)                                |
| Notes rows       | `GET /api/notes/list?limit=&before=&since=`           | Keyset; filter by selected folder client-side               |
| Columns          | `created_at`, title-preview, folder name, word count  | Title-preview is the first line of `content`                |

TanStack Query keys:
- `queryKeys.folders.list({ limit, before })`.
- `queryKeys.notes.list({ limit, before, since })`.

### Actions

- **Click a folder** → filter notes table client-side by folder id.
- **Row click** → navigate to `/app/notes/[id]` (U9).
- **Row Delete** → `<DeleteConfirmDialog>` → `DELETE /api/notes/delete`
  with `{ id }`. On 200: invalidate `queryKeys.notes.list(*)`.
- **Search** (toolbar) → navigates to U10 with the typed `q`.
- **Load more** → keyset refetch.

Folder create/rename/delete affordances are intentionally absent (D-UX5).

### States

| State    | Trigger                                                | UI                                                                  |
|----------|--------------------------------------------------------|---------------------------------------------------------------------|
| loading  | Either fetch in flight                                 | `Skeleton` folders + skeleton rows                                  |
| success  | Both 200                                               | Folders tree + notes table                                          |
| empty    | Notes list returns zero rows                           | Empty-state card with "No notes yet"                                |
| error    | 401 / 5xx on either fetch                              | `Alert` per pane                                                    |

### User journey

1. User opens Notes from the sidebar.
2. Left pane shows the user's folder tree (read-only).
3. Right pane shows the user's notes (all folders by default).
4. User clicks a folder to filter the right pane.
5. User clicks a row to open U9, deletes a row, or jumps to U10 search.

### Copy keys

| Key                                                            | English value                                                       |
|----------------------------------------------------------------|---------------------------------------------------------------------|
| `end-user.notes-list.nav.sidebar.label`                        | Notes                                                               |
| `end-user.notes-list.title.heading.text`                       | Notes                                                               |
| `end-user.notes-list.subtitle.body.text`                       | Notes recorded with the desktop client.                             |
| `end-user.notes-list.folders.title.label`                      | Folders                                                             |
| `end-user.notes-list.folders.readonly-body.text`               | Folder management is in the desktop client.                         |
| `end-user.notes-list.table.col-created.label`                        | Created                                                             |
| `end-user.notes-list.table.col-title.label`                          | Title                                                               |
| `end-user.notes-list.table.col-folder.label`                         | Folder                                                              |
| `end-user.notes-list.table.col-words.label`                          | Words                                                               |
| `end-user.notes-list.row.action-delete.label`                  | Delete                                                              |
| `end-user.notes-list.action.search.label`                      | Search notes                                                        |
| `end-user.notes-list.action.loadmore.label`                    | Load more                                                           |
| `end-user.notes-list.empty.title.text`                         | No notes yet                                                        |
| `end-user.notes-list.empty.body.text`                          | Record a note in the desktop client to see it here.                 |
| `end-user.notes-list.error.title.text`                         | Could not load notes                                                |
| `end-user.notes-list.error.retry.label`                        | Retry                                                               |

### Wireframe

```text
+--------------------------------------------------------------+
| Sidebar     | Notes                  [Search]      [Refresh] |
| - Dashboard | +------------+ +-----------------------------+ |
| - Trx       | | Folders    | | Created  Title    Folder Wd | |
| - Notes     | | (readonly) | | -------------------------- | |
| - Convs     | |            | | Today    Ideas    Work  84 | |
| - Account   | | - Inbox    | | Yest.    Lunch    Inbox 12 | |
|             | | - Work     | | 11/12    Phone    Inbox 1.2k | |
|             | | - Trips    | |                  [Load more] | |
|             | +------------+ +-----------------------------+ |
+--------------------------------------------------------------+
```

Desktop ≥1024px: two-pane (240px folders + main). Tablet 640–1024:
folders collapse into a Sheet drawer. Mobile <640: drawer-style folders.

See visual: design/screens-user.jsx#ScreenNotesList

### shadcn primitives

`Card`, `Table`, `Skeleton`, `Button`, `Input`, `Badge`, `DropdownMenu`, `AlertDialog`, `Sheet`, `ScrollArea`, `Alert`

## U9 — Note detail

### Purpose

Authenticated, read-only deep view of one note. Surfaces the full note
record fields (content, transcript, enhanced content, enhancement prompt,
audio duration, participants, type, folder breadcrumb).

### Roles

Authenticated end-user surface. Server filters by user.

### Route

`/app/notes/[id]` (Next.js App Router dynamic segment under
`app/(app)/app/notes/[id]/page.tsx`).

### Data

| Field          | Source                                              | Notes                                              |
|----------------|-----------------------------------------------------|----------------------------------------------------|
| Note row       | `GET /api/notes/list` filtered client-side by id    | Same fallback as U7 (no `:id` endpoint)            |
| Fields         | `content`, `transcript`, `enhanced_content`, `enhancement_prompt`, `audio_duration_seconds`, `participants`, `note_type`, `folder_id`, `created_at` | — |

TanStack Query keys:
- `queryKeys.notes.detail(id)` — resolves from list cache.

### Actions

- **Copy** → `navigator.clipboard.writeText(row.content)`.
- **Export .md** → client-side `Blob` with content + transcript sections.
- **Export .json** → client-side `Blob` of the row.
- **Delete** → `<DeleteConfirmDialog>` → `DELETE /api/notes/delete`. On 200:
  navigate to U8 and invalidate notes list.
- **Back** → navigates to U8.

### States

| State    | Trigger                                                | UI                                                                  |
|----------|--------------------------------------------------------|---------------------------------------------------------------------|
| loading  | Fetch in flight                                        | `Skeleton` body and sidebar                                         |
| success  | Row located                                            | Tabbed body (Content / Transcript / Enhanced) + metadata sidebar    |
| empty    | Row not found                                          | "Note not found" card                                               |
| error    | 401 / 5xx / network                                    | `Alert` with Retry                                                  |

### User journey

1. User clicks a row in U8.
2. Detail page renders; user toggles between Content / Transcript /
   Enhanced tabs.
3. Sidebar shows participants, duration, note type, folder breadcrumb.
4. User copies / exports / deletes.

### Copy keys

| Key                                                            | English value                                                       |
|----------------------------------------------------------------|---------------------------------------------------------------------|
| `end-user.note-detail.title.heading.text`                      | Note                                                                |
| `end-user.note-detail.action.back.label`                       | Back to notes                                                       |
| `end-user.note-detail.action.copy.label`                       | Copy                                                                |
| `end-user.note-detail.action.export-md.label`                  | Export as Markdown                                                  |
| `end-user.note-detail.action.export-json.label`                | Export as JSON                                                      |
| `end-user.note-detail.action.delete.label`                     | Delete                                                              |
| `end-user.note-detail.tabs.content.label`                      | Content                                                             |
| `end-user.note-detail.tabs.transcript.label`                   | Transcript                                                          |
| `end-user.note-detail.tabs.enhanced.label`                     | Enhanced                                                            |
| `end-user.note-detail.metadata.title.label`                    | Details                                                             |
| `end-user.note-detail.metadata.folder.label`                   | Folder                                                              |
| `end-user.note-detail.metadata.duration.label`                 | Audio duration                                                      |
| `end-user.note-detail.metadata.participants.label`             | Participants                                                        |
| `end-user.note-detail.metadata.type.label`                     | Note type                                                           |
| `end-user.note-detail.metadata.created.label`                  | Created                                                             |
| `end-user.note-detail.empty.title.text`                        | Note not found                                                      |
| `end-user.note-detail.empty.body.text`                         | This note does not exist or was deleted.                            |
| `end-user.note-detail.error.title.text`                        | Could not load note                                                 |
| `end-user.note-detail.error.retry.label`                       | Retry                                                               |

### Wireframe

```text
+--------------------------------------------------------------+
| Sidebar     | Note                   [Copy][.md][.json][Del] |
| - Dashboard | Folder: Work / Q2 plans                        |
| - Notes     |                                                |
| - Convs     | [Content] [Transcript] [Enhanced]              |
| - Account   |                                                |
|             | The text content of the note as the user wrote |
|             | it via the desktop client.                     |
|             |                                                |
|             |                  +--------------------------+  |
|             |                  | Details                  |  |
|             |                  | Folder     Work / Q2 plan|  |
|             |                  | Duration   8m 14s        |  |
|             |                  | Participants Alice, Bob  |  |
|             |                  | Type       meeting       |  |
|             |                  | Created    2026-05-12    |  |
|             |                  +--------------------------+  |
+--------------------------------------------------------------+
```

Desktop ≥1024px: two-column (main + 280px sidebar). Tablet/mobile: stacks.

See visual: design/screens-user.jsx#ScreenNoteDetail

### shadcn primitives

`Card`, `Tabs`, `Skeleton`, `Button`, `DropdownMenu`, `AlertDialog`, `Badge`, `Separator`, `Alert`

## U10 — Notes search

### Purpose

Authenticated full-text-ish search over the user's own notes. Submits the
query as a JSON body to the live `POST /api/notes/search` endpoint (verified
in Plan 01 — note: HTTP method is **POST**, not GET).

### Roles

Authenticated end-user surface.

### Route

`/app/notes/search?q=<query>` (Next.js App Router segment under
`app/(app)/app/notes/search/page.tsx`). The `?q=` query parameter is read
client-side and forwarded into the POST body.

### Data

| Field    | Source                                                | Notes                                                       |
|----------|-------------------------------------------------------|-------------------------------------------------------------|
| Results  | `POST /api/notes/search` body `{ query: string, limit?: number }` | Returns `{ notes: (CloudNote & { score })[] }` |
| `q`      | `useSearchParams().get('q')`                          | Drives the POST body; missing `q` → empty state             |

TanStack Query keys:
- `queryKeys.notes.search({ query, limit })`.

### Actions

- **Submit search input** → push `?q=<value>` and refetch.
- **Result row click** → navigate to `/app/notes/[id]` (U9).
- **Clear** → push `?q=` (empty), show empty state.

### States

| State    | Trigger                                                | UI                                                                  |
|----------|--------------------------------------------------------|---------------------------------------------------------------------|
| loading  | Fetch in flight                                        | `Skeleton` result rows                                              |
| success  | 200 with rows                                          | Result list with score badge                                        |
| empty    | `q` missing, or 200 with zero rows                     | "Type to search" or "No results" card                               |
| error    | 401 / 4xx / 5xx                                        | `Alert` with Retry                                                  |

### User journey

1. User clicks Search in U8 or lands on `/app/notes/search?q=foo`.
2. Page shows the search input and (if `q` present) result rows.
3. User clicks a result → opens U9.

### Copy keys

| Key                                                       | English value                                                       |
|-----------------------------------------------------------|---------------------------------------------------------------------|
| `end-user.notes-search.title.heading.text`                | Search notes                                                        |
| `end-user.notes-search.input.placeholder.text`            | Search your notes                                                   |
| `end-user.notes-search.action.submit.label`               | Search                                                              |
| `end-user.notes-search.action.clear.label`                | Clear                                                               |
| `end-user.notes-search.result.score.label`                | Score                                                               |
| `end-user.notes-search.empty.type.text`                   | Type a query to search your notes.                                  |
| `end-user.notes-search.empty.none.text`                   | No notes match this query.                                          |
| `end-user.notes-search.error.title.text`                  | Search failed                                                       |
| `end-user.notes-search.error.retry.label`                 | Retry                                                               |

### Wireframe

```text
+--------------------------------------------------------------+
| Sidebar     | Search notes                                   |
| - Dashboard | [ search input...........................][Go] |
| - Notes     |                                                |
| - Convs     | Results                                        |
| - Account   | -------                                        |
|             | Title preview            Folder  Score         |
|             | "Ideas for Q2"           Work    0.91          |
|             | "Lunch with Bob"         Inbox   0.74          |
|             | "Phone call with..."     Inbox   0.61          |
+--------------------------------------------------------------+
```

Desktop ≥1024px: single column with search above and result list below.
Tablet/mobile preserved.

See visual: design/screens-user.jsx#ScreenNotesSearch

### shadcn primitives

`Card`, `Input`, `Button`, `Skeleton`, `Badge`, `Alert`, `Separator`

## U11 — Conversations list

### Purpose

Authenticated, paginated table of the user's own LLM conversations. Read-only
listing with row-level Delete and click-through to U12.

### Roles

Authenticated end-user surface. Server filters by user.

### Route

`/app/conversations` (Next.js App Router segment under
`app/(app)/app/conversations/page.tsx`). Sidebar entry labelled by copy
key `end-user.conv-list.nav.sidebar.label`.

### Data

| Field           | Source                                                  | Notes                                                |
|-----------------|---------------------------------------------------------|------------------------------------------------------|
| Rows            | `GET /api/conversations/list?limit=&before=`            | Keyset; `include=messages` not requested here        |
| Columns         | `created_at`, `title`, `updated_at`, message count      | message count is derived from the optional `messages` field; omitted unless `include=messages` |

TanStack Query keys:
- `queryKeys.conversations.list({ limit, before })`.

### Actions

- **Row click** → navigate to `/app/conversations/[id]` (U12).
- **Row Delete** → `<DeleteConfirmDialog>` →
  `DELETE /api/conversations/delete` with `{ id }`. On 200: invalidate
  `queryKeys.conversations.list(*)`.
- **Load more** → keyset refetch.
- **Search** (toolbar) → navigates to U13.

### States

| State    | Trigger                                                | UI                                                                  |
|----------|--------------------------------------------------------|---------------------------------------------------------------------|
| loading  | Initial fetch in flight                                | Five `Skeleton` rows                                                |
| success  | 200 with rows                                          | `Table` with rows                                                   |
| empty    | 200 with zero rows                                     | Empty-state card with desktop-client CTA                            |
| error    | 401 / 5xx / network                                    | `Alert` with Retry                                                  |

### User journey

1. User clicks Conversations in the sidebar.
2. Table loads; user scans titles and timestamps.
3. User clicks a row to open U12, or deletes via kebab.

### Copy keys

| Key                                                            | English value                                                       |
|----------------------------------------------------------------|---------------------------------------------------------------------|
| `end-user.conv-list.nav.sidebar.label`                         | Conversations                                                       |
| `end-user.conv-list.title.heading.text`                        | Conversations                                                       |
| `end-user.conv-list.subtitle.body.text`                        | LLM chats started from the desktop client.                          |
| `end-user.conv-list.table.col-created.label`                         | Created                                                             |
| `end-user.conv-list.table.col-title.label`                           | Title                                                               |
| `end-user.conv-list.table.col-updated.label`                         | Updated                                                             |
| `end-user.conv-list.row.action-delete.label`                   | Delete                                                              |
| `end-user.conv-list.action.search.label`                       | Search conversations                                                |
| `end-user.conv-list.action.loadmore.label`                     | Load more                                                           |
| `end-user.conv-list.empty.title.text`                          | No conversations yet                                                |
| `end-user.conv-list.empty.body.text`                           | Start a chat in the desktop client to see it here.                  |
| `end-user.conv-list.error.title.text`                          | Could not load conversations                                        |
| `end-user.conv-list.error.retry.label`                         | Retry                                                               |

### Wireframe

```text
+--------------------------------------------------------------+
| Sidebar     | Conversations          [Search]      [Refresh] |
| - Dashboard |                                                |
| - Trx       | Created    Title                  Updated      |
| - Notes     | --------------------------------------------   |
| - Convs     | Today      "Plan Q2 roadmap"      2 min ago    |
| - Account   | Yest.      "Compare GPUs"         1 day ago    |
|             | 11/12      "Email draft"          3 days ago   |
|             |                              [Load more]       |
+--------------------------------------------------------------+
```

Desktop ≥1024px: full-width Table. Tablet/mobile: horizontal scroll or
card stack.

See visual: design/screens-user.jsx#ScreenConvList

### shadcn primitives

`Card`, `Table`, `Skeleton`, `Button`, `Badge`, `DropdownMenu`, `AlertDialog`, `Alert`

## U12 — Conversation detail

### Purpose

Authenticated thread view of one LLM conversation. Renders each message with
role, content, and metadata, in chronological order. Note: the endpoint
`/api/conversations/messages` is dual-method — this screen uses the GET
variant; the POST variant is desktop-client only.

### Roles

Authenticated end-user surface. Server filters by user via the parent
conversation's user_id.

### Route

`/app/conversations/[id]` (Next.js App Router dynamic segment under
`app/(app)/app/conversations/[id]/page.tsx`).

### Data

| Field              | Source                                                        | Notes                                                          |
|--------------------|---------------------------------------------------------------|----------------------------------------------------------------|
| Conversation       | `GET /api/conversations/list?include=messages` filtered by id | Header metadata (title, created_at, updated_at)                |
| Messages thread    | `GET /api/conversations/messages?conversation_id=<id>&limit=&before=` | Keyset paginated; ordered created_at ASC               |
| Message fields     | `id`, `role`, `content`, `metadata`, `created_at`             | role rendered as a Badge; content rendered as Markdown         |

TanStack Query keys:
- `queryKeys.conversations.detail(id)`.
- `queryKeys.conversations.messages({ conversationId, limit, before })`.

### Actions

- **Copy entire transcript** → joins messages as
  `### <role>\n<content>` and copies to clipboard.
- **Export .json** → client-side `Blob` of `{ conversation, messages }`.
- **Delete conversation** → `<DeleteConfirmDialog>` →
  `DELETE /api/conversations/delete`. On 200: navigate to U11 and invalidate.
- **Load earlier messages** → keyset cursor refetch (`before=<oldest>`).
- **Back** → navigates to U11.

### States

| State    | Trigger                                                | UI                                                                  |
|----------|--------------------------------------------------------|---------------------------------------------------------------------|
| loading  | Either fetch in flight                                 | `Skeleton` message bubbles                                          |
| success  | Both 200                                               | Message thread + header + actions                                   |
| empty    | Conversation has zero messages                         | Empty-state "Conversation has no messages"                          |
| error    | 401 / 5xx / network                                    | `Alert` with Retry                                                  |

### User journey

1. User clicks a row in U11.
2. Detail page loads; messages render top-to-bottom in time order.
3. User scrolls; "Load earlier messages" fetches the previous keyset page.
4. User copies the transcript, exports JSON, or deletes the conversation.

### Copy keys

| Key                                                            | English value                                                       |
|----------------------------------------------------------------|---------------------------------------------------------------------|
| `end-user.conv-detail.title.heading.text`                      | Conversation                                                        |
| `end-user.conv-detail.action.back.label`                       | Back to conversations                                               |
| `end-user.conv-detail.action.copy.label`                       | Copy transcript                                                     |
| `end-user.conv-detail.action.export-json.label`                | Export as JSON                                                      |
| `end-user.conv-detail.action.delete.label`                     | Delete conversation                                                 |
| `end-user.conv-detail.action.loadearlier.label`                | Load earlier messages                                               |
| `end-user.conv-detail.role.user.label`                         | You                                                                 |
| `end-user.conv-detail.role.assistant.label`                    | Assistant                                                           |
| `end-user.conv-detail.role.system.label`                       | System                                                              |
| `end-user.conv-detail.role.tool.label`                         | Tool                                                                |
| `end-user.conv-detail.empty.title.text`                        | No messages                                                         |
| `end-user.conv-detail.empty.body.text`                         | This conversation does not contain any messages yet.                |
| `end-user.conv-detail.error.title.text`                        | Could not load conversation                                         |
| `end-user.conv-detail.error.retry.label`                       | Retry                                                               |

### Wireframe

```text
+--------------------------------------------------------------+
| Sidebar     | Plan Q2 roadmap        [Copy][.json][Delete]   |
| - Dashboard |                                                |
| - Trx       | [Load earlier messages]                        |
| - Notes     |                                                |
| - Convs     | [You] Let's draft the Q2 plan.                 |
| - Account   |                                                |
|             | [Assistant] Sure — what's the headline goal?   |
|             |                                                |
|             | [You] Ship Phase 8 by end of June.             |
|             |                                                |
|             | [Assistant] Here's a proposed timeline ...     |
+--------------------------------------------------------------+
```

Desktop ≥1024px: single column thread, 720px max width. Tablet/mobile:
full-width thread.

See visual: design/screens-user.jsx#ScreenConvDetail

### shadcn primitives

`Card`, `Skeleton`, `Button`, `Badge`, `DropdownMenu`, `AlertDialog`, `Separator`, `ScrollArea`, `Alert`

## U13 — Conversations search

### Purpose

Authenticated full-text-ish search over the user's own conversations. Submits
the query as a JSON body to the live `POST /api/conversations/search`
endpoint (verified in Plan 01 — note: HTTP method is **POST**, not GET).

### Roles

Authenticated end-user surface.

### Route

`/app/conversations/search?q=<query>` (Next.js App Router segment under
`app/(app)/app/conversations/search/page.tsx`).

### Data

| Field    | Source                                                       | Notes                                                       |
|----------|--------------------------------------------------------------|-------------------------------------------------------------|
| Results  | `POST /api/conversations/search` body `{ query: string, limit?: number }` | Returns `{ conversations: (CloudConversation & { score })[] }` |
| `q`      | `useSearchParams().get('q')`                                 | Drives the POST body; missing `q` → empty state             |

TanStack Query keys:
- `queryKeys.conversations.search({ query, limit })`.

### Actions

- **Submit search input** → push `?q=<value>` and refetch.
- **Result row click** → navigate to `/app/conversations/[id]` (U12).
- **Clear** → push `?q=` (empty), show empty state.

### States

| State    | Trigger                                                | UI                                                                  |
|----------|--------------------------------------------------------|---------------------------------------------------------------------|
| loading  | Fetch in flight                                        | `Skeleton` result rows                                              |
| success  | 200 with rows                                          | Result list with score badge                                        |
| empty    | `q` missing, or 200 with zero rows                     | "Type to search" or "No results" card                               |
| error    | 401 / 4xx / 5xx                                        | `Alert` with Retry                                                  |

### User journey

1. User clicks Search in U11 or lands on `/app/conversations/search?q=foo`.
2. Page shows the search input and (if `q` present) result rows.
3. User clicks a result → opens U12.

### Copy keys

| Key                                                            | English value                                                       |
|----------------------------------------------------------------|---------------------------------------------------------------------|
| `end-user.conv-search.title.heading.text`                      | Search conversations                                                |
| `end-user.conv-search.input.placeholder.text`                  | Search your conversations                                           |
| `end-user.conv-search.action.submit.label`                     | Search                                                              |
| `end-user.conv-search.action.clear.label`                      | Clear                                                               |
| `end-user.conv-search.result.score.label`                      | Score                                                               |
| `end-user.conv-search.empty.type.text`                         | Type a query to search your conversations.                          |
| `end-user.conv-search.empty.none.text`                         | No conversations match this query.                                  |
| `end-user.conv-search.error.title.text`                        | Search failed                                                       |
| `end-user.conv-search.error.retry.label`                       | Retry                                                               |

### Wireframe

```text
+--------------------------------------------------------------+
| Sidebar     | Search conversations                           |
| - Dashboard | [ search input...........................][Go] |
| - Trx       |                                                |
| - Notes     | Results                                        |
| - Convs     | -------                                        |
| - Account   | Title                       Updated   Score    |
|             | "Plan Q2 roadmap"           today     0.94     |
|             | "Compare GPUs"              yest.     0.71     |
|             | "Email draft to legal"      11/12     0.58     |
+--------------------------------------------------------------+
```

Desktop ≥1024px: single column with search above and result list below.
Tablet/mobile preserved.

See visual: design/screens-user.jsx#ScreenConvSearch

### shadcn primitives

`Card`, `Input`, `Button`, `Skeleton`, `Badge`, `Alert`, `Separator`

## API Reference (verified)

Every endpoint the end-user surface references, with HTTP method, request
shape, response shape, auth requirement, and a citation back to the live route
file or to the Better Auth catch-all handler. **HTTP method is read from the
route file's `method:` key inside `app.route({...})` or the literal in
`app.<method>(...)` — not inferred.**

| Method | Path | Auth | Request | Response (fields) | Source |
|--------|------|------|---------|-------------------|--------|
| GET    | /api/usage                       | session (dual-auth) | — | `{ wordsUsed: number, wordsRemaining: 999_999_999, plan: 'unlimited', limitReached: false }` | apps/api/src/routes/usage.ts:38-73 |
| POST   | /api/streaming-usage             | session (dual-auth) | `StreamingUsageBodySchema` (sessionId, audioDurationSeconds, …12 optional telemetry fields) | `{ wordsUsed, wordsRemaining, plan, limitReached }` (same envelope as `/api/usage`) | apps/api/src/routes/streaming-usage.ts:56-137 |
| GET    | /api/transcriptions/list         | session (dual-auth) | Query: `?limit=&before=&since=` (keyset) | `{ transcriptions: CloudTranscription[] }` — each row: `{ id, user_id, text, raw_text, word_count, audio_duration_ms, provider, model, language, status, created_at, ... }` (rowToCloudTranscription) | apps/api/src/routes/transcriptions/list.ts:37-77 |
| DELETE | /api/transcriptions/delete       | session (dual-auth) | Body: `{ id: uuid }` | `{ ok: true }` or 404 `{ error: 'transcription not found' }` | apps/api/src/routes/transcriptions/delete.ts:35-65 |
| GET    | /api/notes/list                  | session (dual-auth) | Query: `?limit=&before=&since=` (keyset) | `{ notes: CloudNote[] }` — each row via rowToCloudNote | apps/api/src/routes/notes/list.ts:40-77 |
| POST   | /api/notes/search                | session (dual-auth) | Body: `{ query: string (1..256), limit?: number }` (strict zod) | `{ notes: (CloudNote & { score: number })[] }` | apps/api/src/routes/notes/search.ts:49-96 |
| DELETE | /api/notes/delete                | session (dual-auth) | Body: `{ id: uuid }` | `{ ok: true }` or 404 `{ error: 'note not found' }` | apps/api/src/routes/notes/delete.ts:32-63 |
| GET    | /api/folders/list                | session (dual-auth) | Query: `?limit=&before=&since=` (keyset) | `{ folders: CloudFolder[] }` — each row via rowToCloudFolder | apps/api/src/routes/folders/list.ts:41-78 |
| GET    | /api/conversations/list          | session (dual-auth) | Query: `?limit=&before=&since=[&include=messages]` | `{ conversations: CloudConversation[] }` or, when `include=messages`, each row carries `messages: CloudMessage[]` (capped at 100, ordered created_at ASC) | apps/api/src/routes/conversations/list.ts:54-140 |
| GET    | /api/conversations/messages      | session (dual-auth) | Query: `?conversation_id=<uuid>&limit=&before=&since=` | `{ messages: CloudMessage[] }` — each row: `{ id, conversation_id, role, content, metadata, created_at }` | apps/api/src/routes/conversations/messages.ts:144-208 |
| POST   | /api/conversations/messages      | session (dual-auth) | Body: `{ conversation_id: uuid, role: 'user'\|'assistant'\|'system'\|'tool', content: string, metadata?: object, client_message_id?: string }` (strict zod; 4 KiB metadata cap) | `CloudMessage` (single row, not wrapped) — idempotent on `client_message_id` | apps/api/src/routes/conversations/messages.ts:78-139 |
| POST   | /api/conversations/search        | session (dual-auth) | Body: `{ query: string (1..256), limit?: number }` (strict zod) | `{ conversations: (CloudConversation & { score: number })[] }` | apps/api/src/routes/conversations/search.ts:47-89 |
| DELETE | /api/conversations/delete        | session (dual-auth) | Body: `{ id: uuid }` | `{ ok: true }` or 404 `{ error: 'conversation not found' }` | apps/api/src/routes/conversations/delete.ts:33-63 |
| DELETE | /api/auth/delete-account         | session (cookie-only — Bearer/PAK rejected) | — | 200 `{}` (empty object) with `Set-Cookie` clearing all 4 cookie variants | apps/api/src/routes/delete-account.ts:88-130 |

### Better Auth catch-all paths (BETTER_AUTH_PATHS)

`apps/api/src/routes/better-auth-handler.ts:61` mounts
`app.all("/api/auth/*", { config: { auth: false } }, ...)` which delegates every
`/api/auth/**` request to Better Auth 1.6.9's universal handler (better-auth
1.6.9 declared in apps/api/package.json:30). The end-user surface relies on:

| Method | Path | Auth | Used by |
|--------|------|------|---------|
| POST   | /api/auth/sign-in/email              | public          | U1 sign-in |
| POST   | /api/auth/sign-up/email              | public          | U2 sign-up |
| POST   | /api/auth/sign-out                   | session cookie  | shared header logout |
| POST   | /api/auth/verify-email               | public (token)  | U3 verify-email |
| GET    | /api/auth/get-session                | session cookie  | every authenticated layout; U5 profile data |
| GET    | /api/auth/list-sessions              | session cookie  | U5 sessions list |
| POST   | /api/auth/revoke-session             | session cookie  | U5 revoke-session action |
| POST   | /api/auth/revoke-other-sessions      | session cookie  | U5 revoke-all-other-sessions action |
| GET    | /api/auth/sign-in/social/:provider   | public          | U1 OIDC button (Continue with SSO) — only when OIDC providers are configured (apps/api/src/auth.ts oidcProviders) |

> **Note on forgot-password.** Per D-UX2, `POST /api/auth/forget-password` and
> `POST /api/auth/reset-password` are NOT used in v1 (the "Forgot password?"
> link in U1 is disabled / links to a static placeholder). Phase 7.x will
> reintroduce them.

## Assumptions resolved

Closes RESEARCH § Assumptions Log A1–A8.

| ID | Claim | Status | Evidence |
|----|-------|--------|----------|
| A1 | `GET /api/auth/list-sessions` available via Better Auth catch-all | VERIFIED | better-auth@1.6.9 in apps/api/package.json:30; catch-all mount at apps/api/src/routes/better-auth-handler.ts:61. Better Auth 1.x exposes `list-sessions`, `revoke-session`, `revoke-other-sessions` natively — no plugin needed |
| A2 | `/api/usage` returns `dailySeries[].{date,requests,audioMinutes}` | REFUTED (KPI-only) | apps/api/src/routes/usage.ts:66-71 returns `{ wordsUsed, wordsRemaining, plan, limitReached }`. No daily series. **U4 must simplify to KPI cards only** (drop Requests/day line chart + Audio-minutes/day bar chart per D-S1). Re-engage Claude Design for U4 layout rebalancing |
| A3 | `providerBreakdown[]` field in `/api/usage` response | REFUTED | apps/api/src/routes/usage.ts:66-71 — no `providerBreakdown` field. **U4 must drop the "By provider" panel** per D-S1 |
| A4 | `session.user.role` exposed by Better Auth session | REFUTED (no role field configured) | apps/api/src/auth.ts:167-220 — Better Auth config does NOT declare `additionalFields.user.role` or `customSession`. packages/data/src/schema/users.ts has no `role` column. Not blocking for end-user surface (no `/admin/*` routes here); blocks admin surface — tracked in UI-SPEC-admin.md WIP |
| A5 | `apps/web/` scaffold deferred to Phase 8 | VERIFIED | .planning/phases/07-frontend-ui-spec/07-CONTEXT.md `<deferred>` confirms; no `apps/web/` directory present in tree |
| A6 | Recharts under 200KB-per-route gzipped (U4) | DEFERRED (and partially moot) | A2/A3 refuted U4 charts; the v1 U4 is KPI-only, so Recharts may be dropped entirely. Measurement still happens in Phase 8 if charts return in 7.x |
| A7 | `NEXT_LOCALE` cookie name (i18n) | DEFERRED | Phase 10 ratifies. Not blocking Phase 7 SPEC body |
| A8 | Better Auth `useSession()` returns `{ data, isPending, error, refetch }` under React 19 | VERIFIED | better-auth@1.6.9 React client; documented at better-auth.com/docs/concepts/session-management and github.com/better-auth/better-auth/issues/903 |

## WIP endpoints (must be empty before Phase 7 closes)

_(none for the end-user surface — every endpoint U1..U13 references is verified
above. The admin-side A4 role-gate WIP is tracked in UI-SPEC-admin.md.)_

# Appendix

> The five sub-appendices below are duplicated verbatim in both UI-SPEC files
> (D-ART6) so each artifact is self-contained for downstream readers.
> Source of truth for design tokens is `design/index.html` (CSS custom
> properties in `<style id="__tokens">`) consumed by `design/ui.jsx`.

## Appendix A — Design tokens

Tailwind 4 places these under the `@theme` directive in `app/globals.css`,
NOT in `tailwind.config.js` (RESEARCH § Pitfall 4). The values below are
transcribed verbatim from `design/index.html` and `design/ui.jsx`.

### Color roles (light theme)

| Role | Value | Notes |
|------|-------|-------|
| `--accent` | `#2563eb` | Primary action; brand blue |
| `--accent-soft` | `color-mix(in oklab, var(--accent) 14%, transparent)` | Focus rings, soft highlights |
| `--accent-fg` | `#ffffff` | Foreground on accent surfaces |
| `--bg` | `#fafafa` | App background |
| `--panel` | `#ffffff` | Card / panel surface |
| `--panel-2` | `#f4f4f5` | Subtle inset / hover surface |
| `--border` | `#e4e4e7` | Default border |
| `--border-strong` | `#d4d4d8` | Input borders, separators |
| `--text` | `#18181b` | Primary foreground |
| `--text-muted` | `#71717a` | Secondary foreground |
| `--text-dim` | `#a1a1aa` | Tertiary / disabled foreground |
| `--danger` | `#dc2626` | Destructive action |
| `--warn` | `#d97706` | Warning state |
| `--ok` | `#059669` | Success state |
| `--info` | `#0284c7` | Informational state |

### Color roles (dark theme — overrides applied by `[data-theme="dark"]`)

| Role | Value |
|------|-------|
| `--bg` | `#09090b` |
| `--panel` | `#111114` |
| `--panel-2` | `#18181b` |
| `--border` | `#26262a` |
| `--border-strong` | `#3f3f46` |
| `--text` | `#fafafa` |
| `--text-muted` | `#a1a1aa` |
| `--text-dim` | `#71717a` |

(`--accent`, `--danger`, `--warn`, `--ok`, `--info` are theme-invariant.)

### Spacing & sizing

| Token | Value | Notes |
|-------|-------|-------|
| `--row-h` (compact) | `32px` | Table row height under `[data-density="compact"]` |
| `--row-h` (default) | `40px` | Default density |
| `--row-h` (comfortable) | `44px` | Under `[data-density="comfortable"]` |
| `--pad` | `14px` | Default cell / container inset |
| `--radius` | `8px` | Default corner radius (cards, buttons, inputs) |

Card radius is `10px`, button radius is `7px`, input radius is `7px`,
dialog radius is `12px` — derived per primitive from `design/index.html`.

### Typography ramp

| Token | Value |
|-------|-------|
| `--font-ui` | `'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif` |
| `--font-mono` | `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace` |
| Body size | `14px` / line-height `1.45` |
| Page title (`page-head h1`) | `22px` / weight `600` / letter-spacing `-.02em` |
| Card title (`card-h h3`) | `13.5px` / weight `600` |
| Auth headline (`auth-form h2`) | `24px` / weight `600` / letter-spacing `-.02em` |
| Side-panel headline | `28px` / weight `600` / letter-spacing `-.025em` / line-height `1.15` |
| Stat value (`stat .v`) | `26px` / weight `600` / tabular-nums |
| Stat key (`stat .k`) | `11px` / weight `600` / uppercase / letter-spacing `.04em` |
| Label (`label`) | `12.5px` / weight `500` |
| Help / muted (`help`) | `12px` |
| Mono badges (`badge`) | `11px` / mono |

Weight scale used: `400`, `500`, `600`, `700` (Inter); `400`, `500`, `600`
(JetBrains Mono).

### Motion

| Token | Value | Notes |
|-------|-------|-------|
| Progress bar width | `transition: width .3s` | `.progress .bar` |
| Skeleton shimmer | `animation: sk 1.4s ease-in-out infinite` | `.sk` keyframes `0%→200% 0`, `100%→-200% 0` |

No additional motion primitives are declared in `design/index.html`; component-
level transitions (hover, focus) inherit the browser default.

## Appendix B — Breakpoint matrix

| Name | Min width | Tailwind alias | Pattern |
|------|-----------|----------------|---------|
| mobile | 0 | (default, mobile-first) | single column; sidebar collapsed to drawer (Sheet) |
| tablet | 640px | `sm:` | two-column where applicable; sidebar slide-over |
| desktop | 1024px | `lg:` | full layout; sidebar persistent (≥240px) |

Tailwind 4 default breakpoints. Per 07-RESEARCH § Pattern 1 and 07-SPEC.md
constraints. Wide-only optimizations (≥1280px) follow Tailwind's `xl:` alias.

## Appendix C — i18n key index

Every copy key declared in this UI-SPEC suite, alphabetized. The linter
(`pnpm lint:ui-spec`) validates the 5-level dotted schema and global
uniqueness across both files; this index is the human audit trail. Russian
translation is deferred to Phase 10.

| Key | English |
|-----|---------|
| `admin.config.action.refresh.label` | Refresh |
| `admin.config.alert-readonly.body.label` | Edits require restarting the api container with updated env. |
| `admin.config.error-fetch-failed.body.label` | Retry, or check the api container logs in Grafana. |
| `admin.config.error-fetch-failed.retry.label` | Retry |
| `admin.config.error-fetch-failed.title.label` | Could not load configuration |
| `admin.config.link.override-docs.label` | Docs: how to override |
| `admin.config.nav.sidebar.label` | Configuration |
| `admin.config.note.endpoint.label` | GET /api/note-recording-config |
| `admin.config.note.row-allowed-formats.label` | Allowed formats |
| `admin.config.note.row-diarization.label` | Diarization enabled |
| `admin.config.note.row-max-duration.label` | Max duration (seconds) |
| `admin.config.note.row-sample-rate.label` | Sample rate (Hz) |
| `admin.config.note.title.label` | Note recording |
| `admin.config.stt.endpoint.label` | GET /api/stt-config |
| `admin.config.stt.row-default-language.label` | Default language |
| `admin.config.stt.row-default-model.label` | Default model |
| `admin.config.stt.row-providers.label` | Available providers |
| `admin.config.stt.title.label` | STT config |
| `admin.config.subtitle.body.text` | Server-side STT and note-recording defaults. Read-only. |
| `admin.config.title.heading.text` | Configuration |
| `admin.observability.action.open-grafana.label` | Open Grafana |
| `admin.observability.card-api-latency.body.label` | p50, p95, p99 from Fastify hooks |
| `admin.observability.card-api-latency.title.label` | API tier — request latency |
| `admin.observability.card-litellm.title.label` | LiteLLM — provider routing |
| `admin.observability.card-postgres.title.label` | Postgres — partitions and vacuum |
| `admin.observability.card-security.title.label` | Security — rate limits and auth failures |
| `admin.observability.card-system.title.label` | System — CPU, RAM, disk, network |
| `admin.observability.card-worker-queue.body.label` | BullMQ depth, retries, throughput |
| `admin.observability.card-worker-queue.title.label` | Worker — STT job queue |
| `admin.observability.error-env-missing.body.label` | Set NEXT_PUBLIC_GRAFANA_BASE_URL and redeploy the web container. |
| `admin.observability.error-env-missing.title.label` | Grafana endpoint not configured |
| `admin.observability.nav.sidebar.label` | Observability |
| `admin.observability.quicklinks.alertmanager.label` | Alertmanager — routing and silences |
| `admin.observability.quicklinks.loki.label` | Loki — application logs |
| `admin.observability.quicklinks.mimir.label` | Mimir — Prometheus metrics |
| `admin.observability.quicklinks.tempo.label` | Tempo — distributed tracing |
| `admin.observability.quicklinks.title.label` | Quick links |
| `admin.observability.subtitle.body.text` | Deep-links to Grafana dashboards for this installation. |
| `admin.observability.title.heading.text` | Observability |
| `end-user.account.danger.delete.label` | Delete account |
| `end-user.account.danger.dialog-body.text` | This deletes your transcriptions, notes, conversations, and sessions. Type your email to confirm. |
| `end-user.account.danger.dialog-confirm.label` | Delete account |
| `end-user.account.danger.dialog-input.label` | Type your email to confirm |
| `end-user.account.danger.dialog-title.text` | Delete your OpenWhispr account |
| `end-user.account.danger.title.label` | Danger zone |
| `end-user.account.error.retry.label` | Retry |
| `end-user.account.error.title.text` | Could not load account |
| `end-user.account.nav.sidebar.label` | Account |
| `end-user.account.profile.created.label` | Member since |
| `end-user.account.profile.email.label` | Email |
| `end-user.account.profile.name.label` | Name |
| `end-user.account.profile.title.label` | Profile |
| `end-user.account.profile.verified.label` | Verified |
| `end-user.account.sessions.action-revoke-others.label` | Revoke all other sessions |
| `end-user.account.sessions.action-revoke.label` | Revoke |
| `end-user.account.sessions.col-created.label` | Started |
| `end-user.account.sessions.col-device.label` | Device |
| `end-user.account.sessions.col-expires.label` | Expires |
| `end-user.account.sessions.col-ip.label` | IP address |
| `end-user.account.sessions.title.label` | Active sessions |
| `end-user.account.subtitle.body.text` | Manage your profile, active sessions, and account deletion. |
| `end-user.account.title.heading.text` | Account |
| `end-user.conv-detail.action.back.label` | Back to conversations |
| `end-user.conv-detail.action.copy.label` | Copy transcript |
| `end-user.conv-detail.action.delete.label` | Delete conversation |
| `end-user.conv-detail.action.export-json.label` | Export as JSON |
| `end-user.conv-detail.action.loadearlier.label` | Load earlier messages |
| `end-user.conv-detail.empty.body.text` | This conversation does not contain any messages yet. |
| `end-user.conv-detail.empty.title.text` | No messages |
| `end-user.conv-detail.error.retry.label` | Retry |
| `end-user.conv-detail.error.title.text` | Could not load conversation |
| `end-user.conv-detail.role.assistant.label` | Assistant |
| `end-user.conv-detail.role.system.label` | System |
| `end-user.conv-detail.role.tool.label` | Tool |
| `end-user.conv-detail.role.user.label` | You |
| `end-user.conv-detail.title.heading.text` | Conversation |
| `end-user.conv-list.action.loadmore.label` | Load more |
| `end-user.conv-list.action.search.label` | Search conversations |
| `end-user.conv-list.empty.body.text` | Start a chat in the desktop client to see it here. |
| `end-user.conv-list.empty.title.text` | No conversations yet |
| `end-user.conv-list.error.retry.label` | Retry |
| `end-user.conv-list.error.title.text` | Could not load conversations |
| `end-user.conv-list.nav.sidebar.label` | Conversations |
| `end-user.conv-list.row.action-delete.label` | Delete |
| `end-user.conv-list.subtitle.body.text` | LLM chats started from the desktop client. |
| `end-user.conv-list.table.col-created.label` | Created |
| `end-user.conv-list.table.col-title.label` | Title |
| `end-user.conv-list.table.col-updated.label` | Updated |
| `end-user.conv-list.title.heading.text` | Conversations |
| `end-user.conv-search.action.clear.label` | Clear |
| `end-user.conv-search.action.submit.label` | Search |
| `end-user.conv-search.empty.none.text` | No conversations match this query. |
| `end-user.conv-search.empty.type.text` | Type a query to search your conversations. |
| `end-user.conv-search.error.retry.label` | Retry |
| `end-user.conv-search.error.title.text` | Search failed |
| `end-user.conv-search.input.placeholder.text` | Search your conversations |
| `end-user.conv-search.result.score.label` | Score |
| `end-user.conv-search.title.heading.text` | Search conversations |
| `end-user.note-detail.action.back.label` | Back to notes |
| `end-user.note-detail.action.copy.label` | Copy |
| `end-user.note-detail.action.delete.label` | Delete |
| `end-user.note-detail.action.export-json.label` | Export as JSON |
| `end-user.note-detail.action.export-md.label` | Export as Markdown |
| `end-user.note-detail.empty.body.text` | This note does not exist or was deleted. |
| `end-user.note-detail.empty.title.text` | Note not found |
| `end-user.note-detail.error.retry.label` | Retry |
| `end-user.note-detail.error.title.text` | Could not load note |
| `end-user.note-detail.metadata.created.label` | Created |
| `end-user.note-detail.metadata.duration.label` | Audio duration |
| `end-user.note-detail.metadata.folder.label` | Folder |
| `end-user.note-detail.metadata.participants.label` | Participants |
| `end-user.note-detail.metadata.title.label` | Details |
| `end-user.note-detail.metadata.type.label` | Note type |
| `end-user.note-detail.tabs.content.label` | Content |
| `end-user.note-detail.tabs.enhanced.label` | Enhanced |
| `end-user.note-detail.tabs.transcript.label` | Transcript |
| `end-user.note-detail.title.heading.text` | Note |
| `end-user.notes-list.action.loadmore.label` | Load more |
| `end-user.notes-list.action.search.label` | Search notes |
| `end-user.notes-list.empty.body.text` | Record a note in the desktop client to see it here. |
| `end-user.notes-list.empty.title.text` | No notes yet |
| `end-user.notes-list.error.retry.label` | Retry |
| `end-user.notes-list.error.title.text` | Could not load notes |
| `end-user.notes-list.folders.readonly-body.text` | Folder management is in the desktop client. |
| `end-user.notes-list.folders.title.label` | Folders |
| `end-user.notes-list.nav.sidebar.label` | Notes |
| `end-user.notes-list.row.action-delete.label` | Delete |
| `end-user.notes-list.subtitle.body.text` | Notes recorded with the desktop client. |
| `end-user.notes-list.table.col-created.label` | Created |
| `end-user.notes-list.table.col-folder.label` | Folder |
| `end-user.notes-list.table.col-title.label` | Title |
| `end-user.notes-list.table.col-words.label` | Words |
| `end-user.notes-list.title.heading.text` | Notes |
| `end-user.notes-search.action.clear.label` | Clear |
| `end-user.notes-search.action.submit.label` | Search |
| `end-user.notes-search.empty.none.text` | No notes match this query. |
| `end-user.notes-search.empty.type.text` | Type a query to search your notes. |
| `end-user.notes-search.error.retry.label` | Retry |
| `end-user.notes-search.error.title.text` | Search failed |
| `end-user.notes-search.input.placeholder.text` | Search your notes |
| `end-user.notes-search.result.score.label` | Score |
| `end-user.notes-search.title.heading.text` | Search notes |
| `end-user.signin.action.signup-link.label` | Don't have an account? Sign up |
| `end-user.signin.error.body.text` | Check your email and password, then try again. |
| `end-user.signin.error.title.text` | Sign-in failed |
| `end-user.signin.form.email.label` | Email |
| `end-user.signin.form.password.label` | Password |
| `end-user.signin.form.submit.label` | Sign in |
| `end-user.signin.oidc.github.label` | Continue with GitHub |
| `end-user.signin.oidc.google.label` | Continue with Google |
| `end-user.signin.oidc.sso.label` | Continue with SSO |
| `end-user.signin.subtitle.body.text` | Use your email or your organization SSO. |
| `end-user.signin.title.heading.text` | Sign in to OpenWhispr |
| `end-user.signup.action.signin-link.label` | Already have an account? Sign in |
| `end-user.signup.error.duplicate.text` | This email is already registered. Sign in instead. |
| `end-user.signup.error.generic.text` | Sign-up failed. Please review the form and try again. |
| `end-user.signup.form.email.label` | Email |
| `end-user.signup.form.name.label` | Name |
| `end-user.signup.form.password.label` | Password |
| `end-user.signup.form.submit.label` | Sign up |
| `end-user.signup.oidc.github.label` | Continue with GitHub |
| `end-user.signup.oidc.google.label` | Continue with Google |
| `end-user.signup.oidc.sso.label` | Continue with SSO |
| `end-user.signup.subtitle.body.text` | A confirmation email is sent to verify your address. |
| `end-user.signup.success.body.text` | We sent a verification link to your address. Open it to continue. |
| `end-user.signup.success.title.text` | Check your email |
| `end-user.signup.title.heading.text` | Create your OpenWhispr account |
| `end-user.trx-detail.action.back.label` | Back to list |
| `end-user.trx-detail.action.copy.label` | Copy |
| `end-user.trx-detail.action.delete.label` | Delete |
| `end-user.trx-detail.action.export-json.label` | Export as JSON |
| `end-user.trx-detail.action.export-md.label` | Export as Markdown |
| `end-user.trx-detail.empty.body.text` | This transcription does not exist or was deleted. |
| `end-user.trx-detail.empty.title.text` | Transcription not found |
| `end-user.trx-detail.error.retry.label` | Retry |
| `end-user.trx-detail.error.title.text` | Could not load transcription |
| `end-user.trx-detail.metadata.created.label` | Created |
| `end-user.trx-detail.metadata.duration.label` | Audio duration |
| `end-user.trx-detail.metadata.language.label` | Language |
| `end-user.trx-detail.metadata.model.label` | Model |
| `end-user.trx-detail.metadata.provider.label` | Provider |
| `end-user.trx-detail.metadata.status.label` | Status |
| `end-user.trx-detail.metadata.title.label` | Details |
| `end-user.trx-detail.metadata.words.label` | Word count |
| `end-user.trx-detail.title.heading.text` | Transcription |
| `end-user.trx-list.action.loadmore.label` | Load more |
| `end-user.trx-list.empty.body.text` | Record audio in the desktop client and your transcriptions show up here. |
| `end-user.trx-list.empty.title.text` | No transcriptions yet |
| `end-user.trx-list.error.retry.label` | Retry |
| `end-user.trx-list.error.title.text` | Could not load transcriptions |
| `end-user.trx-list.nav.sidebar.label` | Transcriptions |
| `end-user.trx-list.row.action-delete.label` | Delete |
| `end-user.trx-list.subtitle.body.text` | All audio you have transcribed with the desktop client. |
| `end-user.trx-list.table.col-created.label` | Created |
| `end-user.trx-list.table.col-duration.label` | Duration |
| `end-user.trx-list.table.col-language.label` | Language |
| `end-user.trx-list.table.col-model.label` | Model |
| `end-user.trx-list.table.col-preview.label` | Preview |
| `end-user.trx-list.table.col-provider.label` | Provider |
| `end-user.trx-list.table.col-status.label` | Status |
| `end-user.trx-list.table.col-words.label` | Words |
| `end-user.trx-list.title.heading.text` | Transcriptions |
| `end-user.usage.action.refresh.label` | Refresh |
| `end-user.usage.error.body.text` | Retry, or check the api container logs in Grafana. |
| `end-user.usage.error.retry.label` | Retry |
| `end-user.usage.error.title.text` | Could not load usage |
| `end-user.usage.kpi-limit-reached.body.text` | Whether you are currently throttled. |
| `end-user.usage.kpi-limit-reached.title.label` | Limit reached |
| `end-user.usage.kpi-plan.body.text` | Active subscription plan. |
| `end-user.usage.kpi-plan.title.label` | Plan |
| `end-user.usage.kpi-words-remaining.body.text` | Quota left on your current plan. |
| `end-user.usage.kpi-words-remaining.title.label` | Words remaining |
| `end-user.usage.kpi-words-used.body.text` | Across all transcriptions and notes. |
| `end-user.usage.kpi-words-used.title.label` | Words used |
| `end-user.usage.nav.sidebar.label` | Dashboard |
| `end-user.usage.subtitle.body.text` | Your current consumption against the active plan. |
| `end-user.usage.title.heading.text` | Usage |
| `end-user.verify.error.body.text` | This verification link is invalid or has expired. Sign up again. |
| `end-user.verify.error.cta.label` | Back to sign up |
| `end-user.verify.error.title.text` | Verification failed |
| `end-user.verify.loading.body.text` | Verifying your email... |
| `end-user.verify.success.body.text` | Your email is confirmed. You can now sign in. |
| `end-user.verify.success.cta.label` | Sign in |
| `end-user.verify.success.title.text` | Email verified |
| `end-user.verify.title.heading.text` | Verify your email |

## Appendix D — API endpoint index

Every endpoint either UI-SPEC file references, with HTTP method, auth
requirement, source citation (route `file:line` or BETTER_AUTH_HANDLER for
the `app.all("/api/auth/*", ...)` catch-all mounted at
`apps/api/src/routes/better-auth-handler.ts:61`), and the screen(s) that
consume it. Cross-checked against Plan 01 § API Reference (verified).

| Method | Path | Auth | Source | Screens |
|--------|------|------|--------|---------|
| POST | `/api/auth/sign-in/email` | public | BETTER_AUTH_HANDLER | U1 |
| POST | `/api/auth/sign-up/email` | public | BETTER_AUTH_HANDLER | U2 |
| POST | `/api/auth/sign-out` | session | BETTER_AUTH_HANDLER | shared header logout (all `/app/**`) |
| POST | `/api/auth/verify-email` | public (token) | BETTER_AUTH_HANDLER | U3 |
| POST | `/api/auth/send-verification-email` | public | BETTER_AUTH_HANDLER | U3 |
| GET | `/api/auth/get-session` | session cookie | BETTER_AUTH_HANDLER | U5, layout guards |
| GET | `/api/auth/list-sessions` | session | BETTER_AUTH_HANDLER | U5 |
| POST | `/api/auth/revoke-session` | session | BETTER_AUTH_HANDLER | U5 |
| POST | `/api/auth/revoke-other-sessions` | session | BETTER_AUTH_HANDLER | U5 |
| DELETE | `/api/auth/delete-account` | session | BETTER_AUTH_HANDLER | U5 |
| GET | `/api/auth/sign-in/social/google` | public | BETTER_AUTH_HANDLER | U1, U2 |
| GET | `/api/auth/sign-in/social/github` | public | BETTER_AUTH_HANDLER | U1, U2 |
| GET | `/api/auth/sign-in/social/oidc` | public | BETTER_AUTH_HANDLER | U1, U2 |
| GET | `/api/usage` | session (dual-auth) | `apps/api/src/routes/usage.ts:40` | U4 |
| POST | `/api/streaming-usage` | session (dual-auth) | `apps/api/src/routes/streaming-usage.ts:58` | U4 (write-side; read uses GET above) |
| GET | `/api/stt-config` | session (dual-auth) | `apps/api/src/routes/stt-config.ts:45` | A3 |
| GET | `/api/note-recording-config` | session (dual-auth) | `apps/api/src/routes/note-recording-config.ts:34` | A3 |
| GET | `/api/transcriptions/list` | session | `apps/api/src/routes/transcriptions/list.ts:39` | U6, U7 |
| DELETE | `/api/transcriptions/delete` | session | `apps/api/src/routes/transcriptions/delete.ts:37` | U6, U7 |
| GET | `/api/notes/list` | session | `apps/api/src/routes/notes/list.ts:42` | U8, U9 |
| POST | `/api/notes/search` | session | `apps/api/src/routes/notes/search.ts:51` | U10 |
| DELETE | `/api/notes/delete` | session | `apps/api/src/routes/notes/delete.ts:34` | U8, U9 |
| GET | `/api/folders/list` | session | `apps/api/src/routes/folders/list.ts:43` | U8 |
| GET | `/api/conversations/list` | session | `apps/api/src/routes/conversations/list.ts:56` | U11 |
| GET | `/api/conversations/messages` | session | `apps/api/src/routes/conversations/messages.ts:80` | U12 |
| POST | `/api/conversations/search` | session | `apps/api/src/routes/conversations/search.ts:49` | U13 |
| DELETE | `/api/conversations/delete` | session | `apps/api/src/routes/conversations/delete.ts:35` | U11, U12 |

Zero new endpoints are introduced by Phase 7 (D-S1). The admin surface (A2)
calls no endpoints on this server — its links target the operator's external
Grafana / Tempo / Mimir / Loki dashboards.

## Appendix E — shadcn/ui v2 primitive inventory

Union of every primitive named in any screen's "shadcn primitives"
subsection across both UI-SPEC files. After `apps/web/` scaffolds (Phase 8),
run the block below once to prime the project. Primitive names follow
shadcn/ui v2 canonical kebab-case identifiers (RESEARCH § Standard Stack).

```bash
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add \
  alert \
  alert-dialog \
  badge \
  button \
  card \
  dropdown-menu \
  form \
  input \
  label \
  scroll-area \
  separator \
  sheet \
  skeleton \
  table \
  tabs \
  tooltip
```

Primitives in the union (alphabetized): `alert`, `alert-dialog`, `badge`,
`button`, `card`, `dropdown-menu`, `form`, `input`, `label`, `scroll-area`,
`separator`, `sheet`, `skeleton`, `table`, `tabs`, `tooltip`. `sonner`
(toast) is recommended by shadcn/ui v2 but is not declared as required by
any v1 screen; add at scaffold time if global toast notifications are
desired for Copy / Export confirmations.
