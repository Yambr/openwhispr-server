# Adversarial Code Review — LiteLLM/Agent/BYOK Route Handlers

**Reviewed:** 2026-05-20
**Branch:** `main` (HEAD 6e43588)
**Depth:** standard + targeted-deep on credential / RLS / multipart paths
**Files reviewed:** 17

## Scope

```
apps/api/src/routes/transcriptions/{batch-create,batch-delete,create,delete,list,shape}.ts
apps/api/src/routes/tokens/{_call-provider,_parse-ttl,assemblyai,deepgram,openai-realtime}.ts
apps/api/src/routes/v1/keys/{create,list,revoke,v1-envelope}.ts
apps/api/src/routes/agent/{stream,translate-tools,web-search}.ts
apps/api/src/routes/transcribe.ts
apps/api/src/routes/diarization.ts
apps/api/src/routes/realtime.ts
apps/api/src/routes/reason.ts
apps/api/src/routes/streaming-usage.ts
```

Tests, `__fixtures__`, plugins, `.planning/`, and `docs/` are explicitly out of scope.

---

## Summary

Overall the scope is in good shape for the publication gate. Credential paths through the LiteLLM proxy and the realtime WSS proxy use a hard "strip client auth, inject master key" pattern (`realtime.ts:63-65`, plus `litellm-client` building fresh header dicts), the v1/keys surface uses Argon2id with the clear-text PAK only emitted at creation, and every route in scope carries `schema` + `rateLimit` config. No `as any`, no `@ts-expect-error`, no `NODE_ENV` branches, no hardcoded secret-shape literals, no `child_process` calls, no production-code edits to make tests pass.

**Net classification: 0 BLOCKER, 11 WARNING, 6 INFO.** None of the warnings are exploitable BYOK leaks or RLS bypasses — they are robustness, error-shape consistency, and architectural-coupling issues that should be cleaned up before public publication so the repo reads as audit-ready.

Most material findings:
- **WR-01** — `ServiceUnavailable(err.message)` propagates upstream-error strings verbatim to the wire envelope at five sites. `MissingProviderKeyError.message` is operator-actionable today, but the constraint is not enforced anywhere; LOCKER-05 truncates `bodyText|responseBody|...` but not `.message`. Defence-in-depth gap.
- **WR-02** — `openai-realtime.ts:172` echoes `upstream.upstreamBody` verbatim on upstream 400, no allowlist. Benign today (request body has no secrets) but trivially weaponizable if the request schema gains a free-form field.

---

## Findings

### BLOCKER

_None found._

### WARNING

#### WR-01 — Upstream error `.message` flows verbatim through `ServiceUnavailable` to the wire envelope

**Status:** ALREADY-CLOSED — verified 2026-05-21, Phase 65 — Phase 62 HI-03 swept all 7 throw sites to code+literal pairs (`ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable")` / `TypedServiceUnavailable("WEB_SEARCH_*", "Service temporarily unavailable")`); the upstream `.message` is logged server-side only. No production fix; regression guard test added (commit `4a751c18`).

**Files / lines:**
- `apps/api/src/routes/transcribe.ts:115` — `throw new ServiceUnavailable(err.message);` for `MissingProviderKeyError`.
- `apps/api/src/routes/reason.ts:118` — same pattern.
- `apps/api/src/routes/diarization.ts:191` — same pattern for `MissingPyannoteKeyError`.
- `apps/api/src/routes/agent/web-search.ts:121` — `throw new TypedServiceUnavailable("WEB_SEARCH_PROVIDER_KEY_MISSING", e.message)` for `MissingProviderKeyError` from the registry.
- `apps/api/src/routes/tokens/assemblyai.ts:106`, `tokens/deepgram.ts:72`, `tokens/openai-realtime.ts:185` — `throw new ServiceUnavailable(r.message)` where `r.message` is built by `_call-provider.ts:buildMessage`.

**Issue.** All sites trust that `err.message` is operator-actionable boilerplate. Today the constructors in `litellm-client`, `pyannote-client`, and `_call-provider.ts` assemble messages from constant strings + env-var names only. That invariant is not enforced anywhere — a future error-class refactor (e.g. adding upstream-derived remediation hints) silently puts upstream-controlled text on the wire. LOCKER-05 truncates `bodyText|responseBody|upstreamPayload|response|body` at construction; the plain `.message` field is not covered.

**Why WARNING, not BLOCKER.** No currently-reachable code path produces an attacker-controllable `message`.

