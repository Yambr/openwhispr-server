---
phase: 65-high-findings-api-routes-transcriptions
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/routes/tokens/openai-realtime.ts
  - apps/api/src/routes/realtime.ts
  - apps/api/src/routes/agent/stream.ts
  - apps/api/src/routes/agent/web-search.ts
  - apps/api/src/lib/web-search/types.ts
  - apps/api/src/lib/web-search/tavily-adapter.ts
  - apps/api/src/lib/web-search/yandex-adapter.ts
  - apps/api/src/routes/diarization.ts
  - apps/api/src/routes/transcriptions/batch-delete.ts
  - apps/api/src/routes/transcriptions/list.ts
  - apps/api/src/routes/streaming-usage.ts
  - apps/api/tests/unit/routes/tokens/__tests__/openai-realtime-upstream-echo.test.ts
  - apps/api/tests/unit/routes/realtime/wr-03-auth-error-code.test.ts
  - apps/api/tests/unit/routes/agent/stream-wr-03-04.test.ts
  - apps/api/tests/unit/routes/agent/web-search-envvar-label.test.ts
  - apps/api/tests/unit/routes/diarization/wr-06-boundary-nonce.test.ts
  - apps/api/tests/unit/routes/diarization/wr-08-error-envelope.test.ts
  - apps/api/tests/unit/routes/transcriptions/batch-delete-wr-07-timing.test.ts
  - apps/api/tests/unit/routes/transcriptions/list-wr-10-redacted-log.test.ts
  - apps/api/tests/unit/routes/streaming-usage-wr-11-text-preview.test.ts
  - .planning/phases/65-high-findings-api-routes-transcriptions/verify-first.log
  - .planning/review/api-routes-transcriptions.md
  - .planning/review/REVIEW-INDEX.md
autonomous: true
requirements: ["WR-01", "WR-02", "WR-03", "WR-04", "WR-05", "WR-06", "WR-07", "WR-08", "WR-09", "WR-10", "WR-11"]

must_haves:
  truths:
    - "WR-01: re-verified ALREADY-CLOSED by Phase 62 HI-03 — all 7 throw sites use code+literal pairs (ServiceUnavailable(\"SERVICE_UNAVAILABLE\",\"Service temporarily unavailable\") / TypedServiceUnavailable(\"WEB_SEARCH_*\",\"Service temporarily unavailable\")); no raw `.message` reaches the wire. No fix; closure recorded with file:line evidence + a regression guard test."
    - "WR-02: openai-realtime.ts 400 path no longer echoes the raw `upstream400.upstreamBody` blob — the `upstream` field is dropped or restricted to a fixed allowlist; a crafted upstream 400 body cannot place free-form text on the wire."
    - "WR-03: realtime.ts and agent/stream.ts throw the two-arg AuthError form so `code === \"UNAUTHORIZED\"`, matching every other route in scope."
    - "WR-04: agent/stream.ts no longer double-parses the body — either the redundant `.parse()` is dropped (if `req.body` is provably Fastify-validated) or it is KEPT with a corrected comment (if the stock ZodCompiler is not attached); the executor records the determination."
    - "WR-05: provider→envvar-label metadata lives on the WebSearchProvider interface (`envVarLabel`); agent/web-search.ts reads it generically — no `provider.name === \"tavily\"` string fork remains."
    - "WR-06: diarization.ts Speaches multipart boundary uses `crypto.randomBytes` — not `Math.random()`; a regression test proves the boundary is cryptographically sourced."
    - "WR-07: transcriptions/batch-delete.ts failure path no longer leaks a measurable timing delta between all-hit and all-miss batches at large sizes."
    - "WR-08: diarization.ts inline `reply.code().send({error,jobId})` sites route through the typed-error contract; the wire envelope is the canonical `{error:<string>}` (a string); no undocumented `jobId` field; no operator-speak copy on user-facing responses."
    - "WR-09: realtime.ts `req.raw.url` mutation is addressed — the sentinel base is documented and `rawUrl` asserted relative, OR the in-place mutation is scoped/avoided; the executor's chosen disposition is recorded with rationale."
    - "WR-10: transcriptions/list.ts logs a redacted shape (`{ name }`), not the raw `err` object."
    - "WR-11: streaming-usage.ts `text_preview` is dropped from the production structured log (user STT content out of Loki)."
    - "All 8 constitutional lockers green (`pnpm lint:lockers`) after every finding; `pnpm typecheck` shows no new errors vs the 5-error baseline; `@openwhispr/api` test suite green."
  artifacts:
    - path: ".planning/phases/65-high-findings-api-routes-transcriptions/verify-first.log"
      provides: "per-finding verify-first determination — still-live / already-closed / partially-mitigated with file:line evidence for WR-01..WR-11; the WR-04 + WR-09 judgment-call records"
      contains: "WR-01"
    - path: ".planning/review/api-routes-transcriptions.md"
      provides: "per-finding closure markers appended to WR-01..WR-11"
      contains: "CLOSED"
  key_links:
    - from: "apps/api/src/routes/tokens/openai-realtime.ts"
      to: "fixed {code,type,param} allowlist (or dropped `upstream` field)"
      via: "replace `upstream: upstream400.upstreamBody`"
      pattern: "upstreamBody"
    - from: "apps/api/src/lib/web-search/types.ts WebSearchProvider"
      to: "envVarLabel metadata"
      via: "interface member implemented by tavily + yandex adapters, read by web-search.ts"
      pattern: "envVarLabel"
    - from: "apps/api/src/routes/diarization.ts boundary"
      to: "crypto.randomBytes"
      via: "replace Math.random() boundary nonce"
      pattern: "randomBytes"
---

<objective>
Clear the 11 WARNING-level findings (mapped to the HIGH backlog) in the
`apps/api` transcriptions / tokens / agent / realtime / diarization / streaming
route surface (`.planning/review/api-routes-transcriptions.md`, WR-01..WR-11).

Each finding is re-verified against current `main` BEFORE any fix (CLAUDE.md
hard rule 3). The planner's pre-determination, which the executor MUST
re-confirm:

- **WR-01 — ALREADY-CLOSED by Phase 62 HI-03.** All 7 throw sites
  (`transcribe.ts:221`, `reason.ts:119`, `diarization.ts:194`,
  `agent/web-search.ts:113`+`:127`, `tokens/assemblyai.ts:108`,
  `tokens/deepgram.ts:75`, `tokens/openai-realtime.ts:191`) already emit a
  code+literal pair — `ServiceUnavailable("SERVICE_UNAVAILABLE", "Service
  temporarily unavailable")` / `TypedServiceUnavailable("WEB_SEARCH_*",
  "Service temporarily unavailable")` — and log the upstream `.message`
  server-side only. No raw `.message` reaches the wire. WR-01 needs NO fix;
  the executor records the closure + adds one regression guard test.
- **WR-02..WR-11 — STILL LIVE** (planner pre-determination; executor
  re-confirms per the verify-first protocol).

