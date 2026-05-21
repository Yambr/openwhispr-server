// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 68 / Plan 68-01 — REVIEW byok HIGH HI-03.
//
// `contract-tests/src/schemas.ts` re-exports the production-route wire
// schemas from `@openwhispr/wire-schemas` (Phase 40 / Sub-fix 40.a). But
// it also locally REDEFINED `OpenAIRealtimeTokenResponse` — a divergent
// copy of a schema that has a canonical counterpart. A divergent copy is
// a silent drift surface: a production-schema change does not propagate
// to the contract test.
//
// Verify-first finding (recorded in verify-first.md): of the schemas
// flagged by the planner, ONLY `OpenAIRealtimeTokenResponse` has a true
// canonical counterpart. `streaming-usage.ts` exports a *request* body
// (`StreamingUsageBodySchema`), NOT a usage *response* — so
// `UsageResponse` / `StreamingUsageResponse` have NO counterpart and are
// legitimately owned by the contract package.
//
// HI-03 contract: every `schemas.ts` export that has a canonical
// `@openwhispr/wire-schemas` counterpart must be the SAME object
// reference (a re-export, not a copy).

import * as wire from "@openwhispr/wire-schemas";
import { describe, expect, it } from "vitest";
import { OpenAIRealtimeTokenResponse } from "../../src/schemas.js";

describe("HI-03 — contract-tests schemas must not drift from wire-schemas", () => {
  it("HI-03: OpenAIRealtimeTokenResponse is re-exported from @openwhispr/wire-schemas", () => {
    expect(OpenAIRealtimeTokenResponse).toBe(wire.OpenAIRealtimeTokenResponse);
  });
});
