---
phase: 64-high-findings-api-routes-conversations
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/routes/folders/batch-create.ts
  - apps/api/src/routes/folders/create.ts
  - apps/api/src/routes/folders/delete.ts
  - apps/api/src/routes/folders/list.ts
  - apps/api/src/routes/folders/update.ts
  - apps/api/src/routes/notes/batch-create.ts
  - apps/api/src/routes/notes/create.ts
  - apps/api/src/routes/notes/delete-all.ts
  - apps/api/src/routes/notes/delete.ts
  - apps/api/src/routes/notes/list.ts
  - apps/api/src/routes/notes/search.ts
  - apps/api/src/routes/notes/update.ts
  - apps/api/src/routes/conversations/messages.ts
  - packages/wire-schemas/src/conversations.ts
  - apps/api/tests/unit/routes/folders/locker-04-schema.test.ts
  - apps/api/tests/unit/routes/notes/locker-04-schema.test.ts
  - apps/api/src/routes/conversations/__tests__/messages-role-contract.test.ts
  - apps/api/src/routes/conversations/__tests__/messages-metadata-contract.test.ts
  - apps/api/src/routes/notes/__tests__/delete-all-error-envelope.test.ts
  - packages/wire-schemas/src/__tests__/conversations.test.ts
  - .planning/phases/64-high-findings-api-routes-conversations/verify-first.log
  - .planning/review/api-routes-conversations.md
  - .planning/review/REVIEW-INDEX.md
autonomous: false
requirements: ["H-1", "H-2", "H-3", "H-4"]

must_haves:
  truths:
    - "H-1: each of the 12 folders/** + notes/** route declarations carries an explicit declarative `schema:` block; a route-introspection test asserts `routeOptions.schema` is present for all 12; tools/lint-prod-readiness.ts (LOCKER-04) reports zero NO-SCHEMA findings for these files."
    - "H-1: the Fastify-compiled validator runs the SAME Zod schema the handler validated inline — moving validation to the declarative `schema:` block does not regress validation coverage (a malformed body/querystring still rejects with the canonical envelope)."
    - "H-2: server `conversations/messages.ts` role enum and canonical `packages/wire-schemas` `ConversationRoleSchema` agree — no enum value is accepted by one and rejected by the other; the advisor-chosen disposition is recorded in the SUMMARY."
    - "H-3: server `conversations/messages.ts` `metadata` field uses the canonical `MetadataSchema` imported from `@openwhispr/wire-schemas` (not an ad-hoc looser `z.record(z.string(), z.unknown())`); a nested-object metadata value is rejected at the route boundary."
    - "H-4: `notes/delete-all.ts` over-limit failure throws `ValidationError` so `setErrorHandler` emits the canonical `{error:{code,message}}` envelope — the 400 response `error` field is an object, not a plain string."
    - "LOCKER-04 + the other 7 lockers green (`pnpm lint:lockers`); `pnpm typecheck` shows no new errors vs the 5-error baseline; `@openwhispr/api` + `@openwhispr/wire-schemas` test suites green."
  artifacts:
    - path: ".planning/phases/64-high-findings-api-routes-conversations/verify-first.log"
      provides: "per-finding verify-first determination — still-live/already-closed with file:line evidence for H-1..H-4, plus the H-2 advisor decision record"
      contains: "H-1"
    - path: ".planning/review/api-routes-conversations.md"
      provides: "per-finding closure markers appended to H-1..H-4"
      contains: "CLOSED"
  key_links:
    - from: "apps/api/src/routes/folders/*.ts + notes/*.ts (12 routes)"
      to: "app.route({ schema: { body|querystring }, ... })"
      via: "declarative schema block wiring the existing inline Zod schema"
      pattern: "schema:"
    - from: "apps/api/src/routes/conversations/messages.ts"
      to: "MetadataSchema from @openwhispr/wire-schemas"
      via: "import + use in MessageInputSchema.metadata field"
      pattern: "MetadataSchema"
    - from: "apps/api/src/routes/notes/delete-all.ts"
      to: "ValidationError"
      via: "throw new ValidationError(CODE, msg) replacing reply.code(400).send({error:string})"
      pattern: "ValidationError"
---

<objective>
Clear the four HIGH findings in the `apps/api` conversations / folders / notes
route surface (`.planning/review/api-routes-conversations.md`, H-1..H-4):

- H-1 — LOCKER-04 inv-14 violation: 12 `folders/**` + `notes/**` route
  declarations register only `config: { rateLimit }`; the declarative
  `schema:` key is absent.
- H-2 — wire-schema drift: server `MessageRoleSchema` accepts `role:"tool"`,
  canonical `ConversationRoleSchema` (and `CloudMessageSchema`, the OUTPUT
  contract) does not. CONTRACT decision — resolved by a `gsd-advisor-researcher`
  checkpoint.
- H-3 — wire-schema drift: server `metadata` accepts any
  `Record<string,unknown>`; canonical `MetadataSchema` constrains
  keys/values/size. Straight fix — adopt the canonical schema.
- H-4 — `notes/delete-all.ts` emits a non-canonical 400 envelope
  (string-valued `error` field).

Each finding is re-verified against current `main` BEFORE any fix
(CLAUDE.md hard rule 3). Each live finding is closed via strict RED→GREEN TDD;
H-1's mechanical 12-route fix is one coherent task with a route-introspection
RED test asserting `schema:` presence across all 12.

