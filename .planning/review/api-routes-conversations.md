# Review: api-routes-conversations
Branch: main @ 13f0864
Files reviewed: 21 source files
- `apps/api/src/routes/conversations/` — create, delete, list, messages, search, shape, update (7)
- `apps/api/src/routes/folders/` — batch-create, create, delete, list, shape, update (6)
- `apps/api/src/routes/notes/` — batch-create, create, delete, delete-all, list, search, shape, update (8)
- (3 `__tests__/setup.ts` test helpers explicitly excluded per scope.)

## Summary
- CRITICAL: 0 / HIGH: 3 / MEDIUM: 5 / LOW: 4
- Top 3 production risks before public publication:
  1. **Every state-mutating route in scope ships without a Fastify `schema:` block** — 19 routes (entire scope) are in the LOCKER-04 allowlist as `issue-31-04-debt-LOCKER-04-route-bulkfix-31-08`. The CLAUDE.md "production-readiness invariant" is satisfied today only because LOCKER-04 is still in WARN mode; the BLOCKING flip is deferred to Phase 41. Publishing this code on GitHub as v1 surfaces a documented-debt invariant breach to outside contributors who will read the routes as the project's canonical pattern.
  2. **`notes/delete-all.ts` 1000-row cap is bypassable** — the count query filters `deleted_at IS NULL` (line 50–55) but the `DELETE` deliberately purges tombstones too (line 65–69, "Includes already-soft-deleted rows"). A user accumulating soft-deleted notes via `/api/notes/delete` can drive an arbitrarily large hard-delete past the gate. The `T-DEL-ALL-DOS` mitigation comment claims this is bounded; it is not.
  3. **`conversations/update.ts` accepts unvalidated `archived_at` strings** — schema is `z.string().nullable().optional()`, value flows straight into a Postgres `timestamptz` column. Bad input becomes an unhandled cast error / 500 instead of a clean 400 with a stable error code. Same shape exists in subtler ways across the family but archived_at is the only direct user-controlled timestamp written without ISO validation.

The reviewed surface is otherwise unusually clean: every handler gates on `req.user && req.tenant`, every DB call lives under `withTenant(deps.db, tenantId, ...)` so FORCE-RLS applies, every dynamic SQL fragment comes from `drizzle-orm`'s parameterised `sql` template tag, every dynamic identifier (`sql.raw(\`"${col}"\`)`) is sourced from a static `MUTABLE_COLS as const` allowlist, both `/search` endpoints use `websearch_to_tsquery('simple', $1)` (never `to_tsquery` on raw input), batch endpoints cap at 500 with a 5-req/min rate limit, soft-delete is enforced via the shared `withSoftDelete()` helper, and the scope contains zero TODO/FIXME/HACK/XXX, zero `as any`/`as unknown as`/`@ts-ignore`/`@ts-expect-error`, zero `console.log`, zero `process.env.NODE_ENV`, zero `localhost`/`127.0.0.1`/`:3000`/`:4000`/`:8080`/`sk-…`/`AKIA…` literals, and zero hand-rolled SQL string concatenation of untrusted input. Auth is mounted globally as `dualAuthHook` (`onRequest`) before route registration; each handler still rejects when the hook didn't populate `req.user`/`req.tenant` (defence-in-depth).

## Findings

### [HIGH] LOCKER-04 — every state-mutating route in scope is missing the Fastify `schema:` block
- File: all 19 route files in scope (e.g. `apps/api/src/routes/conversations/create.ts:29`, `notes/update.ts:89`, `folders/batch-create.ts:39`).
- Category: production-readiness invariant breach (allowlisted as known debt)
- Evidence:
  ```ts
  // apps/api/src/routes/conversations/create.ts:29
  app.route({
    method: "POST",
    url: "/api/conversations/create",
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      // ...
      const body = ConversationInputSchema.parse(req.body);
  ```
  The matching allowlist entry is in `tools/lint-prod-readiness.allowlist.txt` (19 rows tagged `issue-31-04-debt-LOCKER-04-route-bulkfix-31-08`).
