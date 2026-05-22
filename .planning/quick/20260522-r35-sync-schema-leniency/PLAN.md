---
quick_id: 260522-r35
slug: r35-sync-schema-leniency
date: 2026-05-22
type: quick
severity: HIGH
source: client-filed bug (R35), live-reproduced against running stack
---

<objective>
Cloud-sync POST endpoints reject the immutable desktop client's request body
with 400 "Invalid request" — transcriptions/notes/conversations/folders never
sync, the web dashboard stays empty.

Two field-validator defects in the wire-schemas INPUT schemas, both LIVE-PROVEN
against the running api (not guessed):

DEFECT 1 — datetime format. `ISO_DATETIME = z.string().datetime({ offset: true })`
is declared identically in `packages/wire-schemas/src/{transcriptions,notes,
conversations,folders}.ts`. The immutable client stores `created_at`/`updated_at`
in SQLite columns declared `DATETIME DEFAULT CURRENT_TIMESTAMP`, which yields the
SPACE-SEPARATED form `"2026-05-22 16:05:11"` (no `T`, no offset). Zod
`.datetime()` requires RFC-3339 `T`-form, so the client's value is rejected.
LIVE-PROVEN: `created_at:"2026-05-22 16:05:11"` -> 400;
`created_at:"2026-05-22T16:05:11.000Z"` -> 200. Affects `created_at`/`updated_at`
on the four INPUT schemas (`TranscriptionInputSchema:29` optional,
`NoteInputSchema:55-56` optional, `ConversationInputSchema:39-40` optional;
FolderInput has NO `created_at`/`updated_at` field — see scope note below).

DEFECT 2 — status enum (transcriptions only). `TranscriptionInputSchema.status`
(transcriptions.ts:28) is `TranscriptionStatusSchema.optional()` where
`TranscriptionStatusSchema = z.enum(["pending","processing","completed","failed"])`,
on a `.strict()` object. The client's local SQLite `transcriptions.status` column
is unconstrained `TEXT NOT NULL DEFAULT 'completed'`. LIVE-PROVEN:
`status:"synced"` -> 400. VERIFIED: only the transcriptions sync payload carries
a `status` field (`SyncService.ts:179,527`); notes/folders/conversations do NOT
send `status` — DEFECT 2 is transcriptions-only.

Purpose: restore cloud sync for the immutable desktop client.
Output: lenient INPUT datetime + tolerant INPUT status; Cloud* RESPONSE schemas
stay strict; new regression tests; wire-contract doc update.
</objective>

<scope_correction>
The task brief states "FolderInputSchema:31-32 NON-optional". VERIFIED FALSE
against the live file: `packages/wire-schemas/src/folders.ts` `FolderInputSchema`
has NO `created_at` / `updated_at` field at all (only `name`, `client_folder_id`,
`is_default`, `sort_order`). `ISO_DATETIME` in folders.ts is used ONLY by
`CloudFolderSchema` (the RESPONSE), which stays strict. Therefore:

- DEFECT 1 touches THREE input schemas: transcriptions, notes, conversations.
- folders.ts is touched ONLY to migrate its `ISO_DATETIME` const to import the
  shared validator IF we adopt the shared-helper design — and even then folders'
  `ISO_DATETIME` stays the STRICT one (response-only). No behavior change for
  folders. Treat folders.ts as out-of-scope for FIX 1 unless the executor
  consolidates the strict const; that consolidation is optional cleanup, not
  required. The folders ROUTE is still verified (FIX 3 below).
</scope_correction>

<live_route_findings>
Read all four routes. CRITICAL finding that shapes the design:

NONE of the four routes echo the client's `created_at`/`updated_at` into the DB
insert. Every route builds `insertValues` WITHOUT `created_at`/`updated_at` and
lets Postgres apply the column DEFAULT. The Cloud* response is then built from
the DB row via `rowToCloud*()`, and Postgres returns canonical ISO. So today the
input `created_at`/`updated_at` are parsed-then-discarded.

