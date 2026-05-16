---
created: 2026-05-16
status: proposal — awaiting `/gsd-new-milestone` + `/gsd-phase` insertion
owner: project (nick)
parent_review: .planning/review/REVIEW-INDEX.md
---

# Proposed milestone: **v2.2 — Pre-OSS Security & Hygiene**

## Why this milestone exists

Pre-publication review of `main` @ `1832f28` (parallel `gsd-code-reviewer` agents
across 11 package scopes) surfaced **10 CRITICAL + 35 HIGH** findings — security
holes, RLS posture regression, plaintext credential storage, stub packages,
hardcoded secrets-in-shell, and route-level zod/rate-limit gaps. The CRITICAL
set spans authentication, multi-tenancy, and secret handling: each item is
independently sufficient to embarrass a project marketed as "enterprise-grade
RLS-isolated 1000-concurrent-user backend".

This milestone has two parts:
1. **Fix every CRITICAL and every HIGH** under strict TDD + 90/90/90/90 coverage
   per `.planning/DISCIPLINE.md`.
2. **Codify lockers** (tsx CLI linters wired into Lefthook + GitHub Actions)
   that make Claude (or any future contributor) **structurally unable** to
   reintroduce the same classes of mistakes.

## Constitutional inheritance

This milestone inherits ALL rules from `.planning/DISCIPLINE.md`:
- Strict TDD (RED → GREEN → REFACTOR; each fix lands with its tests in the SAME
  atomic commit).
- Per-phase coverage floor ≥ 90/90/90/90 on new/modified files.
- E2E mandatory for any phase touching a user-visible route or wire surface.
- No mocks of internal logic.
- Real services in tests (testcontainers for DB-touching code).
- Verification gate: `make e2e-test` + `pnpm -r test --coverage` JSON parsed.
- Audit trail: PLAN.md + SUMMARY.md + REVIEW.md + VERIFICATION.md +
  `<phase>-COVERAGE.md` per phase.

**Additional v2.2-specific hard rules** (codified at Phase 30 — see below):

- **NEW RULE 11: No `if (process.env.NODE_ENV === 'test'|'development')` in
  production runtime paths.** Allowlist: `bootstrap.ts`, `config/*.ts`,
  `otel-bootstrap.ts`, and explicit `*.config.ts` files only.
  Enforced by `tools/lint-no-env-branches.ts`.
- **NEW RULE 12: Zero `as any` / `as unknown as X` / `@ts-ignore` /
  `@ts-nocheck` in `apps/**/src/**` and `packages/**/src/**`.** `@ts-expect-error`
  requires a one-line reason AND a tracking issue ID. Enforced by
  `tools/lint-no-suppressions.ts`.
- **NEW RULE 13: No hardcoded URLs / UUIDs / test-tokens / localhost in
  production code.** Allowlist: `tests/**`, `.env.*.example`, doc files.
  Enforced by `tools/lint-no-hardcode.ts`.
- **NEW RULE 14: Every Fastify route MUST have `schema: { body | querystring }`
  (zod from `packages/wire-schemas`) AND a `rateLimit` config (explicit
  `false` allowed for `/api/health` only).** Every exported symbol MUST have
  ≥1 non-test caller. Enforced by `tools/lint-prod-readiness.ts`.

## Phase ordering

Phases run **sequentially** (no parallel waves at milestone level) to keep
atomic-commit history readable and to let each fix verify against a stable
upstream. Within each phase, gsd-executor still parallelizes plan-level tasks
where the dependency graph allows.

```
30  → lockers FIRST (the rules every other v2.2 phase will be tested against)
20  → CR-7 RLS fail-closed
21  → CR-8 envelope encryption wired to Better Auth columns
22  → CR-1 tenantPlugin retirement
23  → CR-2,3,4 api-routes-rest bundle (public endpoints + Set-Cookie + setup-admin)
24  → CR-5,6 worker bundle (DATABASE_URL + reconciliation-discrepancy)
25  → CR-9 litellm-client bodyText truncation
26  → CR-10 @openwhispr/auth retirement
27  → wire-schemas HIGH sweep (6 findings; mechanical)
28  → byok-guard + contract-tests HIGH sweep (3 findings)
29  → remaining HIGH sweep (api-core + api-routes-transcriptions + web + worker + data + litellm + small-pkgs)
```

