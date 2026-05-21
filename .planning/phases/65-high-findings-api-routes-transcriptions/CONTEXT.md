# Phase 65 — HIGH findings: api-routes-transcriptions (11 / WR-01..11)

## Background

Pre-publication HIGH-backlog clearance, phase-by-phase by package
(user decision 2026-05-20). Phases 62–64 cleared api-core (5),
api-routes-rest (3), api-routes-conversations (4). This phase clears
the **`apps/api` routes — transcriptions/tokens/agent/realtime/
diarization/streaming** cluster — 11 WARNING-level findings
(`.planning/review/api-routes-transcriptions.md`, WR-01..WR-11). The
reviewer used a BLOCKER/WARNING/INFO scale: 0 BLOCKER, 11 WARNING,
6 INFO. The 11 WARNINGs map to the HIGH backlog in `REVIEW-INDEX.md`;
the 6 INFO (IN-01..06) are MEDIUM-class and OUT OF SCOPE for this
phase.

## The 11 findings (from `.planning/review/api-routes-transcriptions.md`)

**Re-verify each against current code before fixing** (CLAUDE.md hard
rule 3). Phase 62 HI-03 already swept some `ServiceUnavailable(err.message)`
route sites — WR-01 overlaps and may be partially/fully closed; confirm.

### WR-01 — upstream error `.message` flows verbatim through `ServiceUnavailable` to the wire
7 sites: `transcribe.ts:~115`, `reason.ts:~118`, `diarization.ts:~191`,
`agent/web-search.ts:~121`, `tokens/{assemblyai,deepgram,openai-realtime}.ts`.
`throw new ServiceUnavailable(err.message)` trusts the upstream message
is operator-boilerplate; not enforced. LOCKER-05 covers
`bodyText|responseBody|...` but not plain `.message`. **NOTE: Phase 62
HI-03 already converted typed-error route throw sites to code+literal
pairs — these 7 sites may already be fixed. Verify first; if HI-03
covered them, mark WR-01 already-closed.** If any remain, fix to emit a
class-default / code+literal, never the raw upstream `.message`.

### WR-02 — `openai-realtime.ts` echoes upstream 400 body wholesale to the wire
`tokens/openai-realtime.ts:~167-176` — the `upstream: upstream400.upstreamBody`
field surfaces the unredacted upstream blob. Fix: restrict the echo to
a fixed `{code,type,param}` allowlist, never the raw `message`/blob —
or drop the `upstream` field entirely.

### WR-03 — `realtime.ts` + `agent/stream.ts` throw legacy single-arg `AuthError("unauthorized")`
`realtime.ts:~182`, `agent/stream.ts:~145` — the one-arg form yields
`code="AUTH_ERROR"` (class default); every other route uses
`new AuthError("UNAUTHORIZED", "unauthorized")` → `code="UNAUTHORIZED"`.
The non-canonical code breaks i18n `errors.<code>` keying + client
switch-on-code. Fix: use the two-arg form.

### WR-04 — `agent/stream.ts` re-parses the body after `schema.body` already validated it
`agent/stream.ts:~115-159` — registers `schema:{body:AgentStreamRequestSchema}`
then re-runs `AgentStreamRequestSchema.parse(req.body)` in the handler.
Fastify runs `schema.body` BEFORE the handler — the manual parse is
dead defence + double allocation on the hottest paid endpoint, and the
"hijack-ordering" comment is misleading. Fix: drop the redundant parse;
trust the Fastify-validated `req.body` (typed via the type-provider).
NOTE: Phase 64 H-1 established that the `@fastify/type-provider-zod`
validator IS attached — so unlike the conversations routes (where the
inline parse was KEPT), here the declarative schema genuinely runs.
Confirm the type-provider gives a typed `req.body` so the parse can go.

### WR-05 — `agent/web-search.ts` hardcodes provider→envvar-label mapping by name
`agent/web-search.ts:~98-113` — a `provider.name === "tavily" ? ... : "yandex" ? ...`
string fork. A new web-search adapter not added here yields a
misleading "set <provider env vars>" message. Fix: move the metadata
onto the `WebSearchProvider` interface (`provider.envVarLabel()`) in
`lib/web-search/registry.ts`; the route reads it generically.

### WR-06 — `diarization.ts` Speaches branch uses `Math.random()` for the multipart boundary
`diarization.ts:~474-476` — `Math.random()` boundary on a route that
forwards untrusted user audio. A predictable boundary lets an attacker
craft an upload that smuggles a forged form field overriding
`name="model"`. Fix: `crypto.randomBytes(16).toString("hex")`.

### WR-07 — `transcriptions/batch-delete.ts` timing oracle on cross-tenant id existence
`transcriptions/batch-delete.ts:~74-104` — response timing differs
measurably between "all ids hit" and "all ids miss" at large batch
sizes → cross-tenant id-existence oracling. Fix: constant-time wait on
the failure path (or equalize the work). Weigh the simplest robust
mitigation during planning.

### WR-08 — `diarization.ts` 504 envelope is operator-speak + invents an undocumented `jobId` field
`diarization.ts:~345-349` (+ `:257,:274,:281-284,:330-333`) — inline
`reply.code().send({error:<operator-speak string>, jobId})`. Two
issues: operator-facing copy on a user endpoint, and `jobId` is not
part of the canonical `{error:<string>}` envelope. Fix: route these
through the typed-error contract (`throw new ...Error(...)`); drop the
operator-speak; if `jobId` must reach the client it needs a documented
home, not an ad-hoc envelope field. NOTE: Phase 64 H-4 confirmed the
canonical envelope IS `{error:<string>}` (a string), NOT
`{error:{code,message}}` — do not "fix" it to an object.

