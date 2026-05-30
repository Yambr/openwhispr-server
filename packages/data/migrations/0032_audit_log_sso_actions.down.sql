-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Down for 0032 — revert the audit_log CHECK to the original 18-action
-- D-A6 posture (drop the SSO JIT actions sso.jit.user.created /
-- sso.jit.role.updated / sso.jit.rejected). NOT in the drizzle journal —
-- run by hand as openwhispr_owner.
--
-- Like the forward migration this DROPs then re-ADDs the CHECK on the
-- partitioned parent (not partition-local), so the 18-action constraint
-- cascades back to every partition child. After this runs, inserting any
-- sso.jit.* action raises audit_log_action_check.
--
-- This revert NARROWS the allow-list (21 -> 18), so the operator MUST
-- first purge / re-map any rows carrying the three sso.jit.* actions —
-- otherwise the `VALIDATE CONSTRAINT` below fails (a row violates the
-- restored 18-action predicate). The `NOT VALID` ADD applies the
-- constraint to new writes immediately; the subsequent `VALIDATE` proves
-- the existing corpus is clean.

ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_action_check";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_check" CHECK ("action" IN (
	'auth.signin','auth.signin_failed','auth.signout','auth.password_change',
	'auth.oauth_link','account.delete','account.delete_requested',
	'key.issued','key.revoked','settings.tenant_changed','settings.user_changed',
	'admin.tenant_created','admin.tenant_suspended','admin.user_impersonated',
	'admin.role_changed','security.cross_tenant_attempt',
	'security.rate_limit_exceeded','security.ssrf_blocked'
)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "audit_log" VALIDATE CONSTRAINT "audit_log_action_check";