Purpose: remove four pre-publication wire-contract / structural-discipline
defects so the conversations/folders/notes surface is byte-for-byte
contract-aligned (D-22) and LOCKER-04-compliant ahead of the Phase 41
WARN→BLOCKING flip.

Output: per-finding RED+GREEN atomic commit pairs (test + production code in
the same commit acceptable), a `verify-first.log` evidence + advisor-decision
record, and `.planning/review/api-routes-conversations.md` + `REVIEW-INDEX.md`
annotated with per-finding closure markers.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/64-high-findings-api-routes-conversations/CONTEXT.md
@.planning/review/api-routes-conversations.md
@CLAUDE.md

Already-read source (facts captured below — do NOT re-read to "check one
more thing"; use Grep for anything more specific):

- **H-1 — all 12 routes STILL LIVE.** Every `folders/**` + `notes/**` route
  declaration has `config: { rateLimit: {...} }` but NO `schema:` key.
  The `conversations/**` family already complies (see
  `conversations/messages.ts:103` `schema: { body: MessageInputSchema }`,
  `:166` `schema: { querystring: MessagesListQuerySchema }`). The 12 routes
  and the schema each handler already `.parse()`s inline:
  - `folders/create.ts:30` POST — `FolderInputSchema` (from `@openwhispr/wire-schemas`), `.parse(req.body)` at `:38` → **body**
  - `folders/batch-create.ts:41` POST — `BatchCreateBodySchema` (inline `z.union`, `:29`), `.parse` at `:49` → **body**
  - `folders/delete.ts:36` DELETE — `DeleteBodySchema` (inline `z.object`, `:25`), `.parse` at `:43` → **body**
  - `folders/update.ts:49` PATCH — `UpdateBodySchema` (inline `z.object`, `:25`), `.parse` at `:56` → **body**
  - `folders/list.ts:39` GET — `parseListQuery((req.query) as ListQuery)` at `:52`; NO declared zod querystring schema → **querystring** (needs a new inline `z.object({limit,before,since}).optional`-shape schema, mirror `MessagesListQuerySchema`)
  - `notes/create.ts:32` POST — `NoteInputSchema` (from `@openwhispr/wire-schemas`) → **body**
  - `notes/batch-create.ts:49` POST — `BatchCreateBodySchema` (inline `z.union`, `:37`) → **body**
  - `notes/delete.ts:33` DELETE — `DeleteBodySchema` (inline `z.object`, `:22`) → **body**
  - `notes/update.ts:90` PATCH — `UpdateBodySchema` (inline `z.object`, `:44`) → **body**
  - `notes/search.ts:48` POST — `SearchRequestSchema` (inline `z`, `:30`) → **body**
  - `notes/list.ts:39` GET — `parseListQuery` (same shape as folders/list) → **querystring** (needs a new inline querystring schema)
  - `notes/delete-all.ts:34` DELETE — **body-less** (no `.parse()` at all). LOCKER-04 still requires a `schema:` key.
- **`tools/lint-prod-readiness.ts:246`** — the linter check is
  `findProperty(opts, "schema") === null` → NO-SCHEMA finding. ANY `schema:`
  property (including `schema: { body: z.object({}).strict() }` or
  `schema: { querystring: SomeSchema }`) satisfies the structural rule.
  For `notes/delete-all.ts` (body-less DELETE) a `schema: { body: z.object({}).strict() }`
  empty-body schema satisfies LOCKER-04 — confirmed by the linter logic
  (it checks key presence, not key shape).
- **`MessageRoleSchema`** — `conversations/messages.ts:63`
  `z.enum(["user","assistant","system","tool"])`. The handler stores
  `role: body.role` verbatim (`messages.ts:135`) — there is NO server-side
  special handling of `"tool"`; `conversations/shape.ts` treats `role` as a
  bare `string`. Nothing in `apps/api` REQUIRES `"tool"` — it is an
  unilateral enum widening. **H-2 STILL LIVE.**
- **`ConversationRoleSchema`** — `packages/wire-schemas/src/conversations.ts:19`
  `z.enum(["user","assistant","system"])` (no `"tool"`); consumed by
  `CloudMessageSchema:62` (the OUTPUT contract). Exported from the package
  (`index.ts:13` re-exports `./conversations.js`).
- **`MetadataSchema`** — `packages/wire-schemas/src/conversations.ts:21` —
  `z.record(z.string().min(1).max(64), z.union([z.string().max(1024), z.number(), z.boolean()]))`
  + a `.refine` 4 KiB stringified-size cap. **CRITICAL: it is declared
  `const MetadataSchema` — NOT `export`ed.** H-3's fix MUST first add the
  `export` keyword so the server can `import { MetadataSchema }`.
- **Server `metadata`** — `conversations/messages.ts:70`
  `metadata: z.record(z.string(), z.unknown()).nullable().optional()` — accepts
  nested objects/arrays. Only the 4 KiB envelope is re-checked at runtime
  (`:112-115`). **H-3 STILL LIVE.**
- **`notes/delete-all.ts:84-88`** — `reply.code(400).send({ error: "<plain string>" })`.
  Every sibling 400 throws `new ValidationError(CODE, msg)` (e.g.
  `messages.ts:114` `throw new ValidationError("METADATA_TOO_LARGE", ...)`,
  `folders/batch-create.ts` `BATCH_TOO_LARGE`). **H-4 STILL LIVE.**
- **`apps/api/src/errors.ts:57-66`** — `ValidationError` constructor is
  variadic: `new ValidationError(code?, message?)` — the two-arg form
  `new ValidationError("CODE", "msg")` sets a per-site i18n code; the
  centralized `setErrorHandler` (Phase 02 `errors.ts` family) emits the
  canonical `{error:{code,message}}` envelope. `ValidationError` maps to 400.

<interfaces>
Fastify declarative schema block (what LOCKER-04 inv-14 + the linter want):
  app.route({
    method, url,
    schema: { body: <ZodSchema> } | { querystring: <ZodSchema> } | { params: <ZodSchema> },
    config: { rateLimit: { max, timeWindow } },
    handler,
  });
The `conversations/**` family is the in-repo reference: every route lists
`schema: { body|querystring }`. The handler MAY still `.parse()` inline since
the project's stock ZodCompiler is not globally attached (see
`messages.ts:101-103` comment — "handler still calls `.parse()` since
Fastify's stock ZodCompiler is not attached"). Therefore the safe H-1 shape
is: ADD the declarative `schema:` block referencing the SAME schema, KEEP the
inline `.parse()` — zero validation-coverage risk, identical to how the
already-compliant `conversations/messages.ts` does it. Do NOT drop the inline
`.parse()` (the compiled validator is not wired, so dropping it WOULD
regress).

packages/wire-schemas — ConversationRoleSchema, CloudMessageSchema,
CloudConversationWithMessagesSchema are exported via `index.ts`.
MetadataSchema is NOT yet exported (H-3 adds the `export` keyword).

apps/api/src/errors.ts:
  new ValidationError(code: string, message: string)  -> 400 via setErrorHandler
</interfaces>

apps/api unit route tests use a hand-rolled fake `TransactionalDb` (Drizzle
SQL-chunk introspection) + an in-process `EnvKeyProvider` — NO HTTP/internal
mocks (CLAUDE.md: mocks only at process/network boundaries). Route-behaviour
tests register the real `build*Routes` plugin on
`Fastify({ logger: false })` + `registerErrorHandler(app)` and drive
`app.inject`. Pure schema-shape tests (`packages/wire-schemas`,
route-introspection) need no DB at all. The route-introspection RED for H-1
captures `routeOptions` via an `onRoute` hook (the established pattern from
`tests/unit/routes/plan-51-12c-locker-04-conversations.test.ts`).
</context>

## Phase Goal

Close H-1..H-4 — each fixed via strict RED→GREEN TDD with the test asserting
the regression-shape (a route missing its `schema:`, a `role:"tool"`
accepted-then-unparseable, a nested-object metadata accepted, a string-valued
400 `error` field), OR confirmed already-resolved with committed evidence.
The planner's pre-determination (executor MUST re-confirm): **all four are
STILL LIVE.**

---

## Verify-first protocol (MANDATORY, all findings)

Before any fix the executor writes
`.planning/phases/64-high-findings-api-routes-conversations/verify-first.log`
and, per finding, records: **still-live / partially-mitigated / already-closed**,
with the `file:line` evidence checked:

- **H-1 — STILL LIVE.** `grep -Ln "schema:" apps/api/src/routes/folders/*.ts apps/api/src/routes/notes/*.ts`
  → expect the 12 route files listed as MISSING `schema:` (excluding
  `shape.ts`). Cross-check `conversations/messages.ts` HAS `schema:`.
- **H-2 — STILL LIVE.** `grep -n "tool" apps/api/src/routes/conversations/messages.ts`
  → `MessageRoleSchema` includes `"tool"`; `grep -n "ConversationRoleSchema" packages/wire-schemas/src/conversations.ts`
  → enum has only `user,assistant,system`.
- **H-3 — STILL LIVE.** `grep -n "metadata" apps/api/src/routes/conversations/messages.ts`
  → `:70` `z.record(z.string(), z.unknown())`; `grep -n "MetadataSchema" packages/wire-schemas/src/conversations.ts`
  → declared `const` (NOT `export`ed) at `:21`.
- **H-4 — STILL LIVE.** `grep -n "reply.code(400)" apps/api/src/routes/notes/delete-all.ts`
  → `:85` `.send({ error: \`...\` })` string-valued.

If any grep contradicts this (a fix is already present), STOP, treat that
finding as already-closed, record the evidence in `verify-first.log`, skip its
RED/GREEN task, and report the divergence in the SUMMARY.

Commit the log: `docs(64-01): verify-first — H-1..H-4 disposition log`.

---

## Task 1 — H-1: declarative `schema:` on the 12 folders/** + notes/** routes

**Finding:** H-1 (HIGH) — 12 route declarations carry `config: { rateLimit }`
only; LOCKER-04 inv-14 requires `schema: { body|querystring|params: <ZodSchema> }`.

**Fix shape (mechanical, identical per route-class):** ADD a declarative
`schema:` block referencing the SAME Zod schema the handler already
`.parse()`s. KEEP the inline `.parse()` (the stock ZodCompiler is not wired —
see the `conversations/messages.ts:101-103` rationale comment — so the inline
`.parse()` is what actually validates; the declarative block satisfies the
structural invariant and gives Fastify the schema for introspection). This is
exactly how the already-compliant `conversations/**` family is built. Dropping
the inline `.parse()` is FORBIDDEN — it would regress validation coverage.

Per-route-class handling:

- **body routes (8):** `folders/{create,batch-create,delete,update}.ts`,
  `notes/{create,batch-create,delete,update,search}.ts` — add
  `schema: { body: <ExistingSchema> }` where `<ExistingSchema>` is the schema
  the handler already `.parse()`s (`FolderInputSchema`, `NoteInputSchema`,
  `BatchCreateBodySchema`, `DeleteBodySchema`, `UpdateBodySchema`,
  `SearchRequestSchema`). No schema redefinition — reuse the existing binding.
- **querystring routes (2):** `folders/list.ts`, `notes/list.ts` — these have
  NO declared zod querystring schema today (`parseListQuery` is called on a
  bare `ListQuery` interface). Add an inline
  `const ListQuerySchema = z.object({ limit: z.string().optional(), before: z.string().optional(), since: z.string().optional() }).strict();`
  (mirror `MessagesListQuerySchema` in `conversations/messages.ts:79-86`),
  add `schema: { querystring: ListQuerySchema }`, and KEEP the existing
  `parseListQuery` call (it produces the keyset-pagination typed value the
  handler needs — the new schema is the surface guard, `parseListQuery` the
  semantic parse, exactly the `messages.ts` pattern).
- **body-less route (1):** `notes/delete-all.ts` — DELETE with no payload.
  Add `schema: { body: z.object({}).strict() }` (empty-body schema). The
  linter checks `schema:` key presence, not shape — confirmed from
  `lint-prod-readiness.ts:246`. Add a one-line comment: empty-body schema
  satisfies LOCKER-04 inv-14 for a payload-less DELETE.

### RED step
- New file: `apps/api/tests/unit/routes/folders/locker-04-schema.test.ts` and
  `apps/api/tests/unit/routes/notes/locker-04-schema.test.ts`. Test names MUST
  contain `H-1`.
- Route-introspection RED: for each `build*Routes` plugin in `folders/**` and
  `notes/**`, register it on a Fastify instance with an `onRoute` hook that
  captures `routeOptions`. Assert, per route, that `routeOptions.schema` is a
  defined object with at least one of `body` / `querystring` / `params`.
  Pre-fix: `routeOptions.schema` is `undefined` for all 12 → RED fails.
- Validation-coverage GUARD (second assertion, post-fix regression guard —
  mark clearly it is NOT the RED driver): for one body route per family
  (e.g. `folders/create`, `notes/create`) and one querystring route
  (`folders/list`), drive `app.inject` with a deliberately malformed payload
  (a body route: an extra unknown key violating `.strict()`; the querystring
  route: a non-string `limit` shape that the schema rejects) and assert the
  response is a 4xx with the canonical `{error:{code,message}}` envelope —
  proving validation still runs after the fix.
- Commit: `test(64-01): red — H-1 folders/notes routes missing declarative schema`.

### GREEN step
- Edit all 12 route files per the per-route-class shape above. Pure additive
  config change for the 10 routes whose schema already exists; the 2 list
  routes additionally gain a small inline `ListQuerySchema`.
- For `notes/delete-all.ts` add the empty-body schema + the explanatory
  comment.
- Update each route file's header docstring where it documents the route
  shape, to note the declarative `schema:` is now present (one line; do not
  rewrite the docstrings).
- Do NOT touch any handler logic; do NOT drop any inline `.parse()`.
- Commit: `fix(64-01): green — H-1 add declarative schema to 12 folders/notes routes`.

### Verify
```
grep -Ln "schema:" apps/api/src/routes/folders/*.ts apps/api/src/routes/notes/*.ts   # 12 route files now MATCH
node --import tsx tools/lint-prod-readiness.ts   # or: pnpm lint:lockers — zero NO-SCHEMA for folders/notes
pnpm --filter @openwhispr/api test -- locker-04-schema
pnpm --filter @openwhispr/api test -- folders notes
pnpm lint:lockers
```

### Done
H-1 RED+GREEN pair on `main`; all 12 `folders/**` + `notes/**` routes carry a
declarative `schema:` block wiring their existing Zod schema; LOCKER-04
NO-SCHEMA findings cleared for these files; the validation-coverage guard
proves a malformed payload still rejects; `@openwhispr/api` suite green.

---

## Task 2 — H-2 contract-decision advisor checkpoint (MANDATORY, before any H-2 code)

**Finding:** H-2 (HIGH) — server `MessageRoleSchema` accepts `role:"tool"`;
canonical `ConversationRoleSchema` + `CloudMessageSchema` (the OUTPUT contract)
do not → a desktop client round-tripping the server response through
`CloudMessageSchema.parse` rejects any `role:"tool"` message the server stored.

This is a CONTRACT decision and a grey area — resolve it via a
`gsd-advisor-researcher` BEFORE writing any H-2 code.

<task type="checkpoint:decision" gate="blocking">
  <decision>H-2 resolution: how to reconcile the server `MessageRoleSchema` `"tool"` value with the canonical `ConversationRoleSchema`.</decision>
  <context>
The server's POST /api/conversations/messages accepts role ∈
{user,assistant,system,tool}. The canonical `packages/wire-schemas`
`ConversationRoleSchema` is {user,assistant,system}, and `CloudMessageSchema`
(the byte-for-byte OUTPUT contract per D-22) uses it. The server has NO
special handling of `"tool"` — the handler stores `role` verbatim. The
upstream desktop client repo `/Users/nick/openwhispr` is READ-ONLY for us.
Before this checkpoint runs, the executor MUST spawn a `gsd-advisor-researcher`
to investigate (does the upstream `ConversationsService.ts` interface use
`"tool"`? is there `BACKEND_SPEC.md` / `OAUTH_SPEC.md` evidence for tool-role
messages?) and surface the RECOMMENDED option first with rationale.
  </context>
  <options>
    <option id="option-a">
      <name>Drop "tool" from the server's MessageRoleSchema (align server DOWN to the canonical contract)</name>
      <pros>Single edit, server-only, no upstream client coordination needed. CLAUDE.md: "every endpoint matches BACKEND_SPEC byte-for-byte" — the canonical wire-schema is the contract; the server adding an enum value unilaterally IS the drift. Recommended UNLESS the advisor finds evidence the desktop actually persists tool-role messages.</pros>
      <cons>If a future feature genuinely needs tool-role messages, the enum must be re-widened (in both repos) later.</cons>
    </option>
    <option id="option-b">
      <name>Add "tool" to packages/wire-schemas ConversationRoleSchema (align the canonical contract UP)</name>
      <pros>Keeps the server's existing behaviour; correct IF the advisor finds the desktop client legitimately uses tool-role messages.</pros>
      <cons>Requires a coordinated upstream change: the client `ConversationsService.ts` interface must follow. The client repo is READ-ONLY — we can only edit `packages/wire-schemas` and must FLAG the required upstream change in the SUMMARY; we MUST NOT touch `/Users/nick/openwhispr`.</cons>
    </option>
  </options>
  <resume-signal>Select: option-a or option-b. The executor records the advisor's recommendation + the chosen option + rationale in verify-first.log under the H-2 entry.</resume-signal>
</task>

### Action
- Spawn a `gsd-advisor-researcher` to investigate the two options; surface the
  recommended option first with rationale.
- Present the A/B decision; on resume, record the advisor recommendation, the
  chosen option, and the rationale in `verify-first.log` under H-2.
- No production code in this task.

### Done
H-2 fix-shape decided and recorded: option-a (drop `"tool"` server-side) or
option-b (add `"tool"` to wire-schemas + FLAG upstream). The advisor's
recommendation is documented.

---

## Task 3 — H-2: apply the chosen reconciliation

**Finding:** H-2 (HIGH) — fix per the Task 2 decision.

### RED step
- New file: `apps/api/src/routes/conversations/__tests__/messages-role-contract.test.ts`.
  Test name MUST contain `H-2`.
- The RED asserts the regression-shape: the server-accepted role enum and the
  canonical `ConversationRoleSchema` must NOT disagree. Concretely — register
  `buildConversationsMessagesRoutes` on a Fastify instance with the fake DB
  (an existing conversation owned by the test user), POST a message with
  `role:"tool"`, then:
  - **if option-a chosen:** assert the POST is REJECTED at the boundary (400,
    canonical envelope) — pre-fix it is accepted (the server enum has `"tool"`)
    → RED fails. ALSO a pure-unit assertion: import the server
    `MessageInputSchema` (or re-derive) and `CloudMessageSchema` from
    `@openwhispr/wire-schemas` and assert every role the server accepts also
    parses under `ConversationRoleSchema` — pre-fix `"tool"` breaks it.
  - **if option-b chosen:** the RED lives in
    `packages/wire-schemas/src/__tests__/conversations.test.ts` — assert
    `ConversationRoleSchema.parse("tool")` succeeds and
    `CloudMessageSchema.parse({...role:"tool"...})` succeeds — pre-fix both
    throw → RED fails.
- Commit: `test(64-01): red — H-2 role enum drift between server and wire-schema`.

### GREEN step
- **If option-a:** `conversations/messages.ts:63` — change `MessageRoleSchema`
  to `z.enum(["user","assistant","system"])` (drop `"tool"`). Update the
  route's header docstring where it documents the body shape. Server-only
  edit; do NOT touch `packages/wire-schemas`.
- **If option-b:** `packages/wire-schemas/src/conversations.ts:19` — add
  `"tool"` to `ConversationRoleSchema`. Do NOT touch the server
  `MessageRoleSchema` (it stays consistent). Do NOT touch
  `/Users/nick/openwhispr`. The SUMMARY MUST FLAG: the upstream client
  `ConversationsService.ts` role interface must be widened to match — this is
  a required follow-up the client-repo owner must apply.
- Commit: `fix(64-01): green — H-2 reconcile role enum (<option-a|option-b>)`.

### Verify
```
grep -n "tool" apps/api/src/routes/conversations/messages.ts packages/wire-schemas/src/conversations.ts
pnpm --filter @openwhispr/api test -- messages-role-contract
pnpm --filter @openwhispr/wire-schemas test
pnpm lint:lockers
```

### Done
H-2 RED+GREEN pair on `main`; the server role enum and the canonical
`ConversationRoleSchema` agree; the advisor decision + (if option-b) the
upstream-client follow-up flag are recorded in the SUMMARY.

---

## Task 4 — H-3: server `metadata` adopts the canonical `MetadataSchema`

**Finding:** H-3 (HIGH) — `conversations/messages.ts:70` `metadata` field is
`z.record(z.string(), z.unknown())` (accepts nested objects/arrays); the
canonical `MetadataSchema` constrains keys (1..64), values (string ≤1024 /
number / boolean), and 4 KiB stringified size. NOT grey-area: adopt the
canonical schema. **Note: `MetadataSchema` is currently `const` (not
exported) — the fix MUST add the `export` keyword first.**

### RED step
- New file: `apps/api/src/routes/conversations/__tests__/messages-metadata-contract.test.ts`.
  Test name MUST contain `H-3`.
- Register `buildConversationsMessagesRoutes` + the fake DB (existing
  conversation owned by the test user) + `registerErrorHandler`. POST a
  message with `metadata: { evil: { nested: [{ deep: true }] } }` (a nested
  object value the canonical `MetadataSchema` rejects but the server's
  `z.unknown()` accepts). Assert the response is a 4xx with the canonical
  `{error:{code,message}}` envelope. Pre-fix the server accepts it (stores it,
  returns 201) → RED fails.
- Second assertion (pure-unit, regression guard): import `MetadataSchema` from
  `@openwhispr/wire-schemas` and assert it parses a flat scalar map and
  rejects a nested-object value — proves the canonical schema is the one now
  in force. (Pre-fix this assertion fails to even import — `MetadataSchema` is
  not exported — so it doubles as the export-needed RED signal.)
- Commit: `test(64-01): red — H-3 server metadata accepts non-canonical shape`.

### GREEN step
- `packages/wire-schemas/src/conversations.ts:21` — add the `export` keyword:
  `export const MetadataSchema = ...`. (Re-exported automatically via
  `index.ts:13`.)
- `conversations/messages.ts` — import `MetadataSchema` from
  `@openwhispr/wire-schemas`; change the `MessageInputSchema.metadata` field
  (`:70`) from `z.record(z.string(), z.unknown()).nullable().optional()` to
  `MetadataSchema.nullable().optional()`.
- The runtime 4 KiB `Buffer.byteLength` check at `:111-115` is now redundant
  with `MetadataSchema`'s `.refine` size cap — KEEP it (defence-in-depth;
  removing it touches handler logic and risks regressing the existing
  `METADATA_TOO_LARGE` test). Add a one-line comment noting the cap is now
  also enforced at the schema layer.