Each live finding is closed via strict RED→GREEN TDD with the test asserting
the regression-shape. Findings touching the same file are grouped into one
coherent task (WR-03+WR-04+WR-09 all in `realtime.ts`/`agent/stream.ts`,
WR-06+WR-08 both in `diarization.ts`), but each WR-NN keeps a distinct,
ID-referenced RED test.

Purpose: remove the pre-publication robustness / error-shape / architectural-
coupling defects in this route cluster so the repo reads as audit-ready ahead
of public publication, while strengthening (never weakening) LOCKER-05
secret-shape discipline.

Output: per-finding RED+GREEN atomic commit pairs (test + production code in
the same commit acceptable), a `verify-first.log` evidence record (incl. the
WR-04 + WR-09 judgment-call rationale), and
`.planning/review/api-routes-transcriptions.md` + `REVIEW-INDEX.md` annotated
with per-finding closure markers.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/65-high-findings-api-routes-transcriptions/CONTEXT.md
@.planning/review/api-routes-transcriptions.md
@CLAUDE.md

Already-read source (facts captured below — do NOT re-read whole files to
"check one more thing"; use Grep for anything more specific):

- **WR-01 — ALREADY-CLOSED.** `grep -n "ServiceUnavailable" apps/api/src/routes/{transcribe,reason,diarization}.ts apps/api/src/routes/tokens/*.ts apps/api/src/routes/agent/web-search.ts`:
  - `transcribe.ts:221` — `throw new ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable")`.
  - `reason.ts:119` — same.
  - `diarization.ts:194` — same.
  - `tokens/assemblyai.ts:108`, `tokens/deepgram.ts:75`, `tokens/openai-realtime.ts:191` + `:200` — same; `r.message` logged via `req.log.warn({ providerMessage: ... })` server-side only (explicit `// HI-03 (Phase 62)` comments).
  - `agent/web-search.ts:113` (`WEB_SEARCH_NOT_CONFIGURED`, literal `"Service temporarily unavailable"`) and `:127` (`WEB_SEARCH_PROVIDER_KEY_MISSING`, literal) — both two-arg `TypedServiceUnavailable`; the env-var hint is logged server-side only.
  The review's WR-01 description (citing `transcribe.ts:115`, raw `.message`)
  is STALE — HI-03 swept these. The executor confirms by grep and marks WR-01
  already-closed.
- **WR-02 — STILL LIVE.** `tokens/openai-realtime.ts:167-176` — the upstream-400
  branch does `reply.code(400).send({ error: { code:"UPSTREAM_REJECTED",
  message:`${PROVIDER_LABEL} rejected the request`, upstream:
  upstream400.upstreamBody, requestId: req.id } })`. `upstream400.upstreamBody`
  is the raw, unfiltered upstream blob (`_call-provider.ts` parses it as JSON,
  text fallback). NOTE this route's 400 envelope is itself `{error:{object}}`
  (a pre-existing v1-keys-style envelope, NOT the canonical string envelope) —
  do NOT "fix" the envelope shape; WR-02 is scoped ONLY to the `upstream`
  field. The other fields stay.
- **WR-03 — STILL LIVE.** `realtime.ts:182` `throw new AuthError("unauthorized")`
  and `agent/stream.ts:145` `throw new AuthError("unauthorized")` — both the
  legacy single-arg form. Every other in-scope route uses the two-arg
  `new AuthError("UNAUTHORIZED", "unauthorized")`.
- **WR-04 — STILL LIVE (judgment call).** `agent/stream.ts:115` registers
  `schema: { body: AgentStreamRequestSchema }`; `:159` re-runs
  `AgentStreamRequestSchema.parse(req.body ?? {})`. The route's `:117-119`
  comment claims the manual parse is for hijack-ordering. CRITICAL UNKNOWN:
  whether the `@fastify/type-provider-zod` validator is globally attached for
  this route — `grep` for `withTypeProvider` / `ZodTypeProvider` /
  `setValidatorCompiler` in `apps/api/src/**` found NOTHING in `agent/stream.ts`
  or an obvious `build*.ts`. Phase 64 H-1 KEPT the inline `.parse()` in the
  conversations routes precisely because the stock ZodCompiler is NOT globally
  attached there. Task 4 below makes this a verify-step decision: only drop
  the redundant parse if the executor PROVES `req.body` is Fastify-validated
  (a malformed body must reject with the canonical envelope WITHOUT the inline
  parse); otherwise KEEP the parse and fix only the misleading comment.
- **WR-05 — STILL LIVE.** `agent/web-search.ts:103-108` — a
  `provider.name === "tavily" ? "TAVILY_API_KEY" : provider.name === "yandex"
  ? "YANDEX_SEARCH_API_KEY + YANDEX_SEARCH_FOLDER_ID" : "<provider env vars>"`
  string fork (used only for the server-side `req.log.warn`, since HI-03 the
  label is NOT on the wire — but the drift-prone mapping remains). The
  `WebSearchProvider` interface is `apps/api/src/lib/web-search/types.ts:33-36`
  — `{ readonly name: string; isConfigured(): boolean; ... }`. Adapters:
  `tavily-adapter.ts`, `yandex-adapter.ts` (both implement `isConfigured()`).
- **WR-06 — STILL LIVE.** `diarization.ts:477-481` — `const boundary =
  `----owsp-speaches-${Date.now().toString(36)}-${Math.random().toString(36)
  .slice(2,10)}``. `node:crypto` is ALREADY imported at `:41`
  (`import { createHash } from "node:crypto"`) — the fix adds `randomBytes` to
  that import.
- **WR-07 — STILL LIVE.** `transcriptions/batch-delete.ts:101-102` — inside the
  `withTenant` tx: `if (returnedIds.length !== requestedIds.length) throw new
  NotFoundError("TRANSCRIPTION_NOT_FOUND", ...)`. The all-hit path runs a full
  `UPDATE ... RETURNING`; the all-miss path returns an empty `RETURNING` — the
  Postgres work differs measurably at large batch sizes (timing oracle).
- **WR-08 — STILL LIVE.** `diarization.ts` inline `reply.code().send({error,
  jobId})` sites: `:333-336` (502, `error: `diarization job ${status}``, jobId),
  `:348-352` (504, operator-speak `"...consider corporate LiteLLM override
  with self-hosted Speaches"`, jobId), `:284-286` (503, jobId-less but inline).
  Also non-jobId inline-envelope sites in the Speaches sync branch:
  `:507-509`, `:515-517`, `:521-523`, `:531-533`, `:543-545` and the 409s at
  `:260-262`, `:277-279`. The canonical envelope is `{error:<string>}` (Phase
  64 H-4) — the `error:<string>` shape is ALREADY correct at these sites; the
  WR-08 defects are (a) the inline `jobId` field on the 502/504, and (b) the
  operator-speak copy on the 504. SCOPE WR-08 to the jobId-carrying sites
  (`:333`, `:348`) — drop `jobId` from the envelope, replace operator-speak
  with user-facing copy. The non-jobId inline sends are envelope-correct
  already; the executor MAY note them but does NOT route them through typed
  errors here (that touches 7+ sites of working code — out of scope).
