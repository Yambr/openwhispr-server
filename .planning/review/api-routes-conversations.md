# Review — apps/api/src/routes/{conversations,folders,notes}

**Scope:** 19 source files (6 conversations, 6 folders, 8 notes — including `shape.ts` helpers).
**Branch / HEAD:** `main` @ `6e43588`.
**Reviewer mode:** adversarial, FORCE stance — describe defects only, no fixes.

---

## Summary

Overall the three families share a single, defensible shape: every handler

1. asserts `req.user && req.tenant` (auth-injected by the global `dualAuthHook` registered in `buildApp`),
2. routes ALL DB access through `withTenant(deps.db, tenantId, …)` (RLS GUC bound for the txn),
3. additionally constrains `user_id = ${userId}::uuid` in every `WHERE` clause (defence-in-depth against shared-tenant cross-user leakage),
4. uses parameterised drizzle template `sql\`\`` — no raw user-input string interpolation.

Tenant-isolation discipline is uniform and clean across the 19 files. I found **no RLS-bypass, no SQL-injection vector, no `as any` / `@ts-ignore` / `NODE_ENV` branch / hardcoded localhost-or-port** in scope.

The defects below are concentrated in (a) **LOCKER-04 invariant 14 non-compliance** in the entire `folders/**` + `notes/**` tree (no `schema: { body|querystring|params: ZodSchema }` on the route declaration), (b) **wire-schema drift** between `apps/api/src/routes/conversations/messages.ts` and `packages/wire-schemas/src/conversations.ts` (role enum + metadata shape), (c) a small dead field inside `folders/shape.ts`, (d) a non-canonical 400 error envelope in `notes/delete-all.ts`.

Severity tally: **0 CRITICAL · 4 HIGH · 5 MEDIUM · 3 LOW**.

---

## CRITICAL

None.

---

## HIGH

### H-1 — LOCKER-04 inv-14 violation: `schema:` missing on every folders/** and notes/** route

`apps/api/src/routes/folders/batch-create.ts:42`
`apps/api/src/routes/folders/create.ts:30`
`apps/api/src/routes/folders/delete.ts:36`
`apps/api/src/routes/folders/list.ts:39`
`apps/api/src/routes/folders/update.ts:48`
`apps/api/src/routes/notes/batch-create.ts:48`
`apps/api/src/routes/notes/create.ts:32`
`apps/api/src/routes/notes/delete-all.ts:33`
`apps/api/src/routes/notes/delete.ts:32`
`apps/api/src/routes/notes/list.ts:38`
`apps/api/src/routes/notes/search.ts:47`
`apps/api/src/routes/notes/update.ts:89`

CLAUDE.md DISCIPLINE invariant 14 (LOCKER-04): *"Every Fastify route declaration MUST carry `schema: { body|querystring|params: <ZodSchema> }` AND `config: { rateLimit: ... }`."*

The `conversations/**` family complies — every route lists `schema: { body: … }` or `schema: { querystring: … }` (see e.g. `apps/api/src/routes/conversations/create.ts:35`, `apps/api/src/routes/conversations/list.ts:61`). The `folders/**` and `notes/**` families register **only** `config: { rateLimit: … }`; the `schema:` key is absent on 12 route declarations.

Runtime safety is currently preserved because the handlers still execute `Schema.parse(req.body)` inline (or `parseListQuery(q)` for query routes). But the invariant is a hard structural rule enforced by `tools/lint-prod-readiness.ts` (LOCKER-04), and CLAUDE.md notes the WARN→BLOCKING flip is operationally deferred to Phase 41 — these routes will fail the lint the moment that flip lands.

Knock-on: Fastify's stock schema-compiled validator never runs on these payloads, so request rejection happens AFTER the handler enters (post-`AuthError` check) rather than at the Fastify dispatcher.

**Status:** CLOSED 2026-05-20 — Phase 64, commit `32f75b3e` — declarative `schema:` added to all 12 folders/notes routes (8 body / 2 querystring / 1 body-less). RED `f1a16914`. Inline `.parse()` preserved on every route; LOCKER-04 NO-SCHEMA findings cleared.

### H-2 — Wire-schema drift: `MessageRoleSchema` server-side vs `ConversationRoleSchema` in wire-schemas

`apps/api/src/routes/conversations/messages.ts:63`

```
const MessageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
```

`packages/wire-schemas/src/conversations.ts:19`

```
export const ConversationRoleSchema = z.enum(["user", "assistant", "system"]);
```

The server's POST `/api/conversations/messages` accepts `role: "tool"`, but the canonical wire-schema (and `CloudMessageSchema` which is the **OUTPUT** contract at conversations.ts:59-66) does NOT include `"tool"`. Result: a desktop client (or contract test) that round-trips through `CloudMessageSchema.parse(serverResponse)` will reject any message persisted with `role="tool"`, even though the server happily accepted, stored and echoed it.

