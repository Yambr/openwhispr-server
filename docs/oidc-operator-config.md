# OIDC Operator Configuration

Per-IdP walkthroughs for plugging an OpenID Connect provider into OpenWhispr
via Better Auth's `genericOAuth` plugin. See [auth.md](auth.md) for the auth
plane overview and the "silent-disable" semantics if env vars are missing.

## Common environment variables

Every IdP integration sets the same three env vars on the API container.
Better Auth treats `OIDC_*` as the generic OAuth credentials; the rest of
the IdP shape is discovered from the issuer's `.well-known/openid-configuration`
document.

```bash
OIDC_ISSUER_URL=<issuer URL — see per-IdP sections>
OIDC_CLIENT_ID=<from your IdP>
OIDC_CLIENT_SECRET=REPLACE_ME            # never commit; use a secret manager
```

After setting these in the operator's `.env` (or compose `env_file:`), restart
the API container:

```bash
docker compose restart api
```

To verify the issuer responds and serves a discoverable OIDC document:

```bash
curl ${OIDC_ISSUER_URL}/.well-known/openid-configuration | jq
```

The output must include `authorization_endpoint`, `token_endpoint`,
`userinfo_endpoint`, and `issuer` matching `OIDC_ISSUER_URL`.

## Redirect URI to register at the IdP

Every IdP needs to know the redirect URI the OAuth handshake completes at:

```
${AUTH_URL}/api/auth/desktop-callback/oidc
```

Register **exactly** this URL — including the path — at the IdP's application
settings. The desktop client's protocol scheme (`openwhispr://`) is **not**
the redirect URI registered at the IdP; the server emits the protocol redirect
itself after the OAuth handshake completes.

---

## Generic OIDC

Use this section when your IdP is not listed below but speaks OIDC discovery.

```bash
OIDC_ISSUER_URL=https://idp.example.com
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=REPLACE_ME
```

Verify discovery:

```bash
curl https://idp.example.com/.well-known/openid-configuration | jq .issuer
# Expect: "https://idp.example.com"
```

Steps at the IdP:

1. Create a new OAuth/OIDC application.
2. Authorisation flow: **Authorization Code with PKCE**.
3. Redirect URI: `${AUTH_URL}/api/auth/desktop-callback/oidc`.
4. Scopes: `openid email profile`.
5. Copy the issued client ID and client secret into the env vars above.

---

## Keycloak

Realm-based OIDC. Replace `<realm>` with your realm name.

```bash
OIDC_ISSUER_URL=https://keycloak.example.com/realms/<realm>
OIDC_CLIENT_ID=openwhispr-server
OIDC_CLIENT_SECRET=REPLACE_ME
```

Verify discovery:

```bash
curl https://keycloak.example.com/realms/<realm>/.well-known/openid-configuration | jq
```

Steps in Keycloak admin:

1. Select the realm → Clients → Create client.
2. Client type: OpenID Connect; Client ID: `openwhispr-server`.
3. Capability config: enable Standard flow + PKCE (S256).
4. Valid redirect URIs: `${AUTH_URL}/api/auth/desktop-callback/oidc`.
5. After save, open the Credentials tab and copy the secret to
   `OIDC_CLIENT_SECRET`.

---

## Authentik

Same realm-style URL pattern as Keycloak. Authentik's `slug` becomes the
issuer path segment.

```bash
OIDC_ISSUER_URL=https://authentik.example.com/application/o/<application-slug>/
OIDC_CLIENT_ID=<from authentik>
OIDC_CLIENT_SECRET=REPLACE_ME
```

Verify discovery:

```bash
curl https://authentik.example.com/application/o/<slug>/.well-known/openid-configuration | jq
```

Steps in Authentik admin:

1. Applications → Providers → Create → OAuth2/OpenID Provider.
2. Authorization flow: default-provider-authorization-explicit-consent.
3. Redirect URIs: `${AUTH_URL}/api/auth/desktop-callback/oidc`.
4. Save and copy the generated client ID and secret.
5. Applications → Applications → Create → bind the provider.