Phase 30 ships **first** even though it is numerically last because the
locker tools are the GATE against regressions during Phases 20–29. Phases
that violate a locker shipped in Phase 30 cannot land.

---

## Phase 30 — Constitutional Lockers (ships FIRST)

**Goal:** A contributor who tries to commit production code that contains
`as any`, `if (NODE_ENV === 'test')` in a runtime path, a hardcoded
`localhost:3000`, a Fastify route without zod, or a dead export — finds
the commit refused by lefthook AND the PR refused by CI, with a precise
file:line + remediation pointer.

**Depends on:** nothing (greenfield tooling phase).

**Requirements** (added under v2.2):
- LOCKER-01 `tools/lint-no-env-branches.ts` + tests at ≥ 90/90/90/90.
- LOCKER-02 `tools/lint-no-suppressions.ts` + tests at ≥ 90/90/90/90.
- LOCKER-03 `tools/lint-no-hardcode.ts` + tests at ≥ 90/90/90/90.
- LOCKER-04 `tools/lint-prod-readiness.ts` + tests at ≥ 90/90/90/90.
- LOCKER-05 `tools/lint-secret-shape-in-error.ts` + tests at ≥ 90/90/90/90
  (catches `public readonly bodyText/responseBody/upstreamPayload` on Error
  subclasses — the CR-9 class of leak).
- LOCKER-06 `tools/lint-shell-credential-interpolation.ts` + tests at
  ≥ 90/90/90/90 (catches `bash -c \`...\${dbUrl}...\`` and friends — the
  CR-5 class of leak).
- LOCKER-07 Update `.planning/DISCIPLINE.md` adding Rules 11–14 and the
  per-rule enforcement-tool map.
- LOCKER-08 Wire all six lockers into `lefthook.yml` pre-commit AND
  `.github/workflows/ci.yml`. Each locker is fast (< 2 s on staged-files
  scope; full scan in CI).
- LOCKER-09 `tools/lint-no-suppressions-allowlist.txt` seeded with the
  current suppressions inventory; CI must FAIL on any net addition.
  (Migration debt — every suppression on the list gets a tracking issue.)

