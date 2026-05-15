<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
---
phase: 18-ldap-keycloak-sso-spec
type: spec
status: locked
created: 2026-05-15
requirements: [SSO-01, SSO-02]
---

# Phase 18 — SPEC: LDAP / Keycloak SSO

## Purpose

Operator-evaluation-time documentation. Phase 18 is the v2 deliverable that
closes the LDAP/Keycloak SSO question with a documented, reviewed path. No
production code lands; v3 (Phase 19) implements against the surface named
here.

## Goal

Close SSO-01 + SSO-02 with (a) an option (a) vs (b) decision matrix
backed by ADR-0009's pre-existing OIDC commitment and (b) a JIT
user-provisioning specification a v3 planner can implement against
directly — including 7 env vars, 5 Better Auth extension points, 7
rejection codes, 3 structured log events, and a worked Keycloak example.

## In Scope

| # | Concern | Notes |
|---|---|---|
| 1 | Decision matrix (a vs b) | Decision below; rationale cross-refs PITFALLS §14 |
| 2 | JIT user-provisioning surface | Better Auth extension points named, not coded |
| 3 | Env-config surface (loud-fail BYOK) | 7 vars; v3 call site named |
| 4 | Failure-mode catalogue | 7 rejection codes |
| 5 | Worked example | Keycloak realm `acme` → tenant + role resolution |

## Out of Scope

| # | Concern | Deferred to |
|---|---|---|
| 1 | Any production code (auth.ts, plugins, migrations) | Phase 19 |
| 2 | `make e2e-cjm SSO=1` Makefile switch | Phase 19 |
| 3 | Keycloak realm import JSON + seed script | Phase 19 |
| 4 | AD / 389DS fixtures | post-Phase-19 (OpenLDAP only in v3) |
| 5 | Authentik fixture (documented as option, no v2/v3 fixture) | post-Phase-19 |

## Decision

**Option (a) — Keycloak/Authentik OIDC frontend over LDAP federation —
chosen.** The decision is essentially pre-committed:

- [ADR-0009](../../../docs/adrs/0009-better-auth-email-password-and-oidc-plugin.md)
  named "Keycloak / Authentik / Azure AD / Okta / Google" as the upstream
  IdP set; this SPEC is a corollary, not a new decision.
- `apps/api/src/auth.ts:39` imports `genericOAuth`; `auth.ts:209` registers
  it conditionally on the existing `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` /
  `OIDC_CLIENT_SECRET` triple. **The surface is already wired.** Phase 19
  ships configuration + hooks, not new Better Auth integration.

Option (b) — direct LDAP via `ldapts` + custom Better Auth plugin —
**rejected**. PITFALLS §14 flags option (b) in four sections:

1. **SPEC-bloat magnet** — operators expect SAML / Kerberos parity once
   LDAP lands; v3 owns a plugin without community upstream.
2. **Integration Gotchas** — `ldapjs` / `ldapts` in-request bind blocks
   the Better Auth pool under load.
3. **Performance Traps** — p95 200ms → 2s at ~50 concurrent auth
   requests (LDAP bind is synchronous).
4. **Recovery Strategies** — shipping LDAP via in-request bind is a HIGH
   cost to deprecate (2-release window minimum).

v3 LOC estimate: **~50–150** (option a — compose + docs + hooks) versus
**~400–800** (option b — plugin + ldapts integration + retry/backoff +
connection pool).

## Worked example

Keycloak realm `acme` issues this id_token to a corporate user:

```json
{
  "sub": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "email": "alice@acme.example",
  "name": "Alice Engineer",
  "groups": ["openwhispr-engineering", "okta-everyone"],
  "iss": "https://sso.acme.example/realms/acme"
}
```

Operator env config:

```
OIDC_ISSUER_URL=https://sso.acme.example/realms/acme
OIDC_CLIENT_ID=openwhispr-backend
OIDC_CLIENT_SECRET=...
OIDC_TENANT_CLAIM=email_domain
OIDC_TENANT_MAPPING={"acme.example":"acme"}
OIDC_GROUP_CLAIM=groups
OIDC_ROLE_MAPPING={"openwhispr-admin":"admin","openwhispr-engineering":"member"}
OIDC_DEFAULT_ROLE=null
```

Resolution: tenant `acme`, role `member`, audit event
`sso.jit.user.created`.

## Env vars (loud-fail BYOK)