### WR-09 — `realtime.ts` mutates `req.raw.url` from a magic-string sentinel base
`realtime.ts:~188-191` — `new URL(rawUrl, "http://internal")` then
`req.raw.url = u.pathname + u.search`. Undocumented sentinel base; and
mutating `req.raw.url` mid-request leaks the appended `user` id into
any audit/observability hook running before the proxy upgrade. Fix:
document the sentinel (or assert `rawUrl` is relative); avoid leaking
the user id into shared request state — pass it via a mechanism that
does not mutate `req.raw.url` in place if feasible, or scope the
mutation as late as possible with a comment. Weigh the cleanest fix.

### WR-10 — `transcriptions/list.ts` logs the full `Error` object without redaction
`transcriptions/list.ts:~57-66` — `req.log.warn({ err }, ...)`. The
shared redact policy does not cover `err.message`; if `parseListQuery`
ever embeds raw user cursor text, it lands in Loki. Fix: log only
`{ name: (err as Error).name }` (or a redacted shape), not the raw
`err`.

### WR-11 — `streaming-usage.ts` logs `text_preview` (≤1000 chars of user STT output) to structured logs
`streaming-usage.ts:~76-103` — `text_preview` is logged to pino every
request; the redact policy does not cover it; Loki retention is 30+
days. Fix: drop `text_preview` from the production log (it is
debug-only) OR add it to the redact policy. Dropping is cleaner — STT
output is user content and should not sit in logs.

## Goal

After this phase:
1. WR-01..WR-11 each fixed-and-verified OR confirmed already-resolved
   (WR-01 especially — Phase 62 HI-03 overlap).
2. Each fix lands via strict TDD (RED→GREEN→REFACTOR), atomic commits.
3. Tests cover the regression-shape.
4. `pnpm --filter @openwhispr/api test` green; `pnpm lint:lockers`
   green (8 lockers); `pnpm typecheck` no new errors vs the 5-error
   baseline.
5. `.planning/review/api-routes-transcriptions.md` + `REVIEW-INDEX.md`
   annotated with per-finding closure markers.

## Constraints

- **Strict TDD** — RED→GREEN→REFACTOR; test + production code atomic.
- **Verify-first** — every finding re-confirmed against current code;
  WR-01 / WR-04 explicitly cross-checked against Phase 62/64 changes.
- **Security-sensitive routes** — transcribe/realtime/diarization
  forward untrusted audio + proxy upgrades. WR-06 (boundary nonce) and
  WR-07 (timing oracle) are security fixes — test the regression shape.
- **No mocks of internal logic** — DB/route tests use real Postgres via
  testcontainers; upstream HTTP is a network boundary (mock-LiteLLM /
  hermetic mock OK).
- **No bypassing gitleaks hooks** — CLAUDE.md hard rule 4.
- **Constitutional lockers green** — `pnpm lint:lockers` (8) after every
  finding; coordinate WR-01/WR-02/WR-08/WR-10/WR-11 with LOCKER-05
  (secret-shape-in-error) — the fixes should strengthen, not weaken it.
- **No production code edited "to make tests pass"** — CLAUDE.md hard
  rule 1. HALT + `.planning/deferred-items.md` if blocked.
- **Canonical envelope is `{error:<string>}`** (a string) — Phase 64
  H-4 established this; WR-08 fixes must respect it.
- **Out of scope** — IN-01..06 (INFO/MEDIUM); do not scope-creep.
- **commitlint** — conventional-commit, lowercase subject, ≤ ~72 chars.
- **EN-only** source artifacts.

## Verification gate

Phase passes when:
1. WR-01..WR-11 each have a RED test + GREEN fix on main, OR a
   documented already-closed disposition.
2. `pnpm --filter @openwhispr/api test` green.
3. `pnpm lint:lockers` green (8 lockers).
4. `pnpm typecheck` — no new errors vs the 5-error baseline.
5. Spot-check: each fixed finding's regression test references its ID
   (WR-01..11).
6. `git log --oneline` shows the expected RED/GREEN commits.
7. `.planning/review/api-routes-transcriptions.md` + `REVIEW-INDEX.md`
   annotated.

## Reference

- `.planning/review/api-routes-transcriptions.md` — WR-01..WR-11 + IN-01..06
- `apps/api/src/routes/{transcribe,reason,diarization,realtime}.ts`
- `apps/api/src/routes/tokens/{assemblyai,deepgram,openai-realtime,_call-provider}.ts`
- `apps/api/src/routes/agent/{stream,web-search}.ts`
- `apps/api/src/routes/transcriptions/{list,batch-delete}.ts`
- `apps/api/src/routes/streaming-usage.ts`
- `apps/api/src/lib/web-search/registry.ts` — WR-05
- `apps/api/src/errors.ts` — `AuthError`, `ServiceUnavailable` (WR-01,03,08)
- `packages/observability/src/redact.ts` — redact policy (WR-10,11)
- Phase 62 (HI-03 — typed-error message echo): `.planning/phases/62-high-findings-api-core/`
- Phase 64 (H-4 — canonical envelope shape): `.planning/phases/64-high-findings-api-routes-conversations/`
- CLAUDE.md hard rules: 1, 3, 4; LOCKER-04, LOCKER-05
