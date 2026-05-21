---
phase: 55-uc-coverage-audit
plan: 04-b
type: execute
wave: 2
depends_on: []
files_modified:
  - apps/web/tests/e2e/100-acceptance/trx-detail-actions.spec.ts
requirements:
  - UC-TRX-DETAIL-COPY
  - UC-TRX-DETAIL-EXPORT-JSON
  - UC-TRX-DETAIL-EXPORT-MD
  - UC-TRX-DETAIL-DELETE-CONFIRM
  - UC-TRX-DETAIL-DELETE-CANCEL
must_haves:
  truths:
    - "Seed a transcription via seedTranscriptions, navigate to /app/transcriptions/[id]"
    - "Copy → clipboard.writeText + sonner toast"
    - "Export JSON → page.waitForEvent('download') with .json filename"
    - "Export MD → page.waitForEvent('download') with .md filename"
    - "Delete → AlertDialog → cancel closes, confirm pushes /app/transcriptions"
    - "Zero browser errors at every step"
  artifacts:
    - path: apps/web/tests/e2e/100-acceptance/trx-detail-actions.spec.ts
      provides: Long-form e2e covering trx detail trio + delete confirm/cancel
  key_links:
    - from: apps/web/tests/e2e/100-acceptance/trx-detail-actions.spec.ts
      to: apps/web/src/components/screens/transcriptions/TranscriptionDetailClient.tsx
      via: button clicks → clipboard / download / DELETE wire
      pattern: 'trx-copy|trx-export-json|trx-export-md|trx-delete'
---

<objective>
Mirror Plan 55-04-a for transcription detail. Spec at
`apps/web/tests/e2e/100-acceptance/trx-detail-actions.spec.ts`.
Closes 5 MISSING UCs from RESEARCH.md §"`/app/transcriptions/[id]`":
- UC-TRX-DETAIL-COPY (TranscriptionDetailClient.tsx:174-178)
- UC-TRX-DETAIL-EXPORT-JSON (180-183)
- UC-TRX-DETAIL-EXPORT-MD (185-199)
- UC-TRX-DETAIL-DELETE-CONFIRM (117-127, 218-241)
- UC-TRX-DETAIL-DELETE-CANCEL (234)

Slim-only. Per-worker fixture user. Pattern: clone 55-04-a structurally.
</objective>

## Context

`TranscriptionDetailClient.tsx` action surface is symmetric to
NoteDetailClient.tsx — same Copy / Export JSON / Export MD / Delete
buttons with AlertDialog confirm. Seed helper: `seedTranscriptions`
(apps/web/tests/e2e/fixtures/seed.ts:170-180) — accepts `{ text }`.

Reference patterns:
- `apps/web/tests/e2e/u7-trx-detail.spec.ts` — existing PARTIAL spec; reads
  the seeded transcription and asserts metadata. Reuse its seed/navigate
  helpers; add the action assertions.
- 55-04-a `note-detail-actions.spec.ts` — adapt verbatim, change paths,
  selectors, and seed helper.

## Files to create

- `apps/web/tests/e2e/100-acceptance/trx-detail-actions.spec.ts`

## Files to modify

(none)

## Tasks

### Task 1 — RED: ship a failing acceptance spec

1. Clone 55-04-a spec structure. Change:
   - `seedNotes` → `seedTranscriptions` (signature: `{ text }`)
   - `/app/notes/${id}` → `/app/transcriptions/${id}`
   - copy body assertion: `expect(clip).toContain("Acceptance transcription 55-04-b body")`
   - Same Copy / Export JSON / Export MD / Delete buttons. Same AlertDialog
     confirm/cancel branches.
   - Final URL after confirm-delete: `/app/transcriptions`
2. **Inspect first:** read `TranscriptionDetailClient.tsx:170-241` for the
   exact selectors (data-testid presence, button labels).
3. Commit: `test(55-04-b): red — trx detail action trio long-form spec`

### Task 2 — GREEN: spec passes first try

1. Re-run spec.
2. Three runs no flake.
3. Full slim sweep → 13 passed.
4. typecheck + lint + hooks green.
5. Commit: `test(55-04-b): green — trx detail action trio + delete confirm/cancel`

## Done

```
$ ls apps/web/tests/e2e/100-acceptance/trx-detail-actions.spec.ts
$ grep -c 'waitForEvent("download")' .../trx-detail-actions.spec.ts  # ≥ 2
$ grep -c 'clipboard' .../trx-detail-actions.spec.ts                 # ≥ 2
$ grep -c 'alertdialog' .../trx-detail-actions.spec.ts               # ≥ 2
$ grep -c 'expectNoBrowserErrors' .../trx-detail-actions.spec.ts     # ≥ 6
$ OPENWHISPR_TOPOLOGY=slim ... 100-acceptance --project=slim         # 13 passed
```

## Risks

- Same surface as 55-04-a: clipboard permissions, sonner toast lifetime,
  download event timing, AlertDialog role.
- Trx detail may render content differently (paragraphs vs note body).
  Adjust the clipboard assertion to match what the Copy button actually
  serializes (could be metadata + body, not just body).
