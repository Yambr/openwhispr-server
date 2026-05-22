-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Down for 0031 — drop the AUTH-04 previous-token SECURITY DEFINER
-- lookup. NOT in the drizzle journal — run by hand as openwhispr_owner.
-- Rolling this back re-introduces AUDIT-SEC-01: the overlap window goes
-- dead again because `tryPreviousToken` falls back to a bare RLS-bound
-- SELECT with no tenant GUC.

DROP FUNCTION IF EXISTS public.lookup_session_by_previous_token_fp(bytea);
