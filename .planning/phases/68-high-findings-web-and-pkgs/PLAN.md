---
phase: 68-high-findings-web-and-pkgs
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/components/screens/auth/SignInForm.tsx
  - apps/web/src/middleware.ts
  - apps/web/src/components/screens/account/SessionsTable.tsx
  - apps/web/src/components/screens/notes/NotesListClient.tsx
  - apps/web/src/components/screens/AdminShell.tsx
  - apps/web/src/components/screens/AdminIndex.tsx
  - apps/web/src/components/screens/admin/ConfigClient.tsx
  - apps/web/src/components/screens/admin/ObservabilityClient.tsx
  - apps/web/src/app/(admin)/admin/page.tsx
  - apps/web/src/app/(admin)/admin/config/page.tsx
  - apps/web/src/app/(admin)/admin/observability/page.tsx
  - apps/web/src/lib/internal-api.ts
  - packages/litellm-client/src/errors.ts
  - packages/litellm-client/src/config.ts
  - packages/contract-tests/src/helpers/sign-in-fixture.ts
  - packages/contract-tests/src/helpers/multipart.ts
  - packages/contract-tests/src/schemas.ts
  - packages/contract-tests/src/negative-matrix.ts
  - packages/contract-tests/package.json
  - packages/byok-guard/package.json
  - packages/wire-schemas/src/conversations.ts
  - packages/email/src/EmailSender.ts
  - packages/email/README.md
  - .planning/phases/68-high-findings-web-and-pkgs/verify-first.log
  - .planning/review/web.md
  - .planning/review/litellm-client.md
  - .planning/review/byok-guard-contract-tests.md
  - .planning/review/wire-schemas.md
  - .planning/review/small-pkgs.md
  - .planning/review/REVIEW-INDEX.md
autonomous: true
requirements:
  - "web-HI-01"
  - "web-HI-02"
  - "web-HI-03"
  - "web-HI-04"
  - "web-HI-05"
  - "web-HI-06"
  - "litellm-HI-1"
  - "litellm-HI-2"
  - "litellm-HI-3"
  - "byok-HI-01"
  - "byok-HI-02"
  - "byok-HI-03"
  - "byok-HI-04"
  - "byok-HI-05"
  - "wire-H-1"
  - "HIGH-EMAIL-01"

must_haves:
  truths:
    - "web HI-01: SignInForm consumes the middleware-set `?from=` query param with an allowlist (value MUST start with `/app/`, MUST NOT contain `://` or `\\`, MUST NOT start with `//`) and uses it as the post-sign-in destination; any value failing the allowlist falls back to `/app`. Both `callbackURL` and `router.push` honour the validated destination."
    - "web HI-02: SessionsTable no longer renders the Better Auth bearer (`SessionRow.token`) into the React tree as a stable prop — the bearer is read only inside the revoke mutation closure where Better Auth's `revokeSession({ token })` contract requires it (Better Auth 1.6.9 `revokeSession` accepts ONLY `{ token }`, no id-based revocation exists — confirmed against the installed `dist/api/routes/session.d.mts`). A file-header comment documents the unavoidable bearer exposure + the CSP `connect-src` containment posture; the residual exposure is recorded in `.planning/deferred-items.md` as a Better-Auth-library-shape v2 item."
    - "web HI-03: NotesListClient's notes-list `queryKey` matches the RSC dehydrated key produced in `notes/page.tsx` — both use `queryKeys.notes.list(cursor)` with no extra `{ folder }` tuple element; the SSR prefetch is consumed on first paint instead of refetched."
    - "web HI-04: AdminShell renders an in-product sign-out control in the header that calls Better Auth `signOut()` and routes to `/sign-in`; an admin on `/admin/*` can sign out without hand-navigating to `/app/account`."
    - "web HI-05: every stale `D-ADMIN-1` / Traefik-basic-auth / edge-auth security comment across the 8 identified files is purged or corrected to describe the real admin model (admin = `users.role='admin'` enforced by `checkAdminAccess()`); no executable behaviour changes."
    - "web HI-06: `internal-api.ts` no longer contains the hardcoded `:3000` literal — the default is sourced env-driven or the literal is moved off the LOCKER-03-scanned surface; `pnpm lint:lockers` passes with any prior allowlist entry for that literal removed."
    - "litellm HI-1: `LitellmUpstreamError` truncates the `message` constructor argument at construction (same 200-char bound applied to the optional `message` override path, not only the default-message path) — `new LitellmUpstreamError(500, raw, raw)` can no longer carry an untruncated upstream payload into `Error.message`."
    - "litellm HI-2: `loadLitellmConfigFromEnv` reads `LITELLM_VIRTUAL_KEY`; when set it takes precedence over `LITELLM_MASTER_KEY` for the upstream Authorization header (corporate-override path), and the precedence rule is documented in the config-loader header."
    - "litellm HI-3: `loadLitellmConfigFromEnv` asserts an operator-overridden `LITELLM_BASE_URL` uses `https://` in production; a non-https override is refused unless an explicit opt-out env (`LITELLM_ALLOW_PLAINTEXT=1`) is set or the host is the bundled-compose `litellm` service name — mirrors the Phase 57 `validateIngressBoot` posture; the bundled `http://litellm:4000` default is unaffected for the slim/dev stack."
    - "byok HI-01: `FIXTURE_PASSWORD` and the privileged `signInFixture` owner-pool flip path no longer ship in the published `@openwhispr/contract-tests` tarball — verified via `npm pack --dry-run`; `FIXTURE_PASSWORD` relocation does NOT trip gitleaks (if it does, `.gitleaks.toml` allowlist + `tools/lint-gitleaks-config.test.ts` regression assertion are extended — never a `--no-verify` bypass)."
    - "byok HI-02: the three `*-shape.test.ts` files no longer ship in the published `@openwhispr/contract-tests` tarball — verified via `npm pack --dry-run`; a `files:` allowlist (or relocation to `tests/`) excludes them."
    - "byok HI-03: every wire schema in `contract-tests/src/schemas.ts` that has a `@openwhispr/wire-schemas` counterpart imports the canonical schema instead of redefining it; schemas with no canonical counterpart carry a header comment stating why the contract package owns them."
    - "byok HI-04: `TolerantEnvelope` is tightened so the negative matrix can distinguish the string-form `{error}` envelope from the structured form; the `negative-matrix-enumeration.test.ts` drift guard is confirmed live and asserted to cover the static route inventory."
    - "byok HI-05: `audioMultipartBody` no longer reads a repo-root `tests/fixtures/audio/` path absent from the published tarball — either a sample fixture is bundled inside `packages/contract-tests/` and shipped via the `files:` allowlist, or the helper is relocated out of the published `src/` surface."
    - "wire H-1: `MetadataSchema`'s size-refinement no longer carries the inline English string `\"metadata too large\"` — it uses a stable machine key (`metadata.too_large`) or an empty message so the route localizes; no inline English end-user error message remains."
    - "HIGH-EMAIL-01: resolved doc-only — every current `EmailSender` caller passes a server-rendered/escaped template (worker `template-renderer` interpolates with `htmlEscape: true`; `apps/api/src/auth.ts` interpolates only Better-Auth-generated URLs). The `SendArgs.html` JSDoc + `packages/email/README.md` are updated to make the caller-owns-escaping contract explicit. No boundary escape is added (no caller interpolates user-controlled data into `html`)."
    - "All 8 constitutional lockers green (`pnpm lint:lockers`); `pnpm typecheck` shows no new errors vs the documented 5-error baseline; `pnpm test` green for web, litellm-client, byok-guard, contract-tests, wire-schemas, and the small packages."
  artifacts:
    - path: ".planning/phases/68-high-findings-web-and-pkgs/verify-first.log"
      provides: "per-finding still-live / already-closed disposition with file:line evidence for all 16 findings; the HI-02 Better-Auth-version finding; the HIGH-EMAIL-01 caller-grep result"
      contains: "HI-02"
    - path: "apps/web/src/middleware.ts"
      provides: "the `?from=` deep-link is set here (web HI-01 — confirm, no change needed unless allowlist moved)"
      contains: "from"
    - path: "packages/litellm-client/src/errors.ts"
      provides: "LitellmUpstreamError message-arg truncation (litellm HI-1)"
      contains: "slice(0, 200)"
    - path: "packages/litellm-client/src/config.ts"
      provides: "LITELLM_VIRTUAL_KEY precedence + https assertion (litellm HI-2/HI-3)"
      contains: "LITELLM_VIRTUAL_KEY"
    - path: "packages/contract-tests/package.json"
      provides: "files: allowlist excluding test files + helpers from the tarball (byok HI-01/02/05)"
      contains: "files"
    - path: "packages/wire-schemas/src/conversations.ts"
      provides: "MetadataSchema refinement with machine key, no inline English (wire H-1)"
      contains: "metadata.too_large"
    - path: "packages/email/README.md"
      provides: "explicit caller-owns-HTML-escaping contract (HIGH-EMAIL-01)"
      contains: "escape"
    - path: ".planning/review/REVIEW-INDEX.md"
      provides: "HIGH aggregate driven to 0 with per-package closure markers"
      contains: "Phase 68"
  key_links:
    - from: "apps/web/src/components/screens/auth/SignInForm.tsx"
      to: "the validated `?from=` destination"
      via: "useSearchParams().get('from') → allowlist guard → callbackURL + router.push"
      pattern: "from"
    - from: "packages/litellm-client/src/config.ts"
      to: "the upstream Authorization header"
      via: "LITELLM_VIRTUAL_KEY winning over LITELLM_MASTER_KEY"
      pattern: "LITELLM_VIRTUAL_KEY"
    - from: "packages/contract-tests/package.json files: allowlist"
      to: "the published npm tarball surface"
      via: "npm pack --dry-run excludes *.test.ts + helpers/sign-in-fixture.ts"
      pattern: "files"
