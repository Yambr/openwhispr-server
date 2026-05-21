# Phase 64 — HIGH findings: api-routes-conversations (4)

## Background

Pre-publication HIGH-backlog clearance, phase-by-phase by package
(user decision 2026-05-20). Phases 62–63 cleared api-core (5) +
api-routes-rest (3). This phase clears the **`apps/api` routes —
conversations / folders / notes** HIGH cluster — 4 findings
(`.planning/review/api-routes-conversations.md`, H-1..H-4).

## The 4 HIGH findings

**Re-verify each against current code before fixing** (CLAUDE.md hard
rule 3).

### H-1 — LOCKER-04 inv-14 violation: `schema:` missing on 12 folders/notes routes
12 route declarations in `apps/api/src/routes/folders/**` +
`notes/**` register only `config: { rateLimit }` — the `schema:`
key is absent. The `conversations/**` family complies. Runtime safety
is currently preserved because the handlers call `Schema.parse(req.body)`
inline, but LOCKER-04 (DISCIPLINE inv-14) requires the declarative
`schema: { body|querystring|params: <ZodSchema> }`. Knock-on: Fastify's
schema-compiled validator never runs → rejection happens AFTER the
handler enters, not at the dispatcher.

The 12 routes: `folders/{batch-create,create,delete,list,update}.ts`,
`notes/{batch-create,create,delete-all,delete,list,search,update}.ts`.

Fix: add the declarative `schema:` block to each route, wiring the
SAME Zod schema the handler already `.parse()`s inline. Where the
handler then double-parses, the inline parse can be dropped IF the
Fastify-validated value is structurally identical (verify per route —
some handlers re-parse to get a typed value; Fastify validation +
a typed cast, or keeping a single parse, both work — choose the
cleaner per route, do not regress validation coverage).
Note `notes/delete-all.ts` is a body-less DELETE (M-4) — LOCKER-04
still wants a `schema:` entry; a `querystring`/`params` schema or an
explicit empty-body schema satisfies it. Confirm what the linter
(`tools/lint-prod-readiness.ts`) accepts for a payload-less route.

### H-2 — wire-schema drift: server `MessageRoleSchema` includes `"tool"`, canonical `ConversationRoleSchema` does not
`conversations/messages.ts:~63` — server accepts
`role ∈ {user,assistant,system,tool}`; `packages/wire-schemas/src/conversations.ts:~19`
`ConversationRoleSchema` is `{user,assistant,system}` (no `"tool"`),
and `CloudMessageSchema` (the OUTPUT contract) uses it. A desktop
client round-tripping the server response through `CloudMessageSchema.parse`
rejects any `role:"tool"` message the server stored and echoed.

**This is a CONTRACT decision — grey-area.** Two valid resolutions:
(a) the desktop contract is authoritative → drop `"tool"` from the
server's `MessageRoleSchema`; (b) `"tool"` is legitimate → add it to
`packages/wire-schemas` `ConversationRoleSchema` AND note the upstream
client `ConversationsService.ts` interface must follow. The planner
must spawn a `gsd-advisor-researcher` to decide — surface the
recommended option first. Lean (a) unless there is evidence the
desktop client actually needs `"tool"` messages (CLAUDE.md: "every
endpoint matches BACKEND_SPEC byte-for-byte" — the canonical
wire-schema is the contract; the server adding an enum value
unilaterally is the drift). The client repo is READ-ONLY for us — if
(b), we can edit `packages/wire-schemas` (server-side) but must FLAG
the required upstream client change, not make it.

### H-3 — wire-schema drift: server `metadata` accepts any `Record<string,unknown>`, canonical `MetadataSchema` constrains keys/values/size
`conversations/messages.ts:~70` — server:
`metadata: z.record(z.string(), z.unknown()).nullable().optional()`.
`packages/wire-schemas` `MetadataSchema` constrains key length (1..64),
value types (string ≤1024 / number / boolean), and total stringified
size (4 KiB). The server validates only the 4 KiB envelope, never the
key/value shape → a client can persist nested objects/arrays the
wire-schema would reject, then the response fails the desktop's
round-trip parse. Fix: the server's `messages.ts` metadata field MUST
use the canonical `MetadataSchema` from `@openwhispr/wire-schemas`
(import it, do not redefine a looser ad-hoc schema). Same root cause as
H-2 — server-side ad-hoc schema diverging from the package contract.
This one is NOT grey-area: the canonical schema is strictly tighter and
is the published contract; adopt it.

