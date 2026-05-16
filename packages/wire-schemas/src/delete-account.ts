// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.a — moved from @openwhispr/contract-tests/schemas.
// Source of truth: BACKEND_SPEC.md §/api/auth/delete-account.
//
// `passthrough()` because the handler may attach audit metadata in a
// future phase without breaking the contract.
import { z } from "zod";

// DELETE /api/auth/delete-account
export const DeleteAccountResponse = z.object({}).passthrough();
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponse>;