- Why it matters: CLAUDE.md DISCIPLINE rule 14 requires every Fastify route to carry `schema: { body|querystring|params: <ZodSchema> }`. The CLAUDE.md WARN→BLOCKING ledger explicitly defers this flip to Phase 41; today it ships as WARN-only debt. Publishing v1 on GitHub before Phase 41 means external contributors read these files as canonical patterns and copy the wrong shape into new routes. Operationally, `Schema.parse(req.body)` inside the handler still produces 400 via the central `setErrorHandler` (error-handler.ts:131), so the wire surface is correct — but route introspection (Swagger/OpenAPI export, fastify-swagger plugin, fastify-zod-openapi) cannot see the schema, so generated client SDKs and contract tests will lack the body/query types for every reviewed route.
- Fix: Either land the Phase 41 route-bulkfix before publication, or, at minimum, document in the README/SELF_HOSTING.md that LOCKER-04 closure is pending and external SDK generation against `/api/notes`, `/api/folders`, `/api/conversations`, `/api/conversations/messages` requires reading the wire-schemas package directly. Long-term fix per LOCKER-04 spec: convert each `Schema.parse(req.body)` to `schema: { body: zodToJsonSchema(Schema) }` with `validatorCompiler` from `fastify-type-provider-zod`, then drop the handler-side `.parse()`.

