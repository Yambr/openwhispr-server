# Phase 05 — Deferred Items

## Pre-existing test failures (out of scope for Plan 05-07)

Discovered while running the conversations integration suite during Plan
05-07 Task 2/3 execution. These failures exist in code committed by
Plans 05-05, 05-06, and the Task 1 portion of 05-07 — NOT introduced
here.

### `update — unknown id → 404` (and `delete — unknown id → 404`)

- **Tests affected**:
  - `apps/api/src/routes/notes/__tests__/crud.integration.test.ts` (2)
  - `apps/api/src/routes/folders/__tests__/crud.integration.test.ts` (2)
  - `apps/api/src/routes/conversations/__tests__/crud.integration.test.ts` (2)
- **Symptom**: route returns `400` (zod uuid validation rejects the
  fixture id literal `11111111-1111-1111-1111-111111111111`) instead
  of the expected `404`.
- **Likely cause**: the zod schema mandates `.uuid()` but the test
  literal isn't quite a v4 UUID under the new strict zod uuid check.
  Either relax the schema or update the fixture id to a proper UUID v4.
- **Disposition**: Out of scope for 05-07 (Task 1 already shipped with
  this; matches the established Plan 05/06 pattern). Track for a
  follow-up plan (e.g. 05-VERIFY) that aligns Zod validation versions
  across notes/folders/conversations.

### `uses websearch_to_tsquery — multi-word phrase query` (notes search)

- **Test**: `apps/api/src/routes/notes/__tests__/search.integration.test.ts`
- **Symptom**: `expected 0 to be greater than or equal to 1` — search
  returns empty when seeded note "quarterly roadmap" should match.
- **Disposition**: Out of scope for 05-07 (Plan 05 ownership).