---

<objective>
Clear the final 16 HIGH findings in the pre-publication REVIEW backlog,
spanning 5 packages: `apps/web` (6), `packages/litellm-client` (3),
`packages/byok-guard` + `packages/contract-tests` (5),
`packages/wire-schemas` (1), and the small packages
`packages/{auth,email,i18n,observability}` (1 — `HIGH-EMAIL-01`).

This is the FINAL HIGH-backlog phase. Phases 62–67 cleared api-core (5),
api-routes-rest (3), api-routes-conversations (4),
api-routes-transcriptions (11), worker (7), data (6) — 36 HIGH closed.
After this phase ALL HIGH findings in `REVIEW-INDEX.md` are closed and the
HIGH aggregate goes to 0.

This cluster is a deliberate MIX of code fixes (strict RED→GREEN TDD) and
doc/comment commits (verified accurate, no test):

- **Code fixes** (strict TDD — RED test referencing the finding ID, then
  GREEN): web HI-01, HI-02 (the file-header doc part is doc; the
  prop-shape change is a code fix), HI-03, HI-04, HI-06; litellm HI-1,
  HI-2, HI-3; byok HI-01, HI-02, HI-03, HI-04, HI-05; wire H-1.
- **Doc / comment commits** (no test — verified accurate against the code
  they describe): web HI-05 (purge stale `D-ADMIN-1` comments);
  HIGH-EMAIL-01 (caller-owns-escaping contract made explicit in JSDoc +
  README). The HI-02 file-header bearer-exposure comment is a doc rider
  on the HI-02 code commit.

Each finding is re-verified against current `main` BEFORE any fix
(CLAUDE.md hard rule 3). The planner's pre-determinations, which the
executor MUST re-confirm via the verify-first protocol below:

- **web HI-01 — STILL LIVE.** `SignInForm.tsx:89,99` hardcode
  `callbackURL: "/app"` and `router.push("/app")`. `middleware.ts:146`
  does `url.searchParams.set("from", path)` on the `/sign-in` redirect.
  The form never reads `from`. **JUDGMENT CALL — RESOLVED: consume
  `?from=` with an allowlist.** Rationale: the middleware deliberately
  preserves `from` (a documented, tested recovery flow — `middleware.ts`
  line 146 + its unit suite); ripping it out of middleware would discard
  a working, tested capability and degrade UX (deep-link recovery is a
  real user-facing feature). The safe move is to CONSUME it with a strict
  same-origin path allowlist in the form. Allowlist rule: the value MUST
  start with `/app/` (or equal `/app`), MUST NOT contain `://`, MUST NOT
  contain a backslash, MUST NOT start with `//` (protocol-relative). Any
  value failing the allowlist falls back to `/app`. This preserves the
  "Open-redirect mitigation" intent (the L88 comment) while honouring the
  middleware design.

- **web HI-02 — STILL LIVE (library-shape exposure).** `SessionsTable.tsx`
  declares `SessionRow.token: string` (`:32`) and calls
  `revokeOne.mutate(row.token)` (`:200`). The Phase 51 CR-4 fix renamed
  the *current-session* prop to `currentSessionId` but each ROW still
  carries the bearer because `authClient.listSessions()` returns it and
  `revokeSession` needs it. **JUDGMENT CALL — RESOLVED: document the
  unavoidable exposure (no id-based revocation exists).** Evidence: the
  installed Better Auth 1.6.9 `dist/api/routes/session.d.mts` declares
  `revokeSession` with input `{ token: z.ZodString }` ONLY — there is NO
  `revokeSession({ id })` overload in this version. Switching to
  id-based revocation is therefore IMPOSSIBLE without a Better Auth
  upgrade. The fix: (a) keep `token` off any rendered/stable surface —
  it is read ONLY inside the revoke mutation closure, never placed in a
  DOM attribute, `data-*`, or React key (audit confirms it is already
  only passed to `revokeOne.mutate`, but the `SessionRow` interface
  exposes it as a typed field — add a header comment making the
  exposure + containment posture explicit); (b) document the residual
  bearer-in-heap exposure + the CSP `connect-src` containment in the
  file header; (c) record the durable fix (a Better Auth upgrade
  exposing id-based revocation) in `.planning/deferred-items.md` as a
  v2 item. The RED test asserts the bearer is not emitted into any
  rendered DOM attribute / `data-*` / React key.

- **web HI-03 — STILL LIVE.** `NotesListClient.tsx:121` —
  `queryKey: [...queryKeys.notes.list(cursor), { folder: folderFilter }]`.
  `notes/page.tsx:25` prefetches with `queryKeys.notes.list(cursor)` (no
  folder element). The keys never match → SSR prefetch wasted. Fix: drop
  the `{ folder: folderFilter }` tuple element from the client query key
  (`folderFilter` is already applied as a pure client-side `.filter()` at
  `NotesListClient.tsx:152` — it does NOT change the fetched data, so it
  has no business in the cache key). The invalidate site at `:132` uses
  `["notes","list"]` (a prefix) and stays valid.

