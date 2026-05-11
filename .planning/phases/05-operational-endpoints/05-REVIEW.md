---
phase: 05-operational-endpoints
reviewed: 2026-05-11T00:00:00Z
depth: standard
files_reviewed: 64
files_reviewed_list:
  - apps/api/src/lib/argon2-keys.ts
  - apps/api/src/lib/client-id-upsert.ts
  - apps/api/src/lib/keyset-pagination.ts
  - apps/api/src/lib/settings-resolver.ts
  - apps/api/src/lib/soft-delete.ts
  - apps/api/src/lib/web-search/registry.ts
  - apps/api/src/lib/web-search/tavily-adapter.ts
  - apps/api/src/lib/web-search/types.ts
  - apps/api/src/lib/web-search/yandex-adapter.ts
  - apps/api/src/routes/agent/web-search.ts
  - apps/api/src/routes/conversations/create.ts
  - apps/api/src/routes/conversations/delete.ts
  - apps/api/src/routes/conversations/list.ts
  - apps/api/src/routes/conversations/messages.ts
  - apps/api/src/routes/conversations/search.ts
  - apps/api/src/routes/conversations/shape.ts
  - apps/api/src/routes/conversations/update.ts
  - apps/api/src/routes/folders/batch-create.ts
  - apps/api/src/routes/folders/create.ts
  - apps/api/src/routes/folders/delete.ts
  - apps/api/src/routes/folders/list.ts
  - apps/api/src/routes/folders/shape.ts
  - apps/api/src/routes/folders/update.ts
  - apps/api/src/routes/index.ts
  - apps/api/src/routes/note-recording-config.ts
  - apps/api/src/routes/notes/batch-create.ts
  - apps/api/src/routes/notes/create.ts
  - apps/api/src/routes/notes/delete-all.ts
  - apps/api/src/routes/notes/delete.ts
  - apps/api/src/routes/notes/list.ts
  - apps/api/src/routes/notes/search.ts
  - apps/api/src/routes/notes/shape.ts
  - apps/api/src/routes/notes/update.ts
  - apps/api/src/routes/streaming-usage.ts
  - apps/api/src/routes/stt-config.ts
  - apps/api/src/routes/test-only.ts
  - apps/api/src/routes/transcriptions/batch-create.ts
  - apps/api/src/routes/transcriptions/batch-delete.ts
  - apps/api/src/routes/transcriptions/create.ts
  - apps/api/src/routes/transcriptions/delete.ts
  - apps/api/src/routes/transcriptions/list.ts
  - apps/api/src/routes/transcriptions/shape.ts
  - apps/api/src/routes/usage.ts
  - apps/api/src/routes/v1/keys/create.ts
  - apps/api/src/routes/v1/keys/list.ts
  - apps/api/src/routes/v1/keys/revoke.ts
  - packages/data/migrations/0006_tenant_settings.sql
  - packages/data/migrations/0007_notes_folders.sql
  - packages/data/migrations/0008_conversations_messages.sql
  - packages/data/migrations/0009_transcriptions.sql
  - packages/data/migrations/0010_api_keys.sql
  - packages/data/migrations/0011_notes_cloud_columns.sql
  - packages/data/migrations/0012_folders_cloud_columns.sql
  - packages/data/migrations/0013_transcriptions_cloud_columns.sql
  - packages/wire-schemas/src/api-keys.ts
  - packages/wire-schemas/src/conversations.ts
  - packages/wire-schemas/src/folders.ts
  - packages/wire-schemas/src/index.ts
  - packages/wire-schemas/src/notes.ts
  - packages/wire-schemas/src/settings.ts
  - packages/wire-schemas/src/streaming-usage.ts
  - packages/wire-schemas/src/transcriptions.ts
  - packages/wire-schemas/src/web-search.ts
findings:
  critical: 0
  warning: 4
  info: 6
  total: 10
status: clean
---

# Phase 5: Code Review Report

**Reviewed:** 2026-05-11
**Depth:** standard
**Files Reviewed:** 64
**Status:** clean (no critical or high-severity findings; 4 warnings + 6 info items below; all are quality / hardening suggestions for future phases — none block phase close)

## Summary

Phase 5 implements 22 wire-surface routes (WIRE-08 .. WIRE-29) across 10 plans, plus 8 new migrations adding 7 multi-tenant tables. The diff is large (~64 source files) but uniformly well-disciplined:

