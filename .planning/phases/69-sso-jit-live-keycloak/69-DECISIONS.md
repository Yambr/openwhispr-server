<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
# Phase 69 — Locked Decisions (advisor-backed)

**Date:** 2026-05-29
**Mode:** autonomous (`--auto`/yolo); user asleep, granted full autonomy + "call the advisor".
Each decision below was produced by a `gsd-advisor-researcher` agent, verified against
code at file:line, and accepted by the orchestrator. These are LOCKED for the planner.

---

## D-69-1 — Desktop bearer-mint JIT seam → **Option C (shared pure resolver, two call-sites)**

**Problem:** The desktop bearer-mint path (`apps/api/src/lib/mint-bearer.ts:316-350`) BYPASSES
`genericOAuth`, so `mapProfileToUser` never fires there. It does its own userinfo fetch with
hardcoded scope `"openid email profile"` (no `groups`) and calls `createOAuthUser` — desktop SSO
users would land with default-tenant + null-role unless the desktop path runs its own projection.

**Decision:** One pure `resolveJitDecision(claims, jitConfig)` function (Req-2, 100% branch,
no I/O). TWO thin call-sites both delegate to it:
- **Web:** inside `genericOAuth`'s `mapProfileToUser` (the only raw-claim seam on the web path).
- **Desktop:** a pre-`createOAuthUser` projection in `mint-bearer.ts`.

Three narrow, ADDITIVE edits to the bearer path: (1) add `groups` to the requested scope in
`desktop-signin.ts:192` AND the `account.scope` in `mint-bearer.ts:346`; (2) widen the
`OidcUserinfo` zod shape to carry claims; (3) call `resolveJitDecision` and pass `tenantId`/`role`
into `createOAuthUser`. Token exchange, discovery SSRF guards (`assertEndpointAffiliated`),
`set-auth-token` rotation, and channel-scheme echo stay UNCHANGED.

**Rejected:** B (route desktop through genericOAuth) — `auth-callback.ts:5-14` + `mint-bearer.ts:5-10`
document that genericOAuth has NO per-request redirect hook and reads PKCE state from a table the
desktop flow doesn't use → re-introduces the `state_not_found` failure the custom route was built
to fix, breaks channel-scheme deep-link. D (descope desktop JIT) — mis-tenants desktop SSO users
in production (isolation footgun); emergency fallback only.

**Residual risk to validate at realm authoring (A1):** the Keycloak client must emit `groups` in
**userinfo** (not only the id_token), since the desktop path reads claims via the userinfo fetch.
If groups land only in the id_token, C extends minimally to decode the id_token JWT in mint-bearer
— still NOT a fallback to B/D.

---

## D-69-2 — 3 new `sso.jit.*` audit actions → **Option A (extend the enum properly)**

**Problem:** `packages/data/src/schema/audit_log.ts:25-80` defines `AUDIT_LOG_ACTIONS` as a LOCKED
18-action enum + Postgres CHECK; `apps/api/src/lib/audit.ts:134-181` has `auditPayloadSchemas` as
a `satisfies Record<AuditAction, ZodSchema>` exhaustive union. The 3 new actions violate both today.

**Decision:** Extend properly (enterprise-grade, no workaround per CLAUDE.md hard-rule 1):
- Add `sso.jit.user.created`, `sso.jit.role.updated`, `sso.jit.rejected` to `AUDIT_LOG_ACTIONS` (18→21).
- Add their 3 zod payload schemas to `auditPayloadSchemas` (keeps `satisfies Record<AuditAction>` compiling).
- Migration `0032_audit_log_sso_actions.sql` (+ `.down.sql`): `DROP CONSTRAINT audit_log_action_check`
  then re-`ADD` with 21 values. **WITHOUT `ONLY`** — cascades to all monthly partition children in one
  statement (using `ONLY` would error once partitions exist). Down-migration re-adds the 18-action CHECK.
- Land enum + zod + migration as ONE atomic TDD commit, RED first (migration/integration test asserting
  the new CHECK admits `sso.jit.*` and down reverts to 18).

