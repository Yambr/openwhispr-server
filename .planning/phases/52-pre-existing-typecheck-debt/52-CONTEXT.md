# Phase 52 — Pre-existing typecheck + biome debt cleanup

**Created:** 2026-05-17
**Predecessor:** Phase 51 (REVIEW fix-cycle, CLOSED at `85519bd` — 12/12 CRITICAL + 36/39 HIGH closed). Phase 51's `make verify` surfaced stages 2/3 failures in files Phase 51 did NOT touch — same class as the 11 pre-existing diarization fails the user explicitly carved out as "not my concern" during Phase 51 execution. Phase 52 closes that residual debt before pre-OSS publication.

## Goal (Core Value link)

Unblock `make verify` exit-0 so the constitutional CI gate (Stage 2 biome + Stage 3 typecheck) passes on `main`. Pre-OSS publication requires a clean verify pipeline — operators evaluating the project run `make verify` against a fresh clone as a smoke test.

## Scope

### IN scope

1. **Stage 3 typecheck — `packages/litellm-client` (6 errors, first to fail, blocks cascade)**
   - `src/errors.ts:63` — TS2564 `bodyText` no initializer (Object.defineProperty pattern not seen by TS)
   - `src/index.ts:60` — TS2375 Dispatcher exactOptionalPropertyTypes drift (undici 7.x type change)
   - `src/index.ts:398,525,545` — TS2345 `ResponseData<unknown>` vs `ResponseData<null>` (undici 7.x generic default change)
   - `src/index.ts:401` — TS2322 same cascade in method signature

2. **Stage 3 typecheck — cascade revealed after litellm-client fix (~21 errors across)**
   - `packages/data/src/encryption/lens.ts` — `CleanedWhere` symbol drift (better-auth@1.6.9 removed re-export; type lives in `@better-auth/core` peer)
   - `apps/worker/src/lib/typed-queue.ts:52,56` — BullMQ return-type wrapping `Promise<Promise<Job>>` (Awaited<> missing)
   - `apps/worker/src/lib/with-tenant-context.ts:114,133` — `unknown → AttributeValue | TenantContext` from `z.infer<ZodTypeAny>.tenant_id`
   - `apps/api/src/auth.ts:213` — TS7022 implicit-any recursive `fallbackLog`
   - `apps/api/src/auth.ts:279` — TS4104 `readonly` → mutable mismatch for `GenericOAuthConfig[]`
   - `apps/api/src/lib/argon2-keys.ts:29,38` — TS2748 ambient const enum + verbatimModuleSyntax
   - `apps/api/src/lib/pyannote-client.ts:71,94` — TS2564 same `bodyText` pattern as litellm-client
   - `apps/api/src/lib/pyannote-client.ts:229` — TS2322 Buffer/ReadableStream multipart body type
   - `apps/api/src/routes/agent/stream.ts:153,216,251` — TS2375/2345/2322 zod inferred vs literal type drift on body shape
   - `tools/load-test/src/{baseline,main,smoke}.ts:85,105,86` — TS2345 `Uint8Array.buffer as ArrayBuffer` (k6 http.file generic narrowing)
   - `tools/load-test/src/utils/http-client.test.ts:66-74` — TS18048 `call possibly undefined` (strictNullChecks)
   - `tests/e2e/phase-05-{config-endpoints,folders,notes,transcriptions}.spec.ts` — TS1308 `await` inside non-async arrow (8 sites)
   - `tests/e2e/tenant-isolation.test.ts:48` — TS2307 deleted module path (intentional, needs `@ts-expect-error` issue-tag)
   - `tests/e2e/mock-realtime/vitest.config.ts:21` — TS2769 vitest v4 removed `coverage.all: true`

3. **Stage 2 biome — 30 errors + 147 warnings**
   - Per-file list captured in `/tmp/verify.log` from Phase 51 final verify run; files: `apps/api/src/{index,lib/audit,lib/client-id-upsert,lib/oidc-providers,lib/pyannote-client,lib/tool-call-accumulator,lib/web-search/yandex-adapter,middleware/dual-auth,routes/capabilities,routes/conversations/__tests__/setup}.ts`, `tools/test-probe/src/probe.test.ts`
   - Categories: `lint/complexity/useLiteralKeys` (auto-fixable), `lint/complexity/noUselessConstructor` (auto-fixable), `lint/style/noNonNullAssertion` (style — assert each is justified or refactor), `lint/correctness/noUndeclaredVariables` (`__dirname` in CJS — needs explicit type-import or `globalThis` shim)

### OUT of scope

- 11 pre-existing diarization test fails — user explicitly carved them out in Phase 51 cron prompt; their root cause is pyannote.ai upstream API drift not local typecheck/biome debt
- LOCKER-04 BLOCKING flip (deferred to v2.3 per `41-FINAL-DECISIONS.md`)
- 47 routes without `schema:` (LOCKER-04 v2.3 bulkfix)
- `@openwhispr/auth-stub` further cleanup (Phase 38 done)
- Architectural HI-3 P0 follow-up (undici Pool-per-call refactor — separate phase post-cleanup)

## Constraints

