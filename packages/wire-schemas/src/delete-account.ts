// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.a — moved from @openwhispr/contract-tests/schemas.
// Source of truth: BACKEND_SPEC.md §/api/auth/delete-account.
//
// Phase 51 / Plan 51-07 (REVIEW wire-schemas HIGH): `.passthrough()`
// removed. The spec defines this endpoint's success response as an
// empty object; if a future phase needs to attach audit metadata, the
// schema is bumped explicitly via wire-versioning, not by accepting
// arbitrary keys today.
import { z } from "zod";

// DELETE /api/auth/delete-account
export const DeleteAccountResponse = z.object({}).strict();
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponse>;