- **WR-09 — STILL LIVE (judgment call).** `realtime.ts:188-191` — `const rawUrl
  = req.raw.url ?? req.url; const u = new URL(rawUrl, "http://internal");
  u.searchParams.set("user", user.id); req.raw.url = u.pathname + u.search`.
  In a `preHandler`. `"http://internal"` is an undocumented sentinel base; the
  in-place `req.raw.url` mutation is shared state. See Task 5 for the decision
  space.
- **WR-10 — STILL LIVE.** `transcriptions/list.ts:64` — `req.log.warn({ err },
  "transcriptions/list: invalid query")`. `ValidationError` import already at
  `:15`.
- **WR-11 — STILL LIVE.** `streaming-usage.ts:80` builds `text_preview =
  text.slice(0, previewCap)` (cap 1000 if `body.sendLogs`, else 200) and
  `:89` logs it inside the `req.log.info({...}, "streaming-usage")` object.
  `text_sha256` + `text_length` in the SAME log object are fine (hash + count,
  not content) — KEEP those; drop only `text_preview`. `previewCap` /
  `text_preview` become dead after — remove the now-unused locals.
- **`packages/observability/src/redact.ts`** — `REDACT_PATHS` is a fixed
  path allowlist (`:32`); neither `err.message` nor `text_preview` is covered.
  Both WR-10 and WR-11 fix at the call site (drop / redact the field) — the
  CONTEXT instructs "dropping is cleaner" for WR-11; for WR-10 log
  `{ name: (err as Error).name }` only. Do NOT widen the redact policy (that
  is a shared-package change with broader blast radius; out of scope).

<interfaces>
apps/api/src/errors.ts (variadic two-arg constructors → centralized
setErrorHandler emits the canonical envelope):
  new AuthError("UNAUTHORIZED", "unauthorized")            -> 401, code "UNAUTHORIZED"
  new AuthError("unauthorized")                            -> 401, code "AUTH_ERROR" (legacy, WR-03 bug shape)
  new ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable") -> 503
  new ServerError(code, message) / NotFoundError / ValidationError / UpstreamError — same variadic pattern.

apps/api/src/lib/web-search/types.ts:
  export interface WebSearchProvider {
    readonly name: string;
    isConfigured(): boolean;
    // WR-05 adds: a way to surface the operator env-var label generically.
    search(query: string, numResults: number): Promise<...>;
  }
The WR-05 fix adds an `envVarLabel` member (a `readonly string` property or a
`envVarLabel(): string` method — executor picks; a property is simpler and
matches `name`). tavily-adapter + yandex-adapter each supply their own label
(`"TAVILY_API_KEY"`, `"YANDEX_SEARCH_API_KEY + YANDEX_SEARCH_FOLDER_ID"`).

@fastify/http-proxy reads `req.raw.url` (the raw IncomingMessage URL) when
wiring the upstream WSS upgrade — this is WHY realtime.ts mutates it (WR-09).
</interfaces>

apps/api unit route tests register the real `build*Routes` plugin on
`Fastify({ logger: false })` + `registerErrorHandler(app)` and drive
`app.inject`; upstream HTTP is the only mock boundary (hermetic mock /
mock-LiteLLM) — NO mocks of internal logic (CLAUDE.md). DB-touching route
tests (batch-delete) use real Postgres via testcontainers + the established
fake `TransactionalDb` only where the suite already does. Pure-shape tests
(boundary nonce, error-envelope shape, log-shape capture) need no DB. For
WR-06/WR-10/WR-11 the cleanest RED captures emitted state: WR-06 stubs the
Speaches fetch and asserts the captured boundary string is high-entropy /
not Math.random-shaped; WR-10/WR-11 install a capturing pino transport (or a
spy logger) and assert the logged object's keys.
</context>

## Phase Goal

Close WR-01..WR-11 — each fixed via strict RED→GREEN TDD with the test
asserting the regression-shape, OR (WR-01) confirmed already-resolved with
committed evidence. WR-06 + WR-07 are security fixes: the RED must demonstrate
the vulnerability shape (predictable boundary / measurable timing delta).

---

## Verify-first protocol (MANDATORY, all findings)

Before any fix the executor writes
`.planning/phases/65-high-findings-api-routes-transcriptions/verify-first.log`
and, per finding, records **still-live / partially-mitigated / already-closed**
with the `file:line` evidence checked:

- **WR-01 — expect ALREADY-CLOSED.**
  `grep -n "ServiceUnavailable" apps/api/src/routes/transcribe.ts apps/api/src/routes/reason.ts apps/api/src/routes/diarization.ts apps/api/src/routes/tokens/*.ts apps/api/src/routes/agent/web-search.ts`
  → every throw site is a two-arg code+literal pair; NO `throw new
  ServiceUnavailable(err.message)` / `(r.message)` / `(e.message)` remains.
  Record the 7 sites + their literal as evidence.
- **WR-02..WR-11 — expect STILL LIVE.** Grep each anchor:
  WR-02 `grep -n "upstreamBody" apps/api/src/routes/tokens/openai-realtime.ts`;
  WR-03 `grep -n 'AuthError("unauthorized")' apps/api/src/routes/realtime.ts apps/api/src/routes/agent/stream.ts`;
  WR-04 `grep -n "AgentStreamRequestSchema.parse" apps/api/src/routes/agent/stream.ts`;
  WR-05 `grep -n 'provider.name ===' apps/api/src/routes/agent/web-search.ts`;
  WR-06 `grep -n "Math.random" apps/api/src/routes/diarization.ts`;
  WR-07 `grep -n "returnedIds.length !== requestedIds.length" apps/api/src/routes/transcriptions/batch-delete.ts`;
  WR-08 `grep -n "jobId," apps/api/src/routes/diarization.ts`;
  WR-09 `grep -n "http://internal" apps/api/src/routes/realtime.ts`;
  WR-10 `grep -n "{ err }" apps/api/src/routes/transcriptions/list.ts`;
  WR-11 `grep -n "text_preview" apps/api/src/routes/streaming-usage.ts`.

If any grep contradicts the pre-determination (a fix already present, or WR-01
NOT closed), STOP, treat per the evidence, record it in `verify-first.log`,
adjust the affected task, and report the divergence in the SUMMARY.

Commit the log: `docs(65-01): verify-first — WR-01..WR-11 disposition log`.

---

## Task 1 — WR-01 (already-closed) + WR-02: openai-realtime upstream-body echo

**WR-01 (already-closed):** Confirm via the grep above that all 7 sites are
HI-03 code+literal pairs. No production fix. Add ONE regression guard test:
register the relevant token/transcribe route, drive the
`MissingProviderKeyError` / upstream-failure path with a mock upstream whose
`.message` contains a recognizable sentinel string, and assert the sentinel
does NOT appear in the response body (`error` field) — proving the
class-default literal is what ships. Test name MUST contain `WR-01`. This is a
GREEN-only commit (a guard for an already-closed finding); no RED.