- Update the route header docstring where it documents the `metadata` field.
- Commit: `fix(64-01): green — H-3 server metadata adopts canonical MetadataSchema`.

### Verify
```
grep -n "MetadataSchema" apps/api/src/routes/conversations/messages.ts packages/wire-schemas/src/conversations.ts
pnpm --filter @openwhispr/api test -- messages-metadata-contract
pnpm --filter @openwhispr/api test -- messages
pnpm --filter @openwhispr/wire-schemas test
pnpm lint:lockers
```

### Done
H-3 RED+GREEN pair on `main`; `MetadataSchema` is exported from
`@openwhispr/wire-schemas`; the server `metadata` field uses it; a
nested-object metadata value is rejected at the route boundary.

---

## Task 5 — H-4: `notes/delete-all.ts` canonical 400 envelope

**Finding:** H-4 (HIGH) — `notes/delete-all.ts:85-87`
`reply.code(400).send({ error: "<plain string>" })` emits a STRING-valued
`error` field, not the canonical `{error:{code,message}}` envelope.

### RED step
- New file: `apps/api/src/routes/notes/__tests__/delete-all-error-envelope.test.ts`.
  Test name MUST contain `H-4`.
- Register `buildNotesDeleteAllRoutes` + the fake DB + `registerErrorHandler`.
  Arrange the fake DB so the `COUNT(*)` returns a value `> MAX_INLINE_PURGE`
  (1000) so the over-limit branch fires. `DELETE /api/notes/delete-all`,
  assert: status 400 AND `body.error` is an OBJECT with `code` (string) and
  `message` (string) — NOT a plain string. Pre-fix `body.error` is a plain
  string → `typeof body.error === "object"` fails → RED fails.
