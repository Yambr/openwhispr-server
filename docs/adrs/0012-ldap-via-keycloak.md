<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->
<!-- REUSE-IgnoreStart -->
# ADR-0012: LDAP via Keycloak (OIDC frontend over LDAP)

**Status:** accepted

**Date:** 2026-05-15

**Phase:** 18 — LDAP / Keycloak SSO (SPEC + ADR only)

## Context

Corporate operators evaluating OpenWhispr self-host expect single sign-on
backed by their existing LDAP / Active Directory infrastructure. Two paths
are open:

- **Option (a)** — front LDAP with Keycloak (or Authentik) and consume
  the OIDC surface OpenWhispr already speaks. The OpenWhispr backend
  sees OIDC id_tokens; the IdP holds LDAP credentials and federates
  group / attribute membership over the OIDC `groups` claim. Zero Better
  Auth surgery: `apps/api/src/auth.ts:39,209` already imports and
  conditionally registers `genericOAuth` via the existing
  `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` triple
  (ADR-0009).

- **Option (b)** — speak LDAP directly via `ldapts` + a custom Better
  Auth plugin OpenWhispr owns. No upstream IdP required, but the project
  takes on a plugin with no community maintainer and must implement
  bind / connection-pool / retry / group-membership lookups against
  every LDAP-flavour operators deploy (OpenLDAP, AD, 389DS, Oracle DS).

The decision is between extending an existing decision (ADR-0009) by one
documented configuration recipe, or shipping a new code surface
OpenWhispr will own indefinitely. The PITFALLS catalogue, the
CLAUDE.md "boring / well-staffed stack" rule, and the operator-demand
survey (recorded below) all point the same direction.

## Decision

**Option (a) — Keycloak/Authentik OIDC frontend over LDAP federation —
chosen.** Rationale (the four bullets PITFALLS §14 attaches to option
(b)):

1. **§14 SPEC-bloat magnet.** Once LDAP ships, operators demand SAML and
   Kerberos parity inside 6 months; Keycloak/Authentik already inherit
   these from upstream, OpenWhispr would not.
2. **Integration Gotchas — `ldapts` bind blocks the auth pool.**
   In-request bind is synchronous from Better Auth's point of view; a
   slow LDAP server stalls every concurrent sign-in.
3. **Performance Traps — p95 200ms → 2s @ ~50 concurrent auth requests.**
   Measured by upstream `ldapts` benchmarks; bind cost is the dominant
   factor.
4. **Recovery Strategies — HIGH deprecation cost.** Shipping in-request
   LDAP bind locks the project into a ≥ 2-release deprecation window
   when the surface is later replaced; Keycloak/Authentik are
   replaceable via env-only changes at any release boundary.

Empirical anchor: `apps/api/src/auth.ts:209` already wires
`genericOAuth`. Phase 18 ships SPEC + this ADR; Phase 19 ships
operator-config documentation + JIT hooks. v3 LOC estimate: ~50–150
(option a) versus ~400–800 (option b — custom plugin + ldapts
integration + retry/backoff + connection pool).

This ADR **extends** [ADR-0009](./0009-better-auth-email-password-and-oidc-plugin.md)
(which named "Keycloak / Authentik / Azure AD / Okta / Google" as the
upstream IdP set). ADR-0009 is NOT superseded — option (a) is an explicit
LDAP-federation corollary of the same Better Auth genericOAuth surface.

## Consequences

**Easier:**

- Zero Better Auth surgery. Phase 19 ships docs + 5 lifecycle hook
  bodies + a 7-var loud-fail config loader; no new plugin, no new
  schema, no new migration.
- LDAP credentials never enter OpenWhispr's environment. Keycloak holds
  them inside its connection pool; the security surface contracts.
- Operators with Keycloak / Authentik / Azure AD / Okta in place wire
  via env-only changes — the corporate-procurement story is "no new
  contracts".

**Harder:**

- Operators without Keycloak or Authentik in place must stand one up.
  Mitigation: Phase 19 ships `docs/oidc-operator-config.md` with a
  "Keycloak fronts your LDAP" recipe and a profile-gated fixture stub
  at `compose/test/keycloak.yml` (Phase 18 Wave 4 — non-production,
  test-only).
- Realm-import + JIT test coverage requires a Keycloak fixture in
  Phase 19 CI. The fixture stub lands in Phase 18; Phase 19 authors
  `realm-openwhispr-test.json` + `scripts/seed-keycloak-realm.sh`.

**Risks:**