**Plans** (sub-plans, sequential within phase):
- 30-01 — Write `lint-no-env-branches.ts` (RED → GREEN). 12 fixtures
  covering `NODE_ENV === 'test'`, `NODE_ENV !== 'production'`,
  `NODE_ENV.startsWith('dev')`. Allowlist read from
  `tools/lint-no-env-branches.allowlist.txt`. Initial allowlist =
  bootstrap.ts + config/*.ts + otel-bootstrap.ts; CI scan must be clean
  against current main.
- 30-02 — Write `lint-no-suppressions.ts` (RED → GREEN). Detect `as any`,
  `as unknown as`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error` without
  trailing comment. Seed allowlist with current main inventory; PR diff
  CANNOT grow it.
- 30-03 — Write `lint-no-hardcode.ts` (RED → GREEN). Detect raw `localhost`,
  `127.0.0.1`, `:3000`/`:4000`/`:8080`, UUID literals, fake-token shapes
  (sk-..., sk-ant-..., AIza..., AKIA..., Bearer ey...). Allowlist for
  `tests/**`, `.env.*.example`, `compose/**`, docs/charts/tools.
- 30-04 — Write `lint-prod-readiness.ts` (RED → GREEN). AST scan of
  `apps/**/src/**` + `packages/**/src/**`. Rules:
  (a) every `app.route({ method, url, ... })` / `app.get/post/...` MUST have
      `schema: { body|querystring|params: <ZodSchema> }` AND a `config:
      { rateLimit: ... }` (or `config: { rateLimit: false }` only for
      `/api/health`);
  (b) every `export` symbol MUST have ≥ 1 non-test importer (cross-file
      reference scan; allow `index.ts` barrel re-exports).
  Failure mode: print `file:line — RULE-NAME — fix: <pointer to wire-schemas
  /  rate-limit docs>`.
- 30-05 — Write `lint-secret-shape-in-error.ts` (RED → GREEN). Detect
  `class X extends Error { public/readonly <fieldName>: string }` where
  fieldName matches `/bodyText|responseBody|upstreamPayload|response|body/i`
  AND the field is not truncated/redacted in the constructor.
- 30-06 — Write `lint-shell-credential-interpolation.ts` (RED → GREEN).
  Detect template-literal strings passed to `spawn('bash', ['-c', ...])` /
  `execSync` / `exec` containing references to `*_URL`, `*_KEY`,
  `*_PASSWORD`, `*_SECRET`, `*_TOKEN` env vars or named bindings matching
  those patterns.
- 30-07 — Update `.planning/DISCIPLINE.md` (Rules 11–14) and `CLAUDE.md`
  (mirror) + wire to lefthook + ci.yml + nightly.yml. Add make targets
  `make lint:lockers` and `make lint:lockers:fix-pointers`.
- 30-08 — Bulk-fix existing violations across main caught by the new
  linters that are NOT covered by Phases 20–29's CRITICAL/HIGH set
  (i.e., MEDIUM/LOW-grade hygiene debris). Per-area atomic commits.

**Success criteria:**
1. `pnpm lint:lockers` runs in CI on every PR and is BLOCKING.
2. Each locker has its own vitest suite at ≥ 90/90/90/90 coverage.
3. A synthetic PR that introduces `if (process.env.NODE_ENV === 'test')` in
   `apps/api/src/routes/foo.ts` is REFUSED by lefthook AND by CI.
4. The allowlists in `tools/lint-*.allowlist.txt` form a finite,
   issue-tracked migration debt list (each entry has a follow-up issue).
5. `.planning/DISCIPLINE.md` v2.2 amendment lands in the SAME commit as
   the linter source — discipline doc and tool ship together.

**E2E test:** A `tests/e2e/lockers.spec.ts` that for each locker creates
a temp file with a known violation, runs the locker, and asserts non-zero
exit + the expected file:line in stderr. (Real binary, real exit code,
no mocks.)

---

## Phase 20 — CR-7: RLS fail-closed

**Source finding:** `.planning/review/data.md` CR-01.
**File:** `packages/data/migrations/0003_better_auth_tenant_defaults.sql:46-57`
+ `packages/data/src/tenant-context.ts` (callers).

**Goal:** `current_setting('app.tenant_id', true) IS NULL` results in
PostgreSQL DENYING the query (RLS policy fails closed), not silently
binding to the default tenant.

**Approach:**
1. **RED** — Property-test (vitest + testcontainers Postgres) that
   asserts a query outside `withTenant()` on a tenant-scoped table
   RAISES (not returns default-tenant rows). Currently fails.
2. **GREEN** — Migration `0017_rls_fail_closed.sql` reverses the
   `ALTER ROLE ... SET app.tenant_id` from 0003, AND removes the
   `tenant_id` column DEFAULT that resolves to the GUC (HI-04 from review).
   Update RLS policies to use `current_setting('app.tenant_id', true)::uuid
   IS NOT NULL AND tenant_id = current_setting(...)::uuid`.
3. **REFACTOR** — `tenant-context.ts` no longer needs to "fall back" to a
   default; any caller that forgets `withTenant()` gets a `RAISE` error
   with a clear message.

**Tests:**
- Unit: `withTenant()` happy path + un-set path raises.
- Integration: 11 tenant-scoped tables × 4 ops (SELECT/INSERT/UPDATE/DELETE)
  × 2 (with-context / without-context) — 88 property-tests asserting
  ALWAYS deny when context absent. Real Postgres testcontainer.
- E2E: full `docker compose up` + a route that intentionally bypasses
  `withTenant` returns 500 with a redacted server-error envelope (not
  a default-tenant row).

**Coverage gate:** new migration + edits to `tenant-context.ts` at
≥ 90/90/90/90.

**Locker check:** must pass Phase 30 lockers.

---

## Phase 21 — CR-8: Envelope encryption wired to Better Auth columns

**Source finding:** `.planning/review/data.md` CR-02.
**Files affected:**
- `packages/data/src/schema/{accounts,verifications,sessions,oauth_state}.ts`
- `packages/data/src/encryption/envelope.ts` (existing — wire it up)
- `apps/api/src/auth.ts` (Better Auth wire-through)
- New migration `0018_envelope_encrypt_secret_columns.sql`

**Goal:** `account.{access_token, refresh_token, id_token, password}`,
`verification.value`, `session.{token, previous_token}`,
`oauth_state.code_verifier` stored as `bytea` envelope-encrypted under
`MASTER_KEK` env (per-row random DEK, AES-256-GCM, 12-byte IV, auth tag).
Plaintext NEVER leaves Better Auth → DB or DB → Better Auth boundary;
encryption/decryption is a Drizzle-level lens.

**Approach:**
1. **RED** — Test asserts `SELECT access_token FROM account WHERE id = $1`
   returns ciphertext bytea, NOT plaintext; round-trip through the
   encryption lens returns the original plaintext.
2. **GREEN** — Migration adds `bytea` columns (`*_ciphertext`,
   `*_dek_wrapped`, `*_iv`, `*_tag`), backfills from existing plaintext
   via SQL function calling pgcrypto OR a one-shot Node migrator (TDD
   the migrator). Drop plaintext columns in a follow-up commit ONLY after
   the encryption lens is wired and integration tests pass.
3. **REFACTOR** — Add a `tools/lint-no-plaintext-secret-columns.ts`
   locker that scans schema files for `text("access_token"|"refresh_token"
   |"password"|"id_token"|...)` and fails. (Becomes RULE-15 in DISCIPLINE.)

**Tests:**
- Unit on the encryption lens (round-trip, tampered ciphertext rejected,
  wrong KEK rejected).
- Integration: Better Auth sign-in + sign-out + password-reset round-trip
  against real Postgres testcontainer; assert ciphertext on disk.
- KEK rotation property test: rotate KEK, all rows still decrypt; old KEK
  retired, decrypt fails.
- Negative: missing MASTER_KEK env → app refuses to start (loud-fail per
  Phase 14 convention).

**Operator doc:** `docs/security.md` section: "Encryption at rest — what
is encrypted, how to rotate MASTER_KEK, how to provision MASTER_KEK from
KMS (AWS, GCP, Azure, Vault)".

---

## Phase 22 — CR-1: tenantPlugin retirement

**Source finding:** `.planning/review/api-core.md` CR-01.
**File:** `apps/api/src/middleware/tenant.ts` + `apps/api/src/index.ts:382`.

**Goal:** Either delete `tenantPlugin` entirely (preferred) or rename to
`req.untrustedTenantHint: string | null` with a runtime guard that throws
when both `req.tenant` (from dual-auth) and `req.untrustedTenantHint` are
present and disagree.

**Approach:**
1. **RED** — Test asserts `GET /api/anything` with a forged `x-tenant-id:
   <other-uuid>` header is REFUSED (not silently overriding `req.tenant`).
2. **GREEN** — Grep proves no production caller reads `req.tenantId`;
   delete the plugin, delete the module-augmentation, delete the index.ts
   registration. Stryker mutation surface drops gracefully.
3. **REFACTOR** — Audit `apps/api/src/types/**` for any leftover
   `FastifyRequest` augmentation referencing `tenantId`.

**Locker:** Phase 30's `lint-prod-readiness` detects the dead-export
class, but a targeted regression test in `tests/e2e/tenant-isolation.spec.ts`
asserts a forged header CANNOT escalate access.

---

## Phase 23 — CR-2 + CR-3 + CR-4: api-routes-rest bundle

**Source:** `.planning/review/api-routes-rest.md` CR-01 + CR-02 + CR-03.

### 23.a CR-2 — Public bootstrap endpoints
- Files: `apps/api/src/routes/{locale,auth-providers,setup-state}.ts`
- Add `config: { auth: false }` to each route registration.
- RED test boots full app via `bootstrap()` (not bare Fastify) and asserts
  `GET /api/locale` returns 200 (not 401). Confirms the global `dualAuthHook`
  opts out correctly.
- Integration test in `tests/e2e/bootstrap-public-endpoints.spec.ts`.

### 23.b CR-3 — `better-auth-handler` Set-Cookie
- File: `apps/api/src/lib/better-auth-handler.ts:179-182`
- Replace `headers.forEach((v, k) => reply.header(k, v))` with explicit
  `headers.getSetCookie()` loop emitting one `reply.header('set-cookie', v)`
  per cookie value.
- RED test asserts multi-cookie Better Auth response yields N independent
  `set-cookie` reply headers, not one comma-joined.
- Real Better Auth sign-in flow in `tests/e2e/sign-in-cookies.spec.ts`.

### 23.c CR-4 — `setup-admin` rollback
- File: `apps/api/src/routes/setup-admin.ts:234`
- Wrap step 4 (role flip) AND `setup_state=completed` in a single Postgres
  transaction; on failure, roll BOTH back. Or move role flip BEFORE the
  state flip.
- RED test: inject a `pg` failure during role flip; assert next POST to
  `/api/setup-admin` returns 409 with a recoverable-error envelope (NOT
  `alreadyCompleted: true` with no admin user).

**Coverage gate:** 90/90/90/90 on each of the three sub-plans.

---

## Phase 24 — CR-5 + CR-6: worker bundle

**Source:** `.planning/review/worker.md` CR-01 + CR-02.

### 24.a CR-5 — DATABASE_URL out of `bash -c`
- File: `apps/worker/src/jobs/audit-archive.ts:96-128`
- Replace `spawn('bash', ['-c', script])` with a Node-side pipeline:
  `spawn('pg_dump', [...args])` with `PGPASSWORD` / `PGUSER` / `PGHOST` /
  `PGDATABASE` envs derived from the URL ONCE (not interpolated); pipe
  `.stdout → gzip stream → mc/aws-cli spawn`. Validate the partition name
  via existing regex (keep that guard).
- Locker LOCKER-06 (`lint-shell-credential-interpolation`) catches future
  regressions.
- RED test: redact-audit asserts NO `DATABASE_URL`/password ever appears
  in `failedReason` after an injected `pg_dump` failure.

### 24.b CR-6 — `reconciliation-discrepancy` truth-telling
- File: `apps/worker/src/jobs/reconciliation-discrepancy.ts:45-61`
- Choose ONE:
  - **Option A (preferred):** Implement the windowed backfill properly.
    Read `since/until/tenant_id` from job payload, drive an
    explicit-window query path in `runIngestOnce` (extend its signature),
    return real `{ rowsProcessed, rowsScanned }`. Update the return type
    to be a non-fictional `Promise<{ rowsProcessed, rowsScanned }>` —
    remove the `as unknown as` cast.
  - **Option B:** Delete the job + its BullMQ enqueuer. Document why in
    SUMMARY.md.
- RED test asserts handler's awaited result destructures cleanly with
  matching counts against a known-discrepancy fixture.

---

## Phase 25 — CR-9: LitellmUpstreamError bodyText truncation

**Source:** `.planning/review/litellm-client.md` CR-01.
**File:** `packages/litellm-client/src/errors.ts:31, 40`

**Approach:**
- Truncate `bodyText` at construction (`this.bodyText = bodyText.slice(0, 200)`)
  AND make it `private readonly` so pino's own-property serializer cannot
  reach it; override `toJSON()` to return `{ name, message, status }` only.
- RED test: `JSON.stringify(new LitellmUpstreamError(500, 'x'.repeat(10000)))`
  is < 500 bytes; pino structured-log of the error contains NO `bodyText`
  field.
- Locker LOCKER-05 (`lint-secret-shape-in-error`) catches future
  regressions.

---

## Phase 26 — CR-10: @openwhispr/auth retirement

**Source:** `.planning/review/small-pkgs.md` CR-01.
**File:** `packages/auth/src/index.ts`

**Approach:** Delete the package OR rename to `@openwhispr/auth-stub` with
`private: true` in package.json (refuses to publish to npm). Update Stryker
config if it references the package. Locker LOCKER-04 part (b) (dead-export
detection) catches future similar shells.

---

## Phase 27 — wire-schemas HIGH sweep

**Source:** `.planning/review/wire-schemas.md` HIGH-1..6.

**Approach (mechanical, single PR):**
1. Add `.strict()` to every input schema (NoteInput, FolderInput,
   ConversationInput, TranscriptionInput, StreamingUsageBody,
   WebSearchRequest, CreateApiKeyOptions).
2. Replace permissive primitives in ALL output schemas:
   `id: z.string()` → `z.string().uuid()`,
   `*_at: z.string()` → `z.string().datetime({ offset: true })`,
   `url: z.string()` → `z.string().url()`.
3. Bound long-text fields: `z.string().max(LIMIT)` per BACKEND_SPEC limits.
4. Bound `metadata: z.record(...)` to known keys or `z.record(z.string(),
   z.union([z.string(), z.number(), z.boolean()])).refine(maxSize(4096))`.
5. Make `note_type` enum symmetrical (strict on output too).
6. Replace `z.number()` count/duration with `z.number().int().nonneg()`.

**Tests:** Property tests asserting (a) `.strict()` rejects unknown keys,
(b) bad UUID/email/url/datetime rejected with 400, (c) all currently-passing
contract tests still pass (no wire breakage).

**E2E:** Run the existing `tests/contract/**` suite + assert no regression.

---

## Phase 28 — byok-guard + contract-tests HIGH sweep

**Source:** `.planning/review/byok-guard-contract-tests.md` HIGH-1..3.

### 28.a HI-1 — package-boundary inversion
- Move every schema currently imported from `@openwhispr/contract-tests` by
  `apps/api/src/routes/**` into `packages/wire-schemas/` and re-export.
- `contract-tests` becomes test-only; `private: true` in package.json so it
  cannot be published.

### 28.b HI-2 — `redactUrl` completeness
- Extend `redact-url.ts` to mask: query-string `api_key=`, `token=`,
  `key=`, `code=`, `secret=`, AWS SigV4 `X-Amz-Signature=`, userinfo
  `username`, bearer-token-shaped path segments (`/sk-[A-Za-z0-9]{32,}`,
  `/sk-ant-[A-Za-z0-9]{32,}`, `/AIza[A-Za-z0-9_-]{35,}`, `/AKIA[A-Z0-9]{16}`).
- Property tests: 50 synthetic URLs, each variant covered.
- Add a `tests/security/redact-completeness.test.ts` that for every
  `process.env.*_API_KEY` env var actually read by `apps/**/src/**` (grep
  at test-time), constructs a fake URL containing the var name + a fake
  key shape, and asserts `redactUrl` masks it. Drift becomes a test
  failure.

### 28.c HI-3 — `fetchAndParse` envelope enforcement
- Remove the `typeof body === "object"` guard; always run
  `ErrorEnvelope.parse()` on non-2xx; non-JSON / empty body → throw a
  typed `MalformedUpstreamEnvelopeError`.

---

## Phase 29 — remaining HIGH sweep

Bundle the residual HIGH findings into one phase with sub-plans grouped by
package. Each sub-plan: RED → GREEN → REFACTOR atomic commit.

- **29.a api-core** HI-01..03: replace hardcoded `"00000000-..."` with
  `resolveDefaultTenantId()` in `apps/api/src/auth.ts:330, 380`; delete
  `apps/api/src/placeholder.ts` (no Stryker config — confirmed); audit any
  remaining bootstrap concerns.
- **29.b api-routes-transcriptions** HI-01..03: fix `DEFAULT_AGENT_MODEL`
  to match LiteLLM config OR remove hardcode + require explicit `body.model`;
  add zod validation to `/api/agent/stream` body using a new schema in
  `packages/wire-schemas`; add per-user `rateLimit` to the same route.
- **29.c web** HI-1, HI-2: add app-level RSC guard to `/admin/*` that
  reads role from session (defense-in-depth on top of Traefik basic-auth);
  remove `PLAYWRIGHT_DISABLE_SSR_PREFETCH` from production RSC paths —
  test-only branches belong in test fixtures, not in shipped code (this
  is a CLAUDE.md Rule 1 violation — surface it as such in SUMMARY).
- **29.d worker** HI-1..4: replace bare `pino()` with shared redact factory
  in `index.ts` + `ingest-litellm-spend.ts`; fix reconciliation-daily-check
  loop bound; refactor OTel gauge callbacks to read fresh `driftStore`;
  add `metadata.duration` validation + warn-log + counter metric on
  minutes-priced models.
- **29.e data** HI-01..04: enforce idempotency in `migrate.ts` for
  LiteLLM DB init; replace TRUNCATE in 0005 with idempotent UPSERT (new
  migration 0019); add `expires_at` enforcement on account tokens
  (becomes irrelevant after Phase 21 makes them encrypted bytea, but the
  TTL check still needs wiring); HI-04 closes automatically with Phase 20.
- **29.f litellm-client** HI-01..04: add `headersTimeout` / `bodyTimeout`
  / required `AbortSignal` to `chatCompletions`, `audioTranscriptions`,
  `passthrough`; assert SSRF dispatcher at module load (throw if
  `getGlobalDispatcher()` is not our wrapped Agent); fix model alias
  drift via single-source-of-truth in `compose/litellm/litellm_config.yaml`
  read at boot (no duplication); fix `streamOptions` spread so caller can
  opt-out of `include_usage`.
- **29.g small-pkgs** HI-01..03: ship real en/ru locale bundles (or rename
  `@openwhispr/i18n` to `-stub` with private:true if Phase 10 already
  covers full i18n elsewhere — verify); add CI parity test between
  `byok-guard` and `observability/redact` provider lists; relax
  `SMTP_SECURE` parsing to accept `1`/`true`/`yes`/`on` (case-insensitive).

---

## Success criteria for the whole milestone

1. **All 10 CRITICAL closed** with linked SUMMARY.md per phase.
2. **All 35 HIGH closed.**
3. **`pnpm lint:lockers` is green on main**, and a synthetic regression PR
   (with `as any`, with `if (NODE_ENV === 'test')`, with `localhost:3000`,
   with a route missing zod, with a stub export, with a leaky Error class,
   with a `bash -c "${DBURL}"`) is REFUSED by CI.
4. **Coverage on diff ≥ 90/90/90/90** in every closed phase.
5. **`make e2e-test` green** at milestone close.
6. **`.planning/DISCIPLINE.md` v2.2 amendment lives in main** with Rules
   11–14 (15 after Phase 21).
7. **`docs/SECURITY.md`** updated reflecting Phases 20–28 (RLS posture,
   encryption-at-rest scope, redact completeness, SSRF defense, rate-limit
   posture).
8. **`.planning/review/REVIEW-INDEX.md`** annotated with per-finding
   close-out commit SHAs.

## Out of scope (deferred or skip)

- All **MEDIUM** findings → Phase 30-08 catches mechanical ones; the rest
  go to `.planning/deferred-items.md` for `gsd-audit-fix` after milestone
  closes.
- All **LOW** findings → backlog; `gsd-cleanup` / housekeeping pass.
- New features. This is a hygiene + security milestone. New product work
  resumes in v2.3.

## Verification (orchestrator must run before declaring milestone complete)

Per CLAUDE.md hard-rule #3 (trust but verify):

1. `git log --oneline v2.1..HEAD | grep -E "CR-(1|2|3|4|5|6|7|8|9|10)"` —
   confirm each CRITICAL has an atomic-commit SHA.
2. `pnpm lint:lockers` exit 0; manually break each rule in a temp branch
   and confirm CI fails.
3. `make e2e-test E2E=1` green end-to-end.
4. `pnpm -r test --coverage` JSON → every package ≥ 90/90/90/90 on diff.
5. Re-run the original 11-agent review against main; expect ≤ 5 residual
   HIGH (down from 35) and 0 CRITICAL.

## After this milestone

`gsd-ship` → tag `v2.2.0` → publish on GitHub. Repo announcement post can
truthfully claim:
- enterprise-grade fail-closed RLS multi-tenant,
- encryption at rest for all credential columns,
- SSRF / redact / rate-limit / zod-strict surface,
- constitutionally-enforced TDD + lint posture preventing the same class
  of mistakes from coming back.

---

## Next action for the user

```
/gsd-new-milestone v2.2
# → opens v2.2 milestone in PROJECT.md + STATE.md

/gsd-phase add 30  # lockers first
/gsd-phase add 20  # RLS fail-closed
/gsd-phase add 21  # envelope encryption
... (the eight phases above)

# then per phase:
/gsd-discuss-phase 30
/gsd-plan-phase 30
/gsd-execute-phase 30
/gsd-secure-phase 30   # threat model verification
/gsd-verify-work 30    # phase verifier
```

Or, if you want a single command to chain it:
```
/gsd-autonomous   # discuss → plan → execute per phase, sequential
```

Note: `gsd-autonomous` will respect the milestone ordering written here
because Phase 30 has no `depends_on`, Phases 20–29 depend on 30, and
Phases 21+ depend on 20 (RLS posture must land before encryption-at-rest
migration touches the same schemas).
