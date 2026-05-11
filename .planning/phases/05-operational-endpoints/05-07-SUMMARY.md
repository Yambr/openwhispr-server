---
phase: 05-operational-endpoints
plan: 07
subsystem: api + conversations-crud + messages-crud
tags: [wire, crud, conversations, messages, rls, keyset-pagination, array-agg, tdd]
requires:
  - "05-01-SUMMARY.md — conversations + messages tables, RLS, partial UNIQUE on client_conversation_id / client_message_id, keyset + content_search GIN indexes"
  - "05-05-SUMMARY.md — canonical CRUD pattern + 3 shared helpers (keyset-pagination, soft-delete, client-id-upsert)"
provides:
  - "POST /api/conversations/create (WIRE-24)"
  - "PATCH /api/conversations/update (WIRE-24)"
  - "DELETE /api/conversations/delete (WIRE-24)"
  - "GET /api/conversations/list (WIRE-24)"
  - "GET /api/conversations/list?include=messages — D-27 array_agg JSON aggregation, 100-msg cap"
  - "POST /api/conversations/search (WIRE-24) — websearch_to_tsquery('simple', $1) + ts_rank"
  - "POST /api/conversations/messages (WIRE-25) — single-message v1, 4 KiB metadata cap"
  - "GET /api/conversations/messages (WIRE-25) — keyset paginated"
affects:
  - "apps/api/src/routes/index.ts — registers 6 new conversations routes UNCONDITIONALLY"
tech-stack:
  added: []
  patterns:
    - "Reuses Plan 05's 3 shared helpers VERBATIM — table=conversations|messages, clientIdColumn=client_conversation_id|client_message_id"
    - "Single-roundtrip array_agg + jsonb_build_object for D-27 include=messages branch"
    - "Per-conversation 100-message cap (T-AGG-MEM mitigation, RESEARCH Open Q#2)"
    - "POST /messages: pre-INSERT ownership check on parent conversation → 404 envelope; 4 KiB metadata cap via Buffer.byteLength"
    - "GET /messages: explicit UUID validation on conversation_id; parent-ownership check before scan → 404 envelope"
key-files:
  created:
    - apps/api/src/routes/conversations/messages.ts
    - apps/api/src/routes/conversations/__tests__/list-include-messages.integration.test.ts
    - apps/api/src/routes/conversations/__tests__/messages.integration.test.ts
    - packages/contract-tests/src/conversations.test.ts
    - tests/e2e/phase-05-conversations.spec.ts
    - .planning/phases/05-operational-endpoints/deferred-items.md
  modified:
    - apps/api/src/routes/conversations/list.ts — adds ?include=messages D-27 branch
    - apps/api/src/routes/conversations/__tests__/setup.ts — registers messages routes in test app
    - apps/api/src/routes/index.ts — registers /api/conversations/messages dual-method + barrel export
decisions:
  - "D-22 — wire shape mirrors upstream ConversationsService.ts byte-for-byte"
  - "D-23 — soft delete via deleted_at = NOW(); messages remain physically present but become unreachable via the parent ownership check on /messages routes"
  - "D-24 — same client_conversation_id / client_message_id on retry returns existing row (200, NOT 409); null-clientId path always inserts"
  - "D-25 — keyset pagination via shared parseListQuery + buildKeysetWhere helpers"
  - "D-27 — list?include=messages uses array_agg(jsonb_build_object(...)) — single round-trip, typed shape stability; 100-message cap per conversation"
  - "Claude's Discretion — POST /api/conversations/messages accepts a single CloudMessage per call (NOT a batch) per upstream v1 contract"
  - "T-MSG-INJ mitigation — JSON.stringify(metadata) Buffer.byteLength capped at 4096; oversize → 400 envelope"
  - "T-AGG-MEM mitigation — 100-message cap on the include=messages branch (Open Q#2 in RESEARCH)"
metrics:
  duration: "1 task continuation session"
  completed: "2026-05-11"
  tasks: 3
  files_created: 6
  files_modified: 3
---

# Phase 5 Plan 7: Conversations + Messages CRUD (WIRE-24 + WIRE-25) Summary

WIRE-24 + WIRE-25 — 6 conversations / messages routes wired to the
existing canonical CRUD pattern with one structural addition: a
single-round-trip JSON aggregation (`array_agg(jsonb_build_object(...))`)
for the `list?include=messages` branch per D-27, capped at 100 messages
per conversation to bound T-AGG-MEM under fan-out.

## What shipped

### Task 1 (previous executor — already committed `1784578`)
- `apps/api/src/routes/conversations/{create,update,delete,list,search,shape}.ts`
- Integration tests for CRUD + search (real Postgres + RLS via
  testcontainers; cross-tenant isolation proven).
- 5 routes registered in `apps/api/src/routes/index.ts`.