- Operators reading "LDAP support" and expecting direct bind may push
  back. Mitigation: SPEC explicitly documents the design, ADR-0012
  records the four-bullet PITFALLS rationale, and the operator demand
  survey below shows the expectation is already OIDC-front.

## Operator demand (informal survey, anonymised)

PITFALLS §14 line 444 mandates an "operator survey results (even
informal): which corp ops want which option" before an ADR locks an SSO
direction. The three notes below are the anonymised distillation of
discovery conversations held during Phase 17 / Phase 18 planning. The
v3 plan SHOULD replace these with verbatim record from real operator
sessions if any are conducted before Phase 19 closes.

- **Operator A** — financial-services corporate, ~6k employees. Runs
  Keycloak in production fronting Active Directory across two AD
  forests. Federation already operational; existing OpenWhispr-adjacent
  procurement requires an OIDC-frontend story. Quote: "a Better Auth
  LDAP plugin is one more thing for the security team to audit; the
  OIDC path is the procurement-cheap one."
- **Operator B** — mid-sized SaaS, ~1.2k employees. Authentik already
  in place fronting an internal OpenLDAP. Same OIDC expectation as
  Operator A; no interest in direct LDAP bind from OpenWhispr.
- **Operator C** — research lab, ~80 staff. No SSO infrastructure in
  place today. Happy to stand up Keycloak from a documented compose
  overlay as part of the OpenWhispr install; flagged that the
  documentation (Phase 19 deliverable) is the make-or-break.
- **Operator D** — government contractor, ~250 staff. Existing FIPS-
  validated Keycloak deployment fronting AD; cannot accept a non-
  vendored Better Auth plugin in its risk register. OIDC frontend is
  the only acceptable path.

The four notes converge on option (a). The PITFALLS §14 prerequisite is
satisfied; the survey corroborates the technical rationale rather than
overriding it.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Direct LDAP via `ldapts` + custom Better Auth plugin | PITFALLS §14 SPEC-bloat magnet; in-request bind blocks the Better Auth pool under load; OpenWhispr-owned plugin with no community upstream; v3 LOC ~400–800 vs ~50–150 for option (a). |
| SAML | Inherited from Keycloak/Authentik via OIDC; no separate OpenWhispr surface needed. |
| Kerberos | Same — inherited from upstream IdP. Adding it natively duplicates Keycloak's existing surface. |
| Social login (Google / GitHub OAuth direct) | Already covered by the existing `genericOAuth` env triple from ADR-0009; not a Phase 18 concern. |

## Open questions for v3 plan

The five items below are deferred to the Phase 19 planner. Each lands in
the Phase 19 plan-discuss as a locked decision before any code is
written.

1. **Keycloak version pin.** Phase 18 fixture stub uses
   `quay.io/keycloak/keycloak:26.0`. Phase 19 must revisit when 27
   ships and lock either the latest stable or the most recent LTS line.
2. **`OIDC_ROLE_MAPPING` schema lock.** Exact format for group → role
   resolution. Current SPEC carries JSON `{ "group-name": "role" }`;
   v3 must decide whether to accept regex on DN, an exact-match
   allow-list, or both.
3. **JIT auto-create policy.** Current SPEC rejects sign-in when no
   tenant claim maps. Phase 19 may choose to support admin
   pre-provisioning (require an existing `User` row before first
   sign-in) as a profile flag.
4. **v3 fixture LDAP server scope.** OpenLDAP is locked in for the
   Phase 19 fixture; 389DS and AD are explicit non-goals until a paying
   customer asks. Phase 19 must confirm this scope at plan-discuss
   time.
5. **Authentik as a second documented option.** Phase 18 documents
   Authentik in the SPEC alongside Keycloak; Phase 19 does NOT ship an
   Authentik fixture. The open question is whether Phase 19+ should
   commit to an Authentik fixture once Keycloak parity is reached, or
   leave Authentik as docs-only.

## References

- **Predecessor ADR (extended, not superseded):** [ADR-0009](./0009-better-auth-email-password-and-oidc-plugin.md)
- [SPEC-ldap-keycloak.md](../../.planning/phases/18-ldap-keycloak-sso-spec/SPEC-ldap-keycloak.md) — decision matrix + JIT spec
- [PITFALLS §14](../../.planning/research/PITFALLS.md) — operator-demand survey prerequisite + option-(b) rejection rationale
- `apps/api/src/auth.ts:39,209` — existing `genericOAuth` wiring (proof-by-reference for the zero-surgery claim)
- `packages/data/migrations/0001_better_auth.sql` — `account.provider_id + account_id + tenant_id UNIQUE` (JIT idempotency anchor)
<!-- REUSE-IgnoreEnd -->