- Commit: `test(64-01): red — H-4 delete-all 400 emits string-valued error`.

### GREEN step
- `apps/api/src/routes/notes/delete-all.ts:84-88` — replace the
  `reply.code(400).send({ error: ... })` with
  `throw new ValidationError("DELETE_ALL_TOO_LARGE", \`delete-all exceeds ${MAX_INLINE_PURGE} rows; please delete in batches\`);`.
  Import `ValidationError` from `../../errors.js` (alongside the existing
  `AuthError` import). Pick a stable SCREAMING_SNAKE code consistent with the
  sibling sites (`METADATA_TOO_LARGE`, `BATCH_TOO_LARGE`) — `DELETE_ALL_TOO_LARGE`.
- The over-limit branch currently returns `{ exceeded: true, count }` from the
  `withTenant` callback and the route then `reply.code(400)`s. Restructure
  minimally: either throw the `ValidationError` from inside the `withTenant`
  callback (it propagates out — `setErrorHandler` catches it), or keep the
  `{exceeded}` return and `throw` after the callback. Throwing after the
  callback is the smaller diff — keep the existing return-shape, replace only
  the `reply.code(400).send(...)` with the `throw`.
- Update the route header docstring (`:8`) — the `400` line now says it emits
  the canonical envelope via `ValidationError`.