---

## Google Workspace

Google's issuer is fixed; the work happens in the Google Cloud Console.

```bash
OIDC_ISSUER_URL=https://accounts.google.com
OIDC_CLIENT_ID=<google-client-id>.apps.googleusercontent.com
OIDC_CLIENT_SECRET=REPLACE_ME
```

Verify discovery:

```bash
curl https://accounts.google.com/.well-known/openid-configuration | jq .issuer
# Expect: "https://accounts.google.com"
```

Steps in Google Cloud Console:

1. APIs & Services → Credentials → Create Credentials → OAuth client ID.
2. Application type: Web application.
3. Authorised redirect URIs: `${AUTH_URL}/api/auth/desktop-callback/oidc`.
4. Save; download the JSON and copy `client_id` + `client_secret`.
5. (Workspace) Admin Console → Security → API controls → Domain-wide
   delegation: NOT required for sign-in; only relevant if you later
   integrate Workspace admin APIs.

---

## Azure AD (Entra ID)

Tenant-scoped issuer. Replace `<tenant-id>` with your directory tenant GUID.

```bash
OIDC_ISSUER_URL=https://login.microsoftonline.com/<tenant-id>/v2.0
OIDC_CLIENT_ID=<application-id>
OIDC_CLIENT_SECRET=REPLACE_ME
```

Verify discovery:

```bash
curl https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration | jq .issuer
# Expect: "https://login.microsoftonline.com/<tenant-id>/v2.0"
```

Steps in the Entra ID portal:

1. App registrations → New registration.
2. Supported account types: Accounts in this organizational directory only
   (single tenant) unless you intend multi-tenant.
3. Redirect URI (Web): `${AUTH_URL}/api/auth/desktop-callback/oidc`.
4. After registration, copy Application (client) ID → `OIDC_CLIENT_ID`.
5. Certificates & secrets → New client secret → copy value to
   `OIDC_CLIENT_SECRET`. Note the expiry — Azure secrets expire by default;
   schedule rotation.
6. API permissions → add `openid`, `email`, `profile` (delegated) → grant
   admin consent.

---

## Okta

Per-org or per-custom-auth-server issuer. Replace `<org>` and choose your
auth server (`default` is built-in).

```bash
OIDC_ISSUER_URL=https://<org>.okta.com/oauth2/default
OIDC_CLIENT_ID=<from okta>
OIDC_CLIENT_SECRET=REPLACE_ME
```

Verify discovery:

```bash
curl https://<org>.okta.com/oauth2/default/.well-known/openid-configuration | jq
```

Steps in Okta admin:

1. Applications → Applications → Create App Integration.
2. Sign-in method: OIDC. Application type: Web Application.
3. Grant type: Authorization Code (with PKCE).
4. Sign-in redirect URIs: `${AUTH_URL}/api/auth/desktop-callback/oidc`.
5. Sign-out redirect URIs: leave blank (the desktop drives sign-out locally).
6. Assignments: assign to the groups that should have access.
7. Copy Client ID + Client secret from the General tab.

---

## Multi-IdP setups

OpenWhispr v1 supports a single `genericOAuth` provider per deployment.
Operators wanting multiple IdPs simultaneously (e.g., Google for end users +
Okta for admins) should front-end with Keycloak/Authentik configured as a
broker and point OpenWhispr at the broker's realm. SAML support is deferred
to v2 (COMPL-01).

## Verification

After restarting the API container with OIDC env set, the desktop client's
"Sign in with OIDC" path should:

1. Open the system browser to `${AUTH_URL}/api/desktop-signin/oidc?protocol=...`.
2. Land on the IdP's login page.
3. After successful authentication, return to the protocol scheme with a
   `bearer_token` query parameter.

If step 1 returns **HTTP 503**, the OIDC plugin was silently disabled
because at least one of `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`
is unset. Check the API container's structured logs for
`event=auth.oidc_disabled`.
