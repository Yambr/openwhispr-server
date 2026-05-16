# Phase 39: wire-schemas HIGH sweep — Context

**Source:** ROADMAP Phase 39 + `.planning/review/wire-schemas.md` HI-1..6
**Closes:** HIGH-FIX-WIRE-01, -02, -03, -04

## Scope

Mechanical sweep across `packages/wire-schemas/src/**`. Existing zod schemas need:

1. **`.strict()` on every INPUT schema** — currently default `.strip()` silently drops unknown keys, flowing them into `Record<string, unknown>` inserts. Affected: `NoteInput`, `FolderInput`, `ConversationInput`, `TranscriptionInput`, `StreamingUsageBody`, `WebSearchRequest`, `CreateApiKeyOptions`. The lone `.strict()` on `ApiKeySchema` (api-keys.ts:25) proves the pattern is known.

2. **Permissive primitives on OUTPUT schemas tightened**:
   - `id: z.string()` → `z.string().uuid()`
   - `*_at: z.string()` → `z.string().datetime({ offset: true })`
   - `client_*_id: z.string()` → `z.string().uuid()`
   - URL fields → `z.string().url()` (incl. WebSearchResult.url)

3. **Long-text + metadata bounded**:
   - Unbounded `z.string()` on body text fields → `.max(BACKEND_SPEC_LIMIT)`
   - `metadata: z.record(...)` → bounded keys + value size cap (e.g., `.refine(maxSize(4096))`)

4. **Symmetrical enums + non-negative integer counts**:
   - `note_type` strict enum on input but free `z.string()` on output → make output strict too
   - All count/duration `z.number()` → `z.number().int().nonneg()`
   - Replace free-string `provider`/`status`/`scope` fields with enums where shape is known

## Tests

Property tests reject:
- Unknown keys on input schemas
- Bad UUID / bad datetime / bad URL on output
- Negative counts / float counts

Existing contract suite MUST remain green (no wire breakage).

## Approach

Pure schema-file refactor. No new files. All edits in `packages/wire-schemas/src/{api-keys,conversations,folders,notes,settings,streaming-usage,transcriptions,web-search}.ts`. Tests at `packages/wire-schemas/tests/`.

Single executor pass; coverage ≥ 90/90/90/90 on diff.

## Scope (out)

- Refactoring contract-tests schemas — Phase 40.
- Route-level changes to handle the new strict rejections — Phase 41 if breaking.