Either the desktop contract is right and the server must reject `"tool"` (drop it from `MessageRoleSchema`), or `"tool"` is correct and `packages/wire-schemas/src/conversations.ts` must add it AND the upstream `~/openwhispr/src/services/ConversationsService.ts` interface must follow. Right now the two sources of truth disagree silently — exactly the "byte-for-byte upstream contract (D-22)" drift CLAUDE.md hard rule 1 forbids.

**Status:** CLOSED 2026-05-20 — Phase 64, commit `df69cfe6` — option-a per advisor (drop `"tool"` server-side, align DOWN to the canonical contract). Advisor finding: upstream client persistence interface `ConversationsService.ts` uses `{user,assistant,system}` at all 4 sites; the server's `"tool"` was unilateral drift. Server-only edit; no upstream client change required.

### H-3 — Wire-schema drift: `metadata` shape diverges between server and wire-schemas

`apps/api/src/routes/conversations/messages.ts:70`

```
metadata: z.record(z.string(), z.unknown()).nullable().optional(),
```

`packages/wire-schemas/src/conversations.ts:21-25`

```
const MetadataSchema = z
  .record(z.string().min(1).max(64), z.union([z.string().max(1024), z.number(), z.boolean()]))
  .refine((meta) => JSON.stringify(meta).length <= METADATA_MAX_BYTES, { … });
```

Wire-schemas constrains keys (1..64 chars), values (string ≤ 1024 / number / boolean), and total stringified size (4 KiB).

The server's POST `messages.ts` accepts ANY `Record<string, unknown>` (nested objects, arrays, deep JSON), THEN re-stringifies via `JSON.stringify(body.metadata ?? {})` and only checks the 4 KiB envelope at `messages.ts:113`. Key/value shape is **never** validated server-side. A client can persist `metadata: { evil: { nested: [{deep: true}] } }` — wire-schemas would reject that input but the server stores it; the response then fails wire-schema round-trip parse on the desktop. Same root cause as H-2 — server-side ad-hoc Zod schema disagrees with the package-level contract.

**Status:** CLOSED 2026-05-20 — Phase 64, commit `4e976fcb` — server `metadata` adopts the canonical `MetadataSchema` (now `export`ed from `@openwhispr/wire-schemas`). A nested-object metadata value is rejected at the route boundary; the runtime 4 KiB check kept as defence-in-depth.

### H-4 — `notes/delete-all.ts` emits non-canonical 400 envelope

`apps/api/src/routes/notes/delete-all.ts:85-87`

```
return reply.code(400).send({
  error: `delete-all exceeds ${MAX_INLINE_PURGE} rows; please delete in batches`,
});
```

Every other 4xx in scope throws `new ValidationError(CODE, message)` so the centralised `setErrorHandler` emits the canonical envelope (`{ error: { code, message } }` per the Phase 02 `errors.ts` family). Compare e.g. `messages.ts:114` (`throw new ValidationError("METADATA_TOO_LARGE", …)`) or `batch-create.ts:54` (`throw new ValidationError("BATCH_TOO_LARGE", …)`).

`delete-all`'s `reply.code(400).send({error: "<plain string>"})` emits `{ "error": "<message>" }` — a STRING-valued `error` field, not the wire envelope object. A desktop client (or contract test) parsing the response as `ErrorEnvelope` will mis-handle it; a future `BACKEND_SPEC.md` contract assertion would reject it. Three further 400 emission sites with the same anti-pattern (see M-1 below) — promoting `notes/delete-all.ts` to HIGH because the 400 IS the only documented failure mode of this route, so the canonical-envelope expectation is unavoidable for a client.

**Status:** CLOSED 2026-05-20 — Phase 64, commit `ad403d59` — over-limit 400 now throws `ValidationError("DELETE_ALL_TOO_LARGE", ...)` so the centralized `setErrorHandler` is the single emission point (i18n localization + uniform logging). **Divergence note (CLAUDE.md hard rule 3):** the review framed this as a string-vs-object envelope defect, but this repo's canonical error envelope IS `{ error: <string> }` — see `apps/api/src/error-handler.ts:4` and the existing `delete-all.integration.test.ts` assertion. `ValidationError` does NOT change the envelope to `{code,message}`. The genuine, fixed defect is the inline emission bypassing the centralized handler — editing `error-handler.ts` to make the envelope an object would violate CLAUDE.md hard rule 1. Recorded in `verify-first.log`.

---

## MEDIUM

### M-1 — keyset-parse failure path returns non-canonical 400 envelope (4 sites)