Consequence: the input datetime validator does NOT need to normalize for
response-correctness — the response never carries the client string. BUT a
normalizing transform is still the chosen design (FIX 1) because:
  (a) it future-proofs against any later route that decides to persist the
      client timestamp;
  (b) `z.infer<TranscriptionInput>.created_at` becomes a canonical-ISO string,
      so any downstream consumer gets a clean value;
  (c) it is strictly safer than a bare regex with zero added risk.

`transcriptions/batch-create.ts:81` inserts `status: input.status ?? "completed"`
directly into the DB `transcriptions.status` column. The executor MUST check the
DB column constraint (FIX 2 / Task 3) — if the column has a CHECK/enum the route
needs a normalize step; if it is free `text` the raw insert is fine but a
defensive normalize is still required so the Cloud* RESPONSE (strict
`TranscriptionStatusSchema`) stays satisfiable.
</live_route_findings>

<the_fix>

## FIX 1 — lenient INPUT datetime (shared normalizing transform)

Add ONE new exported helper to wire-schemas. Create
`packages/wire-schemas/src/input-datetime.ts`:

- Export `INPUT_DATETIME` — a `z.string()` with a `.transform()` that:
  1. Trims the string.
  2. Detects the SQLite space form via this exact regex:
     `^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$`
  3. If the string matches, normalize: replace the separator (space or `T`) with
     `T`; if no trailing `Z`/offset is present, append `Z`; leave an existing
     offset/`Z` untouched. Result is always canonical RFC-3339.
  4. If the string does NOT match the regex, FAIL via `z.never()`-style refine —
     implement as `z.string().refine(...).transform(...)` OR a single
     `.superRefine` + `.transform`. Recommended concrete shape:

     ```
     const SQLITE_OR_ISO =
       /^(\d{4})-(\d{2})-(\d{2})[ T]\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$/;

     // Roll-over-detecting calendar-validity check.
     // Date.parse silently rolls impossible dates (Feb 30 -> Mar 2), so a bare
     // `!Number.isNaN(Date.parse(...))` would WRONGLY accept "2026-02-30...".
     // For Z / offset-less inputs the normalized form ends in `Z`, so the UTC
     // getters read back the exact calendar components and we compare them to
     // the source digits. For explicit-offset inputs (machine-generated, never
     // a calendar typo) a plain non-NaN parse is sufficient.
     function isCalendarValid(source: string, normalized: string): boolean {
       const t = Date.parse(normalized);
       if (Number.isNaN(t)) return false;
       const m = SQLITE_OR_ISO.exec(source);
       if (!m) return false;
       const hasOffset = /[+-]\d{2}:?\d{2}$/.test(source);
       if (hasOffset) return true; // non-NaN parse already passed
       const d = new Date(t);
       const [, yy, mm, dd] = m;
       return (
         d.getUTCFullYear() === Number(yy) &&
         d.getUTCMonth() + 1 === Number(mm) &&
         d.getUTCDate() === Number(dd)
       );
     }

     export const INPUT_DATETIME = z
       .string()
       .trim()
       .refine((s) => SQLITE_OR_ISO.test(s), {
         message: "datetime.invalid_format",
       })
       .refine((s) => isCalendarValid(s, s.replace(" ", "T")), {
         message: "datetime.invalid_format",
       })
       .transform((s) => {
         const normalized = s.replace(" ", "T");
         return /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
           ? normalized
           : `${normalized}Z`;
       });
     ```

  NOTE the refine `message` is a STABLE MACHINE KEY (`datetime.invalid_format`),
  NOT inline English — mirrors the `metadata.too_large` precedent in
  conversations.ts:32 (LOCKER / i18n doctrine).

- The first `.refine` rejects structural garbage: `"not a date"` (no digits),
  `""` (empty), `"   "` (post-trim empty), `"2026-05-22"` (date only, no time).