- **web HI-04 — STILL LIVE.** `AdminShell.tsx` header (lines ~63-69) has
  only `<ThemeSwitcher />`; the L4-7 comment says "NO sign-out button:
  admin auth is enforced at Traefik basic-auth". Basic-auth is retired.
  Fix: add a sign-out control to the header that calls Better Auth
  `signOut()` (mirror `AppShell`'s `handleSignOut`) and routes to
  `/sign-in`.

- **web HI-05 — STILL LIVE (doc drift).** 8 files carry stale
  `D-ADMIN-1` / Traefik-basic-auth / edge-auth comments (grep-confirmed):
  `middleware.ts:24-25`, `app/(admin)/admin/observability/page.tsx:2,10-11`,
  `app/(admin)/admin/page.tsx:5`, `app/(admin)/admin/config/page.tsx:2,8,11,15`,
  `components/screens/AdminShell.tsx:2,5` (folded into HI-04's commit since
  the file is edited there anyway), `components/screens/AdminIndex.tsx:27`,
  `components/screens/admin/ObservabilityClient.tsx:2`,
  `components/screens/admin/ConfigClient.tsx:2,13`. NOTE: `admin-guard.ts:6,21`
  ALREADY describes the correct model ("No Traefik basic-auth ... the prior
  model treated Traefik basic-auth as the primary gate and") — it is the
  authoritative file and is NOT edited. `app/(admin)/layout.tsx:8,38` also
  already say "No Traefik basic-auth" — confirm and leave. Doc-only purge.

- **web HI-06 — STILL LIVE.** `internal-api.ts:22` —
  `const DEFAULT_INTERNAL_API_URL = "http://api:3000"`. The `:3000` port
  literal is on the LOCKER-03 blocklist (`:3000|:4000|:8080`) and
  `apps/web/src/lib/` is not an allowlisted dir. Fix: the loader already
  reads `process.env.INTERNAL_API_URL` and only falls back to the literal
  when unset. Make the literal env-driven — split the default into a host
  + port the operator can override, OR (cleaner) require
  `INTERNAL_API_URL` to be set and fail-closed when absent (the env IS set
  by docker-compose and the Helm chart per the file header, so a
  fail-closed default has no real cost for supported deploy paths). The
  executor picks the lower-risk option and records it in `verify-first.log`;
  the non-negotiable outcome is the `:3000` literal no longer appears on
  the LOCKER-03-scanned surface and `pnpm lint:lockers` passes with any
  prior allowlist entry for it removed.

- **litellm HI-1 — STILL LIVE.** `errors.ts:68-73` —
  `constructor(status, bodyText, message?)`; `super(message ?? default)`.
  `bodyText` IS truncated (`:72`) but the optional `message` override is
  used verbatim. LOCKER-05's contract is "truncate AT CONSTRUCTION". Fix:
  truncate the `message` argument too (same 200-char bound) before passing
  it to `super()`.

- **litellm HI-2 — STILL LIVE.** `config.ts:32-57` reads
  `LITELLM_MASTER_KEY` and `LITELLM_BASE_URL` but NEVER `LITELLM_VIRTUAL_KEY`.
  CLAUDE.md's corporate-override narrative names `LITELLM_VIRTUAL_KEY`. Fix:
  read `LITELLM_VIRTUAL_KEY`; when set it wins over `LITELLM_MASTER_KEY` as
  the value placed on `config.masterKey` (the field consumed by
  `authHeaders()`); document the precedence in the loader header.

- **litellm HI-3 — STILL LIVE.** `config.ts:29` —
  `DEFAULT_LITELLM_BASE_URL = "http://litellm:4000"`; no `https://`
  assertion on overrides. Fix: when `LITELLM_BASE_URL` is overridden and
  `NODE_ENV === "production"`, assert the scheme is `https://`; refuse a
  non-https override unless `LITELLM_ALLOW_PLAINTEXT=1` is set OR the host
  is the bundled `litellm` compose service name. The bundled default is
  unaffected (it is not an override). `config.ts` is a `config/*` module —
  LOCKER-01 permits the `NODE_ENV` read here.

- **byok HI-01 — STILL LIVE.** `contract-tests/src/helpers/sign-in-fixture.ts:18`
  exports `FIXTURE_PASSWORD = "test-PW-12345!"`; `package.json` has
  `"main": "./src/index.ts"`, NO `files:` allowlist → `npm pack` tars the
  whole `src/` tree including this helper and its privileged owner-pool
  `email_verified` flip. Fix: add a `files:` allowlist to
  `contract-tests/package.json` that excludes `*.test.ts` and the test-only
  helpers, OR relocate the helpers to a non-published path. The
  `FIXTURE_PASSWORD` literal must not trip gitleaks on relocation — if it
  does, extend `.gitleaks.toml` allowlist + add the regression assertion in
  `tools/lint-gitleaks-config.test.ts` (CLAUDE.md hard rule 4 — never
  `--no-verify`).

- **byok HI-02 — STILL LIVE.** `contract-tests/src/{folders,notes,transcriptions}-shape.test.ts`
  live inside `src/` and ship in the tarball (no `files:` allowlist). Fix:
  same `files:` allowlist as HI-01 excludes them (one cohesive fix).

- **byok HI-03 — STILL LIVE (partial).** `contract-tests/src/schemas.ts`
  ALREADY re-exports the production-route schemas from `@openwhispr/wire-schemas`
  (`:28-40` — "Phase 40 / Sub-fix 40.a"). But it STILL locally defines
  `HealthResponse`, `TranscribeRequestFields/Response`, the streaming
  `*Chunk` family, `StreamingTokenResponse`, `DeepgramStreamingTokenResponse`,
  `UsageResponse`, `OpenAIRealtimeTokenResponse`, `ErrorEnvelope`. Fix: for
  each locally-defined schema with a `wire-schemas` counterpart (verified:
  `openai-realtime-token`, `streaming-usage` exist in the barrel), replace
  the local copy with a `wire-schemas` import; for schemas with NO
  counterpart (`HealthResponse`, the streaming `*Chunk` family,
  `DeepgramStreamingTokenResponse`, `ErrorEnvelope`) add a header comment
  stating the contract package legitimately owns them and why.

- **byok HI-04 — STILL LIVE (partial).** `negative-matrix.ts` — two issues.
  (1) The static `PHASE_5_ROUTES` / `PHASE_2_4_BASELINE_ROUTES` inventory:
  the drift guard `negative-matrix-enumeration.test.ts` ALREADY EXISTS
  (`packages/contract-tests/tests/unit/__tests__/negative-matrix-enumeration.test.ts`
  — grep-confirmed) — verify it actually enforces parity with the live
  route set; if it does, this sub-issue is already mitigated and the fix
  is to confirm + document. (2) `TolerantEnvelope` (`:21-29`) accepts BOTH
  the string and structured envelope as equivalent → the matrix cannot
  detect a route emitting the wrong shape. Fix: tighten so the matrix
  asserts the string form per route (the structured form is reserved for
  one documented future site — gate it to that site or remove the union).

- **byok HI-05 — STILL LIVE.** `contract-tests/src/helpers/multipart.ts:28-29`
  reads `resolve(__dirname, "../../../../tests/fixtures/audio", filename)` —
  a repo-root path absent from a published tarball. Fix: bundle a sample
  fixture inside `packages/contract-tests/fixtures/` and ship it via the
  `files:` allowlist + repoint the resolve path, OR relocate the helper
  out of the published `src/`.

- **wire H-1 — STILL LIVE.** `wire-schemas/src/conversations.ts:23-27` —
  `MetadataSchema.refine(..., { message: "metadata too large" })`. Inline
  English end-user error message. Fix: replace with a stable machine key
  `metadata.too_large` (or an empty message) so the route localizes via
  i18next.

- **HIGH-EMAIL-01 — STILL LIVE (doc gap), resolution DOC-ONLY.**
  `EmailSender.ts:142-150` forwards `html` to nodemailer verbatim, no
  escape, no documented contract. **JUDGMENT CALL — RESOLVED: doc-only.**
  Grep of every `EmailSender` caller (3 total): (1) `apps/worker/src/jobs/email-delivery.ts:98`
  passes `rendered.html` from the worker `template-renderer`, which
  interpolates with `htmlEscape: true` (`template-renderer.ts:199` —
  `interpolate(tpl.html, variables, { htmlEscape: true })`) — escaping is
  ALREADY done upstream. (2) `apps/api/src/auth.ts:565` and `:617` build
  `html` by interpolating ONLY a Better-Auth-generated `url` (a
  server-generated reset/verify URL — not user-controlled). NO caller
  interpolates user-controlled data into `html`. Therefore a boundary
  escape inside `EmailSender` would be redundant (worker double-escapes)
  and risky (it would corrupt the worker's already-escaped HTML). The
  correct fix is the review's own recommendation (a): make the
  caller-owns-escaping contract EXPLICIT in the `SendArgs.html` JSDoc +
  `packages/email/README.md`. Doc commit, no test.

Each live code finding is closed via strict RED→GREEN TDD; the RED test
references the finding ID; test + production code may land in the same
atomic commit. Doc findings (web HI-05, HIGH-EMAIL-01) land as doc commits
verified accurate against the code they describe.

Purpose: clear the final pre-publication HIGH backlog — a lost deep-link
recovery flow (web HI-01), a session-bearer heap-exposure (web HI-02), a
wasted SSR prefetch (web HI-03), an admin UX dead-end (web HI-04),
security comments that would mislead a future contributor into weakening
the admin gate (web HI-05), a LOCKER-03 hardcode (web HI-06), an
error-truncation bypass (litellm HI-1), a missing corporate-override env
binding (litellm HI-2), a plaintext-credential-over-the-wire risk (litellm
HI-3), test fixtures + a hardcoded password + a privileged DB-flip path
shipping in a published npm tarball (byok HI-01/02/05), a wire-schema
drift surface (byok HI-03), a weakened negative-matrix contract (byok
HI-04), an inline English error message (wire H-1), and an undocumented
HTML-escape contract on the email boundary (HIGH-EMAIL-01).

Output: per-finding RED+GREEN / doc atomic commits, a `verify-first.log`
evidence record, and the 5 `.planning/review/*.md` files + `REVIEW-INDEX.md`
annotated with per-finding closure markers driving the HIGH aggregate to 0.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/68-high-findings-web-and-pkgs/CONTEXT.md
@.planning/review/web.md
@.planning/review/litellm-client.md
@.planning/review/byok-guard-contract-tests.md
@.planning/review/wire-schemas.md
@.planning/review/small-pkgs.md
@CLAUDE.md

Already-read source (facts captured below — do NOT re-read whole files to
"check one more thing"; use Grep for anything more specific):

- **web HI-01.** `SignInForm.tsx` is a `"use client"` component. It does
  NOT currently import `useSearchParams`. `middleware.ts:144-146` sets
  `url.searchParams.set("from", path)` where `path = req.nextUrl.pathname`
  (always starts with `/app` — the auth gate only runs for `/app` and
  `/app/*`). The validated-destination helper belongs in the form (or a
  tiny `lib/` helper with its own unit test). Allowlist: starts with
  `/app/` OR equals `/app`; no `://`; no `\`; not starting with `//`.
- **web HI-02.** `SessionsTable.tsx` — `SessionRow.token` at `:32`;
  `revokeOne.mutate(row.token)` at `:200`. The token is NEVER placed in a
  DOM attribute / `data-*` / React `key` today (React keys use `row.id`).
  The exposure is the typed field on the row objects held in the
  TanStack Query cache (JS heap). Better Auth 1.6.9 `revokeSession` input
  is `{ token: z.ZodString }` ONLY (confirmed in
  `node_modules/.pnpm/better-auth@1.6.9*/node_modules/better-auth/dist/api/routes/session.d.mts:230-243`).
  So id-based revocation is not available — the fix is documentation +
  keeping `token` strictly out of any render path.
- **web HI-03.** `NotesListClient.tsx:121` client key has the extra
  `{ folder: folderFilter }`; `notes/page.tsx:25` prefetch key does not.
  `folderFilter` (`NotesListClient.tsx:111`) is applied client-side as a
  `.filter()` at `:152` — it does not change the fetched payload.
  Invalidate at `:132` uses the `["notes","list"]` prefix.
- **web HI-04.** `AdminShell.tsx` header is lines ~63-69, only
  `<ThemeSwitcher />`. `AppShell` is the reference for `handleSignOut`
  (`signOut()` from `auth-client`). Add a sign-out button + i18n key.
- **web HI-05.** 8 files (grep-confirmed list in `<objective>`).
  `admin-guard.ts` and `app/(admin)/layout.tsx` already describe the
  correct model — do NOT edit them. `AdminShell.tsx` comments fold into
  the HI-04 commit.
- **web HI-06.** `internal-api.ts:22` `DEFAULT_INTERNAL_API_URL = "http://api:3000"`.
  `internalApiUrl()` reads `process.env.INTERNAL_API_URL`, falls back to
  the literal. The env is set by docker-compose + Helm per the file header.
- **litellm HI-1.** `errors.ts:68-73`. `super(message ?? default)`. Apply
  `.slice(0, 200)` to `message` before passing it to `super`.
- **litellm HI-2/HI-3.** `config.ts:32-57`. `loadLitellmConfigFromEnv`
  takes `env: NodeJS.ProcessEnv`. `config.masterKey` is consumed by
  `authHeaders()` in `index.ts:365`. `config.ts` is a `config/*` module
  (LOCKER-01 permits a `NODE_ENV` read). The bundled default
  `DEFAULT_LITELLM_BASE_URL = "http://litellm:4000"` (`:29`).
- **byok HI-01/02/05.** `contract-tests/package.json` has `"main": "./src/index.ts"`,
  `"exports"` to `./src/index.ts` + `./src/schemas.ts`, NO `files:` field.
  `src/` tree: `env.ts errors.ts {folders,notes,transcriptions}-shape.test.ts
  helpers/{cookie-jar,http,multipart,sign-in-fixture,streaming}.ts index.ts
  negative-matrix.ts schemas.ts`. `tsconfig.json` `"include": ["src/**/*.ts"]`.
  `byok-guard/package.json` has no `files:` field and `byok-guard/src/`
  has only `index.ts` + `redact-url.ts` (no test files in `src/` — byok-guard
  itself is clean; the `files:` concern is contract-tests only — but adding a
  `files:` allowlist to `byok-guard/package.json` for symmetry is acceptable
  defence-in-depth). `.gitleaks.toml` has a `[allowlist]` with `paths` and
  `regexes`; `tools/lint-gitleaks-config.test.ts` is the regression test.
  `tests/fixtures/audio/` exists at repo root.
- **byok HI-03.** `contract-tests/src/schemas.ts` already imports from
  `@openwhispr/wire-schemas` at `:40`. wire-schemas barrel exports:
  agent, api-keys, check-user, conversations, delete-account, diarization,
  folders, notes, openai-realtime-token, reason, settings, streaming-usage,
  test-only-seed-tenant, transcriptions, verification-status, web-search.
  Locally-defined-with-counterpart: `OpenAIRealtimeTokenResponse`
  (counterpart `openai-realtime-token.ts`), `UsageResponse`/`StreamingUsageResponse`
  (counterpart `streaming-usage.ts`). Locally-defined-without-counterpart:
  `HealthResponse`, `TranscribeRequestFields/Response`, the `*Chunk` family,
  `DeepgramStreamingTokenResponse`, `ErrorEnvelope`.
- **byok HI-04.** `negative-matrix.ts:21-29` `TolerantEnvelope` union.
  `negative-matrix-enumeration.test.ts` EXISTS at
  `packages/contract-tests/tests/unit/__tests__/`. The static inventory's
  drift guard is therefore already present — verify it enforces parity.
- **wire H-1.** `conversations.ts:23-27` `MetadataSchema.refine`. Use key
  `metadata.too_large`.
- **HIGH-EMAIL-01.** `EmailSender.ts:42-47` `SendArgs`; `:142-150` `send`.
  3 callers, all pass trusted/escaped HTML (grep evidence in `<objective>`).
  Doc-only: JSDoc on `SendArgs.html` + `packages/email/README.md`.

<interfaces>
packages/litellm-client/src/errors.ts:
  export class LitellmUpstreamError extends Error
  constructor(status: number, bodyText: string, message?: string)
  // HI-1 GREEN: truncate `message` (slice 0,200) before super().

packages/litellm-client/src/config.ts:
  export function loadLitellmConfigFromEnv(env?: NodeJS.ProcessEnv): LitellmClientConfig
  // HI-2 GREEN: read env.LITELLM_VIRTUAL_KEY; precedence over LITELLM_MASTER_KEY.
  // HI-3 GREEN: assert https on overridden LITELLM_BASE_URL in production.

apps/web/src/components/screens/account/SessionsTable.tsx:
  export interface SessionRow { id; token; ... }
  // HI-02: token stays — Better Auth needs it — but document the exposure;
  // RED asserts token never reaches a DOM attribute / data-* / React key.

packages/wire-schemas/src/conversations.ts:
  export const MetadataSchema
  // H-1 GREEN: refinement message → "metadata.too_large" (machine key).
</interfaces>

Test runners: `apps/web` uses vitest (component tests under
`apps/web/tests/`); `packages/{litellm-client,byok-guard,contract-tests,wire-schemas,email}`
use vitest with tests under each package's `tests/` directory. NO mocks of
internal logic — these are pure-unit surfaces (no DB-touching path in
scope). Per-package test commands: `pnpm --filter @openwhispr/<pkg> test`.
</context>

## Phase Goal

Close all 16 HIGH findings — 14 via strict RED→GREEN TDD with the RED test
referencing the finding ID, 2 via accurate doc commits (web HI-05,
HIGH-EMAIL-01). No production code edited solely to make a test pass
(CLAUDE.md hard rule 1). No gitleaks hook bypass (hard rule 4). All 8
constitutional lockers green; `pnpm typecheck` no new errors vs the 5-error
baseline.

---

## Verify-first protocol (MANDATORY, all 16 findings)

Before any fix the executor writes
`.planning/phases/68-high-findings-web-and-pkgs/verify-first.log` and, per
finding, records **still-live / partially-mitigated / already-closed** with
the `file:line` evidence checked:

```
# web
grep -n 'callbackURL\|router.push\|useSearchParams' apps/web/src/components/screens/auth/SignInForm.tsx   # HI-01 — no useSearchParams; hardcoded /app
grep -n 'searchParams.set."from"' apps/web/src/middleware.ts                                              # HI-01 — middleware sets from
grep -n 'token' apps/web/src/components/screens/account/SessionsTable.tsx                                 # HI-02 — SessionRow.token live
grep -rn 'revokeSession' node_modules/.pnpm/better-auth@1.6.9*/node_modules/better-auth/dist/api/routes/session.d.mts  # HI-02 — token-only input
grep -n 'queryKey' apps/web/src/components/screens/notes/NotesListClient.tsx 'apps/web/src/app/(auth)/app/notes/page.tsx'  # HI-03 — key mismatch
grep -n 'sign-out\|signOut\|ThemeSwitcher' apps/web/src/components/screens/AdminShell.tsx                  # HI-04 — no sign-out
grep -rn 'D-ADMIN-1\|Traefik basic-auth' apps/web/src --include=*.ts --include=*.tsx | grep -v test       # HI-05 — 8 stale files
grep -n ':3000' apps/web/src/lib/internal-api.ts                                                          # HI-06 — hardcoded port
# litellm
grep -n 'message ?? ' packages/litellm-client/src/errors.ts                                               # HI-1 — message override untruncated
grep -n 'LITELLM_VIRTUAL_KEY' packages/litellm-client/src/config.ts                                       # HI-2 — expect ABSENT
grep -n 'DEFAULT_LITELLM_BASE_URL\|https' packages/litellm-client/src/config.ts                            # HI-3 — http default, no assertion
# byok
grep -n 'files' packages/contract-tests/package.json                                                      # HI-01/02 — expect ABSENT
grep -n 'FIXTURE_PASSWORD' packages/contract-tests/src/helpers/sign-in-fixture.ts                          # HI-01 — exported literal
find packages/contract-tests/src -name '*.test.ts'                                                        # HI-02 — 3 test files in src/
grep -n '@openwhispr/wire-schemas\|export const' packages/contract-tests/src/schemas.ts                    # HI-03 — local + imported mix
ls packages/contract-tests/tests/unit/__tests__/negative-matrix-enumeration.test.ts                        # HI-04 — drift guard exists
grep -n 'tests/fixtures/audio' packages/contract-tests/src/helpers/multipart.ts                            # HI-05 — repo-root path
# wire
grep -n 'metadata too large' packages/wire-schemas/src/conversations.ts                                    # H-1 — inline English
# email
grep -rn '\.send(' apps/api/src/auth.ts apps/worker/src/jobs/email-delivery.ts                             # HIGH-EMAIL-01 — caller grep
grep -n 'htmlEscape' apps/worker/src/i18n/template-renderer.ts                                             # HIGH-EMAIL-01 — worker escapes
```

**HI-02 BETTER-AUTH-VERSION CHECK (mandatory, explicit):** the
`session.d.mts` grep MUST show `revokeSession` input is `{ token }` only —
NO `{ id }` variant. If it is confirmed token-only → record in
`verify-first.log` that id-based revocation is unavailable in Better Auth
1.6.9 and HI-02's resolution is the documentation route. If — unexpectedly
— an `{ id }` variant exists, STOP and report; the fix changes to id-based
revocation.

**HIGH-EMAIL-01 CALLER-GREP (mandatory, explicit):** record in
`verify-first.log` the result of the 3-caller grep. If every caller passes
trusted/escaped HTML (worker `htmlEscape: true`; auth.ts server-generated
URL only) → HIGH-EMAIL-01 resolution is doc-only. If ANY caller interpolates
user-controlled data into `html`, STOP and report — the fix becomes a real
boundary escape.

Each finding is expected STILL LIVE. If any grep contradicts the
pre-determination, STOP, treat per the evidence, record it in
`verify-first.log`, adjust the affected task, and report the divergence in
the SUMMARY.

Commit the log: `docs(68-01): verify-first — 16 HIGH disposition log`.

---

## Task 1 — apps/web: HI-01, HI-02, HI-03, HI-04, HI-06 (code) + HI-05 (doc)

**Findings:** web HI-01..HI-06.

**Type:** five code fixes (strict RED→GREEN TDD) + one doc purge (HI-05).
Group by package; each finding keeps a distinct ID-referenced RED test.

### HI-01 — consume `?from=` with an allowlist (RED→GREEN)
- **RED:** new/extended test under `apps/web/tests/` for `SignInForm` (or a
  `lib/` `safeFromParam` helper if the executor extracts the allowlist into
  a testable pure function — preferred for unit-testability). Test names
  MUST contain `HI-01`. Assert: (a) `from=/app/notes/123` → post-sign-in
  destination is `/app/notes/123`; (b) `from=https://evil.com` → falls back
  to `/app`; (c) `from=//evil.com` → `/app`; (d) `from=/etc/passwd` (no
  `/app/` prefix) → `/app`; (e) absent `from` → `/app`.
- **GREEN:** add `useSearchParams` to `SignInForm`; compute the validated
  destination via the allowlist (starts with `/app/` or equals `/app`; no
  `://`; no `\`; not starting with `//`); use it for both `callbackURL`
  and `router.push`. Update the L88/L30 comment to describe the allowlist
  (the "Open-redirect mitigation" is now an allowlist, not a hardcode).
- Commit: `test(68-01): red — web HI-01 SignInForm drops ?from= deep-link`
  then `fix(68-01): green — web HI-01 consume ?from= with path allowlist`.

### HI-02 — document the unavoidable session-bearer exposure (RED→GREEN)
- **RED:** test under `apps/web/tests/` for `SessionsTable`. Test names MUST
  contain `HI-02`. Render the table with a row whose `token` is a
  recognizable sentinel; assert the sentinel does NOT appear in any rendered
  DOM attribute, `data-*` attribute, or as a React `key` (query the rendered
  output). This pins that the bearer is never emitted to the DOM.
- **GREEN:** `SessionsTable.tsx` — the bearer stays on `SessionRow.token`
  (Better Auth `revokeSession` needs it; 1.6.9 has no id-based revocation —
  confirmed). Add a file-header comment block documenting: (a) the bearer
  is in the JS heap because `listSessions()` returns it and `revokeSession`
  requires it; (b) it is read ONLY inside the `revokeOne` mutation closure
  and never rendered; (c) the CSP `connect-src` containment posture limits
  exfiltration; (d) the durable fix is a Better Auth upgrade exposing
  id-based revocation. Confirm no code path renders `token`.
- Add the residual exposure to `.planning/deferred-items.md`: a v2 item —
  "Better Auth upgrade for id-based session revocation (web HI-02)".
- Commit: `test(68-01): red — web HI-02 session bearer must not reach DOM`
  then `fix(68-01): green — web HI-02 document session-bearer heap exposure`.

### HI-03 — align NotesListClient query key (RED→GREEN)
- **RED:** test under `apps/web/tests/` for `NotesListClient`. Test names
  MUST contain `HI-03`. Assert the notes-list `queryKey` deep-equals
  `queryKeys.notes.list(cursor)` (no extra `{ folder }` tuple element) so it
  matches the RSC dehydrated key. Pre-fix the extra element fails the
  equality.
- **GREEN:** `NotesListClient.tsx:121` — remove the `, { folder: folderFilter }`
  tuple element; the query key becomes `queryKeys.notes.list(cursor)`.
  `folderFilter` continues to be applied as the client-side `.filter()` at
  `:152` (unchanged). The `:132` invalidate (`["notes","list"]` prefix)
  stays valid.
- Commit: `test(68-01): red — web HI-03 NotesListClient queryKey mismatch`
  then `fix(68-01): green — web HI-03 align notes-list queryKey with RSC`.

### HI-04 — AdminShell sign-out button (RED→GREEN)
- **RED:** test under `apps/web/tests/` for `AdminShell`. Test names MUST
  contain `HI-04`. Assert the header renders a sign-out control (by role /
  test-id / accessible name). Pre-fix it is absent.
- **GREEN:** `AdminShell.tsx` — add a sign-out button to the header (next
  to `ThemeSwitcher`) that calls Better Auth `signOut()` from `auth-client`
  and routes to `/sign-in` (mirror `AppShell.handleSignOut`). Add the i18n
  key (EN + RU) for the button label. Remove the stale L4-7 "NO sign-out
  button ... Traefik basic-auth" comment (HI-05 overlap — folded here).
- Commit: `test(68-01): red — web HI-04 AdminShell has no sign-out`
  then `fix(68-01): green — web HI-04 add AdminShell sign-out control`.

### HI-06 — internal-api.ts LOCKER-03 hardcode (RED→GREEN)
- **RED:** test under `apps/web/tests/` (or `tests/unit/`). Test names MUST
  contain `HI-06`. Assert `internalApiUrl()` behaves correctly with
  `INTERNAL_API_URL` set, and (per the executor's chosen approach) either
  fails-closed when unset OR derives the default from a host/port env. Also
  add an assertion that `internal-api.ts` source contains no `:3000` literal.
- **GREEN:** `internal-api.ts` — remove the `:3000` literal. Executor picks
  the lower-risk option (record in `verify-first.log`): (a) fail-closed —
  `internalApiUrl()` throws a clear error when `INTERNAL_API_URL` is unset
  (docker-compose + Helm always set it per the file header); or (b) derive
  the default from `INTERNAL_API_HOST` + `INTERNAL_API_PORT` env reads. The
  non-negotiable outcome: no `:3000` on the LOCKER-03-scanned surface.
- If a LOCKER-03 allowlist entry exists for this literal, remove it; confirm
  `pnpm lint:lockers` passes.
- Commit: `test(68-01): red — web HI-06 hardcoded :3000 in internal-api`
  then `fix(68-01): green — web HI-06 remove :3000 hardcode (LOCKER-03)`.

### HI-05 — purge stale D-ADMIN-1 / Traefik comments (doc)
- Edit the 7 remaining files (AdminShell folded into HI-04 above):
  `middleware.ts:24-25`, `app/(admin)/admin/observability/page.tsx:2,10-11`,
  `app/(admin)/admin/page.tsx:5`, `app/(admin)/admin/config/page.tsx:2,8,11,15`,
  `components/screens/AdminIndex.tsx:27`,
  `components/screens/admin/ObservabilityClient.tsx:2`,
  `components/screens/admin/ConfigClient.tsx:2,13`. Replace each stale
  comment with an accurate one describing the real model: admin =
  `users.role='admin'` enforced by `checkAdminAccess()` (see `admin-guard.ts`).
  Do NOT change `admin-guard.ts` or `app/(admin)/layout.tsx` (already
  correct). Comment-only — zero executable behaviour change.
- Commit: `docs(68-01): web HI-05 purge stale D-ADMIN-1/Traefik comments`.

### Verify
```
grep -rn 'D-ADMIN-1\|Traefik basic-auth' apps/web/src --include=*.ts --include=*.tsx | grep -v test   # 0 (admin-guard.ts/layout.tsx historical refs allowed if accurate)
grep -c ':3000' apps/web/src/lib/internal-api.ts                                                      # 0
grep -rn 'HI-01\|HI-02\|HI-03\|HI-04\|HI-06' apps/web/tests --include='*.ts' --include='*.tsx'         # each ID referenced
pnpm --filter @openwhispr/web test
pnpm lint:lockers
```

### Done
web HI-01..HI-06 closed: `?from=` consumed with an allowlist; session
bearer documented + kept off the DOM; notes-list queryKey aligned;
AdminShell has a sign-out control; stale comments purged; `:3000` hardcode
removed and LOCKER-03 green.

---

## Task 2 — packages/litellm-client: HI-1, HI-2, HI-3

**Findings:** litellm HI-1, HI-2, HI-3. **Type:** three code fixes — strict
RED→GREEN TDD. Each finding keeps a distinct ID-referenced RED test.

### HI-1 — truncate the `message` constructor argument (RED→GREEN)
- **RED:** extend `packages/litellm-client/tests/unit/errors-truncation.test.ts`.
  Test names MUST contain `HI-1`. Construct
  `new LitellmUpstreamError(500, "x".repeat(500), "y".repeat(500))` and
  assert `err.message.length <= 200` (the message-override path is
  truncated). Pre-fix it is 500 → RED fails.
- **GREEN:** `errors.ts:73` — apply `.slice(0, 200)` to `message` before
  passing to `super()`: `super((message ?? \`...\`).slice(0, 200))` or
  equivalent. Keep the existing default-message + `bodyText` truncation.
- Commit: `test(68-01): red — litellm HI-1 message override bypasses truncation`
  then `fix(68-01): green — litellm HI-1 truncate LitellmUpstreamError message`.

### HI-2 — wire LITELLM_VIRTUAL_KEY with precedence (RED→GREEN)
- **RED:** extend `packages/litellm-client/tests/unit/config.test.ts`. Test
  names MUST contain `HI-2`. Assert: (a) with `LITELLM_VIRTUAL_KEY` set and
  `LITELLM_MASTER_KEY` set, `loadLitellmConfigFromEnv` returns a config
  whose `masterKey` equals `LITELLM_VIRTUAL_KEY` (precedence); (b) with only
  `LITELLM_MASTER_KEY` set, `masterKey` equals `LITELLM_MASTER_KEY`
  (back-compat).
- **GREEN:** `config.ts` — read `env.LITELLM_VIRTUAL_KEY`; when present and
  non-empty it becomes `config.masterKey` (the field `authHeaders()`
  consumes); else fall back to `LITELLM_MASTER_KEY`. Keep the existing
  "`LITELLM_MASTER_KEY` is required" guard as the floor (the corporate
  override still needs SOME key). Document the precedence in the loader
  header.
- Commit: `test(68-01): red — litellm HI-2 LITELLM_VIRTUAL_KEY never read`
  then `fix(68-01): green — litellm HI-2 wire LITELLM_VIRTUAL_KEY precedence`.

### HI-3 — assert https on production base-URL override (RED→GREEN)
- **RED:** extend `config.test.ts`. Test names MUST contain `HI-3`. Assert:
  (a) `NODE_ENV=production` + `LITELLM_BASE_URL=http://x.example` →
  `loadLitellmConfigFromEnv` throws a clear error; (b) same with
  `LITELLM_ALLOW_PLAINTEXT=1` → does NOT throw; (c) `NODE_ENV=production` +
  `LITELLM_BASE_URL=https://x.example` → does NOT throw; (d) no
  `LITELLM_BASE_URL` (bundled default `http://litellm:4000`) → does NOT
  throw; (e) non-production + http override → does NOT throw.
- **GREEN:** `config.ts` — after resolving `baseUrl`, if `LITELLM_BASE_URL`
  was overridden (i.e. the env var is set and non-empty) AND
  `env.NODE_ENV === "production"` AND the scheme is not `https://`, throw
  unless `env.LITELLM_ALLOW_PLAINTEXT` is `"1"` (or a truthy value) OR the
  host is the bundled `litellm` compose service name. `config.ts` is a
  `config/*` module — the `NODE_ENV` read is LOCKER-01 permitted. Document
  the assertion in the loader header.
- Commit: `test(68-01): red — litellm HI-3 no https assertion on override`
  then `fix(68-01): green — litellm HI-3 assert https on prod base-URL override`.

### Verify
```
grep -rn 'HI-1\|HI-2\|HI-3' packages/litellm-client/tests --include='*.ts'   # each ID referenced
pnpm --filter @openwhispr/litellm-client test
pnpm lint:lockers
```

### Done
litellm HI-1..HI-3 closed: `LitellmUpstreamError` truncates the `message`
override; `LITELLM_VIRTUAL_KEY` is read with precedence over
`LITELLM_MASTER_KEY`; an http production base-URL override is refused
without explicit opt-out.

---

## Task 3 — packages/byok-guard + contract-tests: HI-01, HI-02, HI-03, HI-04, HI-05

**Findings:** byok HI-01..HI-05. **Type:** code fixes (published-tarball
hygiene + schema imports + matcher tightening) — strict TDD where a test is
meaningful; the `files:` allowlist + fixture relocation are verified via
`npm pack --dry-run` rather than a unit test.

### HI-01 + HI-02 + HI-05 — published-tarball hygiene (one cohesive change)
These three share a root cause (no `files:` allowlist → the whole `src/`
tree ships) and a single fix.
- **GREEN:**
  - Add a `files:` allowlist to `packages/contract-tests/package.json` that
    ships ONLY what an external consumer needs (the schema/error surface
    re-exported via `index.ts` + `schemas.ts`) and EXCLUDES `*.test.ts` and
    the test-only helpers (`helpers/sign-in-fixture.ts` carrying
    `FIXTURE_PASSWORD` + the privileged owner-pool flip). Prefer relocating
    `*-shape.test.ts` to `packages/contract-tests/tests/` AND scoping
    `files:` so the tarball excludes test helpers — whichever the executor
    judges lower-risk; the non-negotiable outcome is `npm pack --dry-run`
    shows neither the test files nor `FIXTURE_PASSWORD`/the privileged flip
    in the tarball.
  - **HI-05:** bundle a sample audio fixture inside
    `packages/contract-tests/fixtures/sample-1s.wav` (copy from
    `tests/fixtures/audio/`), repoint `multipart.ts:28-29`'s `resolve(...)`
    to the bundled path, and include `fixtures/` in the `files:` allowlist.
    (Alternative: relocate `multipart.ts` out of published `src/` — executor
    picks; record in `verify-first.log`.)
  - **HI-01 gitleaks:** if relocating `FIXTURE_PASSWORD` (or the
    `sample-1s.wav` copy) trips the gitleaks pre-commit/pre-push hook,
    extend `.gitleaks.toml`'s `[allowlist]` (path or regex) AND add the
    matching regression assertion to `tools/lint-gitleaks-config.test.ts`
    in the SAME commit (CLAUDE.md hard rule 4). NEVER `git commit/push
    --no-verify`. If the hook does not fire, no `.gitleaks.toml` change is
    needed.
  - Add a `files:` allowlist to `packages/byok-guard/package.json` for
    symmetry (its `src/` has no test files today, but a `files:` field is
    cheap defence-in-depth — optional, executor's call, record in log).
- **Verify (the test):** `cd packages/contract-tests && npm pack --dry-run`
  — the printed file list MUST NOT contain any `*.test.ts`,
  `helpers/sign-in-fixture.ts`, or the `FIXTURE_PASSWORD` literal. Capture
  the output into `verify-first.log`.
- Commit: `fix(68-01): green — byok HI-01/02/05 exclude test artifacts from tarball`.

### HI-03 — collapse contract-tests schema drift (RED→GREEN)
- **RED:** new test `packages/contract-tests/tests/unit/schemas-no-drift.test.ts`.
  Test names MUST contain `HI-03`. For each schema in `schemas.ts` that has
  a `wire-schemas` counterpart (`OpenAIRealtimeTokenResponse`,
  `UsageResponse`/`StreamingUsageResponse`), assert the `schemas.ts` export
  is referentially the SAME object as the `@openwhispr/wire-schemas` export
  (`toBe`) — i.e. it is a re-export, not a divergent copy. Pre-fix they are
  distinct objects → RED fails.
- **GREEN:** `schemas.ts` — replace the local `OpenAIRealtimeTokenResponse`,
  `UsageResponse`, `StreamingUsageResponse` definitions with imports from
  `@openwhispr/wire-schemas` (re-exported for path compat). For the schemas
  with NO counterpart (`HealthResponse`, `TranscribeRequestFields/Response`,
  the `*Chunk` family, `DeepgramStreamingTokenResponse`, `ErrorEnvelope`)
  add a header comment block stating the contract package legitimately owns
  them (no production-route counterpart exists) and why.
- Commit: `test(68-01): red — byok HI-03 contract-tests schema drift`
  then `fix(68-01): green — byok HI-03 import canonical wire-schemas`.

### HI-04 — tighten TolerantEnvelope + confirm drift guard (RED→GREEN)
- **RED:** new/extended test under `packages/contract-tests/tests/unit/`.
  Test names MUST contain `HI-04`. Assert: (a) the tightened envelope
  matcher REJECTS the structured `{error:{message}}` form for the
  default-envelope routes (so a route emitting the wrong shape is caught);
  (b) `negative-matrix-enumeration.test.ts` exists and the static route
  inventory is parity-checked against the live route set (assert the guard
  is present — if the executor finds the existing enumeration test does NOT
  actually enforce parity, extend it).
- **GREEN:** `negative-matrix.ts` — replace the permissive `TolerantEnvelope`
  union with a strict default-envelope matcher (`{error: z.string().min(1)}`)
  for the matrix's per-route assertion; if the one documented structured-error
  site genuinely needs the structured form, gate it to that single route
  rather than accepting both globally. Keep the static inventory but ensure
  the enumeration drift guard is live.
- Commit: `test(68-01): red — byok HI-04 TolerantEnvelope weakens contract`
  then `fix(68-01): green — byok HI-04 tighten negative-matrix envelope`.

### Verify
```
cd packages/contract-tests && npm pack --dry-run    # no *.test.ts, no sign-in-fixture, no FIXTURE_PASSWORD
grep -rn 'HI-03\|HI-04' packages/contract-tests/tests --include='*.ts'
pnpm --filter @openwhispr/contract-tests test
pnpm --filter @openwhispr/byok-guard test
pnpm test --filter ./tools                          # gitleaks-config regression if .gitleaks.toml touched
pnpm lint:lockers
```

### Done
byok HI-01..HI-05 closed: test files, `FIXTURE_PASSWORD`, the privileged
owner-pool flip, and the repo-root fixture path no longer ship in the
published tarball (verified via `npm pack --dry-run`); `schemas.ts` imports
canonical wire-schemas with documented exceptions; `TolerantEnvelope` is
tightened; the enumeration drift guard is confirmed live. No gitleaks
bypass.

---

## Task 4 — wire-schemas H-1 + small-pkgs HIGH-EMAIL-01

**Findings:** wire H-1 (code, RED→GREEN); HIGH-EMAIL-01 (doc-only).

### wire H-1 — machine-key the MetadataSchema refinement (RED→GREEN)
- **RED:** new/extended test under `packages/wire-schemas/tests/`. Test
  names MUST contain `H-1`. Parse an over-budget metadata object and assert
  the Zod issue's `message` is the machine key `metadata.too_large` (not the
  inline English `"metadata too large"`).
- **GREEN:** `conversations.ts:25-27` — change the `.refine` message from
  `"metadata too large"` to `"metadata.too_large"` (a stable machine key
  the route maps through i18next). Update the L8 file-header comment if it
  references the old string.
- Commit: `test(68-01): red — wire H-1 inline English in MetadataSchema`
  then `fix(68-01): green — wire H-1 machine-key MetadataSchema refinement`.

### HIGH-EMAIL-01 — make the caller-owns-escaping contract explicit (doc)
- **Verify-first evidence required:** the 3-caller grep result recorded in
  `verify-first.log` (worker `template-renderer` escapes with
  `htmlEscape: true`; `auth.ts` interpolates only server-generated URLs).
  If that holds → doc-only (this task). If a caller interpolates
  user-controlled data → STOP per the verify-first protocol.
- `EmailSender.ts` — add a JSDoc block to `SendArgs.html` stating: the
  `html` body is forwarded to nodemailer VERBATIM; the package performs NO
  HTML-escaping; the CALLER owns escaping any interpolated value; point at a
  known-safe renderer (the worker `template-renderer` with `htmlEscape:true`)
  as the reference pattern.
- `packages/email/README.md` — add a section documenting the same
  caller-owns-escaping contract (create the README section if absent).
- No boundary escape is added (it would double-escape the worker's
  already-escaped HTML and corrupt it). No test — doc commit.
- Commit: `docs(68-01): HIGH-EMAIL-01 document caller-owns-HTML-escaping`.

### Verify
```
grep -c 'metadata too large' packages/wire-schemas/src/conversations.ts   # 0
grep -c 'metadata.too_large' packages/wire-schemas/src/conversations.ts   # >=1
grep -rn 'H-1' packages/wire-schemas/tests --include='*.ts'
grep -n 'escape\|caller' packages/email/src/EmailSender.ts packages/email/README.md
pnpm --filter @openwhispr/wire-schemas test
pnpm --filter @openwhispr/email test
pnpm lint:lockers
```

### Done
wire H-1 closed: `MetadataSchema` uses the machine key `metadata.too_large`,
no inline English. HIGH-EMAIL-01 closed doc-only: the caller-owns-escaping
contract is explicit in the `SendArgs.html` JSDoc + `packages/email/README.md`;
the verify-first caller grep confirmed no caller interpolates user-controlled
data.

---

## Task 5 — annotate the review artifacts (FINAL TASK)

After Tasks 1–4 are green/verified:

- Append a closure marker under each finding in the 5 review files:
  - `.planning/review/web.md` — HI-01..HI-06
  - `.planning/review/litellm-client.md` — HI-1..HI-3
  - `.planning/review/byok-guard-contract-tests.md` — HI-01..HI-05 (the
    HIGH section; CR-01/CR-02 already closed by Phase 57; MED/LOW out of
    scope)
  - `.planning/review/wire-schemas.md` — H-1
  - `.planning/review/small-pkgs.md` — HIGH-EMAIL-01
  Marker format: `**Status:** CLOSED 2026-05-21 — Phase 68, commit <sha> —
  <one-line fix summary>.` web HI-02 notes Better Auth 1.6.9 has no
  id-based revocation (doc-route resolution). HIGH-EMAIL-01 notes the
  doc-only resolution + the caller-grep evidence. byok HI-04 notes the
  enumeration drift guard was already present.
- `.planning/review/REVIEW-INDEX.md` — update the per-package roll-up rows:
  `apps/web` HIGH `6 → 0`, `wire-schemas` HIGH `1 → 0`, `litellm-client`
  HIGH `3 → 0`, `byok-guard + contract-tests` HIGH `5 → 0`, `small-pkgs`
  HIGH `1 → 0` (all `✅ Phase 68`); update the top-level HIGH aggregate
  row (`~38 → 0` — all HIGH closed across Phases 62–68); mirror how Phase
  62–67 closures are marked.
- Commit: `docs(68-01): annotate web+pkgs review with 16 HIGH closures`.

### Done
All 5 review files + `REVIEW-INDEX.md` carry per-finding closure markers;
the `REVIEW-INDEX.md` HIGH aggregate reads 0; `git log` shows the
annotation commit.

---

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| signed-out deep link → post-sign-in redirect | A `?from=` value crosses from the URL into a `router.push` destination — an open-redirect surface if unvalidated (web HI-01). |
| Better Auth session bearer → browser JS heap | Every session's bearer crosses into the React/TanStack-Query heap where an XSS or compromised dependency could read it (web HI-02). |
| operator config → LiteLLM upstream Authorization header | A misconfigured `LITELLM_BASE_URL` crosses the credential over plaintext HTTP on a routable hop (litellm HI-3). |
| LiteLLM upstream response body → structured log shipping | An untruncated `message` override crosses an upstream payload into Loki (litellm HI-1). |
| published npm tarball → external consumer | Test fixtures, a hardcoded password, and a privileged `email_verified` DB-flip path cross into the published artifact where a misconfigured consumer could trigger them (byok HI-01/02/05). |
| route response shape → contract-test matcher | A permissive `TolerantEnvelope` lets a route emitting the wrong envelope cross undetected (byok HI-04). |
| caller-interpolated value → email HTML body | An unescaped interpolated value could cross into a delivered email as stored-HTML injection if a future caller drifts (HIGH-EMAIL-01). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-68-01 | Spoofing (open redirect) | SignInForm `?from=` consumption | mitigate | Task 1 HI-01 — `?from=` is consumed through a strict same-origin path allowlist (`/app/` prefix, no `://`, no `//`, no `\`); any failing value falls back to `/app`. |
| T-68-02 | Information disclosure | session bearer in JS heap | mitigate | Task 1 HI-02 — the bearer is kept off every render path (DOM attr / `data-*` / React key), the exposure + CSP `connect-src` containment is documented, and the durable fix (Better Auth upgrade) is logged as a v2 deferred item. Accepted residual: the bearer is in heap because Better Auth 1.6.9 `revokeSession` is token-only — no id-based revocation exists. |
| T-68-03 | Information disclosure | `LitellmUpstreamError.message` override | mitigate | Task 2 HI-1 — the `message` constructor argument is truncated at construction (200 chars), closing the LOCKER-05 bypass. |
| T-68-04 | Information disclosure / Tampering | plaintext LiteLLM Authorization header | mitigate | Task 2 HI-3 — a non-https `LITELLM_BASE_URL` override is refused in production unless an explicit `LITELLM_ALLOW_PLAINTEXT=1` opt-out is set. |
| T-68-05 | Elevation of privilege | `signInFixture` `email_verified` flip in the published tarball | mitigate | Task 3 HI-01 — the privileged helper + `FIXTURE_PASSWORD` are excluded from the tarball via a `files:` allowlist, verified by `npm pack --dry-run`. |
| T-68-06 | Tampering (contract evasion) | permissive `TolerantEnvelope` | mitigate | Task 3 HI-04 — the negative-matrix envelope matcher is tightened to the string form so a route emitting the wrong shape is caught. |
| T-68-07 | Tampering (stored-HTML injection) | `EmailSender.html` boundary | accept | Task 4 HIGH-EMAIL-01 — no current caller interpolates user-controlled data (worker escapes with `htmlEscape:true`; auth.ts uses server-generated URLs only). The caller-owns-escaping contract is documented; a real boundary escape is rejected because it would double-escape the worker's HTML. Residual risk is caller-side drift, mitigated by the explicit documented contract. |
</threat_model>

<verification>
Phase-level gate (run after all tasks):

```
pnpm --filter @openwhispr/web test
pnpm --filter @openwhispr/litellm-client test
pnpm --filter @openwhispr/byok-guard test
pnpm --filter @openwhispr/contract-tests test
pnpm --filter @openwhispr/wire-schemas test
pnpm --filter @openwhispr/email test
pnpm lint:lockers          # 8 lockers green (LOCKER-03 — web HI-06; LOCKER-05 — litellm HI-1)
pnpm typecheck             # no NEW errors vs the documented 5-error baseline
git log --oneline -30      # verify-first log + per-finding RED/GREEN pairs + doc commits + annotation commit
```

Spot-check (CLAUDE.md hard rule 3 — verify, do not relay):
- `grep -rn 'HI-01\|HI-02\|HI-03\|HI-04\|HI-06' apps/web/tests` — each web
  code finding has a test referencing its ID.
- `grep -rn 'HI-1\|HI-2\|HI-3' packages/litellm-client/tests` — each litellm
  finding referenced.
- `grep -rn 'HI-03\|HI-04' packages/contract-tests/tests` — referenced.
- `grep -rn 'H-1' packages/wire-schemas/tests` — referenced.
- `cd packages/contract-tests && npm pack --dry-run` — output contains NO
  `*.test.ts`, NO `helpers/sign-in-fixture.ts`, NO `FIXTURE_PASSWORD`.
- `grep -c ':3000' apps/web/src/lib/internal-api.ts` — `0`.
- `grep -rn 'D-ADMIN-1\|Traefik basic-auth' apps/web/src --include='*.ts' --include='*.tsx' | grep -v test`
  — only accurate historical references in `admin-guard.ts` (if any) remain.
- `grep -c 'metadata too large' packages/wire-schemas/src/conversations.ts` — `0`.
- `grep -n 'LITELLM_VIRTUAL_KEY' packages/litellm-client/src/config.ts` — present.
- `grep -n 'slice(0, 200)' packages/litellm-client/src/errors.ts` — applied to the message path.
- Each cited commit SHA is on HEAD; `git status --short` clean.
- `verify-first.log` exists, committed, records a disposition for all 16
  findings + the HI-02 Better-Auth-version finding + the HIGH-EMAIL-01
  caller grep.
- The 5 review files + `REVIEW-INDEX.md` carry the closure markers; the
  `REVIEW-INDEX.md` HIGH aggregate reads 0.
</verification>

<success_criteria>
- web HI-01..HI-06: five RED+GREEN pairs + one doc commit (HI-05) on `main`;
  `?from=` allowlist-consumed; session bearer documented + off the DOM;
  notes-list queryKey aligned; AdminShell sign-out control; stale comments
  purged; `:3000` removed and LOCKER-03 green.
- litellm HI-1..HI-3: three RED+GREEN pairs — `message` truncation;
  `LITELLM_VIRTUAL_KEY` precedence; https assertion on prod overrides.
- byok HI-01..HI-05: a tarball-hygiene fix verified by `npm pack --dry-run`
  + two RED+GREEN pairs (HI-03 schema imports, HI-04 envelope tightening);
  no gitleaks bypass.
- wire H-1: a RED+GREEN pair — `metadata.too_large` machine key, no inline
  English.
- HIGH-EMAIL-01: a doc commit — caller-owns-escaping contract explicit in
  JSDoc + README; doc-only resolution justified by the verify-first caller
  grep.
- `pnpm test` green for web, litellm-client, byok-guard, contract-tests,
  wire-schemas, email; `pnpm lint:lockers` green (8); `pnpm typecheck` no
  new errors vs the 5-error baseline.
- The 5 review files + `REVIEW-INDEX.md` annotated; HIGH aggregate → 0.
- No skipped tests, no `.only`, no `@ts-expect-error` without `issue-NNNN:`.
- No `as any` / `as unknown as` / `@ts-ignore` introduced; no production
  code edited solely to make a test pass (CLAUDE.md hard rule 1).
- No gitleaks hook bypass (CLAUDE.md hard rule 4).
- All MEDIUM/LOW findings untouched (out of scope).
</success_criteria>

<risk_register>
| Risk | Task | Mitigation |
|------|------|------------|
| web HI-01: allowlist too loose → open redirect survives. | 1 | The RED test enumerates the attack vectors (`https://`, `//`, no-`/app/`-prefix); the allowlist is a closed conjunction of checks, not a denylist. |
| web HI-02: an executor "fixes" by switching to id-based revocation that does not exist in Better Auth 1.6.9 → build break. | 1 | The verify-first BETTER-AUTH-VERSION CHECK confirms `revokeSession` is token-only; the resolution is documentation, recorded in the log. |
| web HI-06: fail-closed default breaks a deploy path that does not set `INTERNAL_API_URL`. | 1 | The file header states docker-compose + Helm both set it; the executor records the chosen option (fail-closed vs host/port env) in the log; the RED test covers the unset behaviour. |
| litellm HI-3: the https assertion fires on the bundled `http://litellm:4000` default and breaks the slim/dev stack. | 2 | The assertion fires ONLY when `LITELLM_BASE_URL` is an explicit override AND `NODE_ENV=production`; the bundled default is not an override; the RED test pins case (d) — bundled default does not throw. |
| byok HI-01: relocating `FIXTURE_PASSWORD` trips gitleaks → tempt a `--no-verify`. | 3 | CLAUDE.md hard rule 4: the fix is `.gitleaks.toml` allowlist + `tools/lint-gitleaks-config.test.ts` regression in the SAME commit. Never bypass. |
| byok HI-03/05: a `files:` allowlist too narrow drops a schema an external consumer needs. | 3 | The allowlist ships the `index.ts` + `schemas.ts` re-export surface + bundled `fixtures/`; `npm pack --dry-run` output is captured into `verify-first.log` and reviewed. |
| byok HI-04: tightening `TolerantEnvelope` breaks the one route that legitimately emits the structured envelope. | 3 | The GREEN step gates the structured form to that single documented site rather than removing it globally. |
| HIGH-EMAIL-01: a real boundary escape is added → double-escapes the worker's already-escaped HTML. | 4 | The verify-first caller grep proves no caller needs it; the resolution is doc-only; a boundary escape is explicitly rejected. |
| typecheck regression from new test files / new env reads. | all | New tests + the config env reads are ordinary typed surfaces; run `pnpm typecheck` after each code task — must stay at the 5-error baseline. |
| A failing test tempts a production hack. | all | CLAUDE.md hard rule 1: the production change here IS the genuine fix. If a HALT arises, log in `.planning/deferred-items.md` with WHY evidence and report in the SUMMARY. |
</risk_register>

<output>
After completion, create
`.planning/phases/68-high-findings-web-and-pkgs/68-01-SUMMARY.md`.

In the SUMMARY, explicitly record per finding (all 16):
- web HI-01..HI-06: the verify-first determination; the allowlist rule
  (HI-01); the Better-Auth-version finding + doc resolution (HI-02); the
  internal-api approach chosen (HI-06); the RED/GREEN SHAs (or doc SHA for
  HI-05).
- litellm HI-1..HI-3: the verify-first determination; the `LITELLM_VIRTUAL_KEY`
  precedence rule (HI-2); the https-assertion opt-out env (HI-3); the
  RED/GREEN SHAs.
- byok HI-01..HI-05: the verify-first determination; the `npm pack --dry-run`
  output proving the test artifacts are gone; whether `.gitleaks.toml` was
  touched (and the regression assertion if so); the schema-import vs
  documented-exception split (HI-03); whether the enumeration drift guard
  was already live (HI-04); the commit SHAs.
- wire H-1: the verify-first determination; the machine key used; RED/GREEN SHAs.
- HIGH-EMAIL-01: the verify-first determination + the 3-caller grep result;
  confirmation it is doc-only; the doc commit SHA.
- LOCKER outcome — all 8 lockers green; LOCKER-03 (web HI-06) + LOCKER-05
  (litellm HI-1) specifically confirmed.
- `pnpm typecheck` result vs the 5-error baseline.
- The per-finding closure markers written to the 5 review files +
  `REVIEW-INDEX.md`, and confirmation the HIGH aggregate reads 0.
- Any divergence from the planner's pre-determination.
</output>
