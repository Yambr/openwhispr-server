# ADR-0009: Better Auth as the auth library, email-password first-class, OIDC plugin for enterprise SSO

**Status:** accepted

**Date:** 2026-05-13

**Phase:** 10 — i18n, Docs & OSS Housekeeping (records a constitutional decision in force since Phase 3)

## Context

OpenWhispr Server's auth surface must serve two audiences at once:

- **OSS self-host users**: clone, `docker compose up`, sign up with email
  and password, verify via mailpit in dev or a real SMTP in prod. No
  external identity provider required.
- **Enterprise self-host operators**: wire the server to their existing
  identity provider — Keycloak, Authentik, Azure AD, Okta, Google
  Workspace, generic OIDC. The desktop client must complete OAUTH_SPEC.md
  flows against the server-as-OAuth-provider.

CLAUDE.md prohibits roll-your-own auth (`feedback_no_workarounds_enterprise`).
The decision is which off-the-shelf library to standardize on.

## Decision

**Better Auth 1.x** is the auth library. It provides:

- First-class email + password with verification, password reset, and
  account-deletion flows. Email send is plug-in-able; we wire it to a BullMQ
  email-delivery queue (Phase 6 + Phase 10 plans).
- Bearer plugin for the desktop client (the canonical access path is
  `Authorization: Bearer <token>`).
- JWT plugin for stateless token verification at edge components.
- OIDC Provider plugin for the server-as-OIDC-provider flow consumed by
  the desktop client (OAUTH_SPEC.md compliance).
- Generic OIDC client plugin for upstream IdPs (Keycloak / Authentik / Azure
  AD / Okta / Google) — corporate operators set provider URLs and client
  credentials via env, no code change required.
- `additionalFields` extension point used by Phase 10 to add `users.locale`
  to the auth user record without forking the schema.

Operator-facing configuration lives in `docs/oidc-operator-config.md` and the
env contract is summarized in `docs/auth.md`.

## Consequences

- **Easier:** every flow we need (email-password, Bearer, JWT, OIDC
  provider, OIDC client) ships with first-class types in a single library;
  upgrades cross the surface atomically; the desktop client's OAUTH_SPEC.md
  flow is a stock Better Auth OIDC Provider configuration.
- **Easier (locale):** Better Auth's `additionalFields` extension lets us
  round-trip `users.locale` through sign-up, get-session, and the verification
  email payload without a custom column path or a forked schema.
- **Harder:** Better Auth is younger than Lucia or NextAuth; we accept a
  faster API churn in exchange for the OIDC Provider plugin (the differentiator).
- **Risk:** version bumps may require migration of the auth schema; we mitigate
  by pinning the minor version and reviewing every bump alongside a Drizzle
  migration if needed.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| **Lucia** | No OIDC Provider plugin — would force us to implement the server-as-OIDC-provider flow by hand, exactly the thing CLAUDE.md prohibits. |
| **NextAuth / Auth.js** | Pages-Router-flavored history; the App-Router story is workable but weaker. More importantly: NextAuth is a frontend library — the server-side application surface fits Better Auth's shape, not NextAuth's. |
| **Keycloak as the only auth path** | Pushes the OSS self-host onboarding behind a separate service deploy; the "clone and run" goal becomes "clone, deploy Keycloak, run". Unacceptable for the OSS path. |
| **Roll-your-own** | Explicitly forbidden by CLAUDE.md and `feedback_no_workarounds_enterprise`. Auth is high-risk security surface; off-the-shelf wins. |
| **Auth0 / Clerk (SaaS)** | The project is self-hosted; a hosted-SaaS dependency violates the core promise. |

## References

- `docs/auth.md` — env contract, schema, lifecycle
- `docs/oidc-operator-config.md` — operator-facing OIDC provider wiring
- Upstream `OAUTH_SPEC.md` (desktop client flow)
- Phase 3 plans (Better Auth bootstrap)
- Phase 10 plan 10-01c (`users.locale` via `additionalFields`)
- ADR-0006 (wire-compatibility — OAUTH_SPEC.md compliance)
- https://www.better-auth.com/