- The second `.refine` (`isCalendarValid`) rejects semantically-impossible
  calendar dates that pass the digit-shape regex. This is a ROUND-TRIP check,
  NOT a bare `Date.parse` non-NaN check. Why: `Date.parse("2026-02-30T12:00:00Z")`
  returns a VALID number — JS silently rolls Feb 30 to Mar 2 — so a non-NaN
  check would WRONGLY ACCEPT an impossible date. Instead:
  - Extract the `YYYY`/`MM`/`DD` digits directly from the regex capture groups
    of the source string (the `SQLITE_OR_ISO` regex now captures them).
  - Construct the `Date` from the normalized canonical-ISO string and read back
    `getUTCFullYear()`, `getUTCMonth()+1`, `getUTCDate()`.
  - The check PASSES only if the read-back year/month/day EQUAL the source
    digits. `"2026-02-30 ..."` -> Date becomes Mar 2 -> `getUTCDate()` returns
    `2 !== 30` -> REJECT. `"2026-13-99 ..."` -> `Date.parse` returns `NaN` ->
    REJECT (the early `Number.isNaN` guard). A genuine valid date round-trips
    identically -> PASS.
  - Offset handling: for inputs WITH an explicit `+HH:MM`/`-HH:MM` offset, the
    UTC getters would read offset-shifted components and could false-reject a
    valid local date, so for offset-bearing inputs `isCalendarValid` returns
    `true` on a plain non-NaN parse. This is sound — an offset-bearing string is
    machine-generated (`toISOString`-style), never a calendar typo, and the
    SQLite space form the client actually sends has NO offset, so the strict
    component round-trip applies to exactly the calendar-typo-risk inputs.
  Required outcome (pinned by Task 1 tests): `"2026-13-99 00:00:00"` and
  `"2026-02-30 12:00:00"` are REJECTED; valid SQLite/ISO/offset forms ACCEPTED.

- Export `INPUT_DATETIME` from `packages/wire-schemas/src/index.ts` barrel.

Apply `INPUT_DATETIME` to `created_at` / `updated_at` ONLY on the three INPUT
schemas, preserving the existing `.optional()`:
  - `transcriptions.ts` — `created_at: INPUT_DATETIME.optional()` (line 29).
  - `notes.ts` — `created_at`/`updated_at`: `INPUT_DATETIME.optional()` (55-56).
  - `conversations.ts` — `created_at`/`updated_at`: `INPUT_DATETIME.optional()` (39-40).

Do NOT touch the per-file `const ISO_DATETIME` — it stays
`z.string().datetime({ offset: true })` and stays used by EVERY `Cloud*` RESPONSE
schema (`CloudTranscription`, `CloudNote`, `CloudConversation`, `CloudMessage`,
`CloudFolder`, `SearchResult`). The RESPONSE contract is unchanged.

## FIX 2 — tolerant INPUT transcription status

In `transcriptions.ts`, change `TranscriptionInputSchema.status` (line 28) from
`TranscriptionStatusSchema.optional()` to:

```
status: z.string().max(SHORT).optional(),
```

(`SHORT = 256` is already declared at transcriptions.ts:13.) Rationale: the
client's SQLite `status` is free `TEXT` defaulting `'completed'`; it is the
client's own field; the server does not gate on it. `z.string().max(256)` is the
simplest future-proof INPUT validator.

`CloudTranscriptionSchema.status` (line 45) stays `TranscriptionStatusSchema` —
the strict 4-value enum. The RESPONSE contract is unchanged.

KEEP `TranscriptionStatusSchema` exported (it is still the response validator and
may have other importers). Do NOT delete it.

## FIX 3 — route verification + status normalize

Task 3 verifies the four routes and adds a status-normalize step to
transcriptions/batch-create only:

1. Confirm `transcriptions/batch-create.ts`, `notes/batch-create.ts`,
   `folders/batch-create.ts` respond `201 { created: [...] }` and
   `conversations/create.ts` responds `201 CloudConversation` — VERIFIED in this
   plan's research, no shape change needed. Confirm each Cloud* item carries `id`
   + the `client_*_id` echo (transcriptions/folders/conversations return full
   Cloud* shape with the echo; notes returns the minimal
   `{ client_note_id, id }` pair per its documented upstream contract — that is
   correct, leave it).
