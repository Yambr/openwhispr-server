# Authentication

> Phase 2 starter (DOCS-06 v1). Full operator handbook lands in Phase 10.

This document explains how to configure and operate the OpenWhispr server's
authentication plane. It covers email+password sign-in (first-class), OIDC
plug-in (any provider Better Auth supports), the channel-scheme echo on the
desktop OAuth flow, dual auth (bearer or cookie), token rotation overlap, and
cookie-host scoping.

## Overview

The auth plane is built on **Better Auth 1.6.9**. We embed the library inside
the Fastify API process and expose a Drizzle adapter bound to the multi-tenant
PostgreSQL substrate (RLS enforced; see [storage.md](storage.md) and the Phase
1 documentation for the data plane).

| Capability | Mechanism |
|------------|-----------|
| Email + password sign-in | Better Auth `emailAndPassword.enabled = true` |
| OIDC sign-in (any provider) | Better Auth `genericOAuth` plugin (silently disabled if env not set) |
| Opaque bearer tokens | Better Auth bearer plugin; tokens are NOT JWTs (the desktop client never inspects contents) |
| Session cookies | Standard HTTP-only cookies; eTLD+1 domain scoped automatically |
| Token rotation | `set-auth-token` response header on every Better-Auth-driven endpoint |
| Rotation overlap | Custom `previous_token_hash` machinery (apps/api/src/lib/token-rotation.ts) — overlap window 5 minutes |
| Channel-scheme echo | Desktop OAuth callback emits `<scheme>://?bearer_token=...` matching the scheme presented at sign-in |

## Quick start: email+password only

The minimum operator configuration to get the server up with email+password
sign-in enabled (no external IdP):

```bash
# .env (or compose env_file)
BETTER_AUTH_SECRET=<32-byte-random; required>
AUTH_URL=https://api.example.com
OPENWHISPR_API_URL=https://api.example.com

# SMTP for verification emails (PROVIDER-04). Leave SMTP_HOST unset in dev to
# get a no-op stub that logs `event=email.smtp_not_configured` instead of
# attempting delivery.
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=<provider-issued>
SMTP_FROM="OpenWhispr <noreply@example.com>"
```

`BETTER_AUTH_SECRET` is the only secret strictly required for sign-in itself.
See `apps/api/scripts/check-default-secrets.ts` and `tools/bootstrap/default-secrets.txt`
for the full deny-list — the API container refuses to start if any deny-listed
placeholder value (`changeme`, `sk-1234`, etc.) is present.

## Plugging an OIDC provider

OpenWhispr accepts any OIDC provider via Better Auth's `genericOAuth` plugin.
If all three of the following env vars are set the plugin registers itself
automatically; if any is missing the plugin is **silently disabled** (D-02)
and email+password remains the only sign-in path.

```bash
OIDC_ISSUER_URL=https://accounts.google.com           # or your IdP's issuer URL
OIDC_CLIENT_ID=<from your IdP application registration>
OIDC_CLIENT_SECRET=<from your IdP application registration>
```

Per-IdP walkthroughs (Keycloak, Authentik, Google Workspace, Azure AD, Okta)
are in [oidc-operator-config.md](oidc-operator-config.md).

There is **no server-side allowlist** of providers (AUTH-07): once a user
signs in successfully via the configured IdP they are recognised as a
corporate user with no plan/tier distinctions in v1.

## Sign-in flow (desktop)

The desktop OAuth flow is a four-hop dance that lets the desktop client
present any URL scheme (`openwhispr://`, `openwhispr-dev://`, `mycorp-whispr://`)
and have the bearer token returned to that exact scheme.

1. The desktop opens its system browser to:

   ```
   GET ${AUTH_URL}/api/desktop-signin/{provider}?protocol=openwhispr-dev
   ```

   The server validates the `protocol=` query against the scheme allow-list
   (see [channel-scheme-override.md](channel-scheme-override.md)), persists
   an `oauth_state` row with PKCE, and 302-redirects to the configured IdP.

2. The IdP authenticates the user and 302-redirects back to:

   ```
   GET ${AUTH_URL}/api/auth/desktop-callback/{provider}?state=...&code=...
   ```

3. The server consumes the `oauth_state` row via an atomic compare-and-set,
   exchanges the code for a Better Auth session, and 302-redirects to:

   ```
   openwhispr-dev://?bearer_token=<opaque-token>
   ```

   The desktop client's protocol handler captures the URL and stores the
   bearer token via its `tokenStore.js`.

4. Subsequent desktop requests carry both `Authorization: Bearer <token>`
   and the session cookie. See "Dual auth" below.

If the requested scheme is not on the allow-list, step 1 returns
**HTTP 400** with body `{"error":"invalid callback scheme"}` — the server
**never** 302-redirects to a rejected scheme.

## Token lifecycle

| Property | Value | Where set |
|----------|-------|-----------|
| Token format | Opaque (HMAC-signed by Better Auth; not a JWT) | Better Auth bearer plugin |
| TTL | ≥30 days | `apps/api/src/auth.ts` `session.expiresIn` |
| Rotation header | `set-auth-token: <new-token>` on every authenticated response that crosses the rotation threshold | Better Auth bearer plugin |
| Overlap window | 5 minutes (old token still resolves to the same session/user/tenant after rotation) | `apps/api/src/lib/token-rotation.ts` |
| Storage on desktop | Main-process `tokenStore.js`; never exposed to the renderer | Desktop client (out of scope here) |

