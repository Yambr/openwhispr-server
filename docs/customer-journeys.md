<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Phase 13 / Plan 02 / Task 13-02-01 — Canonical Customer Journey Map (CJM). -->

# Customer Journeys

Each journey enumerates a real user path through OpenWhispr. Every happy path
has at least one negative twin in the same section. Anchors `@cjm-N.M`
correspond 1:1 to `Scenario` tags in `tests/e2e-cjm/features/`. Downstream
phases remove their `@expected-red` tag once shipped — the `(after-phase-N
— currently @expected-red)` marker signals which phase is on the hook.

Convention:

- `### @cjm-N.M Title` — every journey heading carries its anchor in the
  heading itself so `tools/lint-cjm-doc.ts` can grep for the exact pair.
- "Backend error branches:" sub-list enumerates every non-2xx the journey
  can emit, with the HTTP status + error code where applicable.
- "Silent-failure modes:" sub-list enumerates ways the journey can silently
  rot in production (worker noop, no email, no observability, etc).

---

## 1. Signup with email verification

A new visitor lands on the public sign-up page, fills the form, receives a
verification mail in their inbox, clicks the link, and arrives at the
authenticated landing as a verified user.

### @cjm-1.1 Signup happy path

The user opens `/sign-up`, fills `email` + `password` + `displayName`,
submits the form, the API returns 200, a verification mail lands in mailpit
within 30 seconds, clicking the link flips the user to verified, and a
subsequent sign-in returns 200.

- Backend error branches: 422 `USER_ALREADY_EXISTS`, 422 password too short,
  403 `MISSING_OR_NULL_ORIGIN` (CSRF gate), 429 rate-limit.
- Silent-failure modes: worker `noopSender` silently dropped the
  verification email (closed by Phase 13-01); mail template variables
  rendered as literal placeholders (closed by Phase 13-01).

### @cjm-1.2 Already-registered email dedup (negative twin)

The same email submits the sign-up form a second time. The API returns 422
with `code: USER_ALREADY_EXISTS`, and NO second verification email is
enqueued. Better Auth's anti-enumeration path short-circuits before
`sendVerificationEmail` fires.

- Backend error branches: 422 `USER_ALREADY_EXISTS`.
- Silent-failure modes: duplicate-signup leaks a second mail (would let
  attackers re-trigger account-takeover flows).

### @cjm-1.3 Password shorter than 8 chars (negative twin)

The user submits the sign-up form with a 6-char password. A per-field Zod
error message renders next to the password input. No request reaches the
api in some configurations (client-side gate); in others the api returns
422 with a structured field error.

- Backend error branches: 422 with `code: VALIDATION_ERROR` and a
  `password` field error.
- Silent-failure modes: form swallows the error and submits anyway (would
  let weak passwords through).

### @cjm-1.4 Locale-scoped error copy (negative twin, after-phase-19.3 — currently @expected-red)

With `Accept-Language: ru` set, the same invalid form surfaces an error
rendered in Russian. Closes UICONF-03 — the form must render error copy in
the active locale, not fall back silently to English.

- Backend error branches: 422 with localized `message` (or client-side
  zod localized).
- Silent-failure modes: middleware falls back to English silently;
  translation key missing returns the key string.

### @cjm-1.5 Zero providers configured — zero social buttons (negative twin)

Against a stack with zero OIDC providers wired, the sign-up page renders
ZERO social-login buttons. Closes UICONF-02. The `OidcButtons` component
returns `null` when `providers.length === 0`.

- Backend error branches: capabilities endpoint may return 404 or
  empty-list; both paths must produce zero buttons.
- Silent-failure modes: hardcoded buttons render despite zero providers
  (would 5xx on click); buttons render with `disabled` attribute but stay
  visible (UX confusion).

---

## 2. Sign in

A verified user enters credentials, signs in, and lands on the
authenticated home. The negative twin asserts the `/sign-in/email` path
rejects an unverified user with a 403 and renders a resend-verification
CTA so the user can recover without re-signing-up.