2. Inspect the DB `transcriptions.status` column definition in
   `packages/data/src/schema/**` and `packages/data/migrations/**`.
   - If the column is free `text`/`varchar` with no CHECK: the raw
     `status: input.status ?? "completed"` insert is accepted, BUT the Cloud*
     RESPONSE is built by `rowToCloudTranscription()` which echoes
     `row.status` verbatim, and the route does NOT re-validate against
     `CloudTranscriptionSchema` at send time — so a non-enum status would flow
     to the client unchanged. To keep the documented RESPONSE contract honest,
     add a normalize step in `transcriptions/batch-create.ts`: map an unknown
     input status to a canonical `TranscriptionStatus` before insert.
     Recommended mapping helper (new, in transcriptions/shape.ts or a small
     local const): if `TranscriptionStatusSchema.safeParse(input.status).success`
     keep it, else fall back to `"completed"`. The raw client value is the
     client's local concern; the SERVER stores its own canonical status.
   - If the column has a CHECK constraint / enum: the normalize step is
     MANDATORY (a raw `"synced"` insert would 500 on the DB constraint).
3. Apply the SAME normalize logic in `transcriptions/create.ts` if it exists and
   inserts `status` from input (grep for it; if present, fix it too — same one-
   line normalize). Do not expand scope beyond status.

Net: input accepts any string status; the row stored and the Cloud* response
emitted always carry a valid `TranscriptionStatus` enum value.