**Rejected:** B (logs only, no audit rows) — contradicts Req-4 acceptance + `@cjm-sso-1.1` asserts the
literal `sso.jit.user.created` row; unauditable security-critical provisioning. C (reuse generic action)
— no generic `user.created` exists in the 18; `admin.role_changed` is admin-actor-scoped (wrong);
muddies taxonomy; breaks the verbatim cjm assertion.

**No-PII payload shapes (FORBIDDEN: email, name, sub, raw groups, email_domain literal):**
- `sso.jit.user.created` → `{ tenant_id: hexUuid, role: enum(roles), tenant_claim_mode: enum(["named_claim","email_domain"]), matched_group_hash: sha256Hex.optional() }` (winning group stored only as SHA-256, mirroring `settings.*_changed` before/after_hash). `actor_user_id` = new user UUID.
- `sso.jit.role.updated` → `{ tenant_id: hexUuid, before: enum(roles), after: enum(roles), reason: enum(["group_change","revocation_downgrade"]) }` (mirrors `admin.role_changed` before/after). `actor_user_id` = user UUID.
- `sso.jit.rejected` → `{ tenant_id: hexUuid, code: enum(["forbidden_missing_tenant_claim","forbidden_unknown_tenant","forbidden_no_role_mapping","forbidden_tenant_mismatch","invalid_oidc_profile"]) }`. Rejected sign-in may have no valid tenant → use DEFAULT_TENANT_ID for the row (matches `auth.signin_failed` precedent). `actor_user_id` = null.

**Flag to planner (orthogonal):** `create.after`/`update.after` hooks fire POST-commit, so audit rows
live in a separate `withTenant` tx from the user row — an intentional documented deviation from D-A1's
"audit row exists iff action commits", forced by Better Auth's hook lifecycle. Record in this DECISIONS doc.

---

## D-69-3 — `@cjm-sso-1.5` cross-tenant assertion → **Option C (split 1.5a sign-in 403 + 1.5b read 404)**

**Problem:** Scenario 1.5 reads "RLS rejects … with 403 forbidden_tenant_mismatch" on a data request.
But: (a) read-time cross-tenant access correctly returns **404** (RLS `USING` filters the row out;
`@cjm-15.*` proves this and asserts `not_found` precisely to avoid existence disclosure); (b) the only
table with a "tenant-A vs tenant-B user" framing, `users`, FAILS OPEN to default tenant (rule 16 /
migration 0024) — no isolation observable there. The scenario conflates two distinct real mechanisms.

**Decision:** Split into two truthful scenarios:
- **1.5a — sign-in-time 403:** returning SSO user presents a CHANGED tenant claim → `resolveJitDecision`
  rejects with `403 forbidden_tenant_mismatch` (SPEC-ldap-keycloak.md:144 failure-mode #6, a genuine
  auth-layer rejection, NOT a data read). Provable without the fail-open users table.
- **1.5b — read-time 404:** tenant-A JIT user issues an authenticated read scoped to tenant B's row in a
  FAIL-CLOSED app table (transcriptions/notes/folders) → RLS `USING` filters → `404 not_found`. Verbatim
  clone of the proven `@cjm-15.*` pattern (`rls-cross-tenant.steps.ts:206-216`).

Edit the locked feature text (one scenario → two). Both exercise mechanisms already required elsewhere
in Phase 69 (mode-#6 path is in SSO-IMPL-04 scope; 404 read pattern is a clone).

**Rejected:** D (prove 403 read-time on users table) — NOT VIABLE: users fails open; pursuing it would
require editing migration 0024 / RLS posture purely to satisfy a test → violates CLAUDE.md hard-rule 1.
A (404 only) is the acceptable fallback IF scenario count must stay flat, accepting mode-#6's 403 is
covered only by the `jit-rejections` integration test rather than e2e.

---

## Carried open question for realm authoring (not blocking the plan)

Exact Keycloak group-membership protocol-mapper config: claim name (`groups`) + ensure it targets
**userinfo** (add to ID token AND userinfo in the client scope mapper) so the desktop path (D-69-1)
sees it. Verified at realm-import authoring time.

---

*Phase: 69-sso-jit-live-keycloak*
*Decisions locked: 2026-05-29 (3 advisor-researched, code-verified)*