### [HIGH] `notes/delete-all.ts` — 1000-row cap is bypassable via tombstone accumulation
- File: `apps/api/src/routes/notes/delete-all.ts:50` (count) vs `:65` (delete)
- Category: security / DoS-mitigation bypass
- Evidence:
  ```ts
  // Count: live rows only
  const countRes = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n
      FROM "notes"
     WHERE "user_id" = ${userId}::uuid
       AND "deleted_at" IS NULL          // <-- excludes tombstones
  `)) as { rows?: { n: number | string }[] };
  const count = Number(countRes.rows?.[0]?.n ?? 0);
  if (count > MAX_INLINE_PURGE) {
    return { exceeded: true, count } as const;
  }
  // Delete: includes tombstones
  const delRes = (await tx.execute(sql`
    DELETE FROM "notes"
     WHERE "user_id" = ${userId}::uuid    // <-- NO deleted_at filter
    RETURNING "id"
  `)) as { rows?: { id: string }[] };
  ```
  The mismatched filter is deliberate per the comment at line 60–64 ("`Includes already-soft-deleted rows (deleted_at IS NOT NULL) so the purge is total`"). The 1000-row cap exists for `T-DEL-ALL-DOS`.
- Why it matters: A user can repeatedly call `/api/notes/create` + `/api/notes/delete` to accumulate soft-deleted tombstones without ever exceeding the 1000-live-row count gate. The eventual `/api/notes/delete-all` purges all of those tombstones inline, exceeding the documented bound. With per-user rate limit 120 req/min on `create` + 120 on `delete`, a sustained pattern of 240 req/min produces 7200 tombstones/hour with no live-row growth. The gate's stated purpose ("keep the request-time roundtrip bounded") is then defeated.
- Fix: Make the count query and the DELETE consistent. Either:
  ```sql
  SELECT COUNT(*)::int AS n FROM "notes" WHERE "user_id" = $1::uuid  -- no deleted_at filter
  ```
  so the cap reflects the actual purge size; or constrain the DELETE to `deleted_at IS NULL` and rely on a periodic worker to vacuum tombstones (then the comment at 60–64 needs rewriting). The first is the smaller change.

### [HIGH] `conversations/messages.ts` POST — `content` has no length cap, asymmetric with the 4 KiB metadata cap
- File: `apps/api/src/routes/conversations/messages.ts:46–54` (schema), `:82–86` (metadata cap)
- Category: security / DoS surface
- Evidence:
  ```ts
  const MessageInputSchema = z
    .object({
      conversation_id: z.string().uuid(),
      role: MessageRoleSchema,
      content: z.string(),                                    // <-- no .max()
      metadata: z.record(z.string(), z.unknown()).nullable().optional(),
      client_message_id: z.string().optional(),
    })
    .strict();
  // ...
  const metaBytes = Buffer.byteLength(JSON.stringify(body.metadata ?? {}), "utf8");
  if (metaBytes > MESSAGE_METADATA_MAX_BYTES) {
    throw new ValidationError("METADATA_TOO_LARGE", "metadata exceeds 4096 bytes (4KB cap)");
  }
  ```
- Why it matters: `metadata` is capped at 4 KiB (`T-MSG-INJ` mitigation) but `content` is unbounded inside the handler. The only ceiling is Fastify's global `bodyLimit` default (1 MiB), or whatever the bootstrap.ts override sets. Caller rate-limited to 240/min × ~1 MiB = ~240 MiB/min/user of message bodies committed to the `messages` table. Under Plan 07's stated 1000-concurrent-user budget that's ~234 GiB/min of WAL across the fleet. The asymmetry is also surprising to a reviewer: the route enforces a tight cap on the small field while leaving the big field open.
- Fix: Add `.max(MAX_MESSAGE_CONTENT_BYTES)` to the `content` field with the cap exported alongside `MESSAGE_METADATA_MAX_BYTES`. A 64 KiB content cap is enough for any sensible chat message and aligns with the upstream desktop client's local-SQLite expectations.

### [MEDIUM] `conversations/update.ts` — `archived_at` accepted as any string
- File: `apps/api/src/routes/conversations/update.ts:20–24`
- Category: input validation / error envelope quality
- Evidence:
  ```ts
  const UpdateBodySchema = z.object({
    id: z.string().uuid(),
    title: z.string().optional(),
    archived_at: z.string().nullable().optional(),     // <-- no .datetime() / .iso() / regex
  });
  // ...
  setFragments.push(sql`${sql.raw(`"${col}"`)} = ${v as unknown}`);  // raw string passed
  ```
  The value reaches a `timestamptz` column via implicit text→timestamptz cast; Postgres raises `invalid input syntax for type timestamp with time zone: "xyz"` which is then surfaced via the central error handler as a 500.
- Why it matters: Wire callers shipping a malformed string get a 500 "internal server error" instead of a stable 400 + `code: VALIDATION_FAILED`. This breaks contract tests against the negative matrix and confuses desktop client retry logic.
- Fix: Replace with `archived_at: z.string().datetime({ offset: true }).nullable().optional()`. Or accept ISO and pre-convert to `Date` in JS before binding.

### [MEDIUM] `notes/update.ts` — `client_note_id` accepted but silently dropped on every PATCH
- File: `apps/api/src/routes/notes/update.ts:63` (schema accepts), `:66–81` (FIELD_MAP does NOT include it)
- Category: API contract / silent data loss
- Evidence:
  ```ts
  const UpdateBodySchema = z.object({
    id: z.string().uuid(),
    // ...
    client_note_id: z.string().optional(),
  });
  const FIELD_MAP: Record<string, MutableCol> = {
    title: "title", content: "content", note_type: "note_type", /* ... */
    // <-- client_note_id absent
  };
  ```
  Same pattern in `folders/update.ts:33` (`client_folder_id` accepted, not in FIELD_MAP). Conversations `update.ts` does not accept `client_conversation_id` so the symptom is asymmetric across the three families.
- Why it matters: A desktop client wishing to rebind a server row to a new local UUID will send `{id, client_note_id}` and receive a 200 with no error — but the server-side `client_note_id` is unchanged. Silent acceptance of an ignored field is a contract anti-pattern; tomorrow's reader assumes the field is honoured.
- Fix: Either (a) drop `client_note_id`/`client_folder_id` from the schema and let `.strict()` reject the key, or (b) add it to `FIELD_MAP` (and write a phase that decides whether rebinding is allowed). Today the schema is non-strict (`z.object` without `.strict()`) so unknown keys are silently stripped — same problem class.

### [MEDIUM] `conversations/update.ts` + `folders/update.ts` + `notes/update.ts` — empty-PATCH bumps `updated_at`
- File: `apps/api/src/routes/conversations/update.ts:49–61`; same pattern at `folders/update.ts:61–74`, `notes/update.ts:101–117`
- Category: API contract / WAL noise
- Evidence:
  ```ts
  const setFragments = [];
  for (const [key, col] of Object.entries(FIELD_MAP)) {
    if (Object.hasOwn(body, key)) { /* push */ }
  }
  setFragments.push(sql`"updated_at" = NOW()`);   // always pushed
  ```
  A request body of `{id}` (no mutable fields) still runs `UPDATE … SET "updated_at" = NOW() WHERE id = … AND user_id = …` and returns 200 with the same row, only `updated_at` advanced.
- Why it matters: A rate-limited (120/min/user) endpoint becomes a free "ping updated_at" pump — useful to an attacker who wants to invalidate caches built on `updated_at` or trigger downstream sync chatter. Also writes ~120 WAL records/min/user that produce no business state change.
- Fix: If `setFragments.length === 1` after the FIELD_MAP loop (i.e. only the `updated_at` synthetic), skip the UPDATE entirely and return the existing row (or a 400 `NO_FIELDS_TO_UPDATE`).

### [MEDIUM] `conversations/messages.ts` GET — manual UUID regex duplicates Zod functionality
- File: `apps/api/src/routes/conversations/messages.ts:147–151`
- Category: code-quality / arch workaround
- Evidence:
  ```ts
  const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRe.test(conversationId)) {
    throw new ValidationError("INVALID_UUID", "conversation_id must be a UUID");
  }
  ```
  The query string is not validated by Zod — instead `(req.query ?? {}) as ListQuery` casts unknown and the handler hand-rolls a regex.
- Why it matters: Duplicates `z.string().uuid()` logic, the regex permits `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX` (no variant/version checks per RFC 4122) and trivially differs from Zod's stricter check. Hand-rolled UUID regex was specifically flagged as an anti-pattern in DISCIPLINE rule 13.
- Fix: Define `const MessagesListQuerySchema = z.object({ conversation_id: z.string().uuid(), limit: z.string().optional(), before: z.string().optional(), since: z.string().optional() })` and `MessagesListQuerySchema.parse(req.query)`. Pairs cleanly with the LOCKER-04 fix above.

### [MEDIUM] `notes/batch-create.ts` + `folders/batch-create.ts` — `client_note_id`/`client_folder_id` absent → no entry in response (silent dropout)
- File: `apps/api/src/routes/notes/batch-create.ts:106–108`
- Category: API contract / wire shape
- Evidence:
  ```ts
  if (row.client_note_id) {
    results.push({ client_note_id: row.client_note_id, id: row.id });
  }
  ```
  Rows inserted with `client_note_id: null` (legitimate per the upstream `NoteInput` schema where the field is optional) are silently omitted from the response `created` array.
- Why it matters: A caller posting `{ notes: [n1, n2] }` where `n1.client_note_id` is set and `n2.client_note_id` is null receives `{ created: [{ client_note_id, id }] }` of length 1. The desktop client must then guess which input element was dropped. The comment at line 19–20 acknowledges this ("the desktop ignores those entries") — but this couples the server's response shape to a desktop assumption that may not hold for third-party SDKs against the v1 published wire.
- Fix: Always emit one entry per input (`client_note_id: row.client_note_id ?? null`). The desktop can keep ignoring entries with null `client_note_id`; SDK authors won't have to guess.

### [LOW] `conversations/list.ts:62` + `notes/list.ts:51` + `folders/list.ts:52` — `req.query ?? {}` cast bypasses runtime validation
- File: `apps/api/src/routes/conversations/list.ts:62`
- Category: code-quality
- Evidence:
  ```ts
  const q = (req.query ?? {}) as ListQuery;
  ```
- Why it matters: Same root cause as the LOCKER-04 finding. `req.query` is `unknown`; the cast assumes shape without validating. `parseListQuery` does light validation on `limit/before/since` but does not reject extra keys or coerce non-string values. Won't bite today because Fastify's `qs`-style parser produces strings, but the cast is the kind of thing future "I added a number coercion" PRs trip on.
- Fix: Same as the LOCKER-04 fix — let `schema: { querystring: ... }` shape `req.query` for you.

### [LOW] `conversations/search.ts:51–54` + `notes/search.ts:58–61` — pre-Zod trim check duplicates schema concern
- File: `apps/api/src/routes/conversations/search.ts:51–54`
- Category: code-quality
- Evidence:
  ```ts
  const rawBody = (req.body ?? {}) as { query?: unknown };
  if (typeof rawBody.query === "string" && rawBody.query.trim().length < 1) {
    throw new ValidationError("QUERY_REQUIRED", "query must be non-empty");
  }
  const body = SearchRequestSchema.parse(req.body);
  ```
- Why it matters: The Zod schema is `z.string().min(1).max(256)`; the manual trim check exists because `"   "` satisfies `.min(1)`. The pre-Zod cast `as { query?: unknown }` is unnecessary — `req.body` is already typed. The comment refers to "Pitfall #3" which is project-internal and not surfaced to a reader.
- Fix: Replace with `z.string().min(1).max(256).refine((s) => s.trim().length > 0, "must be non-empty")` inside the schema. Removes the cast and centralizes validation.

### [LOW] `conversations/list.ts:46–48` — `ConversationWithMessagesRow` extends `CloudConversationRow` but renames the SELECT result
- File: `apps/api/src/routes/conversations/list.ts:46–48`, `:81–106`
- Category: code-quality
- Evidence:
  ```ts
  interface ConversationWithMessagesRow extends CloudConversationRow {
    messages: CloudMessageRow[] | null;
  }
  // ...
  const result = (await tx.execute(sql`SELECT c.*, COALESCE(...) AS messages FROM "conversations" c ...`));
  ```
  The aggregated subquery emits `jsonb_build_object(...)` rows — i.e. `messages` arrives as a `jsonb[]` typed array of plain objects, NOT as `CloudMessageRow` (which has `Date|string` timestamp types). The TS type is a lie at the boundary; it happens to work because `rowToCloudMessage` accepts the union.
- Why it matters: The next person to add a column to `CloudMessageRow` will assume the shape arrives intact from the SQL; it doesn't. Names the boundary inaccurately.
- Fix: Define a tighter `interface AggregatedMessage { id: string; conversation_id: string; role: string; content: string; metadata: Record<string, unknown> | null; created_at: string; }` matching exactly what `jsonb_build_object` emits, and use it in `ConversationWithMessagesRow.messages`.

### [LOW] `conversations/messages.ts:109` — `JSON.stringify(body.metadata ?? {})` redundant double-encoding into a `jsonb` column
- File: `apps/api/src/routes/conversations/messages.ts:109`
- Category: code-quality
- Evidence:
  ```ts
  metadata: JSON.stringify(body.metadata ?? {}),
  ```
  `messages.metadata` is declared `jsonb` (`packages/data/src/schema/messages.ts:22`). The `pg` driver coerces a JS object to jsonb natively; passing a `JSON.stringify`-ed text relies on Postgres re-parsing the text via the `text → jsonb` cast.
- Why it matters: Wastes one parse cycle per insert and obscures intent. Doesn't change wire output (the `jsonb` column is parsed back into a JS object on SELECT regardless), but a reader assumes the stringify is doing something protective.
- Fix: `metadata: body.metadata ?? {},` — pass the object directly. The Drizzle param binder + pg type system handle the jsonb conversion.

## Dead code
None within scope. Every exported `build*Routes` builder is wired into `apps/api/src/routes/index.ts` (confirmed by grep across `apps/`, `packages/` excluding `__tests__/`). All exported `rowTo*`/`Cloud*Row`/`*Deps` types are consumed within the same family. No orphan exports.

## Suppressed warnings
None within scope — no `@ts-ignore`, `@ts-expect-error`, `// @ts-nocheck`, `as any`, `as unknown as`, `eslint-disable`, or `biome-ignore` lines in the 19 source files reviewed. Two `as` casts exist (e.g. `(req.query ?? {}) as ListQuery` in three list routes, and `(req.body ?? {}) as { query?: unknown }` in both search routes) — these are widening-narrowing casts on `unknown`, not type-suppressions; covered as LOW-tier code-quality findings above.