</the_fix>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/quick/20260522-r35-sync-schema-leniency/PLAN.md
@packages/wire-schemas/src/transcriptions.ts
@packages/wire-schemas/src/notes.ts
@packages/wire-schemas/src/conversations.ts
@packages/wire-schemas/src/folders.ts
@packages/wire-schemas/src/index.ts
@apps/api/src/routes/transcriptions/batch-create.ts
@apps/api/src/routes/transcriptions/shape.ts
@apps/api/src/routes/notes/batch-create.ts
@apps/api/src/routes/folders/batch-create.ts
@apps/api/src/routes/conversations/create.ts
@apps/api/tests/unit/routes/__tests__/usage.integration.test.ts
@packages/wire-schemas/tests/unit/__tests__/r28-nullish-optionals.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1 (RED): wire-schemas unit tests for INPUT_DATETIME + tolerant status</name>
  <files>
    packages/wire-schemas/tests/unit/__tests__/r35-sync-schema-leniency.test.ts
  </files>
  <behavior>
    INPUT_DATETIME (import once it exists — write the test first, it will fail to
    import / fail assertions = RED):
    - ACCEPTS the SQLite space form: "2026-05-22 16:05:11".
    - ACCEPTS RFC-3339 T-form: "2026-05-22T16:05:11.000Z".
    - ACCEPTS fractional seconds: "2026-05-22 16:05:11.123".
    - ACCEPTS trailing offset: "2026-05-22 16:05:11+02:00",
      "2026-05-22T16:05:11-05:00".
    - NORMALIZES: parsing "2026-05-22 16:05:11" yields the string
      "2026-05-22T16:05:11Z" (assert the transformed output value, not just
      success).
    - NORMALIZES: "2026-05-22 16:05:11+02:00" keeps its offset
      ("2026-05-22T16:05:11+02:00").
    - REJECTS garbage: "not a date", "", "   ", "2026-13-99 00:00:00"
      (impossible month), "2026-02-30 12:00:00" (impossible day),
      "2026-05-22" (date only, no time).
    - The "2026-02-30 12:00:00" REJECT is the critical roll-over case: a bare
      Date.parse non-NaN check would WRONGLY accept it (JS rolls Feb 30 -> Mar 2);
      the round-trip component check rejects it. Pin this case explicitly.
    Three INPUT schemas accept the SQLite form:
    - TranscriptionInputSchema.safeParse({ text:"x", created_at:"2026-05-22 16:05:11" }).success === true.
    - NoteInputSchema.safeParse({ created_at:"2026-05-22 16:05:11", updated_at:"2026-05-22 16:05:11" }).success === true.
    - ConversationInputSchema.safeParse({ created_at:"2026-05-22 16:05:11", updated_at:"2026-05-22 16:05:11" }).success === true.
    Transcription INPUT status tolerance:
    - TranscriptionInputSchema.safeParse({ text:"x", status:"synced" }).success === true.
    - TranscriptionInputSchema.safeParse({ text:"x", status:"completed" }).success === true.
    - TranscriptionInputSchema.safeParse({ text:"x", status:"some-future-client-state" }).success === true.
    Asymmetry pin (the RESPONSE schema stays strict):
    - CloudTranscriptionSchema.safeParse({ ...validCloudRow, status:"synced" }).success === false.
    - The Cloud* RESPONSE datetime stays strict: CloudTranscriptionSchema /
      CloudNoteSchema reject "2026-05-22 16:05:11" in created_at (build an
      otherwise-valid Cloud row, set created_at to the space form, expect
      success === false).
  </behavior>
  <action>
    Create the test file mirroring the style of
    r28-nullish-optionals.test.ts (header comment naming R35, `describe`/`it`,
    `safeParse`). Import `INPUT_DATETIME` from "../../../src/input-datetime.js"
    and the schemas from their src files. Run the suite; it MUST fail (import
    error or assertion failures) — this is the RED commit.
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && pnpm --filter @openwhispr/wire-schemas test r35-sync-schema-leniency 2>&1 | tail -20</automated>
  </verify>
  <done>Test file exists, suite RUNS and FAILS (RED). Commit: `test(260522-r35): RED — sync schema leniency regression`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2 (GREEN): INPUT_DATETIME helper + apply to 3 input schemas + tolerant status</name>
  <files>
    packages/wire-schemas/src/input-datetime.ts
    packages/wire-schemas/src/index.ts
    packages/wire-schemas/src/transcriptions.ts
    packages/wire-schemas/src/notes.ts
    packages/wire-schemas/src/conversations.ts
  </files>
  <action>
    Implement FIX 1 and FIX 2 exactly as specified in the_fix:
    - Create input-datetime.ts with the `INPUT_DATETIME` validator: format regex
      refine (machine-key message "datetime.invalid_format"), roll-over-detecting
      calendar-validity refine (`isCalendarValid` round-trip check — NOT a bare
      Date.parse non-NaN check; reject Feb 30 / month 13 / etc.), normalizing
      transform to canonical RFC-3339. Add the SPDX header line.
    - Export `INPUT_DATETIME` from index.ts barrel.
    - transcriptions.ts: `created_at: INPUT_DATETIME.optional()` (was ISO_DATETIME);
      `status: z.string().max(SHORT).optional()` (was TranscriptionStatusSchema).
      Leave `const ISO_DATETIME`, `TranscriptionStatusSchema`, and the entire
      `CloudTranscriptionSchema` UNTOUCHED.
    - notes.ts: `created_at`/`updated_at` -> `INPUT_DATETIME.optional()`. Leave
      `const ISO_DATETIME` and `CloudNoteSchema`/`SearchResultSchema` untouched.
    - conversations.ts: `created_at`/`updated_at` -> `INPUT_DATETIME.optional()`.
      Leave `const ISO_DATETIME` and all Cloud* schemas untouched.
    - Do NOT remove `.strict()` from any input object. Do NOT touch folders.ts.
    Update the Phase-comment block atop each edited file with a one-line R35 note.
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && pnpm --filter @openwhispr/wire-schemas test r35-sync-schema-leniency 2>&1 | tail -15 && pnpm --filter @openwhispr/wire-schemas exec tsc --noEmit 2>&1 | tail -5</automated>
  </verify>
  <done>r35 wire test suite GREEN; wire-schemas tsc clean. Commit: `fix(260522-r35): GREEN — lenient INPUT datetime + tolerant transcription status`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: route verification + status normalize + route integration tests</name>
  <files>
    apps/api/src/routes/transcriptions/batch-create.ts
    apps/api/src/routes/transcriptions/shape.ts
    apps/api/tests/unit/routes/__tests__/r35-sync-leniency.integration.test.ts
  </files>
  <behavior>
    Integration tests (real Postgres testcontainer, mirror
    usage.integration.test.ts — `getSharedPostgres()`, real Drizzle migrate,
    Fastify boot with the route mounted, real `withTenant`):
    - POST /api/transcriptions/batch-create with one item carrying
      `created_at:"2026-05-22 16:05:11"` AND `status:"synced"` -> 201,
      body `{ created: [ { id, client_transcription_id, status, created_at, ... } ] }`.
      `created` length 1; `client_transcription_id` echoes the sent value;
      `status` is a valid TranscriptionStatus enum value (normalized, e.g.
      "completed"); `created_at` is canonical RFC-3339.
    - POST /api/notes/batch-create with `created_at`/`updated_at` in SQLite space
      form -> 201 `{ created: [{ client_note_id, id }] }`.
    - POST /api/folders/batch-create with a normal folder -> 201
      `{ created: [CloudFolder...] }` with `client_folder_id` echo (folders has
      no datetime input field — this test just confirms the route still passes
      and the echo is present; it is a control case).
    - POST /api/conversations/create with `created_at`/`updated_at` in SQLite
      space form -> 201 CloudConversation with `client_conversation_id` echo.
    - Live-form read-back: after the transcriptions batch-create, the row is
      readable (assert via a direct DB select inside the test, or via the route
      result `id`).
  </behavior>
  <action>
    First inspect the DB `transcriptions.status` column in
    packages/data/src/schema/** and packages/data/migrations/** (grep
    `status`). Then apply FIX 3:
    - Add a status-normalize helper: a small function (in transcriptions/shape.ts
      next to the existing helpers, exported) `normalizeTranscriptionStatus(s)`:
      returns `s` if `TranscriptionStatusSchema.safeParse(s).success`, else
      `"completed"`. Import `TranscriptionStatusSchema` from
      "@openwhispr/wire-schemas".
    - In transcriptions/batch-create.ts line ~81, change
      `status: input.status ?? "completed"` to
      `status: normalizeTranscriptionStatus(input.status ?? "completed")`.
    - If `apps/api/src/routes/transcriptions/create.ts` exists and inserts
      `status` from input, apply the SAME one-line normalize there.
    - Write the integration test file mirroring usage.integration.test.ts
      structure (shared-pg fixture, MIGRATIONS_FOLDER resolution, beforeAll boot,
      beforeEach TRUNCATE, unique emails, real `req.user`/`req.tenant` via the
      existing auth/test seam used by the other route integration tests — copy
      the exact seam from a sibling route integration test such as
      streaming-usage.integration.test.ts or usage.integration.test.ts).
    Do NOT change any route response shape. Do NOT touch notes/folders/
    conversations route source — they need no normalize.
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && pnpm --filter @openwhispr/api test r35-sync-leniency 2>&1 | tail -25</automated>
  </verify>
  <done>Integration suite GREEN against real Postgres; transcriptions batch-create with SQLite datetime + non-enum status returns 201 with normalized enum status. Commit: `fix(260522-r35): normalize transcription status at route + route integration tests`.</done>
</task>

<task type="auto">
  <name>Task 4: wire-contract doc + full-suite + LOCKER + live verification</name>
  <files>
    docs/wire-contract.md
  </files>
  <action>
    - Update docs/wire-contract.md: document the sync-endpoint INPUT contract —
      `created_at`/`updated_at` on transcription/note/conversation inputs accept
      BOTH RFC-3339 and the SQLite space form `"YYYY-MM-DD HH:MM:SS"` (optionally
      fractional seconds / offset) and are normalized server-side to canonical
      RFC-3339; the transcription INPUT `status` is tolerant (any string ≤256),
      mapped server-side to a canonical `TranscriptionStatus`. State explicitly
      that the `Cloud*` RESPONSE schemas remain strict (RFC-3339 datetime, 4-value
      status enum) — the input/output asymmetry is intentional.
    - Run the full wire-schemas + api test suites and the LOCKER lints.
    - tsc: confirm ZERO new errors beyond the documented baseline of 5
      (routes/index.ts FastifyPluginAsync x3, tokens/assemblyai.ts:125,
      tokens/deepgram.ts:91).
    - Live verification: with the dev stack running, POST
      /api/transcriptions/batch-create with `created_at:"2026-05-22 16:05:11"`
      and `status:"synced"` -> expect 201; then GET /api/transcriptions/list and
      confirm the row is present. Record the result in the commit message or
      task notes. If the stack is not running, note that live verification is
      deferred to the operator and the integration test (Task 3) is the
      authoritative proof.
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && pnpm --filter @openwhispr/wire-schemas test 2>&1 | tail -8 && pnpm lint:lockers 2>&1 | tail -15</automated>
  </verify>
  <done>wire-contract.md updated; full wire-schemas suite green; LOCKER lints green; tsc shows only the 5 baseline errors. Commit: `docs(260522-r35): document lenient sync-endpoint input contract`.</done>
</task>

</tasks>

<antipatterns>
- Do NOT loosen any `Cloud*` RESPONSE schema. `CloudTranscription`, `CloudNote`,
  `CloudConversation`, `CloudMessage`, `CloudFolder`, `SearchResult` keep their
  strict `ISO_DATETIME` (`z.string().datetime({ offset: true })`) and
  `TranscriptionStatusSchema`. The fix is INPUT-only.
- Do NOT remove `.strict()` from any input object. The bug is field validators,
  not extra-key rejection. The immutable client sends no extra keys.
- Do NOT delete `TranscriptionStatusSchema` or the per-file `const ISO_DATETIME`
  — both remain in use by the response schemas.
- Do NOT use a bare `!Number.isNaN(Date.parse(...))` as the date-validity check —
  it silently accepts roll-over dates like "2026-02-30" (JS rolls to Mar 2). Use
  the `isCalendarValid` component round-trip check specified in FIX 1.
- Do NOT make the routes echo the client's raw `created_at`/`updated_at` into the
  DB insert — they correctly use the Postgres column default today; leave that.
- Do NOT edit production schema/migration SQL to satisfy a test (CLAUDE.md hard
  rule). If the DB `status` column has a CHECK that blocks a value, the route
  normalize step is the fix — never widen the DB constraint here.
- Do NOT touch folders.ts input schema (it has no datetime input field).
- Do NOT use inline-English Zod error messages — use stable machine keys
  (`datetime.invalid_format`), per the conversations.ts `metadata.too_large`
  precedent.
- Do NOT introduce `as any` / `@ts-ignore` (LOCKER-02). Do NOT add hardcoded
  localhost/UUID/token shapes outside `tests/` (LOCKER-03).
</antipatterns>

<verification_checklist>
- [ ] `INPUT_DATETIME` accepts SQLite space form, RFC-3339, fractional, offset.
- [ ] `INPUT_DATETIME` normalizes space form -> canonical `...T...Z`.
- [ ] `INPUT_DATETIME` rejects "not a date", empty, "2026-13-99 ...", date-only.
- [ ] `INPUT_DATETIME` rejects the roll-over case "2026-02-30 12:00:00" (round-trip
      component check, not bare Date.parse non-NaN).
- [ ] Three INPUT schemas accept `created_at:"2026-05-22 16:05:11"`.
- [ ] `TranscriptionInputSchema.status` accepts `"synced"` and arbitrary strings.
- [ ] `CloudTranscriptionSchema.status` still rejects `"synced"` (asymmetry pinned).
- [ ] Cloud* RESPONSE datetime still rejects the SQLite space form.
- [ ] Route stores a canonical `TranscriptionStatus` enum value (normalize step).
- [ ] All four sync routes return their documented `201` shape with `client_*_id` echo.
- [ ] Route integration test: SQLite datetime + non-enum status -> 201, row readable.
- [ ] wire-schemas + api suites green; LOCKER lints green.
- [ ] tsc: only the 5 baseline pre-existing errors, zero new.
- [ ] docs/wire-contract.md documents the lenient input / strict output contract.
- [ ] Live: batch-create with exact SQLite datetime form + real status -> 200/201,
      row visible via /api/transcriptions/list (or deferred to operator with
      integration test as authoritative proof).
</verification_checklist>

<success_criteria>
Cloud sync from the immutable desktop client succeeds: transcriptions, notes, and
conversations with SQLite-form timestamps and (for transcriptions) free-text
status are accepted with `201 { created: [...] }`, while the server's emitted
`Cloud*` shapes remain strict and canonical.
</success_criteria>

<output>
After completion, summarize the four commits, the files changed, the
input/output asymmetry rationale, and the live-verification result (or its
deferral) directly to the user.
</output>