#### WR-02 — `openai-realtime.ts` echoes upstream body wholesale to the wire on 400

**Status:** CLOSED 2026-05-21 — Phase 65, commit `4a751c18` — the raw `upstream: upstream400.upstreamBody` field is dropped from the 400 envelope; the upstream blob is logged server-side only. Disposition: drop (not allowlist) — no wire-doc consumer needs `code`/`type`/`param`.

**File:** `apps/api/src/routes/tokens/openai-realtime.ts:167-176`

```ts
if (upstream400) {
  return reply.code(400).send({
    error: {
      code: "UPSTREAM_REJECTED",
      message: `${PROVIDER_LABEL} rejected the request`,
      upstream: upstream400.upstreamBody, // raw, unfiltered
      requestId: req.id,
    },
  });
}
```

`_call-provider.ts:139-150` parses the upstream 400 body as JSON (text fallback otherwise) and surfaces the unredacted blob. OpenAI's error shape is benign today, but the field is structurally untyped on our side. If `OpenAIRealtimeTokenRequest` ever gains a free-form field (e.g. `metadata`) and OpenAI echoes the offending value in `error.param`, the desktop UI receives attacker-controlled text.

**Describe-only fix shape:** restrict the echo to a fixed `{ code, type, param }` allowlist, never the raw `message`; or drop `upstream` entirely.

#### WR-03 — `realtime.ts:182` and `agent/stream.ts:145` throw `new AuthError("unauthorized")` (legacy single-arg form), inconsistent with every other route in scope

**Status:** CLOSED 2026-05-21 — Phase 65, commit `c8b5d9ae` — both routes now throw the two-arg `AuthError("UNAUTHORIZED", "unauthorized")` form so `code === "UNAUTHORIZED"`, matching every other in-scope route.

**Files:** `apps/api/src/routes/realtime.ts:182`, `apps/api/src/routes/agent/stream.ts:145`