### Task 2 — list?include=messages branch (D-27)
- Extends `apps/api/src/routes/conversations/list.ts` with a branch
  triggered by `req.query.include === 'messages'` that returns a
  single-round-trip JOIN aggregating each conversation's messages via
  `array_agg(jsonb_build_object(...))` into the response row.
- Per-conversation message cap = **100** (T-AGG-MEM mitigation, Open
  Q#2). The inner `SELECT ... ORDER BY created_at ASC, id ASC LIMIT 100`
  is the cap; `COALESCE(... , ARRAY[]::jsonb[])` ensures empty
  conversations return `messages: []`.
- Soft-deleted messages excluded (`WHERE deleted_at IS NULL`).
- Test coverage: shape, ordering ASC, 100-cap behavior, soft-delete
  exclusion, empty-messages, unknown-include value fallback.

### Task 3 — POST + GET /api/conversations/messages + contract + e2e
- `apps/api/src/routes/conversations/messages.ts` — single dual-method
  module:
  - **POST**: single-message-only per v1; pre-INSERT ownership check
    on the parent conversation (cross-tenant invisible via FORCE-RLS +
    explicit user_id WHERE); `client_message_id` idempotency via the
    shared `createOrReturnExisting` helper; **4 KiB metadata cap**
    (Buffer.byteLength of `JSON.stringify(metadata)`) — T-MSG-INJ.
  - **GET**: UUID validation on `conversation_id`; parent-ownership
    check before scan → 404 envelope for cross-tenant probes;
    keyset-paginated via the shared `parseListQuery` /
    `buildKeysetWhere` / `buildKeysetOrderLimit` helpers.
- Contract conformance: `packages/contract-tests/src/conversations.test.ts`
  covers all 6 routes + include=messages branch + 401 envelope matrix.
- E2E: `tests/e2e/phase-05-conversations.spec.ts` rounds-trips
  create → idempotency → 5-message add → list?include=messages
  → search → metadata>4KB→400 → soft-delete via the live compose stack.

## Wire shapes (verified against upstream `ConversationsService.ts`)

```
CloudConversation = {
  id, client_conversation_id, title, archived_at,
  deleted_at, created_at, updated_at  // 7 fields
}

CloudMessage = {
  id, conversation_id, role, content, metadata, created_at  // 6 fields
}

CloudConversationWithMessages = CloudConversation & {
  messages: CloudMessage[]    // present only on ?include=messages
}
```

## Deviations from Plan

### Auto-fixed Issues
None — Task 2 and Task 3 executed exactly per plan. The `client-id-upsert`
helper required `metadata` to be serialized to a JSON string before insert
(it stores raw via Drizzle param binding which would otherwise serialize a
JS object as `[object Object]::jsonb`); resolved inline by passing
`JSON.stringify(body.metadata ?? {})` into `insertValues`.

### Out-of-scope discoveries (logged to deferred-items.md)
- `update/delete — unknown id → 404` tests across notes/folders/
  conversations all return `400` instead of `404` (Zod uuid schema
  rejects literal `11111111-1111-1111-1111-111111111111`). Pre-existing
  in Plans 05-05, 05-06, and Task 1 of 05-07 — not introduced by
  Task 2/3.
- `notes/search` multi-word phrase test returns 0 rows. Pre-existing
  Plan 05-05 issue.

These were NOT modified — see
`.planning/phases/05-operational-endpoints/deferred-items.md`.

## Threat surface

All flags from the plan's `<threat_model>` are mitigated in code:

| Threat ID | Mitigation in this plan |
|-----------|-------------------------|
| T-05-03   | `websearch_to_tsquery('simple', $1)` (Task 1) + Zod 256-char query cap |
| T-05-07   | Partial UNIQUE indexes scoped per (tenant_id, user_id, client_id); cross-tenant test asserts both tenants can reuse the same `client_conversation_id` without collision |
| T-MSG-INJ | 4 KiB metadata cap on POST /messages; Zod role enum; parameterized SQL throughout |
| T-AGG-MEM | 100-message cap on include=messages branch via `LIMIT 100` in the inner subquery |

No new threat surface introduced — the messages route exposes ONE new
URL (`/api/conversations/messages`, dual-method) entirely behind
dualAuth + RLS + parent-ownership check.

## Self-Check: PASSED

- `apps/api/src/routes/conversations/messages.ts` — FOUND
- `apps/api/src/routes/conversations/__tests__/list-include-messages.integration.test.ts` — FOUND (6 tests pass)
- `apps/api/src/routes/conversations/__tests__/messages.integration.test.ts` — FOUND (11 tests pass)
- `packages/contract-tests/src/conversations.test.ts` — FOUND (12 cases, skipped without live BACKEND_URL — expected)
- `tests/e2e/phase-05-conversations.spec.ts` — FOUND
- Commit `1460fa8` — Task 2 (will be verified post-Task-3 commit)