### Why the overlap window matters

When the desktop's main process has a request in flight at the moment Better
Auth rotates the session token, the response carrying the new `set-auth-token`
header arrives **after** the in-flight request was sent with the old token.
Without an overlap window, the desktop's `withSessionRefresh()` helper would
see a 401 cascade on R2/R3 issued in that race window and force the user
back to sign-in.

OpenWhispr stores the SHA-256 hash of the previous token plus an expiry
timestamp (now + 5 min) on each rotation. A `SECURITY DEFINER` function
(`lookup_session_by_previous_token`) lets the dual-auth middleware fall back
to the previous-token row when the bearer presented does not match the
current one. After 5 minutes the previous_token row is invalid and the old
token returns a clean 401.

## Dual auth

Every authenticated endpoint accepts **both** of:

- `Authorization: Bearer <opaque>` — main-process desktop calls
- Session cookie — renderer-direct calls (the cookie is HTTP-only and
  scoped per "Cookie host scoping" below)

The dual-auth Fastify hook (`apps/api/src/middleware/dual-auth.ts`) tries the
bearer first, falls through to the cookie, then falls through to the
previous-token overlap window, and finally throws `AuthError` which the
centralised `setErrorHandler` converts to **HTTP 401** with the global
envelope `{"error":"<message>"}` (WIRE-18).

Some endpoints are **cookie-only** (browser-driven, never reached from the
desktop main process):

- `GET /api/auth/verification-status`
- `DELETE /api/auth/delete-account`

Cookie-only endpoints use the `requireCookieOnly` preHandler which strips
the `Authorization` header before invoking Better Auth, so a stray bearer
on a renderer call cannot fall through accidentally.

## Cookie host scoping (AUTH-07)

The session cookie's `Domain` attribute depends on whether `AUTH_URL` and
`OPENWHISPR_API_URL` resolve to the same host or different hosts on the
same eTLD+1.

| Topology | Example | Cookie Domain |
|----------|---------|---------------|
| Single-host | both URLs `https://api.example.com` | `Domain` omitted (host-only cookie) |
| Split-host (eTLD+1 shared) | `https://auth.example.com` + `https://api.example.com` | `Domain=example.com` |
| Different eTLD+1 | `https://auth.example.com` + `https://api.other.test` | **Unsupported** — the cookie cannot reach the API host. Either consolidate to a single eTLD+1 or use bearer-only auth from the desktop. |

The eTLD+1 logic lives in `apps/api/src/lib/cookie-domain.ts`.

## Troubleshooting

### 401 cascade after sign-in

Symptom: user signs in successfully but the next desktop request returns 401.

Likely causes:
- `BETTER_AUTH_SECRET` rotated between sign-in and the next request →
  every existing token is invalidated. Operators must communicate this
  rotation as a forced-relogin event.
- Clock skew between the API container and the database. Better Auth
  computes session expiry against `now()`; a >5-minute drift can backdate
  the previous-token expiry. Run NTP on the host.
- Cookie did not reach the API host (split-host topology). See
  "Cookie host scoping" above.

### OIDC silently disabled

Symptom: the server starts but the `genericOAuth` plugin is not registered;
`/api/desktop-signin/{provider}` returns **503**.

Likely cause: at least one of `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, or
`OIDC_CLIENT_SECRET` is unset or empty. All three are required (D-02). Check
the API container logs for `event=auth.oidc_disabled` — the structured log
emits the missing key names.

### Verification email not delivered

Symptom: sign-up succeeds but the user never receives the verification email.

Likely cause: `SMTP_HOST` is unset. The dev fallback returns a no-op stub
that logs `event=email.smtp_not_configured`. In dev profile, bring up
mailpit (`docker compose --profile dev up -d mailpit`) and point
`SMTP_HOST=mailpit` to capture mail in a local UI.

For production: set `SMTP_HOST`, `SMTP_PORT` (587 for STARTTLS, 465 for
direct TLS, 25 plain), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. The
nodemailer transport selects TLS mode automatically based on port.

### "Invalid callback scheme" on desktop sign-in

Symptom: clicking "Sign in" in the desktop client lands on an HTTP 400
page in the system browser with `{"error":"invalid callback scheme"}`.

Likely cause: the desktop is presenting a custom URL scheme that the server
hasn't been told to accept. The built-in allow-list is `openwhispr`,
`openwhispr-dev`, `openwhispr-staging`. Operators can add **one** additional
scheme via `OPENWHISPR_PROTOCOL`. See [channel-scheme-override.md](channel-scheme-override.md)
for the rules.

## Related operator runbook entries

- [operations.md § Auth](operations.md) — runbook for SMTP, BETTER_AUTH_SECRET
  rotation, default-secrets entrypoint check, common 401 patterns
- [oidc-operator-config.md](oidc-operator-config.md) — per-IdP env-config
  walkthroughs
- [channel-scheme-override.md](channel-scheme-override.md) — channel-scheme
  allow-list rules and the OPENWHISPR_PROTOCOL override