**WR-02 (STILL LIVE):** `tokens/openai-realtime.ts:167-176` — the upstream-400
branch echoes `upstream: upstream400.upstreamBody` (the raw blob).

### RED step (WR-02)
- New file: `apps/api/tests/unit/routes/tokens/__tests__/openai-realtime-upstream-echo.test.ts`.
  Test name MUST contain `WR-02`.
- Register `buildOpenAIRealtimeTokenRoutes` (or the token router) with a
  hermetic mock upstream that returns HTTP 400 with a body containing a
  free-form sentinel value (e.g. `{"error":{"message":"SENTINEL_LEAK_xyz",
  "code":"bad","type":"invalid_request","param":"foo"}}`). POST a token
  request. Assert: status 400 AND the response body does NOT contain
  `SENTINEL_LEAK_xyz` anywhere (the raw upstream blob is not echoed). Pre-fix
  `body.error.upstream` carries the whole blob → RED fails.
- Commit: `test(65-01): red — WR-02 openai-realtime echoes raw upstream 400 body`.

### GREEN step (WR-02)
- `tokens/openai-realtime.ts:167-176` — replace `upstream:
  upstream400.upstreamBody` with EITHER: drop the `upstream` field entirely
  (simplest; the CONTEXT lists this as acceptable), OR restrict it to a fixed
  `{ code, type, param }` allowlist read from a typed parse of the upstream
  body (never `message`, never the raw blob). The executor picks; dropping the
  field is the smaller, lower-risk diff — prefer it unless a downstream
  consumer demonstrably needs `code`/`type`/`param` (grep the desktop-client-
  facing wire docs — if unclear, drop). Keep `code`, `message`
  (`${PROVIDER_LABEL} rejected the request` — a fixed literal), `requestId`.
- Add a one-line comment: the upstream blob is not surfaced (WR-02).
- Commit: `fix(65-01): green — WR-02 drop raw upstream blob from openai-realtime 400`.

### Verify
```
grep -n "upstreamBody" apps/api/src/routes/tokens/openai-realtime.ts   # no wire echo
pnpm --filter @openwhispr/api test -- openai-realtime
pnpm lint:lockers
```

### Done
WR-01 closure confirmed + a regression guard test added; WR-02 RED+GREEN pair
on `main` — a crafted upstream 400 body cannot place free-form text on the
wire; LOCKER-05 secret-shape discipline strengthened, not weakened.

---

## Task 2 — WR-05: web-search provider envvar-label moves onto the interface

**Finding:** WR-05 (HIGH) — `agent/web-search.ts:103-108` hardcodes a
`provider.name === "tavily"|"yandex"` → envvar-label string fork; a new adapter
not added here yields a misleading label.

### RED step
- New file: `apps/api/tests/unit/routes/agent/web-search-envvar-label.test.ts`.
  Test name MUST contain `WR-05`.
- Pure-unit: import the `WebSearchProvider` adapters (`tavily-adapter`,
  `yandex-adapter`). Assert each exposes an `envVarLabel` (the WR-05 interface
  member) returning its expected label, AND assert the route module does NOT
  contain a `provider.name ===` string fork (a source-level assertion: read
  `agent/web-search.ts` and assert `/provider\.name === "tavily"/` does not
  match). Pre-fix: the interface member does not exist (compile/import error
  or `undefined`) and the string fork is present → RED fails.
- Commit: `test(65-01): red — WR-05 provider envvar-label hardcoded in route`.

### GREEN step
- `apps/api/src/lib/web-search/types.ts` — add `readonly envVarLabel: string;`
  to the `WebSearchProvider` interface (a property mirrors `name`; a method is
  also acceptable — executor picks, property preferred for simplicity).
- `tavily-adapter.ts` — supply `envVarLabel: "TAVILY_API_KEY"`.
- `yandex-adapter.ts` — supply `envVarLabel: "YANDEX_SEARCH_API_KEY + YANDEX_SEARCH_FOLDER_ID"`.
- `agent/web-search.ts:103-108` — delete the `provider.name === ...` fork;
  use `provider.envVarLabel` directly in the `req.log.warn` call.
- Update the route header docstring line that documents the provider→envvar
  mapping (`web-search.ts:~8`).
- Commit: `fix(65-01): green — WR-05 move provider envvar-label onto interface`.

### Verify
```
grep -n "envVarLabel\|provider.name ===" apps/api/src/routes/agent/web-search.ts apps/api/src/lib/web-search/*.ts
pnpm --filter @openwhispr/api test -- web-search
pnpm lint:lockers
```

### Done
WR-05 RED+GREEN pair on `main`; the envvar-label metadata lives on the
`WebSearchProvider` interface; the route reads it generically; no string fork
remains.

---

## Task 3 — WR-06 + WR-08: diarization boundary nonce + jobId error envelope

Both findings live in `diarization.ts` — one task, two distinct ID-referenced
RED tests.

**WR-06 (security, STILL LIVE):** `diarization.ts:477-481` — `Math.random()`
multipart boundary on a route forwarding untrusted user audio. A predictable
boundary lets an attacker craft an upload that smuggles a forged form field.

