---
slug: r35-sync-schema-leniency
date: 2026-05-22
status: complete
commit: [0484b161, 20d8a03d, 85728bdd, 8b6485c3]
---

# R35 — sync-endpoint schema leniency — Summary

## Problem

Cloud-sync POST endpoints (`/api/transcriptions/batch-create`,
`/api/notes/batch-create`, `/api/conversations/create`,
`/api/folders/batch-create`) rejected the immutable desktop client's
body with 400 "Invalid request" — sync never reached the server, the
web dashboard stayed empty. Two defects, both diagnosed by LIVE
reproduction (the client-agent's "nullable" hypothesis was wrong — the
input fields were already `.nullable().optional()`):

- **DEFECT 1 — datetime.** `ISO_DATETIME = z.string().datetime({offset:
  true})` requires the RFC-3339 `T`-form. The client stores
  `created_at`/`updated_at` in SQLite (`DATETIME DEFAULT
  CURRENT_TIMESTAMP`) → space-separated `"2026-05-22 16:40:00"` →
  rejected. Live-proven: space → 400, `T`-form → 200.
- **DEFECT 2 — status enum.** `TranscriptionInputSchema.status` was
  `z.enum([4 values])`; the client's SQLite `status` column is free
  `TEXT`. `status:"synced"` → 400.

## Fix — INPUT schemas lenient, RESPONSE schemas stay strict

- **FIX 1** — new `packages/wire-schemas/src/input-datetime.ts`
  `INPUT_DATETIME`: accepts the SQLite space form AND the RFC-3339
  `T`-form, normalizes to canonical ISO via `.transform()`. A
  roll-over-detecting `isCalendarValid` round-trip refine rejects
  `"2026-02-30"` (JS `Date.parse` would silently roll it to Mar 2 — a
  bare non-NaN check is insufficient) and month-13. Applied to
  `created_at`/`updated_at` on the three INPUT schemas
  (transcription/note/conversation — `folders.ts` has no datetime input
  field). `Cloud*` RESPONSE schemas keep strict `ISO_DATETIME`.
- **FIX 2** — `TranscriptionInputSchema.status` widened to
  `z.string().max(256)` on INPUT; `CloudTranscriptionSchema.status`
  stays the strict enum.
- **FIX 3** — `normalizeTranscriptionStatus()` in
  `transcriptions/shape.ts`, applied in `batch-create.ts` +
  `create.ts`, so the free-text DB column row and the strict Cloud*
  response always carry a valid enum value.

The lenient-input / strict-output asymmetry is intentional and
documented in `docs/wire-contract.md`.

## Verification

- wire-schemas: 24 R35 unit tests green (both datetime forms accepted +
  normalized, garbage + `"2026-02-30"` roll-over + month-13 rejected,
  input status accepts `"synced"`, response schema still rejects
  non-enum).
- Route integration (real Postgres testcontainer): 4/4 — batch-create
  with SQLite-form `created_at` + `status:"synced"` → 201,
  `client_*_id` echo, status normalized.
- Lockers green; tsc baseline 5, zero new.
- LIVE (rebuilt api container): `POST /api/transcriptions/batch-create`
  with `created_at:"2026-05-22 16:40:00"` + `status:"synced"` → 201,
  `client_transcription_id` echoed, status normalized to `"completed"`.
  `POST /api/notes/batch-create` with SQLite dates → 201. Both were
  400 before the fix.

## Self-Check: PASSED

- 4 SHAs on HEAD confirmed via git log.
- wire-schema 24/24 + integration 4/4 re-run independently — exit 0.
- Live curls re-run on the rebuilt container — 201 read directly.