`apps/api/src/routes/conversations/list.ts:75-78`
`apps/api/src/routes/conversations/messages.ts:188-190`
`apps/api/src/routes/notes/list.ts:53-55`
`apps/api/src/routes/folders/list.ts:54-57`

```
try {
  parsed = parseListQuery(q);
} catch (err) {
  return reply
    .code(400)
    .send({ error: err instanceof Error ? err.message : "invalid query" });
}
```

`parseListQuery()` (`apps/api/src/lib/keyset-pagination.ts:64,67`) raises `TypeError("Invalid 'before' timestamp")` / `"Invalid 'since' timestamp"` — these get serialised as `{error: "Invalid 'before' timestamp"}` rather than the canonical `{error:{code, message}}` envelope. Same drift class as H-4 but lower-severity because the desktop sends ISO strings and is unlikely to trip the parse in steady-state usage.

### M-2 — `CloudFolderRow.parent_folder_id` is dead in the wire layer

`apps/api/src/routes/folders/shape.ts:21`

The `parent_folder_id?: string | null` field is declared on the row interface but `rowToCloudFolder()` (line 43) does not read or emit it. The 10-line comment at the top of the file (`shape.ts:11-14`) explicitly says this is intentional (upstream `CloudFolder` omits it). Fine — but then the field on the row interface is dead surface area. Nothing reads it; if a future caller mis-typed `row.parentFolderId` (camelCase) the optional-field would silently mask the mistake. Lower-noise option: drop the field from the row interface entirely.

### M-3 — `MutableCol` type alias dead-pairs with `MUTABLE_COLS` in three update routes

`apps/api/src/routes/conversations/update.ts:17`
`apps/api/src/routes/folders/update.ts:22`
`apps/api/src/routes/notes/update.ts:26`

```
const MUTABLE_COLS = ["…"] as const;
type MutableCol = (typeof MUTABLE_COLS)[number];
```

`MutableCol` is referenced once each (the `FIELD_MAP: Record<string, MutableCol>` declaration). `MUTABLE_COLS` itself, however, is **never read** at runtime — the actual SET-fragment construction iterates `FIELD_MAP`. The array exists purely as a compile-time provenance for the type. That's defensible but the `// STRICT allowlist — defends against untrusted-column injection` comment (notes/update.ts:24-25) overstates the runtime effect — the only runtime allowlist is the keys of `FIELD_MAP`, which is hand-maintained beside it. If a future contributor adds a key to `FIELD_MAP` without adding it to `MUTABLE_COLS`, the type does not catch it (TS will still accept the string-literal as `MutableCol` because `Record<string, MutableCol>` widens the key-side, and the index-access into `(typeof MUTABLE_COLS)[number]` only widens the value-side). Confusing dead-runtime allowlist next to a real hand-maintained one.

### M-4 — `notes/delete-all.ts` carries no `schema:` at all (no body, no querystring)

`apps/api/src/routes/notes/delete-all.ts:33-39`

Sub-bullet of H-1, mentioned separately because a body-less DELETE genuinely has no payload to validate. Even so, LOCKER-04 inv-14 requires either `schema: { body|querystring|params: <ZodSchema> }` or the route is non-compliant — the route's bare `config: { rateLimit }` shape is the exact pattern the linter refuses.

### M-5 — `conversations/messages.ts` GET handler validates UUID twice (zod schema is too loose, regex bandaid)

`apps/api/src/routes/conversations/messages.ts:81` + `:178-182`

```
const MessagesListQuerySchema = z.object({
  conversation_id: z.string().min(1),     // NOT .uuid()
  …
}).strict();
…
const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-…/;
if (!uuidRe.test(conversationId)) {
  throw new ValidationError("INVALID_UUID", …);
}
```

The zod schema permits any non-empty string, so the handler hand-rolls a UUID regex right after `parseListQuery`. The cleaner shape is `conversation_id: z.string().uuid()` which would make the regex check + the comment (`// UUID sanity check — keep the SQL cast from raising`) redundant. Today the duplication is fine, but the looser zod-level shape means contract tests that round-trip through `MessagesListQuerySchema.parse({conversation_id: "not-a-uuid"})` won't catch the bug that the in-handler regex catches at runtime.

---

## LOW

### L-1 — Stale "200" rationale comments after 56-04 flip to 201/204

`apps/api/src/routes/conversations/create.ts:8-11` — comment says "D-24 — same client_conversation_id on retry returns the existing row (200, NOT 409)" but the route now returns 201 on both paths (line 63). Comment drift, not behaviour drift.