Per `apps/api/src/errors.ts:46-55`, the one-arg form sets `code = "AUTH_ERROR"` (class default) and `message = "unauthorized"`. Every other route in scope (transcribe, reason, diarization, transcriptions/*, v1/keys/*, web-search, streaming-usage) uses the two-arg form `new AuthError("UNAUTHORIZED", "unauthorized")` to produce the spec-mandated `code = "UNAUTHORIZED"`. Realtime + agent/stream emit a non-canonical code that downstream i18n keying (`errors.<code>` lookup) and client switch-on-code logic will miss.

#### WR-04 — `agent/stream.ts:159` re-parses the body after `schema.body` already validated it

**Status:** CLOSED 2026-05-21 — Phase 65, commit `c8b5d9ae` — determination: the zod-type-provider's `validatorCompiler` IS attached (`plugins/zod-type-provider.ts:21`, registered at the buildApp boundary), so the declarative `schema.body` validates the body before the handler. The route now registers via `app.withTypeProvider<ZodTypeProvider>()` for a typed `req.body` and the redundant inline `AgentStreamRequestSchema.parse()` is dropped. (Distinct from Phase 64 H-1's conversations routes, which do NOT declare `schema.body` and kept their inline parse.)

**File:** `apps/api/src/routes/agent/stream.ts:115-159`

The route registers `schema: { body: AgentStreamRequestSchema }` (LOCKER-04 compliance), then inside the handler does `AgentStreamRequestSchema.parse(req.body ?? {})`. The comment justifies this as needed for hijack-ordering, but Fastify runs `schema.body` validation **before** the handler executes — well before any `reply.hijack()`. The manual parse is dead defence that doubles allocation cost on the hottest paid endpoint in the codebase, and the misleading comment will trip future maintainers.

#### WR-05 — `agent/web-search.ts:98-113` hardcodes provider→envvar-label mapping by name; drift-prone

**Status:** CLOSED 2026-05-21 — Phase 65, commit `b41a57b8` — a `readonly envVarLabel: string` member was added to the `WebSearchProvider` interface; the tavily + yandex adapters supply their own label; the route reads `provider.envVarLabel` generically — no `provider.name ===` string fork remains.

**File:** `apps/api/src/routes/agent/web-search.ts:98-113`

```ts
const envVarName =
  provider.name === "tavily"
    ? "TAVILY_API_KEY"
    : provider.name === "yandex"
      ? "YANDEX_SEARCH_API_KEY + YANDEX_SEARCH_FOLDER_ID"
      : "<provider env vars>";
```

If a new web-search adapter is added to `lib/web-search/registry.ts` but not here, the operator gets `Tavily not configured (set <provider env vars> in .env)` — misleading. The metadata belongs on the `WebSearchProvider` interface (`provider.envVarLabel()`), not as a string-equality fork in the route.

#### WR-06 — `diarization.ts` Speaches branch uses non-cryptographic boundary nonce

**Status:** CLOSED 2026-05-21 — Phase 65, commit `73661033` — the `Math.random()` boundary segment is replaced with `crypto.randomBytes(16).toString("hex")`; a regression test proves the boundary carries a 32-hex-char cryptographic segment and two successive boundaries differ.

**File:** `apps/api/src/routes/diarization.ts:474-476`

```ts
const boundary = `----owsp-speaches-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 10)}`;
```

`Math.random()` is acceptable for boundary uniqueness in isolation, but the route forwards untrusted user-uploaded audio bytes. If an attacker can predict the boundary (Mersenne-Twister state recoverable after enough samples) they can craft an upload whose bytes contain the boundary and smuggle a forged form field overriding `name="model"`. Replace with `crypto.randomBytes(16).toString("hex")`.

#### WR-07 — `transcriptions/batch-delete.ts` atomicity check exposes cross-tenant id-existence timing oracle

**Status:** CLOSED 2026-05-21 — Phase 65, commit `59b7d732` — the failure path now waits out a constant-time wall-clock floor (`FAILURE_PATH_FLOOR_MS = 750`, measured from handler entry) before throwing `NotFoundError`, so an all-miss batch is no longer a fast-fail and response timing no longer oracles cross-tenant id existence. The RED stayed timing-based: a structural floor assertion (an all-miss 500-id batch takes ≥ the floor) plus a comparative median assertion (all-miss median not systematically faster than all-hit), both against real Postgres.

**File:** `apps/api/src/routes/transcriptions/batch-delete.ts:74-104`

The route compares `returnedIds.length !== requestedIds.length` to throw `NotFoundError`. RLS hides cross-tenant rows; the route also constrains `user_id = ${userId}::uuid AND deleted_at IS NULL`. The route correctly conflates three failure modes into one 404, but the response timing differs measurably between "all 500 ids hit" (full UPDATE) and "all 500 ids miss" (empty RETURNING). Cross-tenant id-existence oracling via timing remains feasible at large batch sizes. Mitigate with a constant-time wait on the failure path.

#### WR-08 — `diarization.ts:345` 504 envelope is operator-facing copy emitted to end users + invents undocumented field

**Status:** CLOSED 2026-05-21 — Phase 65, commit `73661033` — the 502 (job failed/cancelled) and 504 (poll-ceiling) sends now emit the canonical `{error:<string>}` envelope with no inline `jobId` field; the 504 operator-speak ("corporate LiteLLM override with self-hosted Speaches") is replaced with user-facing copy referencing the documented Idempotency-Key resume mechanism. Scope: the jobId-carrying 502/504 sites only — the envelope-correct non-jobId inline sends (`:284`, `:507+`, the 409s) were already canonical and out of scope.

**File:** `apps/api/src/routes/diarization.ts:345-349`

```ts
return reply.code(504).send({
  error:
    "diarization exceeded 5-minute ceiling; for files > 5min consider corporate LiteLLM override with self-hosted Speaches",
  jobId,
});
```

Two issues: (a) the message is operator-speak ("corporate LiteLLM override") shown on a user-facing endpoint; (b) the `jobId` field is invented inline and is not part of the canonical `{error: <string>}` envelope used by `errors.ts`. Several other inline `reply.code().send({error, jobId})` shapes appear at `diarization.ts:257`, `:274`, `:281-284`, `:330-333` — the route bypasses the typed-error contract.

#### WR-09 — `realtime.ts:188-191` mutates `req.raw.url` from a magic-string sentinel base

**Status:** CLOSED 2026-05-21 — Phase 65, commit `970e17bd` — Option A (document + assert relative). Rationale: `@fastify/http-proxy@11.4.4` exposes no per-request upstream-URL rewrite hook (only `wsClientOptions.rewriteRequestHeaders`, headers-only), so Option B is not cleanly achievable; Option A is the genuine improvement. The `"http://internal"` sentinel parser base is now documented; the preHandler asserts `req.raw.url` is relative (rejects loudly if absolute, surfacing the silent scheme/host-drop bug); the in-place mutation stays as the last preHandler statement with a comment on the deliberate timing.

**File:** `apps/api/src/routes/realtime.ts:188-191`

```ts
const rawUrl = req.raw.url ?? req.url;
const u = new URL(rawUrl, "http://internal");
u.searchParams.set("user", user.id);
req.raw.url = u.pathname + u.search;
```

Two issues:
1. `"http://internal"` is a magic-string base URL with no comment explaining the intent. If `rawUrl` ever becomes absolute (test harness, proxy injection), the sentinel is silently dropped and `req.raw.url` ends up with `pathname + search` of the absolute URL — losing scheme/host without warning.
2. Mutating `req.raw.url` mid-request is read-modify-share state on `IncomingMessage`. Any other hook (audit, observability) running between this mutation and the proxy upgrade sees the URL with the user id appended — placing the user id into log contexts that wouldn't otherwise carry it.

#### WR-10 — `transcriptions/list.ts:64` logs full `Error` object without redaction

**Status:** CLOSED 2026-05-21 — Phase 65, commit `1c71fafc` — `req.log.warn` now logs `{ name: (err as Error).name }` instead of the raw `err` Error object, so `err.message` cannot leak user cursor text into Loki.

**File:** `apps/api/src/routes/transcriptions/list.ts:57-66`

```ts
} catch (err) {
  req.log.warn({ err }, "transcriptions/list: invalid query");
  throw new ValidationError("INVALID_QUERY", "invalid query");
}
```

The wire envelope is correctly bypass-free, but the unredacted `err` is handed to pino. The shared `@openwhispr/observability/redact` policy is a fixed path allowlist — `err.message` is not redacted. If `parseListQuery` ever embeds raw user-supplied cursor text in its message, it lands in Loki. Pass `{ name: (err as Error).name }` only, or extend the redact policy.

#### WR-11 — `streaming-usage.ts:82-103` logs `text_preview` (up to 1000 chars of user STT output) to structured logs

**Status:** CLOSED 2026-05-21 — Phase 65, commit `1c71fafc` — `text_preview` (and the now-dead `previewCap` local) is dropped from the structured log; `text_sha256` + `text_length` (a hash + a count, not raw content) stay. User STT content no longer reaches 30-day Loki retention.

**File:** `apps/api/src/routes/streaming-usage.ts:76-103`

The route observes D-13 for the **ledger** (text never persisted) but logs `text_preview` to pino on every request. The shared redact policy does not cover `text_preview`. Loki retention is 30+ days. Either add `text_preview` to the redact policy or drop the field on the production profile (it's debug-only).

### INFO

#### IN-01 — `tokens/_call-provider.ts:44-56` mutates the process-wide global undici dispatcher on first call
The "detect default Agent by constructor.name" heuristic is fragile and entangles the tokens routes with global undici state for the remainder of the process. Other modules that try to install their own per-call dispatcher inherit the 3s connect ceiling. Move to a boot-time install in `apps/api/src/index.ts`.

#### IN-02 — `realtime.ts:125-146` carries `LegacyWsClientOptions` typed-cast workaround for `@fastify/http-proxy@11.4.4`
Comment is thorough and references commit `3bcc879` as proof. This is accumulating tech debt in a security-critical route. Open upstream issue or migrate to a pre-upgrade hook; the public-publication audience will flag this artefact.

#### IN-03 — `UNLIMITED_REMAINING = 999_999_999` magic constant duplicated
**Files:** `transcribe.ts:63`, `streaming-usage.ts:45`. Same literal, same semantics. Centralise in `lib/quota.ts` or wire-schemas.

#### IN-04 — `reason.ts:74-78` `MODEL_PROVIDER` table is misleading under corporate LiteLLM override
The route returns `provider: "openrouter"` for three model aliases unconditionally. Under a corporate LiteLLM override (Bedrock-backed, internal vLLM, etc.) the field is a lie. Either drop it or extract from upstream response metadata.

#### IN-05 — `diarization.ts:232-242` dual truncation detection (thrown `FST_REQ_FILE_TOO_LARGE` + `.truncated` boolean)
The thrown-code path and the boolean-flag path are both checked. `@fastify/multipart` documents the thrown path as canonical; the `.truncated` poll is brittle backup. Pick one.

#### IN-06 — `agent/stream.ts:87-108` and `:326-340` use `try { ... } catch {}` for raw socket writes
The "socket closed mid-write" defence is correct, but empty catches violate the codebase's no-swallowed-errors discipline. Log `req.log.debug` so operators can observe disconnect-during-finish rates.

---

## Dead Code

Every exported symbol in scope has at least one in-tree, non-test importer:

| Symbol | File | Importer(s) |
|---|---|---|
| `rowToCloudTranscription`, `CloudTranscriptionRow` | `transcriptions/shape.ts` | `transcriptions/{batch-create,create,list}.ts` |
| `translateLegacyTools`, `prependSystemPrompt` | `agent/translate-tools.ts` | `agent/stream.ts` |
| `callProvider`, `CallProviderResult`, `CallProviderOptions` | `tokens/_call-provider.ts` | `tokens/{assemblyai,deepgram,openai-realtime}.ts` |
| `parseTtlSeconds` | `tokens/_parse-ttl.ts` | `tokens/{assemblyai,deepgram}.ts` |
| `httpToWsScheme`, `buildRewriteRequestHeaders` | `realtime.ts` | self + dedicated unit tests |
| `rowToApiKey`, `ApiKeyRow` | `v1/keys/list.ts` | `v1/keys/{create,revoke}.ts` |
| `withV1Envelope`, `registerV1EnvelopeErrorHandler` | `v1/keys/v1-envelope.ts` | `v1/keys/{create,list,revoke}.ts` |
| `webSearchRegistry`, `resolveWebSearchProvider` (re-exports) | `agent/web-search.ts` | `apps/api/src/lib/web-search/registry.ts` |

`__test` (`tokens/_call-provider.ts:185`) is exposed for branch-coverage tests. Acceptable per project convention.

---

## Suppressed Warnings

**None in scope.** No `as any`, `as unknown as`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `eslint-disable`, or `biome-ignore` in any of the 17 reviewed source files.

The only `as` cast worth noting is `realtime.ts:146` — `const wsClientOptions: LegacyWsClientOptions = { ... }` uses a typed local extension rather than a suppression, the explicit LOCKER-02 preferred pattern. (Underlying upstream-types debt is tracked as IN-02.)

The `apps/api/src/routes/transcriptions/__tests__/setup.ts:111` `as unknown as` cast is in a test file (out of scope).

---

## LOCKER Compliance Snapshot

| Locker | Check | Status |
|---|---|---|
| LOCKER-01 (no NODE_ENV in runtime paths) | grep `NODE_ENV` / `process.env.NODE_ENV` in scope | clean (0 hits) |
| LOCKER-02 (no type suppressions) | grep `as any` / `as unknown as` / `@ts-*` | clean (0 hits in source) |
| LOCKER-03 (no hardcoded host/UUID/secret-shape) | grep `localhost` / `127.*` / `:3000` / UUID / `sk-` / `AKIA` | clean; `"http://internal"` sentinel (WR-09) is a non-secret URL parser hint |
| LOCKER-04 (schema + rateLimit per route) | every `app.route` declaration | clean — every route carries `config: { rateLimit: ... }`; `transcriptions/list.ts` + `agent/stream.ts` carry explicit `schema`; multipart routes (transcribe, diarization) skip body schema by design with documented justification |
| LOCKER-05 (Error body truncation) | error classes defined in scope | n/a (no Error subclasses defined here; defence-in-depth gap surfaces as WR-01 for the consumer side) |
| LOCKER-06 (spawn/exec credential interpolation) | grep `spawn` / `execSync` / `child_process` | clean (0 hits) |

---

## RLS / Tenant Context

Every DB-touching route in scope routes through `withTenant(deps.db, tenantId, async (tx) => ...)`:
- `transcribe.ts:135`, `reason.ts:137`, `streaming-usage.ts:106`
- `transcriptions/{batch-create,batch-delete,create,delete,list}.ts`
- `v1/keys/{create,list,revoke}.ts`
- `agent/web-search.ts:152`

No raw `deps.db.execute` / `pool.query` calls bypassing the tenant GUC anywhere in scope.

---

## CLAUDE.md Hard Rule 1 (no production code "fixed to make tests pass")

No evidence of production code being modified solely to satisfy failing tests. All defensive coercions / fallback constants in scope carry explicit threat-model references (T-04-01, T-04-04, T-05-09, D-29, etc.) and are mirrored across multiple routes — they predate the test files.

---

_Reviewed: 2026-05-20 by gsd-code-reviewer (Opus 4.7)_
_Depth: standard + targeted-deep on credential & multipart paths_
_Files reviewed: 17_