- M-1 is OUT OF SCOPE (the 4 keyset-parse `reply.code(400).send({error:string})`
  sites are MEDIUM). Do NOT scope-creep — the executor MAY note in the SUMMARY
  that those sites share the anti-pattern, but MUST NOT fix them here.
- Commit: `fix(64-01): green — H-4 delete-all throws ValidationError for canonical 400`.

### Verify
```
grep -n "ValidationError\|reply.code(400)" apps/api/src/routes/notes/delete-all.ts
pnpm --filter @openwhispr/api test -- delete-all-error-envelope
pnpm --filter @openwhispr/api test -- delete-all
pnpm lint:lockers
```

### Done
H-4 RED+GREEN pair on `main`; `notes/delete-all.ts` over-limit failure throws
`ValidationError` so the 400 response carries the canonical
`{error:{code,message}}` envelope.

---

## Task 6 — annotate the review artifacts (FINAL TASK)

After Tasks 1–5 are green/verified:

- `.planning/review/api-routes-conversations.md` — append a closure marker
  line under each of H-1..H-4:
  - H-1: `**Status:** CLOSED 2026-05-20 — Phase 64, commit <green-sha> — declarative schema added to all 12 folders/notes routes.`
  - H-2: `**Status:** CLOSED 2026-05-20 — Phase 64, commit <green-sha> — <option-a|option-b> per advisor; <if option-b: upstream ConversationsService.ts change FLAGGED>.`
  - H-3: `**Status:** CLOSED 2026-05-20 — Phase 64, commit <green-sha> — server metadata adopts canonical MetadataSchema (now exported).`
  - H-4: `**Status:** CLOSED 2026-05-20 — Phase 64, commit <green-sha> — canonical ValidationError envelope.`