`apps/api/src/routes/conversations/messages.ts:18` — same drift: "idempotency — same client_message_id returns the existing row, NEVER 409 (D-24)" reads fine, but line 13's `(Phase 56 / Plan 56-04 — R10 client contract conformance, flipped 200 → 201 Created. Idempotent replay also returns 201.)` is the actual current behaviour. Mixed historical + current; minor confusion source.

### L-2 — `conversations/delete.ts:62-77` discards the cascade-update affected-row count

```
const row = result.rows?.[0];
if (!row) return undefined;
// Phase 56 / Plan 56-04 R10 — cascade soft-delete to messages …
await tx.execute(sql`UPDATE "messages" SET "deleted_at" = NOW() WHERE conversation_id = … `);
```

The cascade UPDATE's affected-row count is not captured or logged. For a 204 endpoint this is fine, but if/when an operator needs to debug "messages survived a conversation delete", there's no observability hook. No `req.log.info({ cascade_count: … })` call exists. Cold-path; LOW.

### L-3 — `conversations/list.ts:112` array-coalesce shape relies on pg-row → JS-array round-trip behaviour

`apps/api/src/routes/conversations/list.ts:92-117,124`

The SQL coalesces an empty aggregation to `ARRAY[]::jsonb[]` and JS does `Array.isArray(row.messages) ? row.messages.map(rowToCloudMessage) : []`. node-pg returns Postgres `jsonb[]` as a JS array, so this works — but a future migration that swaps `array_agg(jsonb_build_object(...))` for `jsonb_agg(...)` would change the value type (jsonb-of-array, not jsonb-array) without breaking `Array.isArray` checks (JSONB arrays also serialise to JS arrays via node-pg). Not a current defect; brittle if revisited.

---

## Dead code summary

| Symbol | File:Line | Disposition |
|---|---|---|
| `MUTABLE_COLS` (3 sites) | conversations/update.ts:17, folders/update.ts:22, notes/update.ts:26 | Runtime-dead allowlist; only the `type MutableCol` indirection consumes it. See M-3. |
| `CloudFolderRow.parent_folder_id` | folders/shape.ts:21 | Declared on row interface, never read or emitted by `rowToCloudFolder()`. See M-2. |
| `MessageRoleSchema` (export risk) | conversations/messages.ts:63 | Not exported; only used inside `MessageInputSchema`. Not dead, but disagrees with `packages/wire-schemas/src/conversations.ts:19` `ConversationRoleSchema`. See H-2. |
| `MESSAGE_METADATA_MAX_BYTES` / `MESSAGE_CONTENT_MAX_BYTES` | conversations/messages.ts:47,61 | Header comments document them as "de-exported (LOCKER-04 dead-export); test now reads source file directly." Verified — only `tests/unit/routes/plan-51-12c-locker-04-conversations.test.ts` references them, by string match against the source file. Not dead by project convention. |

All route builder factories (`buildConversationsCreateRoutes`, `buildFoldersListRoutes`, …) are imported by `apps/api/src/routes/index.ts:33-75`. No orphan exports at the file-builder level.

---

## Suppressed warnings

None. `grep -rE "as any|as unknown as|@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|biome-ignore"` over the 19 files returns zero hits. LOCKER-02 clean in scope.

---

## RLS / tenant-isolation cross-check

All 19 DB-touching call sites route through `withTenant(deps.db, tenantId, async (tx) => { … })`. Every `WHERE` clause additionally binds `user_id = ${userId}::uuid`. No raw `deps.db.execute()` outside `withTenant`. No `runWithTenantContext`-style escape hatch observed. Clean.

Defence-in-depth note: `apps/api/src/routes/notes/delete-all.ts:62,73-77` constrains the COUNT + DELETE by `user_id` but does **not** add an explicit `tenant_id` predicate. Fine today, because `withTenant` binds the RLS GUC and the `notes` table has FORCE RLS on `tenant_id`. If a future migration ever drops FORCE RLS on `notes`, this route becomes a cross-tenant hard-purge gun under a shared-tenant scenario. Belt-and-braces would add `AND tenant_id = current_setting('app.tenant_id')::uuid` to the DELETE, but per existing pattern in the rest of the file it's not required. Noted, not flagged.

---

## CLAUDE.md hard rule 1 cross-check

`git log -p --since='2 months ago' -- apps/api/src/routes/conversations apps/api/src/routes/folders apps/api/src/routes/notes` not exhaustively reviewed line-by-line, but the recent in-file rationale comments (e.g. `notes/delete-all.ts:50-58` documenting the count→DELETE rowset mismatch, `conversations/messages.ts:50-61` documenting the missing `content` cap) read as legitimate production hardening, not "edited to make tests pass." No smoking-gun pattern (e.g. tenant FK reference change, schema mutation, magic-string sentinel matching a fixture) in scope.

---

_End of review — describe-only, no source files modified._