**WR-08 (STILL LIVE):** `diarization.ts:333-336` (502) and `:348-352` (504)
emit inline `reply.code().send({ error:<string>, jobId })` — the `jobId` field
is not part of the canonical `{error:<string>}` envelope (Phase 64 H-4), and
the 504 copy is operator-speak ("corporate LiteLLM override with self-hosted
Speaches") on a user-facing endpoint.

### RED step
- New file: `apps/api/tests/unit/routes/diarization/wr-06-boundary-nonce.test.ts`.
  Test name MUST contain `WR-06`. Stub the Speaches `fetch` (the test seam at
  `diarization.ts:~124` already supports a stub returning a synthesised
  Response) to CAPTURE the outgoing `content-type` header / request body.
  Drive the Speaches diarization branch. Extract the `boundary=` token.
  Assert it is high-entropy: 32 hex chars (the `randomBytes(16).toString("hex")`
  shape) and NOT the `Math.random().toString(36).slice(2,10)` 8-base36-char
  shape. Pre-fix the boundary matches `/[a-z0-9]{8}$/` (base36) → RED fails.
  Optionally a stronger assertion: capture two boundaries across two calls and
  assert they do not share a predictable monotonic prefix beyond the
  `Date.now()` segment.
- New file: `apps/api/tests/unit/routes/diarization/wr-08-error-envelope.test.ts`.
  Test name MUST contain `WR-08`. Register the diarization route + a pyannote
  stub that drives (a) a `failed`/`cancelled` job → the 502 site, and (b) the
  poll-ceiling timeout → the 504 site (use a fake clock or a stub that never
  resolves `succeeded` within a shortened `POLL_CEILING_MS` test override if
  one exists; if not, assert the 502 path only and note the 504 path in the
  SUMMARY). Assert: response body has NO `jobId` key; `body.error` is a STRING;
  the 504 message contains NO operator-speak (no `"corporate"`, no
  `"LiteLLM"`, no `"Speaches"`). Pre-fix `body.jobId` is present and the 504
  string contains `"corporate LiteLLM"` → RED fails.
- Commit: `test(65-01): red — WR-06 predictable boundary + WR-08 jobId/operator-speak envelope`.

### GREEN step
- **WR-06:** `diarization.ts:41` — add `randomBytes` to the existing
  `import { createHash } from "node:crypto"`. `:477-481` — replace the
  `Math.random()` segment with `crypto.randomBytes(16).toString("hex")`.
  Keep the `----owsp-speaches-` prefix and the `Date.now()` segment if desired
  (they aid debuggability) — the security property is the unpredictable
  cryptographic segment.
- **WR-08:** `diarization.ts:333-336` (502) — drop the `jobId` field; keep
  `error: `diarization job ${job.status}``. `:348-352` (504) — drop `jobId`;
  replace the operator-speak string with user-facing copy, e.g.
  `error: "diarization timed out; retry with the same Idempotency-Key to resume"`
  (the resume hint is user-actionable and references the documented
  Idempotency-Key mechanism, not internal infra). The `jobId` resume-hint is
  ALREADY available to the client via the `Idempotency-Key` round-trip — note
  this in the SUMMARY. Update the route header docstring lines (`:35`, `:66`)
  that mention "jobId returned for resume hint" — the resume hint is now the
  Idempotency-Key, not an envelope field.
- Do NOT touch the envelope-correct non-jobId inline sends (`:284`, `:507`+,
  the 409s) — they already emit `{error:<string>}` correctly; out of scope.
- Commit: `fix(65-01): green — WR-06 crypto boundary + WR-08 canonical diarization envelope`.

### Verify
```
grep -n "Math.random\|randomBytes\|jobId," apps/api/src/routes/diarization.ts
pnpm --filter @openwhispr/api test -- diarization
pnpm lint:lockers
```

### Done
WR-06 + WR-08 RED+GREEN pair on `main`; the Speaches boundary is
cryptographically sourced; the 502/504 diarization responses emit the
canonical `{error:<string>}` envelope with no `jobId` field and no
operator-speak copy.

---

## Task 4 — WR-03 + WR-04: agent/stream + realtime AuthError code; agent/stream double-parse

WR-03 spans `realtime.ts` + `agent/stream.ts`; WR-04 is `agent/stream.ts`.
Grouped — both touch `agent/stream.ts`. WR-09 (`realtime.ts`) is its own task
(Task 5) since it needs a separate judgment call.

**WR-03 (STILL LIVE):** `realtime.ts:182` + `agent/stream.ts:145` —
`throw new AuthError("unauthorized")` (legacy single-arg → `code="AUTH_ERROR"`).

**WR-04 (STILL LIVE, judgment call):** `agent/stream.ts:159` re-runs
`AgentStreamRequestSchema.parse(req.body ?? {})` after the declarative
`schema: { body: AgentStreamRequestSchema }` at `:122`.

### RED step
- New file: `apps/api/tests/unit/routes/realtime/wr-03-auth-error-code.test.ts`
  and `apps/api/tests/unit/routes/agent/stream-wr-03-04.test.ts`. Test names
  MUST contain `WR-03` (and `WR-04` in the stream file).
- **WR-03 RED:** register `buildRealtimeRoutes` / the agent-stream route on a
  Fastify instance with `registerErrorHandler`, drive an unauthenticated
  request (no `req.user`), assert the 401 response `error.code` (or the
  canonical envelope's code field) is `"UNAUTHORIZED"` — NOT `"AUTH_ERROR"`.
  Pre-fix the single-arg form yields `"AUTH_ERROR"` → RED fails. For
  `realtime.ts` the auth re-check is in a `preHandler` before the WS upgrade —
  an `app.inject` of an un-upgraded request hits the `preHandler` throw.
- **WR-04 RED/GUARD:** this is a verify-step decision, not a pure RED. The
  executor FIRST determines whether `req.body` is Fastify-validated WITHOUT
  the inline `.parse()`: register the agent-stream route, temporarily reason
  about / test whether a malformed body (violating `AgentStreamRequestSchema`)
  is rejected by Fastify's declarative `schema:` alone. Concretely — grep for
  `withTypeProvider` / `setValidatorCompiler` / `ZodTypeProvider` across
  `apps/api/src/**` (NOT tests). If a Zod validator compiler IS attached →
  WR-04 is a real drop: write a RED asserting the handler receives an
  already-typed `req.body` and the inline `.parse()` is redundant (assert the
  declarative schema alone rejects a malformed body with the canonical
  envelope), then GREEN drops the `.parse()`. If NO validator compiler is
  attached (the Phase 64 H-1 situation) → the inline `.parse()` is the ONLY
  thing validating; WR-04's fix is NOT a drop — it is correcting the
  MISLEADING comment (`:117-119`). In that case the "fix" is a comment edit +
  a test asserting the inline `.parse()` still rejects a malformed body
  (regression guard). Record the determination in `verify-first.log` under
  WR-04.
- Commit: `test(65-01): red — WR-03 legacy AuthError code + WR-04 stream body parse`.

### GREEN step
- **WR-03:** `realtime.ts:182` → `throw new AuthError("UNAUTHORIZED", "unauthorized")`.
  `agent/stream.ts:145` → same. Two-line change.
- **WR-04 (per the determination):**
  - If validator IS attached: `agent/stream.ts` — remove the
    `AgentStreamRequestSchema.parse(req.body ?? {})` at `:159`; use the
    Fastify-typed `req.body` directly; correct the `:117-119` comment.
  - If validator NOT attached: KEEP the inline `.parse()`; rewrite the
    `:117-119` comment to state plainly that the inline parse is the active
    validator (the stock ZodCompiler is not attached) — NOT a "hijack-ordering"
    concern. Note in the SUMMARY that WR-04's review premise (the declarative
    schema runs) did not hold for this route, mirroring Phase 64 H-1.
- Commit: `fix(65-01): green — WR-03 canonical AuthError code + WR-04 stream body parse`.

### Verify
```
grep -n "AuthError" apps/api/src/routes/realtime.ts apps/api/src/routes/agent/stream.ts
grep -rn "withTypeProvider\|setValidatorCompiler\|ZodTypeProvider" apps/api/src --include="*.ts" | grep -v test
pnpm --filter @openwhispr/api test -- realtime stream
pnpm lint:lockers
```

### Done
WR-03 RED+GREEN pair — both routes emit `code="UNAUTHORIZED"`; WR-04 RED+GREEN
pair — the double-parse is either removed (validator attached) or the
misleading comment is corrected (validator not attached), with the
determination + rationale recorded in `verify-first.log`.

---

## Task 5 — WR-09: realtime.ts req.raw.url mutation (judgment call)

**Finding:** WR-09 (HIGH) — `realtime.ts:188-191` builds `new URL(rawUrl,
"http://internal")` (undocumented sentinel base) then mutates `req.raw.url`
in place, leaking the appended `user` id into any audit/observability hook
running before the proxy upgrade.

This needs a judgment call. The executor weighs the decision space and picks,
recording the rationale in `verify-first.log` under WR-09:

- **Option A — document + assert (minimal).** Add a comment explaining the
  `"http://internal"` sentinel (a parser base required because `new URL`
  needs an absolute base for a relative path; the host is never used). Add an
  assertion / guard that `rawUrl` is relative (starts with `/`) — if it is
  ever absolute, the sentinel-drop bug surfaces loudly instead of silently.
  Keep the in-place mutation but move it as LATE as possible in the
  `preHandler` and comment that the `user` id deliberately enters `req.raw.url`
  only immediately before the upgrade. LOW risk, smallest diff.
- **Option B — avoid the in-place mutation.** If `@fastify/http-proxy`
  supports a per-request URL rewrite hook (`replyOptions.rewriteRequestHeaders`
  is already used at `realtime.ts`; check for a `rewritePrefix` / a
  `preRewrite` / an upstream-URL hook), pass the `?user=` query via that
  mechanism so `req.raw.url` is never mutated. HIGHER confidence but depends on
  the proxy plugin's API surface.
- **Option C — HALT.** If neither A nor B is cleanly achievable (the proxy
  plugin genuinely requires the `req.raw.url` mutation and there is no relative
  guarantee), the executor records the constraint in
  `.planning/deferred-items.md` with `WHY:` evidence and marks WR-09
  partially-mitigated (document the sentinel only) — do NOT invent a fragile
  rewrite. CLAUDE.md hard rule 1: never edit production code in a way that is
  not a genuine improvement.

The executor MUST first read enough of `realtime.ts` (the proxy registration
block, ~`:120-193`) and the `@fastify/http-proxy@11.4.4` option surface to
choose. Prefer Option A unless Option B is demonstrably clean.

### RED step
- New file (folded into `apps/api/tests/unit/routes/realtime/wr-03-auth-error-code.test.ts`
  is acceptable, or a dedicated file). Test name MUST contain `WR-09`.
- The RED asserts the regression-shape per the chosen option:
  - Option A: assert that when `req.raw.url` is an ABSOLUTE URL the
    `preHandler` throws / rejects loudly (a guard) rather than silently
    dropping scheme+host; AND assert the `"http://internal"` base is
    accompanied by an explanatory comment (a source-level grep assertion is
    acceptable as a guard against silent regression). The behavioural RED:
    drive the `preHandler` with a relative `req.raw.url` and assert the
    appended `?user=` is present; drive it with an absolute URL and assert the
    new guard rejects.
  - Option B: assert `req.raw.url` is NOT mutated (capture it before/after the
    `preHandler`) and the `user` id reaches the upstream via the proxy hook.
- Commit: `test(65-01): red — WR-09 realtime req.raw.url sentinel/mutation`.

### GREEN step
- Apply the chosen option per the decision space above. Update the
  `realtime.ts:184-191` comment block to document the sentinel and the
  mutation timing.
- Commit: `fix(65-01): green — WR-09 <option-a|option-b> realtime url handling`.
  (If Option C: `docs(65-01): WR-09 partially-mitigated — sentinel documented, mutation deferred`
  plus the `deferred-items.md` entry.)

### Verify
```
grep -n "http://internal\|req.raw.url" apps/api/src/routes/realtime.ts
pnpm --filter @openwhispr/api test -- realtime
pnpm lint:lockers
```

### Done
WR-09 addressed per the executor's recorded option; the sentinel base is
documented; the chosen disposition + rationale are in `verify-first.log`.

---

## Task 6 — WR-07: batch-delete timing oracle

**Finding:** WR-07 (security, HIGH) — `transcriptions/batch-delete.ts:101-102`
— the all-hit path runs a full `UPDATE ... RETURNING`; the all-miss path
returns empty; response timing differs measurably at large batch sizes →
cross-tenant id-existence oracle.

### RED step
- New file: `apps/api/tests/unit/routes/transcriptions/batch-delete-wr-07-timing.test.ts`.
  Test name MUST contain `WR-07`. Uses real Postgres via testcontainers (the
  established pattern for the transcriptions suite — DB-touching, no internal
  mocks).
- Seed N (e.g. 200) owned, live transcriptions for the test user. Measure two
  request timings: (a) a batch of 200 ids that ALL hit (all owned/live),
  (b) a batch of 200 ids that ALL miss (random UUIDs). Pre-fix: assert the
  failure-path (b) duration is measurably SHORTER than the success-path (a)
  duration beyond a tolerance — this is the oracle the RED demonstrates. (A
  timing test is inherently noisy: run each batch K times, compare medians,
  use a generous-but-meaningful delta; the RED's job is to show a *systematic*
  delta exists pre-fix, not a flaky one. If the executor finds the delta is
  not reliably observable in the test environment, record that in
  `verify-first.log` and pivot the RED to a *structural* assertion — see
  GREEN — asserting the failure path performs the equalizing work.)
- Commit: `test(65-01): red — WR-07 batch-delete timing oracle on cross-tenant ids`.

### GREEN step
- Mitigate the timing delta. Simplest robust option (the CONTEXT says "weigh
  the simplest robust mitigation"): equalize the work on the failure path.
  Two viable shapes — executor picks, records rationale:
  - **Equalize the query:** run the `UPDATE` unconditionally for all requested
    ids regardless of hit/miss (the current query already does — the delta is
    in the RETURNING row count, which Postgres still does proportional work
    for). The cleaner fix: after detecting `returnedIds.length !==
    requestedIds.length`, before throwing `NotFoundError`, perform a
    constant-shape compensating operation so total work is independent of how
    many ids hit — e.g. a fixed-cost wait OR a second query touching the same
    row count. A constant-time wait on the failure path (the CONTEXT's
    explicit suggestion) is the smallest, most predictable mitigation: on the
    mismatch branch, `await` until a fixed wall-clock budget (measured from tx
    start) elapses, THEN throw. The budget must exceed the p99 all-hit
    duration for the max batch (500).
  - The structural assertion the test then makes: the failure path's duration
    is NOT systematically shorter than the success path (within tolerance) —
    OR (if the test pivots to structural) the failure branch invokes the
    equalizing wait.
- Add a comment referencing WR-07 and the constant-time rationale.
- Commit: `fix(65-01): green — WR-07 constant-time batch-delete failure path`.

### Verify
```
grep -n "returnedIds.length !== requestedIds.length\|WR-07" apps/api/src/routes/transcriptions/batch-delete.ts
pnpm --filter @openwhispr/api test -- batch-delete
pnpm lint:lockers
```

### Done
WR-07 RED+GREEN pair on `main`; the batch-delete failure path no longer leaks
a measurable timing delta distinguishing all-hit from all-miss batches; the
mitigation shape + rationale are recorded.

---

## Task 7 — WR-10 + WR-11: redacted error log + drop text_preview

WR-10 (`transcriptions/list.ts`) and WR-11 (`streaming-usage.ts`) are both
structured-log content-leak fixes — grouped (independent files, both
log-shape).

**WR-10 (STILL LIVE):** `transcriptions/list.ts:64` — `req.log.warn({ err },
...)` logs the full unredacted `Error` object.

**WR-11 (STILL LIVE):** `streaming-usage.ts:80,89` — `text_preview` (≤1000
chars of user STT output) logged to pino every request.

### RED step
- New files: `apps/api/tests/unit/routes/transcriptions/list-wr-10-redacted-log.test.ts`
  and `apps/api/tests/unit/routes/streaming-usage-wr-11-text-preview.test.ts`.
  Test names MUST contain `WR-10` / `WR-11`.
- **WR-10 RED:** register `buildTranscriptionsListRoutes` with a capturing
  logger (a pino instance writing to an in-memory stream, or a spy). Drive a
  request with a querystring that makes `parseListQuery` throw. Capture the
  `req.log.warn` call's bound object. Assert it does NOT contain an `err`
  key carrying the full Error (assert it carries only `{ name }` or a redacted
  shape). Pre-fix the logged object has `err` (the whole Error) → RED fails.
- **WR-11 RED:** register the streaming-usage route with a capturing logger.
  POST a streaming-usage request with `text` set to a recognizable sentinel
  string and `sendLogs: true`. Capture the `req.log.info({...},
  "streaming-usage")` bound object. Assert it does NOT contain a `text_preview`
  key, AND assert `text_sha256` + `text_length` ARE still present (the
  hash+count are fine — only raw content is dropped). Pre-fix `text_preview`
  carries the sentinel → RED fails.
- Commit: `test(65-01): red — WR-10 raw err logged + WR-11 text_preview leaked to logs`.

### GREEN step
- **WR-10:** `transcriptions/list.ts:64` — change `req.log.warn({ err }, ...)`
  to `req.log.warn({ name: (err as Error).name }, ...)`. Keep the
  `throw new ValidationError("INVALID_QUERY", "invalid query")` unchanged.
- **WR-11:** `streaming-usage.ts` — remove `text_preview` from the
  `req.log.info` object (`:89`); remove the now-dead `previewCap` (`:79`) and
  `text_preview` (`:80`) locals. KEEP `text_sha256` + `text_length`. Update
  the `:74-75` comment (`D-13: ... bounded preview to structured logs`) — the
  bounded preview is dropped; only the SHA-256 + length go to logs.
- Commit: `fix(65-01): green — WR-10 redact err log + WR-11 drop text_preview`.

### Verify
```
grep -n "{ err }\|name:" apps/api/src/routes/transcriptions/list.ts
grep -n "text_preview\|previewCap" apps/api/src/routes/streaming-usage.ts
pnpm --filter @openwhispr/api test -- list streaming-usage
pnpm lint:lockers
```

### Done
WR-10 + WR-11 RED+GREEN pair on `main`; `transcriptions/list.ts` logs a
redacted error shape; `streaming-usage.ts` no longer writes user STT content
to structured logs.

---

## Task 8 — annotate the review artifacts (FINAL TASK)

After Tasks 1–7 are green/verified:

- `.planning/review/api-routes-transcriptions.md` — append a closure marker
  line under each of WR-01..WR-11:
  - WR-01: `**Status:** ALREADY-CLOSED — verified 2026-05-21, Phase 65 — Phase 62 HI-03 swept all 7 throw sites to code+literal pairs; regression guard test added (commit <sha>).`
  - WR-02..WR-11: `**Status:** CLOSED 2026-05-21 — Phase 65, commit <green-sha> — <one-line fix summary>.`
  - WR-04: also note the validator-attached determination.
  - WR-09: also note the chosen option (A/B/C) + rationale.
- `.planning/review/REVIEW-INDEX.md` — update the `api-routes-transcriptions`
  row and summary line to reflect HIGH = 11 cleared (mirror how Phase 64
  H-1..H-4 / Phase 63 HR-01..HR-03 closures are marked). IN-01..06 remain
  open (MEDIUM, out of scope).
- Commit: `docs(65-01): annotate api-routes-transcriptions review with WR-01..WR-11 closure`.

### Done
Both review artifacts carry per-finding closure markers; `git log` shows the
annotation commit.

---

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| upstream provider 400 body → openai-realtime route → desktop client | An untrusted upstream-controlled blob is echoed onto the wire (WR-02). |
| client request body → agent/stream route handler | An untrusted body crosses a possibly-double-validated boundary (WR-04). |
| untrusted user audio bytes → diarization multipart forwarder | Attacker-uploaded bytes are framed by a multipart boundary whose predictability decides forge-ability (WR-06). |
| client batch-delete request → Postgres UPDATE | Response timing crosses back to the client and may encode cross-tenant id existence (WR-07). |
| route handler → pino / Loki structured logs | User STT content + raw error objects cross into 30-day-retained logs (WR-10, WR-11). |
| client WSS upgrade request → @fastify/http-proxy upstream | A mutated `req.raw.url` carrying the user id crosses shared request state visible to earlier hooks (WR-09). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-65-01 | Information disclosure | tokens/openai-realtime.ts 400 path | mitigate | Task 1 drops / allowlists the raw `upstream` blob so a crafted upstream 400 body cannot place free-form attacker text on the wire (strengthens LOCKER-05). |
| T-65-02 | Spoofing / Tampering | diarization.ts Speaches multipart boundary | mitigate | Task 3 replaces `Math.random()` with `crypto.randomBytes(16)` so the boundary is unpredictable — a crafted upload cannot smuggle a forged `name="model"` field. |
| T-65-03 | Information disclosure (side channel) | transcriptions/batch-delete.ts failure path | mitigate | Task 6 equalizes the failure-path work (constant-time wait) so response timing no longer oracles cross-tenant id existence. |
| T-65-04 | Information disclosure | conversations error envelope / realtime + agent-stream AuthError code | mitigate | Task 4 emits the canonical `code="UNAUTHORIZED"` so client switch-on-code + i18n keying behave uniformly; no behavioural leak, contract-consistency. |
| T-65-05 | Information disclosure | transcriptions/list.ts + streaming-usage.ts structured logs | mitigate | Task 7 logs a redacted error shape and drops `text_preview` so user STT content + raw error text never reach 30-day Loki retention. |
| T-65-06 | Information disclosure | realtime.ts req.raw.url mutation | mitigate | Task 5 documents the sentinel base + asserts `rawUrl` relative (or avoids the in-place mutation) so the user id does not silently leak into earlier audit/observability hooks. |
| T-65-07 | Tampering | diarization.ts inline error envelope | accept→mitigate | Task 3 routes the jobId-carrying 502/504 sites to the canonical `{error:<string>}` envelope; the envelope-correct non-jobId inline sends are accepted as-is (already canonical, out of scope). |
</threat_model>

<verification>
Phase-level gate (run after all tasks):

```
pnpm --filter @openwhispr/api test
pnpm lint:lockers          # 8 lockers green — esp. LOCKER-05 (WR-01/02/08/10/11
                           # strengthen secret-shape / content-leak discipline)
pnpm typecheck             # no NEW errors vs the documented 5-error baseline
git log --oneline -20      # verify-first log + RED/GREEN pairs WR-02..WR-11
                           # + WR-01 guard + the doc annotation commit
```

Spot-check (CLAUDE.md hard rule 3 — verify, do not relay):
- `grep -rn "WR-01\|WR-02\|WR-03\|WR-04\|WR-05\|WR-06\|WR-07\|WR-08\|WR-09\|WR-10\|WR-11" apps/api --include="*.test.ts"`
  — every fixed finding has a test referencing its ID.
- `grep -n "upstreamBody" apps/api/src/routes/tokens/openai-realtime.ts` — no wire echo.
- `grep -n "AuthError" apps/api/src/routes/realtime.ts apps/api/src/routes/agent/stream.ts`
  — both two-arg `"UNAUTHORIZED"` form.
- `grep -n "Math.random\|randomBytes" apps/api/src/routes/diarization.ts` — boundary is `randomBytes`.
- `grep -n "jobId," apps/api/src/routes/diarization.ts` — no `jobId` in the 502/504 envelopes.
- `grep -n "envVarLabel\|provider.name ===" apps/api/src/routes/agent/web-search.ts` — no string fork.
- `grep -n "text_preview" apps/api/src/routes/streaming-usage.ts` — absent.
- `grep -n "{ err }" apps/api/src/routes/transcriptions/list.ts` — absent (redacted shape).
- Each cited commit SHA is on HEAD; `git status --short` clean.
- `verify-first.log` exists, committed, records a disposition for WR-01..WR-11
  plus the WR-04 validator-attached determination and the WR-09 option choice.
- `.planning/review/api-routes-transcriptions.md` + `REVIEW-INDEX.md` carry the
  closure markers.
</verification>

<success_criteria>
- WR-01: re-verified ALREADY-CLOSED (HI-03); a regression guard test added; no
  production fix.
- WR-02..WR-11: each a RED+GREEN pair on `main` with the test referencing its
  ID; WR-06 + WR-07 RED tests demonstrate the vulnerability shape.
- WR-04: the validator-attached determination recorded; the parse dropped OR
  the comment corrected per the determination.
- WR-09: the chosen option (A/B/C) + rationale recorded in `verify-first.log`.
- `pnpm --filter @openwhispr/api test` green; `pnpm lint:lockers` green (8);
  `pnpm typecheck` no new errors vs the 5-error baseline.
- `.planning/review/api-routes-transcriptions.md` + `REVIEW-INDEX.md` annotated.
- No skipped tests, no `.only`, no `@ts-expect-error` without `issue-NNNN:`.
- No `as any` / `as unknown as` / `@ts-ignore` introduced; no production code
  edited solely to green a test (CLAUDE.md hard rule 1).
- No gitleaks hook bypass (CLAUDE.md hard rule 4).
- IN-01..06 untouched (out of scope).
</success_criteria>

<risk_register>
| Risk | Task | Mitigation |
|------|------|------------|
| WR-01 grep contradicts the already-closed pre-determination. | verify-first, 1 | If any `ServiceUnavailable(.message)` remains, treat WR-01 as still-live, add a RED+GREEN pair, report the divergence in the SUMMARY. |
| WR-02: a downstream consumer needs `code`/`type`/`param`. | 1 | Default to dropping the `upstream` field; only allowlist `{code,type,param}` if a wire-doc consumer demonstrably needs it. Either way the raw blob is gone. |
| WR-04: the validator-attached state is ambiguous. | 4 | Task 4 makes it an explicit verify-step: grep for `withTypeProvider`/`setValidatorCompiler`; if not attached, KEEP the parse and fix only the comment (mirrors Phase 64 H-1). The determination is recorded. |
| WR-06: the diarization test seam does not expose the outgoing boundary. | 3 | The route has a documented fetch stub seam (`:124`); the stub captures the request — assert on the captured `content-type` boundary token. |
| WR-07: a timing test is inherently flaky. | 6 | The RED runs K iterations and compares medians with a generous delta; if the delta is not reliably observable, the test pivots to a structural assertion that the failure path performs the equalizing work — recorded in verify-first.log. |
| WR-07: the constant-time wait budget is wrong. | 6 | The budget must exceed the p99 all-hit duration for the max batch (500); the executor measures and documents the chosen budget. |
| WR-08: the 504 poll-ceiling path is hard to drive in a unit test. | 3 | If no `POLL_CEILING_MS` test override exists, assert the 502 path's envelope and note the 504 path coverage gap in the SUMMARY (the operator-speak string fix is still applied + grep-verified). |
| WR-09: neither Option A nor B is cleanly achievable. | 5 | Option C — record the constraint in `.planning/deferred-items.md` with WHY evidence, mark WR-09 partially-mitigated (sentinel documented). Do NOT invent a fragile rewrite (CLAUDE.md hard rule 1). |
| typecheck regression from new imports / interface member. | 2,3,4 | `randomBytes`, `envVarLabel`, the two-arg `AuthError` are ordinary typed surfaces; run `pnpm typecheck` after each task — must stay at the 5-error baseline. |
| Adding `envVarLabel` to `WebSearchProvider` breaks a non-adapter implementer. | 2 | grep all `: WebSearchProvider` / `implements WebSearchProvider` — only tavily + yandex adapters implement it; both get the property in the same commit. |
| A failing test tempts a production hack. | all | CLAUDE.md hard rule 1: the production change here IS the genuine fix. If a HALT arises, log in `.planning/deferred-items.md` with WHY. |
</risk_register>

<output>
After completion, create
`.planning/phases/65-high-findings-api-routes-transcriptions/65-01-SUMMARY.md`.

In the SUMMARY, explicitly record per finding:
- WR-01: the verify-first determination (expect ALREADY-CLOSED by HI-03 — the
  7 sites + their literal); the regression guard test added.
- WR-02: the chosen disposition (drop vs allowlist) + the RED/GREEN SHAs.
- WR-03: the RED/GREEN SHAs; both routes confirmed `code="UNAUTHORIZED"`.
- WR-04: the validator-attached determination (attached → parse dropped;
  not attached → comment corrected) + the RED/GREEN SHAs.
- WR-05: the interface-member shape chosen (property vs method) + the SHAs.
- WR-06: confirmation the boundary is `crypto.randomBytes` + the SHAs.
- WR-07: the timing-mitigation shape chosen + the constant-time budget + the
  RED/GREEN SHAs; whether the RED stayed timing-based or pivoted structural.
- WR-08: confirmation the 502/504 envelopes are canonical `{error:<string>}`
  with no `jobId` + the operator-speak removed; the SHAs.
- WR-09: the chosen option (A/B/C) + full rationale; if C, the
  `deferred-items.md` entry.
- WR-10 + WR-11: confirmation the redacted shapes + the SHAs.
- LOCKER outcome — all 8 lockers green; LOCKER-05 secret-shape discipline
  strengthened.
- `pnpm typecheck` result vs the 5-error baseline.
- The final per-finding closure markers written to
  `api-routes-transcriptions.md` + `REVIEW-INDEX.md`.
- Any divergence from the planner's pre-determination.
</output>
