---
phase: 55-uc-coverage-audit
plan: 04-c
type: execute
wave: 3
depends_on: []
files_modified:
  - apps/web/tests/e2e/100-acceptance/conv-detail-actions.spec.ts
requirements:
  - UC-CONV-DETAIL-COPY
  - UC-CONV-DETAIL-EXPORT-JSON
  - UC-CONV-DETAIL-DELETE-CONFIRM
  - UC-CONV-DETAIL-DELETE-CANCEL
must_haves:
  truths:
    - "Seed a conversation + at least one message; navigate to /app/conversations/[id]"
    - "Copy → clipboard.writeText + sonner toast"
    - "Export JSON → download with .json filename"
    - "Delete → AlertDialog → cancel closes, confirm pushes /app/conversations"
    - "Zero browser errors at every step"
  artifacts:
    - path: apps/web/tests/e2e/100-acceptance/conv-detail-actions.spec.ts
      provides: Long-form e2e for conversation detail action trio + delete
  key_links:
    - from: apps/web/tests/e2e/100-acceptance/conv-detail-actions.spec.ts
      to: apps/web/src/components/screens/conversations/ConversationDetailClient.tsx
      via: button clicks → clipboard / download / DELETE wire
      pattern: 'conv-copy|conv-export-json|conv-delete'
---

<objective>
Mirror Plan 55-04-a for conversation detail. Note: conversation detail
has Copy + Export JSON + Delete (NO Export MD per
`ConversationDetailClient.tsx:185-194`).

Spec at `apps/web/tests/e2e/100-acceptance/conv-detail-actions.spec.ts`.

Closes 4 MISSING UCs from RESEARCH.md §"`/app/conversations/[id]`":
- UC-CONV-DETAIL-COPY (ConversationDetailClient.tsx:173-183)
- UC-CONV-DETAIL-EXPORT-JSON (185-194)
- UC-CONV-DETAIL-DELETE-CONFIRM (87-97, 211-233)
- UC-CONV-DETAIL-DELETE-CANCEL (227-229)

Slim-only.
</objective>

## Context

`ConversationDetailClient.tsx` — Copy + Export JSON + Delete. Same
sonner toast pattern, same AlertDialog pattern. Seed helper:
likely `seedConversations` in `apps/web/tests/e2e/fixtures/seed.ts`.
If absent — adapt the existing pattern that seeds via
POST `/api/conversations/create` then POST `/api/conversations/messages/create`.

Reference: `apps/web/tests/e2e/u12-conv-detail.spec.ts` for the existing
seed + navigate pattern.

## Files to create

- `apps/web/tests/e2e/100-acceptance/conv-detail-actions.spec.ts`

## Files to modify

(none)

## Tasks

### Task 1 — RED: ship a failing acceptance spec

1. Clone 55-04-a structure. Differences:
   - Seed conversation + 1 message (mirror u12-conv-detail.spec.ts seed)
   - `/app/conversations/${id}`
   - Buttons: Copy + Export JSON + Delete (NO Export MD step)
   - Final URL after confirm-delete: `/app/conversations`
2. Inspect `ConversationDetailClient.tsx:170-233` for selectors.
3. Commit: `test(55-04-c): red — conv detail action trio long-form spec`

### Task 2 — GREEN

1. Re-run spec.
2. 3 runs no flake.
3. Full slim sweep → 14 passed.
4. typecheck + lint + hooks green.
5. Commit: `test(55-04-c): green — conv detail action trio + delete confirm/cancel`

## Done

```
$ ls apps/web/tests/e2e/100-acceptance/conv-detail-actions.spec.ts
$ grep -c 'waitForEvent("download")' .../conv-detail-actions.spec.ts # ≥ 1 (JSON only — no MD)
$ grep -c 'clipboard' .../conv-detail-actions.spec.ts                # ≥ 2
$ grep -c 'alertdialog' .../conv-detail-actions.spec.ts              # ≥ 2
$ grep -c 'expectNoBrowserErrors' .../conv-detail-actions.spec.ts    # ≥ 5
$ OPENWHISPR_TOPOLOGY=slim ... 100-acceptance --project=slim         # 14 passed
```

## Risks

- Conversation seed requires BOTH conversation + at least one message
  (otherwise the Copy button serializes empty content). Check
  `u12-conv-detail.spec.ts` for the existing seed shape.
- Same clipboard/toast/download/dialog risks as 55-04-a/b.
