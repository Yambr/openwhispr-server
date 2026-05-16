# Review: api-routes-conversations

Branch: main @ 1832f28
Scope: apps/api/src/routes/{conversations,folders,notes}/**

## Summary
- Files reviewed: 21 source files (3 setup.ts test helpers excluded)
  - conversations/: create, list, delete, messages, search, update, shape (7)
  - folders/: create, list, update, delete, batch-create, shape (6)
  - notes/: create, list, update, delete, delete-all, batch-create, search, shape (8)
- Findings: CRITICAL=0 HIGH=0 MEDIUM=3 LOW=3
- Top 3 production risks:
  1. `conversations/update.ts` accepts unvalidated `archived_at` string and passes it raw to a `timestamptz` column → bad input becomes a Postgres cast error / 500 instead of a clean 400.
  2. `conversations/messages.ts` POST has no max length on `content` while metadata is capped at 4 KiB — asymmetric DoS surface (a 50 MB message body sails through if it fits the global body limit).
  3. `notes/update.ts` + `folders/update.ts` build `SET` clauses by reading optional-key presence after Zod parse; safe today (FIELD_MAP is static allowlist) but the pattern is fragile if anyone ever loads field names from a non-static source.

The reviewed surface is unusually clean: every handler gates on `req.user && req.tenant` and runs DB work inside `withTenant(deps.db, tenantId, ...)`, all SQL is parameterized via Drizzle's `sql` template tag, all column names in dynamic `SET` clauses are sourced from static `FIELD_MAP` allowlists, both search endpoints use `websearch_to_tsquery('simple', $1)` (no `to_tsquery` raw-input path), batch endpoints cap at 500 with tighter rate limits, soft-delete is enforced via a shared helper, and there are no TODO/FIXME/HACK/`as any`/`@ts-ignore`/`console.log`/hardcoded URLs/test-token literals in the scope. Auth is mounted globally via `dualAuthHook` before route registration (apps/api/src/index.ts:43, middleware/dual-auth.ts:163), and every reviewed handler additionally rejects when the hook didn't populate the request.

## Findings

### [MEDIUM] `archived_at` accepted as any string, no ISO/datetime validation
- File: `apps/api/src/routes/conversations/update.ts:23`
- Category: input validation / error envelope
- Evidence:
  ```ts
  const UpdateBodySchema = z.object({
    id: z.string().uuid(),
    title: z.string().optional(),
    archived_at: z.string().nullable().optional(),
  });
  ```
  …then on line 53 the raw value goes straight into the SET fragment for column `archived_at`, which is `timestamp("archived_at", { withTimezone: true })` (`packages/data/src/schema/conversations.ts:18`).
- Why it matters: a client PATCHing `{"id":"…","archived_at":"yesterday"}` triggers a Postgres `invalid input syntax for type timestamp with time zone` error inside the transaction. That bubbles to the global error handler as a 500 rather than the 400 the wire contract implies for malformed input. Same upstream-spec drift risk if the desktop client ever sends a non-ISO local-time string.
- Fix: tighten the schema, e.g. `archived_at: z.union([z.string().datetime({ offset: true }), z.null()]).optional()` (or accept ISO date + null). Bonus: cast the bound value with `::timestamptz` explicitly in the SET fragment for parity with the WHERE-side casts.

### [MEDIUM] No max length on `messages.content`, while metadata is capped at 4 KiB
- File: `apps/api/src/routes/conversations/messages.ts:46-54,83-86`
- Category: DoS / input validation asymmetry
- Evidence:
  ```ts
  const MessageInputSchema = z
    .object({
      conversation_id: z.string().uuid(),
      role: MessageRoleSchema,
      content: z.string(),                       // ← no max
      metadata: z.record(z.string(), z.unknown()).nullable().optional(),
      client_message_id: z.string().optional(),
    })
    .strict();
  …
  const metaBytes = Buffer.byteLength(JSON.stringify(body.metadata ?? {}), "utf8");
  if (metaBytes > MESSAGE_METADATA_MAX_BYTES) {
    throw new ValidationError("METADATA_TOO_LARGE", "metadata exceeds 4096 bytes (4KB cap)");
  }
  ```
- Why it matters: the comment header advertises "T-MSG-INJ — 4 KiB metadata cap" as the size guardrail, but the much larger `content` field is unbounded. A caller can blow through the per-row size by orders of magnitude (capped only by Fastify's global body limit) and then issue 240 such requests per minute under the route's rate limit. Same gap on `notes/create.ts`, `notes/batch-create.ts`, and the `notes/update.ts` `content`/`transcript`/`enhanced_content` strings — none carry a max — but those are deliberate "long-form note body" fields with upstream-spec'd shapes, whereas chat `content` has no analogous justification.
- Fix: set an explicit upper bound on `content` (e.g. `z.string().max(64 * 1024)` or the limit the desktop actually enforces) and surface a `CONTENT_TOO_LARGE` validation error in the same shape as `METADATA_TOO_LARGE`. Verify the same shape across the search/list endpoints' equivalent fields if applicable.

### [MEDIUM] Dynamic SET clause assembled from object-key presence — safe today, fragile by construction
- File: `apps/api/src/routes/notes/update.ts:102-110`, `apps/api/src/routes/folders/update.ts:61-67`, `apps/api/src/routes/conversations/update.ts:49-55`
- Category: pattern hygiene (defense-in-depth)
- Evidence:
  ```ts
  const setFragments = [];
  for (const [key, col] of Object.entries(FIELD_MAP)) {
    if (Object.hasOwn(body, key)) {
      const v = (body as Record<string, unknown>)[key];
      setFragments.push(sql`${sql.raw(`"${col}"`)} = ${v as unknown}`);
    }
  }
  ```
- Why it matters: this is currently safe — `FIELD_MAP` is a module-scoped literal, column names never come from user input, and Zod has already rejected unknown keys (strict for the message schema; the update schemas lean on `Object.hasOwn` over a static map rather than `.strict()`). However, both `notes/update.ts:44-64` and `folders/update.ts:25-34` schemas are NOT `.strict()`. That means a client can send extra keys (e.g. `tenant_id`, `user_id`, `id_admin`) and they will silently pass schema validation. They are then dropped because `FIELD_MAP` doesn't list them — but only because of the allowlist. Drop the allowlist by accident in a future refactor and you have unfiltered column-name passthrough from request body. The `as unknown` casts also hide the fact that `v` could legitimately be a JS object that breaks the SQL bind.
- Fix: add `.strict()` to `UpdateBodySchema` in all three files so unknown keys are 400'd at the edge (matching the messages POST and search bodies which already do `.strict()`). Keep the `FIELD_MAP` allowlist as belt-and-braces.

### [LOW] Duplicate UUID regex instead of `z.string().uuid()` on `conversations/messages.ts` GET
- File: `apps/api/src/routes/conversations/messages.ts:147-151`
- Category: pattern consistency
- Evidence:
  ```ts
  const uuidRe =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRe.test(conversationId)) {
    throw new ValidationError("INVALID_UUID", "conversation_id must be a UUID");
  }
  ```
- Why it matters: every other route reaches for `z.string().uuid()` via a `z.object({...})` schema. This one constructs and re-applies a regex inline for a query-string field. Not wrong — just inconsistent and dodges the centralized validation error shape used elsewhere.
- Fix: parse `req.query` through a small `z.object({ conversation_id: z.string().uuid(), limit: z.string().optional(), before: z.string().optional(), since: z.string().optional() })` and drop the regex.

### [LOW] `conversations/shape.ts` returns nested CloudMessage docs separately from `rowToCloudMessage`
- File: `apps/api/src/routes/conversations/list.ts:114-119`
- Category: shape-drift risk
- Evidence:
  ```ts
  return reply.code(200).send({
    conversations: rowsWithMessages.map((row) => ({
      ...rowToCloudConversation(row),
      messages: Array.isArray(row.messages) ? row.messages.map(rowToCloudMessage) : [],
    })),
  });
  ```
  The aggregated messages come from a `jsonb_build_object` projection in SQL (list.ts:86-93), then are passed through `rowToCloudMessage` which expects a `CloudMessageRow` with `Date | string` timestamp fields. The SQL projection produces `created_at` as a `jsonb` string, not a `Date`, so the `isoNonNull(v)` path returns `String(v)` verbatim — which happens to be ISO already because pg-jsonb serializes timestamps to ISO. Works today, but the contract relies on incidental pg behavior; if anyone changes the jsonb projection to `to_jsonb(m.created_at)` (which would emit `"2024-…"` likewise) it still works, but `EXTRACT(epoch FROM m.created_at)` numeric form would silently produce `"1700000000.123"` strings on the wire.
- Fix: cast `m.created_at` to text inside the `jsonb_build_object` (`'created_at', to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`) or assert `typeof === "string"` in `isoNonNull`. Optional — only file if tightening downstream contracts.

### [LOW] `conversations/shape.ts:CloudConversationRow` and `CloudMessageRow` mark `tenant_id` / `user_id` optional
- File: `apps/api/src/routes/conversations/shape.ts:22-23,35-36`; same pattern at `folders/shape.ts:17-18`, `notes/shape.ts:13-14`
- Category: types-vs-DB drift
- Evidence:
  ```ts
  export interface CloudConversationRow {
    id: string;
    tenant_id?: string;
    user_id?: string;
    ...
  ```
- Why it matters: the underlying columns are `NOT NULL` per Plan 01 schema. Optional-marking these in the row interface communicates the wrong invariant to future callers and silently green-lights tests that mock partial rows. Not exploitable.
- Fix: drop the `?` — these are always present on SELECT *.

## Dead code
None in scope. Every route builder and shape helper is imported by `apps/api/src/routes/index.ts` (lines 33-75, 292-340). `softDeletePredicate` in `apps/api/src/lib/soft-delete.ts:40` is unused at present but lives in `apps/api/src/lib/`, outside this review's scope.

## Suppressed warnings
None in scope. No `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`, `biome-ignore`, `as any`, `as unknown as`, `console.log`, or `debugger` appears in any of the 21 reviewed files. The only casts present are `as unknown` (on dynamic SET-clause values, addressed in MEDIUM #3 above) and one `as { rows?: T[] }` per file on `tx.execute()` returns — those are necessary because Drizzle's `execute()` is typed as `unknown` for raw SQL paths.

## Disabled tests near scope
Not investigated — out of scope per task instructions (no test files in the review set besides the three `__tests__/setup.ts` helpers, which were not opened).

## Notes
- Auth/tenant discipline is sound: every handler does `if (!req.user || !req.tenant) throw new AuthError(...)` and routes DB work through `withTenant(deps.db, req.tenant, async (tx) => ...)`. Confirmed `withTenant` (packages/data/src/tenant-context.ts:68-83) validates the tenant UUID via `TENANT_UUID_RE` and binds `app.tenant_id` via `set_config(..., true)` inside the same tx. None of the reviewed handlers read `tenant_id` from the body — handlers explicitly construct `insertValues.tenant_id = req.tenant` from the session.
- SQL injection surface: zero. Every `${…}` interpolation in a `sql\`\`` block is a parameterized bind; every `sql.raw(...)` in dynamic-SET paths consumes only static `FIELD_MAP` values; `quoteIdent` in `client-id-upsert.ts:75-81` rejects non-`[a-z_][a-z0-9_]*` table/column literals before emitting raw SQL.
- Search endpoints (conversations + notes) correctly use `websearch_to_tsquery('simple', $1)` which never raises on operator-laden user input (T-05-03 mitigation), and the GIN-indexed `content_search` generated column does the heavy lifting.
- Rate limits look right per endpoint: 120/min for typical CRUD, 240/min for messages (chatty), 60/min for search, 5/min for batch endpoints, 3/min for `notes/delete-all`.
- `notes/delete-all` hard-deletes (including already-soft-deleted rows) and is gated by a `COUNT(*) > 1000 → 400` pre-check inside the same tx as the DELETE (delete-all.ts:50-69). Read-then-write inside a single transaction with `withTenant`'s GUC binding is correct here.
- `client-id-upsert.ts:147-154` throws on the "ON CONFLICT path but no existing row found" race. That's reachable if the conflicting row is soft-deleted or hard-deleted between INSERT and SELECT; surfaces as a 500. Documented and out of scope (file is under apps/api/src/lib/, not the reviewed routes), but flagging here as a known sharp edge the reviewed routes lean on.
