---
quick_id: 260530-onm
slug: oidc-provider-name
date: 2026-05-30
status: in-progress
---

# Quick Task: OIDC_PROVIDER_NAME operator-configurable SSO button label

## Goal

Make the generic OIDC sign-in button's display label operator-configurable
via a new optional env var `OIDC_PROVIDER_NAME`, so an operator wiring
Keycloak / Authentik / Okta / any IdP can render "Continue with <Company
SSO>" instead of the generic "OIDC" button.

Peer request (desktop-client developer 3bc6n4wj).

## Frozen contract preserved

The provider `id` stays the **frozen** `"oidc"` round-trip with the desktop
client (it POSTs back to `/api/desktop-signin/oidc`) — only the
human-facing `name` changes. See memory
`project_provider_id_roundtrip_contract`. NO new id, NO per-IdP id like
`keycloak`. One generic `oidc` button, operator-named.

## Surface

- `apps/api/src/lib/oidc-providers.ts` — `listConfiguredOidcProviders()`:
  the hardcoded `name: "OIDC"` (L80) becomes `name: oidcProviderName(env)`.
  New helper reads `env.OIDC_PROVIDER_NAME`, trims, falls back to `"OIDC"`
  when unset/blank.
- `apps/api/tests/unit/lib/__tests__/oidc-providers.test.ts` — 6 new cases
  (override, frozen-id, default, blank→default, trim, no-bleed-to-google/github).
- `apps/api/tests/unit/routes/__tests__/auth-providers.test.ts` — 1 new
  case asserting the override flows through the public HTTP route.
- `.env.full.example` — documented optional override in the OIDC block.
- `charts/openwhispr-server/README.md` — documented in the auth secret
  creation example.

## Verification

- RED → GREEN (lib 18→20, route 9→10).
- `pnpm --filter api tsc --noEmit` exit 0.
- `pnpm test:all` green for the pre-push evidence gate (never --no-verify).