## Notes
- **TODO/FIXME/HACK/XXX/TEMP/WORKAROUND scan**: zero hits across the 19 files (`grep -rEn '(TODO|FIXME|HACK|XXX|TEMP|WORKAROUND|kludge)' apps/api/src/routes/{conversations,folders,notes}` returned no rows).
- **Hardcode scan**: zero hits for `localhost|127\.0\.0\.1|:3000|:4000|:8080|sk-|AIza|AKIA|Bearer ey|process\.env\.NODE_ENV` in scope.
- **Rate-limit posture**: every route in scope carries `config: { rateLimit: { max, timeWindow } }`. None use `rateLimit: false`. Batch endpoints correctly drop to 5/min/user; bulk-purge correctly drops to 3/min/user. Search drops to 60/min/user. Default CRUD sits at 120/min/user (240 for `/messages` which is per-message rather than per-conversation). The rate-limit posture is the strongest part of this surface.
- **Auth posture**: `dualAuthHook` (`apps/api/src/middleware/dual-auth.ts`) is mounted as a global `onRequest` hook (`apps/api/src/index.ts:428`) and populates `req.user`/`req.tenant`/`req.sessionId` from session cookie OR Bearer PAK. Every reviewed handler re-checks `if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", "unauthorized")` as defence-in-depth. Cross-tenant ownership is enforced by `withTenant(deps.db, tenantId, ...)` (sets the `app.tenant_id` GUC and FORCE-RLS gates every read/write) plus an explicit `WHERE "user_id" = ${userId}::uuid` in every handler — so cross-user attacks within the same tenant are blocked even if RLS were misconfigured.
- **Soft-delete posture**: every read path composes `withSoftDelete()` (`AND deleted_at IS NULL`); every soft-delete UPDATE adds `AND "deleted_at" IS NULL` to avoid re-deleting tombstones (also yields the 404 idempotency the contract wants). The single exception is `notes/delete-all.ts` which deliberately hard-deletes tombstones — see HIGH #2 above.
- **SQL-injection posture**: no `sql.raw()` carries user input. Every `sql.raw` in scope wraps a column name pulled from a static `MUTABLE_COLS as const` tuple after `Object.hasOwn(body, key)` guard. The `client-id-upsert` helper additionally validates table/column identifiers against `/^[a-z_][a-z0-9_]*$/` before any `sql.raw`. Search routes both use `websearch_to_tsquery('simple', $1)` exclusively — no `to_tsquery` raw-input path.
- **Recommendation for v1 publication**: address HIGH #2 (`delete-all` cap bypass) and HIGH #3 (`messages.content` cap) before tagging v1. The LOCKER-04 schema-block debt can ship if the README clearly documents it as pending Phase 41; otherwise external contributors will copy the missing-schema pattern into new routes faster than Phase 41 can land.