1. **No production-behavior changes.** Type-fixes only — every fix must be type-system change OR `@ts-expect-error issue-52-XX-<tag>` with a one-line allowlist rationale. If a fix requires logic change to be type-correct, defer that file to a `--gaps` sub-plan and document why.
2. **Each plan opens with a RED→GREEN→REFACTOR cycle pinned by a vitest regression test** that asserts `tsc --noEmit` on the touched files exits 0. Source-pattern tests (read file + grep) acceptable per Phase 51 precedent (51-13c, 51-11d/e).
3. **One atomic commit per plan.** No multi-file landing patterns. If a fix cascades across packages, split into multiple plans with explicit dependency ordering.
4. **LOCKER-01..08 must stay clean.** Single `as` casts allowed; `as unknown as` requires allowlist entry per LOCKER-02 (existing precedent in `tools/lint-no-suppressions.allowlist.txt`).
5. **English-only DOCS-09.** All commit messages, test names, JSDoc strings ASCII-only (lint-english CLI catches Cyrillic in source).

## Gray areas (for advisor)

### GA-1: Cascade strategy — fix-and-reveal vs all-at-once

Phase 51 final-fix attempt revealed that fixing `lens.ts` exposed 5 more files; fixing those exposed 10 more in `apps/api`. The natural workflow is iterative: fix → re-typecheck → fix new errors → repeat. But this prevents parallel-wave execution because every plan depends on every prior one being landed. Two options:

- **(a) Sequential single-wave** — one plan per file, strict ordering by tsc-discovery order. Predictable but no parallelism.
- **(b) Up-front full-error inventory** — disable `noEmitOnError` or use `--allowJs --noEmit` with `--listFilesOnly` style approach to enumerate ALL errors before fixing, then group into parallel waves by package. Faster wall-clock but risk of overlapping fixes.

### GA-2: undici 7.x `ResponseData<T>` generic — fix-at-source vs cast-at-callsite

The 4 errors in litellm-client are the same root cause: undici 7.x changed `ResponseData` default from `ResponseData<any>` to `ResponseData<null>`. Options:

- **(a) Update interface declarations** to use `ResponseData<unknown>` at each export — propagates through callers in api/worker. Cleanest, but every consumer needs the update too.
- **(b) `as Dispatcher.ResponseData<null>` cast at the 4 call sites** — single-cast, allowed by LOCKER-02. Minimal blast radius but hides the type drift.
- **(c) Adapter wrapper** — wrap `undiciRequest` once in a typed helper that returns the project's own `LitellmResponseData` type. More work, but future-proof against more undici drift.

### GA-3: Cyrillic in test files — content-aware vs blanket-exempt

Phase 51 hit a snag at lint-english on `apps/web/src/components/screens/account/__tests__/locale-parity-cancel.test.tsx` — test asserted `expect(...).toBe("Отмена")` which the linter rejected. Resolution was to use structural assertions (`toBeTypeOf("string")`, `not.toBe("Cancel")`) instead. Phase 52 will encounter the same for any test that pins ru-locale strings. Options:

- **(a) Continue structural-only assertions in tests** — preserves DOCS-09 hard rule.
- **(b) Carve `apps/web/src/**/__tests__/**/locale-*.test.tsx` from lint-english** — small allowlist in `tools/lint-english.ts` that permits locale test files to embed expected translations literally.

### GA-4: Biome auto-fixable errors — apply `biome check --write` blanket vs per-file review

15 of the 30 biome errors are FIXABLE (auto-fix safe). Options:

- **(a) Single `pnpm exec biome check --write` commit** — fastest, but 15+ files modified at once; review burden moves to PR diff.
- **(b) Per-file fix commits** — atomic, reviewable; 15x slower wall-clock.

### GA-5: TS2748 ambient const enum + verbatimModuleSyntax

`apps/api/src/lib/argon2-keys.ts:29,38` imports from `argon2` which exports const enums. With `verbatimModuleSyntax: true`, TS refuses ambient const enum access (would erase at compile). Options:

- **(a) Replace const-enum usage with string literals** — `Argon2id` → `2` (the numeric variant value) with a comment; production behaviour identical.
- **(b) `import type` + manual mirror** — declare local `const ARGON2_TYPE_ID = 2` mirroring the upstream constant.
- **(c) Carve `argon2-keys.ts` from `verbatimModuleSyntax`** — file-level override via `// @ts-nocheck` (forbidden by LOCKER-02) or per-import workaround.

## Plan sketch (subject to advisor refinement)

- **52-01**: litellm-client typecheck (6 errors) — fix-at-source approach (GA-2 (a))
- **52-02**: data/encryption lens.ts CleanedWhere — add `@better-auth/core` to package.json deps, import from there
- **52-03**: worker typed-queue Awaited<> + with-tenant-context tenantId narrowing
- **52-04**: api lib pyannote-client + argon2-keys (GA-5 decision needed)
- **52-05**: api auth.ts fallbackLog + readonly OidcProviders
- **52-06**: api routes/agent/stream zod-inferred drift (3 errors)
- **52-07**: tests/e2e/phase-05-*.spec.ts await-arrow batch + tenant-isolation @ts-expect-error + mock-realtime vitest v4 `all`
- **52-08**: tools/load-test Uint8Array.buffer + strictNullChecks
- **52-09**: biome auto-fix wave (GA-4 decision needed)
- **52-10**: biome style/correctness manual fixes
- **52-final**: `make verify` exit-0 + update REVIEW-INDEX.md + close TaskList #35