- **Security posture is strong.** Argon2id parameters match OWASP 2026 (m=64MiB, t=3, p=1) and are a module-level constant with no override path. Clear-text PAKs are returned exactly once on create and never logged or persisted. All 7 new tables (`tenant_settings`, `user_settings`, `folders`, `notes`, `conversations`, `messages`, `transcriptions`, `api_keys`) have BOTH `ENABLE ROW LEVEL SECURITY` AND `FORCE ROW LEVEL SECURITY` plus tenant-isolation policies bound to `current_setting('app.tenant_id')`. Every route runs DB activity inside `withTenant(deps.db, tenantId, …)` so the GUC is set per-transaction.
- **SQL injection surface is closed.** Every route uses parameterized `sql\`...\`` template tags from drizzle-orm; the one place that uses `sql.raw` (`client-id-upsert.ts`) gates identifiers through a strict `^[a-z_][a-z0-9_]*$` allow-pattern (`quoteIdent`) before composition. Search routes use `websearch_to_tsquery('simple', $1)` rather than `to_tsquery`, which is by-contract safe against operator-laden user input (T-05-03 mitigation).
- **HTTP-boundary hygiene for Tavily/Yandex is correct.** API keys are sourced from `process.env` only inside the outbound `Authorization` header, never logged, never echoed in error envelopes. URLs are hardcoded constants; user input flows only into the JSON body's `query` field (T-05-01 SSRF closed). Yandex adapter explicitly captures and discards `requestId`/`grpcCode` for triage but does not echo upstream JSON to the client.
- **Rate-limiting is per-user with sane budgets.** `/create` is 5/hr/user (Argon2id-aware), `/web-search` 30/min/user, `/notes/delete-all` 3/min/user, `batch-*` 5/min/user. All keyed on `req.user?.id ?? req.ip`.
- **Wire-shape contracts are clearly documented.** Every route header comment cites the upstream desktop service file, the BACKEND_SPEC line range, and the relevant D-decisions / T-threat IDs from the phase plan. This makes future drift detectable on review.
- **TDD discipline is visible.** Each route ships with unit, integration (testcontainer), e2e (`tests/e2e/phase-05-*.spec.ts`), and contract tests (negative-matrix enumeration covers every `/api/*` path).

No CRITICAL findings. No HIGH findings. Status: `clean`.

## Warnings

### WR-01: streaming-usage logs raw transcript text (PII) to structured logs

**Files:** `apps/api/src/routes/streaming-usage.ts:81-105`
**Issue:** D-13's stated invariant is "NEVER store body.text in usage_ledger" — and the DB write does honor that. But `text_preview` (the first 200 chars by default, 1000 chars when `sendLogs=true`) is emitted to `req.log.info(...)`, which in this stack ships to Loki via the OTel Collector. That means user-spoken transcript content lands in the operator's log store with the same retention as access logs. The header comment explicitly acknowledges this is intentional ("Emit SHA-256 + length + bounded preview to structured logs only"), but the design splits PII into two retention surfaces with very different operator expectations:
- DB (privacy-protected, RLS-scoped, GDPR delete supported via tenant cascade)
- Logs (typically NOT under tenant cascade; operator log retention is process-global)

The desktop client opts in via `sendLogs=true` which raises the cap to 1000 chars, but the 200-char default applies to EVERY call — there is no "never log preview" path. Under GDPR right-to-erasure a tenant delete will not remove these previews from Loki.
**Fix:** One of:
1. Make the 200-char-default opt-in too: log `text_preview` only when `sendLogs=true`, otherwise log only `text_sha256` + `text_length`. This is the privacy-by-default position.
2. Document this as a known-by-design trade-off in `docs/conventions.md` and confirm operator log retention policy in the deployment docs (CLAUDE.md hard rule: "every requirement ships with corresponding documentation").
3. If the trade-off is intentional, add a tenant-id-scoped log scrubber to the OTel Collector so tenant deletion can purge associated previews.

### WR-02: `streaming-usage` accepts unbounded `sessionId` and `audioDurationSeconds`

**Files:** `packages/wire-schemas/src/streaming-usage.ts:11-12`, `apps/api/src/routes/streaming-usage.ts:74,113`
**Issue:**
- `sessionId: z.string()` has no min/max length. It is stored as `usage_ledger.request_id` (which has a UNIQUE index across the entire ledger). A misbehaving or hostile client can ship a 10MB sessionId; Postgres will accept up to ~1GB but the index page will throw `index row size exceeds maximum` somewhere around 2.7KB and surface a generic 500 instead of a clean 400.
- `audioDurationSeconds: z.number().min(0)` has no upper bound. `Math.round()` on `Number.MAX_SAFE_INTEGER` (or `Infinity`) writes a huge `units` value into `usage_ledger`, polluting the SUM aggregator that drives `/api/usage` and contaminates every dashboard.

