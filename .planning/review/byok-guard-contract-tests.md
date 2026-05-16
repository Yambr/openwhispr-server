# Review: byok-guard + contract-tests

Branch: main @ 1832f28
Scope: packages/byok-guard/src/** + packages/contract-tests/src/**

## Summary
- Files: 9 (byok-guard: 2; contract-tests: 7)
- Findings: CRITICAL=0 HIGH=3 MEDIUM=5 LOW=4
- Top 3 risks:
  1. **Package-boundary inversion** — production code (`apps/api/src/routes/{check-user,verification-status,delete-account,reason,diarization}.ts`) imports wire schemas from `@openwhispr/contract-tests`, a *test-helper* package. Shipping `contract-tests` as a public artifact forces consumers to pull a test harness into prod, and bakes test-package versioning into the API contract. Schemas belong in `@openwhispr/wire-schemas`. HIGH.
  2. **`redactUrl` only masks `URL.password`** — query-string credentials (`?api_key=`, `?token=`, AWS SigV4 `?X-Amz-Signature=…`), userinfo `username`, and bearer-token-looking opaque path segments pass through `new URL().toString()` unchanged. Today the only caller is the storage row's `S3_ENDPOINT` echo, but an operator using a presigned/signed S3 URL would leak the signature to stderr at boot. The header on `redact-url.ts` describes the function as "tiny" and the doc-string promises only password masking — but the file lives in the package the hunt-list expects to be the *canonical* redactor. Misalignment between actual scope and ambient expectations. HIGH.
  3. **`fetchAndParse` envelope assertion has a silent-skip branch** — `ErrorEnvelope.parse()` runs ONLY when the non-2xx body is a parseable JSON object. Non-2xx responses with `text/plain` bodies, empty bodies, or invalid JSON silently pass — the very wire-conformance regressions the helper exists to catch. Contract tests would go green on a server that erroneously returns `"unauthorized"` (plain string) instead of `{error:"unauthorized"}`. HIGH.

## Findings

### HIGH

**H-01 — Production code imports test-helper schemas (package-boundary inversion)**
File: `packages/contract-tests/src/schemas.ts:1-303`
Consumers in production source:
- `apps/api/src/routes/reason.ts:36` → `ReasonRequest, ReasonResponse`
- `apps/api/src/routes/check-user.ts:22` → `CheckUserRequest, CheckUserResponse`
- `apps/api/src/routes/verification-status.ts:21`
- `apps/api/src/routes/delete-account.ts:54` → `DeleteAccountResponse`
- `apps/api/src/routes/diarization.ts:43` → `DiarizationResponse`

`@openwhispr/contract-tests` is published as a test harness (the package self-describes as "Phase 0 contract-test harness shell"). Production handlers cannot depend on it without (a) shipping test-only deps (`tough-cookie`, `pg` for sign-in fixture, etc.) into runtime, (b) coupling release cadence of API to test-helper, (c) confusing OSS consumers reading the npm tarball who will see a "test" package required by the server. The schemas in `schemas.ts` (ErrorEnvelope, Health, CheckUser, Verification, Transcribe, Reason, Diarization, StreamChunk family, StreamingTokenResponse, OpenAIRealtimeTokenResponse, UsageResponse) should live in `@openwhispr/wire-schemas` next to the Phase 5 schemas already there; `contract-tests` should re-export or import from wire-schemas. Per the hunt-list rubric this is "Contract-tests schemas — they MUST re-export from `packages/wire-schemas`, not duplicate" → MEDIUM by that rubric, but the production-pulling-test-package angle elevates it to HIGH for a pre-release review.

**H-02 — `redactUrl` does not mask query-string credentials or userinfo username**
File: `packages/byok-guard/src/redact-url.ts:28-38`
`new URL(raw).toString()` preserves `?api_key=…`, `?token=…`, `?X-Amz-Signature=…`, and the userinfo `username` component verbatim. The only field masked is `.password`. Concrete leak path: an operator setting `S3_ENDPOINT="https://AKIA…@host/bucket?X-Amz-Signature=abcd…"` (presigned URL misuse — plausible during ops debugging) would have the full signature echoed to stderr in the BYOK fatal record. Fix options: (a) also strip `u.search` to `?***` when present, (b) document the helper as "URL-password-only" and rename to `redactUrlPassword`, or (c) extend with a Set of sensitive query-param names. The hunt-list lists `api_key=`, `key=`, `token=`, Bearer, Basic, `sk-`, `sk-ant-`, `AIza`, `AKIA` as required patterns; *none* of these are matched. The vendored twin at `apps/api/src/lib/redact-url.ts` has the same gap, so a port-back is needed there too.

**H-03 — `fetchAndParse` silently passes when the error body isn't an object**
File: `packages/contract-tests/src/helpers/http.ts:31-35`
```ts
if (!res.ok && body !== undefined && typeof body === "object") {
  ErrorEnvelope.parse(body);
}
```
- 4xx/5xx with `Content-Type: text/plain` body → JSON.parse throws → catch sets `body = text` (string) → `typeof body === "object"` is false → **envelope assertion skipped**.
- 4xx/5xx with empty body → `text.length === 0` → `body` stays `undefined` → assertion skipped.
- 4xx/5xx with `null` literal → `typeof null === "object"` but `ErrorEnvelope.parse(null)` rejects with the right error (this one branch is fine).

The whole point of the helper (per its header comment "Every non-2xx response body MUST parse as ErrorEnvelope (D-13 / WIRE-17)") is to enforce conformance. Today, the most-likely-regression cases (raw string, empty body) silently pass. Fix: when `!res.ok`, require body to be a JSON object — anything else throws.

### MEDIUM

**M-01 — `contract-tests/src/schemas.ts` duplicates wire-shape source-of-truth**
File: `packages/contract-tests/src/schemas.ts` entire file.
Even after H-01 is resolved by moving schemas to `wire-schemas`, the package currently *is* the source of truth for Phase 2–4 wire shapes (the file header literally says "Single zod source of truth for Phase 2 wire shapes"). `@openwhispr/wire-schemas` is the canonical home — the duplication risk is that `wire-schemas` will grow Phase-2 shapes and the two will drift. Consolidate or re-export.

**M-02 — `harnessLoaded()` is dead code outside its own self-test**
File: `packages/contract-tests/src/index.ts:1-6`
Only consumer is `packages/contract-tests/tests/unit/loads.test.ts`, which exists only to call this function. Phase 0 placeholder per its own comment; nothing else has wired up to the harness barrel. Either delete or replace with the real exports the package surfaces (`schemas`, `env`, `helpers/*`).

**M-03 — `STREAMING_HELPERS_PLACEHOLDER` is a Phase-2 stub with no consumers**
File: `packages/contract-tests/src/helpers/streaming.ts:1-7`
Self-describes as "implement once /api/agent/stream lands" — Phase 4 is past. Zero importers. Delete the placeholder export or replace with the actual NDJSON line-flush helpers Phase 4 needs.

**M-04 — `BACKEND_URL_EXPLICIT` is exported but unused outside its own coverage test**
File: `packages/contract-tests/src/env.ts:27-28`
Only reference outside `env.ts` is `tests/unit/probe-backend-redirect-error.test.ts`, which exists specifically to keep coverage of the constant green. No real test consumes the skip-vs-fail signal it was designed for; in practice tests use `await probeBackend()` directly. Either wire the constant into actual `describe.skipIf` decisions or delete it (and the dynamic re-import coverage harness).

**M-05 — `buildHint` `redactedEcho` parameter is reached from only one of five rows**
File: `packages/byok-guard/src/index.ts:125-131, 158`
Only `storageRow` passes `redactedEcho`; the other four rows always call `buildHint(overlay)`. The second branch of the function is exercised by one row out of five. Either (a) make every row echo its observed value (consistent operator UX — they always see "Observed value: …"), or (b) inline the storage-specific echo into `storageRow` and simplify `buildHint` to take only the overlay. Today it's partially-dead surface that obscures the policy.

### LOW

**L-01 — `signInFixture` does not assert rowCount on the email_verified FLIP**
File: `packages/contract-tests/src/helpers/sign-in-fixture.ts:144-149`
If the fixture row doesn't exist (typo in test email, fixture not seeded), the UPDATE silently affects 0 rows; `postSignIn` then 401s with a less clear error than "fixture user not seeded". Defensive `if (rowCount === 0) throw` would make the failure point obvious.

**L-02 — `cookie-jar.ts` fallback path corrupts multi-cookie responses**
File: `packages/contract-tests/src/helpers/cookie-jar.ts:33-39`
When `getSetCookie` is unavailable, falls back to `headers.get("set-cookie")` which per WHATWG fetch concatenates multiple `Set-Cookie` headers with commas — invalid for tough-cookie. Node 24's undici always has `getSetCookie` so this is currently inert, but the fallback is misleading; either delete it (we require Node 24 LTS) or document it as "only correct when server emits exactly one Set-Cookie."

**L-03 — `audioMultipartBody` filename is interpolated verbatim into Content-Disposition**
File: `packages/contract-tests/src/helpers/multipart.ts:31`
A filename containing `"` or `\r\n` would corrupt the multipart envelope. Test-only helper with hardcoded default, so realistic risk is zero — but if anyone wires it to user input it breaks. Quote/escape or validate the filename.

**L-04 — Magic 24-bit XFF counter seeded with `Math.random()` is non-deterministic across reruns**
File: `packages/contract-tests/src/helpers/sign-in-fixture.ts:43`
`xffCounter = Math.floor(Math.random() * 0xff_ff_ff)` — fine for rate-limit-bucket isolation but makes test-failures non-reproducible (cannot replay the same X-Forwarded-For sequence). Seed from a deterministic env (`VITEST_WORKER_ID`, or `process.pid`) for reproducibility. The rationale comment cites the worker-collision concern; `VITEST_POOL_ID`/`VITEST_WORKER_ID` solves it without `Math.random`.

## Dead code

- `packages/contract-tests/src/index.ts` — `harnessLoaded()` (M-02)
- `packages/contract-tests/src/helpers/streaming.ts` — entire file's only export `STREAMING_HELPERS_PLACEHOLDER` (M-03)
- `packages/contract-tests/src/env.ts:27-28` — `BACKEND_URL_EXPLICIT` (M-04)
- `packages/byok-guard/src/index.ts:127` — partially-dead `redactedEcho` branch of `buildHint` (M-05)

No TODO/FIXME/HACK/XXX/TEMP/WORKAROUND comment markers found in either package's `src/`.

## Suppressed warnings

None found. No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `biome-ignore`, `as any`, or `as unknown as` in scope. Two `as` casts in `cookie-jar.ts:34-36` are narrowing the WHATWG `Headers` type to detect `getSetCookie()` — defensible, not suppressions.

No hardcoded real API keys (`sk-…`, `sk-ant-…`, `AIza…`, `AKIA…`) in scope. The fixture password `"test-PW-12345!"` in `sign-in-fixture.ts:18` is a documented seeded-fixture password tied to `packages/data/src/seed/conformance.ts`, not a production credential — acceptable.

No hardcoded real URLs. `http://api.localhost` defaults in `env.ts` are documented Traefik defaults — acceptable.

## Notes

- **`byok-guard` core logic is sound.** The BYOK matrix ordering, first-violation-only behavior, NODE_ENV gate on SMTP, throw-vs-process.exit discipline per SR-19.3/D-09, lazy logger construction, and synchronous Pino destination for flush-before-throw are all correctly implemented. The package fulfills its narrow charter.
- **The `redactUrl` vendoring duplication** (`packages/byok-guard/src/redact-url.ts` vs `apps/api/src/lib/redact-url.ts`) is documented in the header and justified by the workspace-boundary one-way rule. Acceptable as designed, *but* H-02 applies to both copies — fixing one without the other will create a real divergence.
- **`signInFixture` verified=false branch** correctly handles try/finally for REVERT (both on `postSignIn` success and throw) and pool cleanup. Owner-pool requirement is gated behind `DATABASE_URL_OWNER` env — production-safe.
- **Severity calibration:** I did not raise H-01/H-02/H-03 to CRITICAL because (a) no secret currently leaks in the *configured* call sites — the leak path in H-02 requires operator misuse; (b) the schema duplication doesn't break wire conformance today, only ships a test package as a production dep. If the hunt-list rubric strictly enforces "byok-guard redact missing a known token format = CRITICAL," H-02 reclassifies upward.
