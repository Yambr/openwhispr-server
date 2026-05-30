-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Phase 69 / Plan 69-02 — D-69-2 (Option A): extend the locked 18-action
-- audit taxonomy to 21 by admitting the three SSO just-in-time
-- provisioning actions:
--   - sso.jit.user.created
--   - sso.jit.role.updated
--   - sso.jit.rejected
--
-- `audit_log` is a monthly RANGE-partitioned parent (migration 0014). A
-- CHECK constraint added to the parent (without the partition-local
-- keyword) cascades to every existing and future partition child in one
-- statement. Adding it partition-local would error once child partitions
-- exist (PostgreSQL refuses a partition-local constraint on a partitioned
-- parent that has children). We therefore DROP the existing 18-action
-- CHECK and re-ADD it (cascading) with the full 21-action set — the swap
-- propagates to all partition children.
--
-- The re-ADD uses `NOT VALID` (online-migration safety, squawk
-- `constraint-missing-not-valid`): it skips the blocking full-table
-- validation scan / write-block. This swap is a pure action-set WIDENING
-- (18 -> 21 superset), so every pre-existing row already satisfies the new
-- predicate — the immediate `VALIDATE CONSTRAINT` finds zero violations
-- and takes only a SHARE UPDATE EXCLUSIVE lock (no full write block). The
-- CHECK is enforced on all NEW writes immediately, including in every
-- partition child (the ADD is not partition-local). PostgreSQL 17 accepts
-- a `NOT VALID` CHECK on a partitioned parent.
--
-- No-PII contract (D-69-2): the matching zod payload schemas in
-- apps/api/src/lib/audit.ts are `.strict()` and reject email/name/sub/raw
-- groups; recordAudit's FORBIDDEN_AUDIT_KEYS sweep + Cyrillic guard remain
-- the runtime defence-in-depth.
--
-- Hard Rule 1 honored: this is a NEW forward migration, not an edit to
-- 0014. The down migration (0032_audit_log_sso_actions.down.sql) reverts
-- the CHECK to the original 18-action posture.

ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_action_check";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_check" CHECK ("action" IN (
	'auth.signin','auth.signin_failed','auth.signout','auth.password_change',
	'auth.oauth_link','account.delete','account.delete_requested',
	'key.issued','key.revoked','settings.tenant_changed','settings.user_changed',
	'admin.tenant_created','admin.tenant_suspended','admin.user_impersonated',
	'admin.role_changed','security.cross_tenant_attempt',
	'security.rate_limit_exceeded','security.ssrf_blocked',
	'sso.jit.user.created','sso.jit.role.updated','sso.jit.rejected'
)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "audit_log" VALIDATE CONSTRAINT "audit_log_action_check";