- `.planning/review/REVIEW-INDEX.md` — update the `apps/api routes —
  conversations` table row and summary line to reflect HIGH = 4 cleared
  (mirror how `api-routes-rest` HR-01..HR-03 closures are marked from Phase 63).
- Commit: `docs(64-01): annotate api-routes-conversations review with H-1..H-4 closure`.

### Done
Both review artifacts carry per-finding closure markers; `git log` shows the
annotation commit.

---

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client request body/querystring → folders/notes route handler | Untrusted payload crosses into 12 routes whose declarative validation contract is currently absent (H-1). |
| client request body → conversations/messages route | A `role` / `metadata` value crosses a server schema looser than the published wire contract (H-2, H-3). |
| server 400 response → desktop client error parser | A non-canonical error envelope crosses back to a client that expects `{error:{code,message}}` (H-4). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-64-01 | Tampering | 12 folders/** + notes/** routes | mitigate | Task 1 adds the declarative `schema:` block so the route's validation contract is structurally explicit and LOCKER-04-auditable; the inline `.parse()` is preserved so no validation-coverage gap opens. |
| T-64-02 | Tampering / Repudiation | conversations/messages.ts role enum | mitigate | Task 3 reconciles the server role enum with the canonical contract so a client cannot persist a message the OUTPUT contract later rejects (a silent round-trip-poison). |
| T-64-03 | Tampering / Denial of Service | conversations/messages.ts metadata field | mitigate | Task 4 adopts the canonical `MetadataSchema` — nested-object/array metadata (a JSON-shape the wire contract forbids) is rejected at the route boundary, not stored-then-unparseable. |
| T-64-04 | Information disclosure (contract) | notes/delete-all.ts 400 path | mitigate | Task 5 routes the 400 through `ValidationError` + `setErrorHandler` so the envelope shape is uniform and a client error parser cannot mis-handle the only documented failure mode. |
</threat_model>

<verification>
Phase-level gate (run after all tasks):

```
pnpm --filter @openwhispr/api test
pnpm --filter @openwhispr/wire-schemas test
pnpm lint:lockers          # 8 lockers green — esp. LOCKER-04 (the 12
                           # folders/notes routes now carry schema:)
pnpm typecheck             # no NEW errors vs the documented 5-error baseline
git log --oneline -14      # verify-first log + RED/GREEN pairs for H-1..H-4
                           # + the doc annotation commit
```

Spot-check (CLAUDE.md hard rule 3 — verify, do not relay):
- `grep -rn "H-1\|H-2\|H-3\|H-4" apps/api packages/wire-schemas --include="*.test.ts"`
  — every fixed finding has a test referencing its ID.
- `grep -Ln "schema:" apps/api/src/routes/folders/*.ts apps/api/src/routes/notes/*.ts`
  — the 12 route files all MATCH (no MISSING).
- `grep -n "tool" apps/api/src/routes/conversations/messages.ts packages/wire-schemas/src/conversations.ts`
  — server enum and canonical enum agree.
- `grep -n "export const MetadataSchema" packages/wire-schemas/src/conversations.ts`
  — present; `grep -n "MetadataSchema" apps/api/src/routes/conversations/messages.ts`
  — imported + used.
- `grep -n "ValidationError" apps/api/src/routes/notes/delete-all.ts` — present;
  no `reply.code(400).send` remains.
- Each cited commit SHA is on HEAD; `git status --short` clean.
- `verify-first.log` exists, is committed, records a disposition for all of
  H-1..H-4 plus the H-2 advisor decision.
- `.planning/review/api-routes-conversations.md` + `REVIEW-INDEX.md` carry the
  closure markers.
</verification>

<success_criteria>
- H-1: RED+GREEN pair — all 12 `folders/**` + `notes/**` routes carry a
  declarative `schema:` block; the introspection test passes; the
  validation-coverage guard proves a malformed payload still rejects.
- H-2: advisor checkpoint resolved; RED+GREEN pair — server role enum and
  canonical `ConversationRoleSchema` agree; if option-b, the upstream-client
  follow-up is FLAGGED in the SUMMARY and `/Users/nick/openwhispr` is untouched.
- H-3: RED+GREEN pair — `MetadataSchema` exported from `@openwhispr/wire-schemas`;
  server `metadata` field uses it; a nested-object metadata value is rejected.
- H-4: RED+GREEN pair — `notes/delete-all.ts` 400 path throws `ValidationError`;
  the 400 `error` field is an object, not a string.
- `pnpm --filter @openwhispr/api test` + `@openwhispr/wire-schemas test` green;
  `pnpm lint:lockers` green (8); `pnpm typecheck` no new errors vs the 5-error
  baseline.
- `.planning/review/api-routes-conversations.md` + `REVIEW-INDEX.md` annotated
  with per-finding closure markers.
- No skipped tests, no `.only`, no `@ts-expect-error` without `issue-NNNN:`.
- No `as any` / `as unknown as` / `@ts-ignore` introduced; no production code
  edited solely to green a test (CLAUDE.md hard rule 1).
- No gitleaks hook bypass (CLAUDE.md hard rule 4).
</success_criteria>

<risk_register>
| Risk | Task | Mitigation |
|------|------|------------|
| A grep contradicts the planner's still-live determination. | verify-first | Treat that finding as already-closed, record evidence in verify-first.log, skip its RED/GREEN, report the divergence in the SUMMARY. |
| H-1: dropping an inline `.parse()` regresses validation because the stock ZodCompiler is not wired. | 1 | The plan FORBIDS dropping the inline `.parse()` — only ADD the declarative `schema:`. The validation-coverage guard assertion proves a malformed payload still rejects post-fix. |
| H-1: `folders/list` / `notes/list` have no existing querystring zod schema to reference. | 1 | The plan instructs adding a small inline `ListQuerySchema` mirroring the existing `MessagesListQuerySchema`; `parseListQuery` is kept as the semantic parse. |
| H-1: the linter rejects an empty-body schema on `notes/delete-all.ts`. | 1 | Confirmed from `lint-prod-readiness.ts:246` — the check is `findProperty(opts,"schema")===null`; any `schema:` key (incl. `{ body: z.object({}).strict() }`) satisfies it. |
| H-2: the advisor recommendation and the user's checkpoint choice diverge. | 2,3 | The checkpoint is `gate="blocking"` — the user's selection is authoritative; the executor records both the advisor recommendation and the chosen option in verify-first.log. |
| H-2 option-b: temptation to edit the read-only client repo. | 3 | The plan explicitly forbids touching `/Users/nick/openwhispr`; the upstream change is FLAGGED in the SUMMARY only. |
| H-3: `MetadataSchema` is not exported — the server import fails. | 4 | The GREEN step's FIRST action is adding the `export` keyword in `packages/wire-schemas/src/conversations.ts`. |
| H-3: adopting the tighter `MetadataSchema` breaks an existing `messages` test that posted loose metadata. | 4 | That test asserted the looser BUG-shape — fix it to use canonical metadata (CLAUDE.md hard rule 1, genuine fix). Keep the runtime 4 KiB check to avoid touching the `METADATA_TOO_LARGE` test. |
| H-4: throwing from inside the `withTenant` callback changes control flow. | 5 | The plan picks the smaller diff — keep the `{exceeded}` return shape, replace only the `reply.code(400).send` with a `throw` after the callback. |
| typecheck regression from new imports. | 3,4,5 | `ValidationError` / `MetadataSchema` are ordinary typed exports; run `pnpm typecheck` after each task — must stay at the 5-error baseline. |
| A failing test tempts a production hack. | all | CLAUDE.md hard rule 1: the production change here IS the genuine fix; the tests assert the fix. If a HALT arises, log in `.planning/deferred-items.md` with WHY. |
</risk_register>

<output>
After completion, create
`.planning/phases/64-high-findings-api-routes-conversations/64-01-SUMMARY.md`.

In the SUMMARY, explicitly record:
- H-1: the verify-first determination; confirmation all 12 routes now carry
  `schema:`; per-route-class handling applied (8 body / 2 querystring / 1
  body-less); the validation-coverage guard outcome; the RED/GREEN commit SHAs.
- H-2: the verify-first determination; the advisor's recommendation; the
  chosen option (a or b) + rationale; if option-b, the explicit FLAG that the
  upstream `ConversationsService.ts` role interface must follow; the RED/GREEN
  commit SHAs.
- H-3: the verify-first determination; that `MetadataSchema` was exported and
  the server now imports it; the RED/GREEN commit SHAs.
- H-4: the verify-first determination; the `ValidationError` code chosen; the
  RED/GREEN commit SHAs. (Optionally note the 4 M-1 sites share the
  anti-pattern — do NOT fix them.)
- LOCKER-04 outcome — the 12 previously-schemaless routes now compliant; all 8
  lockers green.
- `pnpm typecheck` result vs the 5-error baseline.
- The final per-finding closure markers written to
  `api-routes-conversations.md` + `REVIEW-INDEX.md`.
- Any divergence from the planner's still-live pre-determination.
</output>