| Var | Required? | Default | Purpose |
|---|---|---|---|
| `OIDC_TENANT_CLAIM` | yes | — | One of `email_domain` or a claim name carrying the tenant key. |
| `OIDC_TENANT_MAPPING` | yes (when claim ≠ `email_domain`) | — | JSON map `claim-value → tenant-id`. |
| `OIDC_GROUP_CLAIM` | optional | `groups` | id_token claim name carrying the array of group memberships. |
| `OIDC_ROLE_MAPPING` | optional | — | JSON map `group-name → role` (`admin` / `member` / `viewer`). |
| `OIDC_ROLE_PRIORITY` | optional | `admin > member > viewer` | Tie-break order when a user matches multiple groups. |
| `OIDC_DEFAULT_ROLE` | optional | `null` (reject) | Role assigned when no group matches. `null` rejects sign-in. |
| `OIDC_REVOCATION_MODE` | optional | `downgrade_to_default` | Behaviour on returning user whose admin group was revoked: `downgrade_to_default` rewrites role + audit; `keep_role` is rejected by SPEC. |

Mirroring `apps/api/src/auth.ts:11-13`: these 7 vars are loud-fail BYOK —
JIT provisioning silently disables when `OIDC_TENANT_CLAIM` is unset, and
boot-time fail-fast triggers on malformed `OIDC_TENANT_MAPPING` /
`OIDC_ROLE_MAPPING` JSON. v3 call site: `apps/api/src/lib/oidc-jit-config.ts`
(mirrors existing `lib/oidc-providers.ts` triplet validation shape). SPEC
implements NO code; v3 plan owns the boot wiring.

## Better Auth extension points

| Concern | Better Auth API |
|---|---|
| Claim → user-field projection | `genericOAuth({ config: [{ ..., mapProfileToUser: (profile) => ({...}) }] })` |
| Initial role + tenant assignment on JIT create | `databaseHooks.user.create.before(entity, ctx)` — returns `{ data: { ...entity, role, tenantId } }` |
| Per-sign-in role re-sync | `databaseHooks.user.update.before(entity, ctx)` |
| Audit emission | `databaseHooks.user.create.after` / `databaseHooks.user.update.after` |
| Multi-OAuth → single user linkage | Existing `account.user_id` foreign key (no new code) |

## Failure modes

| # | Trigger | Resolution | Code |
|---|---|---|---|
| 1 | Tenant claim missing on id_token | Reject sign-in; no auto-tenant-provisioning. | `403 forbidden_missing_tenant_claim` |
| 2 | Tenant claim present but not in `OIDC_TENANT_MAPPING` | Reject; operators onboard tenants explicitly. | `403 forbidden_unknown_tenant` |
| 3 | Group claim missing AND `OIDC_DEFAULT_ROLE=null` | Reject; no implicit role grant. | `403 forbidden_no_role_mapping` |
| 4 | Multiple group matches | Resolve deterministically via `OIDC_ROLE_PRIORITY`. | (200, role = highest-priority match) |
| 5 | Returning user, admin group revoked | Rewrite role to `OIDC_DEFAULT_ROLE`; emit `sso.jit.role.updated` + audit row. | (200, downgraded) |
| 6 | Returning user, tenant claim changed | Reject (RLS invariant — user is bound to one tenant). | `403 forbidden_tenant_mismatch` |
| 7 | `mapProfileToUser` throws (claim shape diff) | Log claim shape diff (NO PII); reject. | `400 invalid_oidc_profile` |

## Structured log events

- `sso.jit.user.created` — first-time JIT provisioning (emitted from
  `databaseHooks.user.create.after`).
- `sso.jit.role.updated` — returning user, role rewritten (emitted from
  `databaseHooks.user.update.after`).
- `sso.jit.rejected` — sign-in rejected by any of failure modes 1, 2, 3,
  6, 7 (emitted from `mapProfileToUser` or `user.create.before`).

Each structured-log line also writes a matching row to `audit_log` (Phase
14 partitioned table).

## Open questions for v3 plan

See [ADR-0012 § Open questions for v3 plan](../../../docs/adrs/0012-ldap-via-keycloak.md#open-questions-for-v3-plan).

## Operator survey results

See [ADR-0012 § Operator demand](../../../docs/adrs/0012-ldap-via-keycloak.md#operator-demand-informal-survey-anonymised).

## References

- [PITFALLS §14](../../research/PITFALLS.md) — operator-demand survey prerequisite + option-(b) rejection rationale.
- [ADR-0009](../../../docs/adrs/0009-better-auth-email-password-and-oidc-plugin.md) — predecessor decision (extended, not superseded).
- [ADR-0012](../../../docs/adrs/0012-ldap-via-keycloak.md) — operator-demand survey + alternatives table + 5 v3 open questions.
- `apps/api/src/auth.ts:11-13,39,199-215` — existing OIDC triplet + `genericOAuth` registration (proof-by-reference for the zero-surgery claim).
- `packages/data/migrations/0001_better_auth.sql` — `account.provider_id + account_id + tenant_id UNIQUE` (JIT idempotency anchor — no migration required for v3).