Neither input is currently authenticated as adversarial in production (the desktop client is the only caller), but the server treats every input as untrusted by Phase 1 discipline.
**Fix:** Tighten the schema:
```ts
export const StreamingUsageBodySchema = z.object({
  sessionId: z.string().min(1).max(128),
  // 24h cap — meaningfully larger than any single STT session.
  audioDurationSeconds: z.number().min(0).max(86_400),
  ...
});
```
Re-derive `units = Math.round(...)` afterward; the bound prevents pollution.

### WR-03: `parseListQuery` accepts arbitrary `Date()` strings; some "valid" inputs land non-ISO

**Files:** `apps/api/src/lib/keyset-pagination.ts:60-66`
**Issue:** `new Date(q.before)` accepts any string `Date.parse` knows — including locale-specific formats like `"5/11/2026"` (which is May 11 in the US, Nov 5 elsewhere) and partial inputs like `"2026"` (which becomes `2026-01-01T00:00:00Z`). The route's contract is "ISO 8601 timestamps". The current code accepts non-ISO strings silently and returns surprising pages.
**Fix:** Validate the input is ISO 8601 before constructing the Date:
```ts
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
if (q.before && !ISO_RE.test(q.before)) throw new TypeError("'before' must be ISO 8601");
```
Or use `z.string().datetime({ offset: true })` in the route's manual parse path.

### WR-04: `client-id-upsert` SELECT fallback uses `sql.raw` between parameter slots

**File:** `apps/api/src/lib/client-id-upsert.ts:139-147`
**Issue:** The fallback SELECT is constructed as:
```ts
sql`${selectHead}${params.tenantId}${selectMid}${params.userId}${selectMid2}${params.clientIdValue}${selectTail}`
```
The `selectHead`/`selectMid` fragments are `sql.raw(...)` (literal SQL strings) interleaved with template-bound values. This works as expected with drizzle-orm — `params.tenantId` etc bind as parameters, and `sql.raw` segments are literal SQL — but the construction is fragile:
- Anyone reading the helper later might mistake `params.tenantId` (a UUID string) for a value that gets concatenated literally into the SQL between two `sql.raw` chunks.
- The helper depends on a non-obvious drizzle behavior: `sql\`${a}${b}\`` where `a` is `sql.raw(...)` and `b` is a JS scalar must produce raw SQL + bound parameter, not literal interpolation. This is in fact what drizzle does today, but the dependency is undocumented.
- `quoteIdent` already provides the safety net for column/table names; reusing the same pattern (build the WHERE as a single `sql\`...\`` template with the raw column-name fragment interpolated as `sql.raw(\`"${cidCol}"\`)`) would be safer and more obviously correct.

**Fix:** Rewrite the SELECT path as a single template with `sql.raw` only around the dynamic column name:
```ts
const cidColRaw = sql.raw(`"${params.clientIdColumn}"`);
const tblRaw = sql.raw(`"${params.table}"`);
const selectResult = await tx.execute(sql`
  SELECT * FROM ${tblRaw}
   WHERE "tenant_id" = ${params.tenantId}::uuid
     AND "user_id" = ${params.userId}::uuid
     AND ${cidColRaw} = ${params.clientIdValue}
   LIMIT 1
`);
```
This is functionally identical, easier to audit, and consistent with the rest of the codebase.

## Info

### IN-01: `notes/batch-create` silently drops rows from response when `client_note_id` is null

**File:** `apps/api/src/routes/notes/batch-create.ts:107-109`
**Issue:** The header comment says "Rows without a client_note_id are returned with `client_note_id: null` in the response (the desktop ignores those entries)", but the code is `if (row.client_note_id) { results.push(...) }` — the row is omitted entirely, not pushed with `client_note_id: null`. Either fix the code to match the comment, or update the comment to "Rows without a client_note_id are omitted from the response."
**Fix:** Pick one of:
- Code change: drop the `if (row.client_note_id)` guard; push `{ client_note_id: row.client_note_id ?? null, id: row.id }`.
- Comment change: clarify "omitted from the response."

### IN-02: SUM-derived `wordsUsed` cast through `Number()` for bigint string