### H-4 — `notes/delete-all.ts` emits a non-canonical 400 envelope
`notes/delete-all.ts:~85-87` —
`reply.code(400).send({ error: "<plain string>" })` emits a
STRING-valued `error` field, not the canonical `{error:{code,message}}`
envelope. Every other 4xx in scope throws `new ValidationError(CODE, msg)`
so the centralized `setErrorHandler` emits the canonical shape. The 400
is the ONLY documented failure mode of this route, so a client parsing
it as `ErrorEnvelope` mis-handles it. Fix: throw
`new ValidationError(<CODE>, <message>)` instead of the inline
`reply.code(400).send(...)`. (The review's M-1 notes 3 more sites with
the same anti-pattern in keyset-parse paths — those are MEDIUM, out of
scope for this HIGH phase, but if the fix is trivially the same shape
the executor MAY note them; do not scope-creep the phase.)

## Goal

After this phase:
1. H-1..H-4 each fixed-and-verified OR confirmed already-resolved.
2. Each fix lands via strict TDD (RED→GREEN→REFACTOR), atomic commits.
3. Tests cover the regression-shape — a route missing its `schema:`,
   a `role:"tool"` accepted-then-unparseable, a nested-metadata accepted,
   a string-valued 400 `error` field — each caught.
4. `pnpm --filter @openwhispr/api test` + `@openwhispr/wire-schemas test`
   green; `pnpm lint:lockers` green (8 lockers, esp. LOCKER-04);
   `pnpm typecheck` no new errors vs the 5-error baseline.
5. `.planning/review/api-routes-conversations.md` + `REVIEW-INDEX.md`
   annotated with per-finding closure markers.

## Constraints

- **Strict TDD** — RED→GREEN→REFACTOR; test + production code atomic.
- **Verify-first** — every finding re-confirmed against current code.
- **H-2 is a contract decision** — spawn `gsd-advisor-researcher`
  before choosing; surface the recommended option first.
- **Client repo is READ-ONLY** — if H-2 resolves to "add `tool`",
  edit `packages/wire-schemas` (server-side) and FLAG the upstream
  client change; do NOT edit `/Users/nick/openwhispr`.
- **No mocks of internal logic** — DB/route tests use real Postgres via
  testcontainers; schema tests are pure-unit.
- **No bypassing gitleaks hooks** — CLAUDE.md hard rule 4.
- **Constitutional lockers green** — `pnpm lint:lockers` (8) after every
  finding. LOCKER-04 is the central one here (H-1).
- **No production code edited "to make tests pass"** — CLAUDE.md hard
  rule 1.
- **Do not regress validation coverage** — when H-1 moves a schema to
  the declarative `schema:` block and drops an inline `.parse()`, the
  payload must still be fully validated (Fastify's compiled validator
  must run the same Zod schema). Verify per route.
- **commitlint** — conventional-commit, lowercase subject, ≤ ~72 chars.
- **EN-only** source artifacts.

## Verification gate

Phase passes when:
1. H-1..H-4 each have a RED test + GREEN fix on main, OR a documented
   already-closed disposition. H-2 records the advisor decision.
2. `pnpm --filter @openwhispr/api test` + `@openwhispr/wire-schemas test`
   green.
3. `pnpm lint:lockers` green (8 lockers) — LOCKER-04 now satisfied for
   the 12 folders/notes routes.
4. `pnpm typecheck` — no new errors vs the 5-error baseline.
5. Spot-check: each fixed finding's regression test references its ID
   (H-1..H-4).
6. `git log --oneline` shows the expected RED/GREEN commits.
7. `.planning/review/api-routes-conversations.md` + `REVIEW-INDEX.md`
   annotated.

## Reference

- `.planning/review/api-routes-conversations.md` — H-1..H-4 + M/L
- `apps/api/src/routes/folders/**`, `apps/api/src/routes/notes/**`,
  `apps/api/src/routes/conversations/**`
- `packages/wire-schemas/src/conversations.ts` — `ConversationRoleSchema`,
  `MetadataSchema`, `CloudMessageSchema` (H-2, H-3)
- `apps/api/src/errors.ts` — `ValidationError` (H-4)
- `tools/lint-prod-readiness.ts` — LOCKER-04 enforcement (H-1)
- CLAUDE.md hard rules: 1, 3, 4; LOCKER-04; wire-compatibility (D-22)
- Phases 62/63 (HIGH backlog, just closed): `.planning/phases/62-*`, `63-*`