### @cjm-2.1 Sign-in happy path

A verified user POSTs `email` + `password` to `/api/auth/sign-in/email`,
receives 200, and the response contains a session cookie.

- Backend error branches: 401 invalid credentials, 403 unverified,
  429 rate-limit.
- Silent-failure modes: session cookie not set despite 200; mismatched
  cookie domain (set on `.localhost` instead of `api.localhost`).

### @cjm-2.2 403 unverified — resend CTA visible (negative twin)

An unverified user attempts sign-in. The API returns 403 with a structured
error envelope, and the UI renders a "resend verification email" CTA. Closes
E2E-05 / TD-13.c.

- Backend error branches: 403 `EMAIL_NOT_VERIFIED`.
- Silent-failure modes: UI shows a generic "wrong password" message
  (privacy/UX-bad — user can't recover); resend endpoint missing entirely.

---

## 3. Password reset

A signed-up user forgets their password, requests a reset, receives a
single-use reset link in mailpit, clicks it, sets a new password, and can
sign in with the new credentials. The negative twin covers the
invalid-token error envelope.

### @cjm-3.1 Password-reset happy path (Phase 19.1 + 19b — GREEN 2026-05-16)

User POSTs `email` to the password-reset request endpoint. Mailpit receives
a reset email within 30s. The reset URL renders a "set new password" form.
The user sets a new password (≥ 8 chars). Sign-in with the new password
returns 200.

- Backend error branches: 404 user-not-found (Better Auth typically
  anti-enumerates to 200), 422 password-too-short on set, 410 token-expired.
- Silent-failure modes: reset email enqueued but worker silently drops it
  (closed by Phase 13-01); token never expires server-side; replay attack
  succeeds (token must be single-use).

### @cjm-3.2 Invalid-token error (negative twin)

GET `/reset-password?token=garbage` renders an "invalid or expired link"
banner. The page MUST NOT render the password form (no token == no reset).

- Backend error branches: 400/410 with `code: INVALID_TOKEN` or
  `code: TOKEN_EXPIRED`.
- Silent-failure modes: page silently renders the password form anyway
  (would let attackers set passwords without a token); error banner uses
  raw stack trace.

---

## 4. Transcribe round-trip

An authenticated user uploads a small audio file to `POST /api/transcribe`,
the api proxies to LiteLLM (Whisper), and the response matches the
`BACKEND_SPEC.md` transcribe shape (200 + JSON with `text` key, optional
`segments`, optional `language`). The negative twin asserts malformed
payloads surface a typed-error envelope, not a 5xx stack leak.

### @cjm-4.1 Multipart audio → response shape match — CLOSED 2026-05-16

Signed-in user POSTs a 0.25s 16kHz mono PCM WAV (`tests/e2e-cjm/fixtures/
silent.wav`) to `/api/transcribe` via multipart. The api returns 200; body
parses as JSON; the response object has a `text` key (whose value is the
transcription string, possibly empty for silent input). Closes E2E-06.

- Backend error branches: 401 unauthorized, 413 payload-too-large, 415
  unsupported-media-type, 422 malformed-multipart, 502 LiteLLM-upstream
  failure.
- Silent-failure modes: api returns 200 with empty body (silent OK on
  failure); api returns 200 with literal `{transcript: ...}` instead of
  the spec'd `{text: ...}` (wire-shape drift).

### @cjm-4.2 Malformed audio → typed-error envelope (negative twin)

Same signed-in user POSTs non-audio bytes (e.g. plain text) to
`/api/transcribe`. The api returns a 4xx (415 or 422) with body shape
`{ error: { code: string, message: string } }`. The response MUST NOT
contain a stack trace or expose internal module paths.

- Backend error branches: 415 unsupported-media-type, 422 invalid-multipart.
- Silent-failure modes: api returns 5xx with stack trace; api returns 200
  with empty `text` field (silently treats junk as success).

---

## 5. Admin onboarding

A fresh installation needs an admin to complete a first-run wizard before
end-users can sign up. Once Phase 12 ships the wizard, the `/admin`
landing is reachable; until then `/admin` returns 404 from the web app.
The `/admin/*` path is gated by a Traefik basicauth break-glass at the edge.

### @cjm-5.1 /admin reaches a real page (after-phase-12 — currently @expected-red)

GET `https://api.localhost/admin` (with the configured basicauth
credentials) returns 200 with a real admin landing page. Closes TD-12.a /
E2E-07. Currently `@expected-red @after-phase-12` because the web app
does not yet ship a `/admin` route under the `(admin)` route group at the
top-level path; Phase 12 wires it.

- Backend error branches: 401 basicauth missing/wrong, 404 web route
  missing.
- Silent-failure modes: `/admin` returns 200 but renders the public
  marketing page (no real admin surface); basicauth strips through and
  exposes admin without creds.

### @cjm-5.2 Basicauth break-glass (negative-context twin)

GET `https://api.localhost/admin` with NO credentials returns 401 with a
`WWW-Authenticate: Basic realm="traefik"` header. This proves the
edge-level gate is wired and the break-glass auth surface is non-bypassable
even when the web `/admin` route does not exist. The negative context: this
is a "the gate works, even though the destination doesn't exist yet"
assertion.

- Backend error branches: 401 missing/invalid basicauth.
- Silent-failure modes: Traefik label missing → admin path reachable
  publicly; basicauth misconfigured to accept any password.

### @cjm-5.3 Wizard happy path (after-phase-12 — currently @expected-red)

GET `/setup` (route ships in Phase 12) renders a single-page admin wizard.
Filling the form and submitting flips `setup_state` from `pending` to
`completed`, and the submitter is logged in as the first admin user.

- Backend error branches: 409 wizard-already-completed, 422 invalid form.
- Silent-failure modes: wizard reachable after `setup_state=completed`
  (would let attackers seize admin); wizard accepts any input without
  validation.

---

## 6. Locale switch

An end-user toggles the locale between English and Russian. The toggle
must persist via cookie and produce localized copy on subsequent renders.
A downstream-phase twin asserts the `/api/locale` endpoint routes through
the `api.localhost` host split (closed by Phase 15).

### @cjm-6.1 en↔ru cookie set (after-phase-19.4 — currently @expected-red)

User clicks the locale toggle. The response sets a `Set-Cookie:
NEXT_LOCALE=ru; Path=/; ...` header. Reload renders the landing page copy
in Russian (asserted via a known-translated string from
`apps/web/src/locales/ru/end-user.json`). Closes E2E-08.

- Backend error branches: 400 unsupported-locale.
- Silent-failure modes: cookie set but middleware ignores it; cookie
  domain misconfigured so it doesn't survive reload.

### @cjm-6.2 /api/locale rejected on app.localhost — host-split error (after-phase-15 — currently @expected-red)

GET `https://api.localhost/api/locale` (NOT `https://app.localhost/api/locale`)
returns 200 with `{ locale: "en" | "ru" }`. Phase 15 closes TD-15.g
(host-split routing) so the api host serves the api path even when the web
host doesn't.

- Backend error branches: 404 if Traefik rule missing.
- Silent-failure modes: route reachable via both hosts (host-split broken);
  route returns the same payload regardless of cookie/header (locale gate
  broken).

---

## 7. OIDC providers

The number of OIDC sign-in buttons rendered on `/sign-in` matches the
number of providers configured in `OIDC_PROVIDERS_JSON`. With zero
providers (the OSS-default), zero buttons render. With one provider
configured (closed by Phase 12), exactly one button renders.

### @cjm-7.1 Zero providers configured — zero buttons (negative twin)

The stack has zero OIDC providers wired. GET `/sign-in` renders the form
but ZERO `OidcButtons` (the component returns `null` when
`providers.length === 0`).

- Backend error branches: capabilities endpoint missing (404) — UI still
  renders zero buttons.
- Silent-failure modes: dummy buttons render anyway (would 5xx on click);
  hidden buttons render in DOM (a11y rot).

### @cjm-7.2 One provider configured → exactly one button (after-phase-12 — currently @expected-red)

Env configures one OIDC provider via `OIDC_PROVIDERS_JSON` (the Phase 12
contract). GET `/sign-in` renders exactly one OIDC button. Clicking the
button initiates the OAuth flow.

- Backend error branches: 502 OIDC discovery failed, 400 OIDC misconfig.
- Silent-failure modes: button renders but click 404s; button renders
  with wrong label.

---

## 8. Error paths

Cross-cutting assertions about the error-rendering surface. Every 4xx the
api emits MUST shape as `{ error: { code: string, message: string } }`.
Every 5xx MUST render a friendly screen, NEVER a raw stack trace.

### @cjm-8.1 4xx renders typed envelope { error: { code, message } }

Hit a known-4xx endpoint (e.g. POST `/api/transcribe` with no body, or
GET `/api/auth/sign-up/email` — wrong method). The response body parses as
JSON; the JSON object has `error.code: string` and `error.message: string`.

- Backend error branches: 4xx for every documented error in
  `BACKEND_SPEC.md`.
- Silent-failure modes: 4xx returns plain-text "Bad Request" (drift from
  spec); 4xx returns `{ code, message }` at the top level instead of
  nested under `error` (drift from spec).

### @cjm-8.2 5xx renders friendly screen, NEVER raw stack (negative twin)

Induce a 5xx via a fault-injection switch or a route known to crash on a
malformed input. The response body MUST NOT contain `at Object.<anonymous>`
or `node_modules/` substrings. Closes the information-disclosure threat
T-13-02-01.

- Backend error branches: 500 generic, 502 upstream, 503 unavailable.
- Silent-failure modes: stack trace leaks (information disclosure); error
  page renders the request body back (XSS / PII leak).

---

## SSO via Keycloak (after-phase-19)

Corporate operators front their LDAP / Active Directory with Keycloak (or
Authentik) and consume the existing OpenWhispr `genericOAuth` surface
already wired in `apps/api/src/auth.ts:209` (ADR-0009 + ADR-0012). These
journeys stay `@expected-red` until Phase 19 (v3) implements the JIT
user-provisioning hooks. v2 ships the SPEC + ADR + RED scenarios +
Keycloak fixture stub. See
`.planning/phases/18-ldap-keycloak-sso-spec/SPEC-ldap-keycloak.md` and
`docs/adrs/0012-ldap-via-keycloak.md` for the locked decision context.

### @cjm-sso-1.1 First-time JIT user creation from OIDC ID token (after-phase-19 — currently @expected-red)

An OIDC sign-in arrives at the api with an id_token from a Keycloak realm
that has never been seen for this operator. Better Auth's
`databaseHooks.user.create.before` projects the `groups` claim onto
`users.role` and the tenant claim onto `users.tenant_id`; a new `User`
row lands, an `account` row links the OIDC subject, and a structured log
event `sso.jit.user.created` + matching `audit_log` row are emitted.

- Backend error branches: 403 `forbidden_missing_tenant_claim`, 403
  `forbidden_unknown_tenant`, 403 `forbidden_no_role_mapping`, 400
  `invalid_oidc_profile`.
- Silent-failure modes: User row created without `tenant_id` set (RLS
  invariant violated); audit row not emitted (sign-in untraceable).

### @cjm-sso-1.2 Returning OIDC user has name and email re-synced from claims (after-phase-19 — currently @expected-red)

A previously-provisioned user signs in again; the IdP has updated the
`name` claim. `databaseHooks.user.update.before` rewrites the existing
`users.name` (and `users.email` if it changed) before the session
issues. A `sso.jit.role.updated` audit row records the field-level diff.

- Backend error branches: 403 `forbidden_tenant_mismatch` if the tenant
  claim diverged from the existing row.
- Silent-failure modes: name claim drift never reflected in app UI
  (operator sees stale display name); update audit row not emitted.

### @cjm-sso-1.3 Group-to-role downgrade revokes admin on next sign-in (negative twin, after-phase-19 — currently @expected-red)

A user previously provisioned as `admin` signs in after their LDAP
admin group membership was revoked upstream. Per `OIDC_REVOCATION_MODE
= downgrade_to_default`, the role is rewritten to the configured
default (typically `member`); a `sso.jit.role.updated` audit row
records the downgrade.

- Backend error branches: 403 `forbidden_no_role_mapping` if no group
  matches and `OIDC_DEFAULT_ROLE=null`.
- Silent-failure modes: revoked admin retains admin in the app
  (privilege-revocation latency); audit row missing for the downgrade.

### @cjm-sso-1.4 Tenant assignment derived from email domain claim (after-phase-19 — currently @expected-red)

`OIDC_TENANT_CLAIM=email_domain` and `OIDC_TENANT_MAPPING` carries
`acme.example → acme`. A first-time user with email
`bob@acme.example` signs in; the JIT path resolves the tenant via the
mapping and creates the `User` row with `tenant_id = acme`.

- Backend error branches: 403 `forbidden_unknown_tenant` when the email
  domain is not in the mapping.
- Silent-failure modes: tenant assignment falls through to a default
  tenant (cross-tenant leak); JIT path silently disables.

### @cjm-sso-1.5 Cross-tenant isolation — RLS rejects tenant A user from tenant B rows (negative twin, after-phase-19 — currently @expected-red)

Two provisioned users exist in tenants `acme` and `globex`. The `acme`
user issues an authenticated request scoped to `globex`; the Postgres
row-level-security policy (Phase 1 multi-tenancy) rejects with `403
forbidden_tenant_mismatch`. This scenario is the property-level
regression guard for JIT not bypassing RLS.

- Backend error branches: 403 `forbidden_tenant_mismatch`.
- Silent-failure modes: cross-tenant query succeeds (RLS bypass — CVE
  class); tenant override leaks through OIDC token replay.

### @cjm-sso-1.6 Loud-fail rejected when Keycloak provider config references missing realm (negative twin, after-phase-19 — currently @expected-red)

Operator boots the api with `OIDC_ISSUER_URL` pointing at a Keycloak
realm that has not been imported into the (empty) fixture import
directory. The api MUST fail loudly: `sso.jit.rejected` structured-log
event with non-zero exit code, NOT silent OIDC disablement. This is the
loud-fail BYOK invariant from the SPEC's env-var table.

- Backend error branches: boot exits non-zero; `sso.jit.rejected`
  structured-log event emitted with reason `realm_not_found`.
- Silent-failure modes: OIDC silently disables and the api serves
  email-password only (operator believes SSO works when it does not).

## 15. Cross-tenant isolation (non-SSO RLS regression sentinel)

Phase 24 / G8 closure. The SSO `@cjm-sso-1.5` scenario covers the
post-JIT path but is `@expected-red @after-phase-19`. The plain
email-password tenant has no equivalent CJM, so an RLS regression in
the bundled flow can slip past the test suite. Phase 24 closes that gap.

### @cjm-15.1 User U_A from tenant T_A cannot read a transcribe job J_B owned by T_B (negative twin)

Two fresh tenants (T_A, T_B) sign up via email/password. T_B's transcribe
job J_B exists in the database. T_A's authenticated session issues
`GET /api/transcribe/jobs/{J_B.id}`. The api MUST respond `404` (NOT
`403` — leakage of existence is forbidden by BACKEND_SPEC.md §10).

- Backend error branches: 404 typed envelope `{ error: { code: "not_found", message: <string> } }`.
- Silent-failure modes: 200 (RLS bypass — CVE class); 403 (leaks the
  existence of the resource); 5xx (stack trace exposure).

### @cjm-15.2 Same tenant, same user reads their own job successfully (happy path)

The happy-path control. T_A's authenticated session issues `GET
/api/transcribe/jobs/{J_A.id}` where J_A is T_A-owned. Response is 200
with the job record. Asserts the negative twin (@cjm-15.1) is not
testing a degenerate "everything 404s" stack.