**Files:** `apps/api/src/routes/streaming-usage.ts:122-125`, `apps/api/src/routes/usage.ts:60-63`
**Issue:** The query returns `COALESCE(SUM(units), 0)::bigint AS words_used`. Postgres `bigint` arrives as a string from the driver to preserve precision past `Number.MAX_SAFE_INTEGER`. `Number(raw)` silently loses precision above 2^53. For a single tenant accumulating 9 quintillion words this is a non-issue today, but the cast is unsafe in principle and the code does no overflow check.
**Fix:** Either keep the response field as a string ("wordsUsed: string") for forward compatibility, or document the precision ceiling and add a defensive `if (raw && Number(raw) > Number.MAX_SAFE_INTEGER) req.log.warn(...)` guard.

### IN-03: `withSoftDelete()` returns leading-AND fragment; couples helper to call-site clause structure

**File:** `apps/api/src/lib/soft-delete.ts:29-31`
**Issue:** `withSoftDelete()` returns `' AND deleted_at IS NULL'` which only makes sense when the caller already has at least one WHERE term. Every Phase 5 list route does so today (filtering on `user_id = …`), but a future caller that wants "list everything for the current tenant under RLS without a user_id filter" will silently produce a syntax error. The accompanying `softDeletePredicate()` is the safer primitive but is unused.
**Fix:** Either deprecate `withSoftDelete()` in favor of `softDeletePredicate()` and have callers compose with `AND` explicitly, or rename to `andSoftDelete()` to make the leading-AND obvious.

### IN-04: Conversation `messages` aggregation uses `array_agg(jsonb_build_object(...))` returning `jsonb[]`

**File:** `apps/api/src/routes/conversations/list.ts:84-108`
**Issue:** `array_agg` over `jsonb_build_object` produces a Postgres `jsonb[]` array — for `?include=messages` lists each conversation row carries up to 100 jsonb objects unmarshalled by the pg driver. Two follow-ups for future hardening:
- This is the documented mitigation for T-AGG-MEM (cap of 100), but at 50 conversations × 100 messages × ~1KB each = ~5MB per response. Worth surfacing in the `?include=messages` doc as "expected response can reach several MB."
- The `COALESCE(..., ARRAY[]::jsonb[])` returns a Postgres array literal that the pg driver will hand back as `[]` JS array. Fine today; just worth a unit test asserting empty conversations.

**Fix:** Add a load-test data-shape assertion in `tests/e2e/phase-05-conversations.spec.ts` for the upper bound (50 conversations × 100 messages); document the response-size ceiling in `docs/wire-contract.md`.

### IN-05: `parseListQuery` clamps `limit=0` to default 50 silently

**File:** `apps/api/src/lib/keyset-pagination.ts:54-58`
**Issue:** When the caller ships `limit=0`, the code path is: `parseInt("0", 10) === 0`, then `parsed > 0` is false, so it falls through to `DEFAULT_LIMIT = 50`. A caller asking for 0 results expects an empty array, not 50. The header comment justifies clamping aggressive values up (`limit=9999` → 200), but `limit=0` arguably should be either `min(1)` (bounce to 1) or pass-through (return `[]` cheaply). Today it returns 50 results, which is potentially an information disclosure surface against a script probing pagination.
**Fix:** Either explicitly clamp `0` to 1 (`if (parsed >= 0) limit = Math.min(Math.max(parsed, MIN_LIMIT), MAX_LIMIT);`), or reject `limit=0` with a 400.

### IN-06: `test-only.ts` re-uses `OPENWHISPR_TEST_ROUTES` opt-in for /api/_test/route-list

**File:** `apps/api/src/routes/test-only.ts:222-237`
**Issue:** The new `/api/_test/route-list` (introspection seam for negative-matrix enumeration) is gated by the same env flag as `/api/_test/force-rotate`. The flag's documentation correctly warns "PRODUCTION OPERATORS MUST NOT set this var". Suggest adding a startup banner / log line at boot when `OPENWHISPR_TEST_ROUTES === 'true'` is detected, so accidental production enablement is loud rather than silent. (The route-list endpoint by itself is not sensitive — it returns the same info `printRoutes` would log to stdout — but the rotation-shortcut endpoint is.)
**Fix:** In `apps/api/src/index.ts` (or wherever the boot-banner lives), add:
```ts
if (process.env.OPENWHISPR_TEST_ROUTES === "true") {
  logger.warn("OPENWHISPR_TEST_ROUTES=true — /api/_test/* surface is exposed. Production deployments MUST NOT enable this.");
}
```

---

_Reviewed: 2026-05-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
