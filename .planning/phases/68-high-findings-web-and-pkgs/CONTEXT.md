# Phase 68 — HIGH findings: web + litellm-client + byok-guard + wire-schemas + small-pkgs (16)

## Background

Pre-publication HIGH-backlog clearance, phase-by-phase by package
(user decision 2026-05-20). Phases 62–67 cleared api-core (5),
api-routes-rest (3), api-routes-conversations (4),
api-routes-transcriptions (11), worker (7), data (6) — 36 HIGH closed.
This is the **final HIGH phase** — the remaining 16 across 5 smaller
packages, batched into one phase:

- `apps/web` — 6 (HI-01..06)
- `packages/litellm-client` — 3 (HI-1..3)
- `packages/byok-guard` + `packages/contract-tests` — 5 (HI-01..05)
- `packages/wire-schemas` — 1
- `packages/{auth,email,i18n,observability}` — 1 (HIGH-EMAIL-01)

After this phase ALL HIGH findings from `REVIEW-INDEX.md` are closed.

## The 16 findings

**Re-verify each against current code before fixing** (CLAUDE.md hard
rule 3) — Phases 59–67 touched overlapping code (e.g. byok CR-01/02
near these HI-NN; litellm-client HI-1 near the LOCKER-05 truncation
work).

### apps/web (`.planning/review/web.md`, HI-01..06)
- **HI-01** — `SignInForm` discards middleware's `?from=` deep-link
  param (`SignInForm.tsx`) — hardcodes `callbackURL:"/app"`; a
  signed-out deep link is lost after sign-in. Fix: consume `?from=`
  with an allowlist (must start with `/app/`, no `://`), OR drop the
  `from=` query in middleware so the design is consistent. Decide.
- **HI-02** — `SessionsTable` ships Better Auth bearer tokens into the
  JS heap (`SessionsTable.tsx`) — `SessionRow.token` rendered into the
  React tree; an XSS/compromised-dep can exfiltrate every session
  bearer. Fix: switch to id-based revocation if Better Auth's
  `revokeSession` accepts `id` (verify the installed version), else
  document the unavoidable exposure + add a CSP `connect-src` note.
- **HI-03** — `NotesListClient` query key never matches the RSC
  dehydrated key → prefetch wasted. Fix: align the queryKey.
- **HI-04** — `AdminShell` has no sign-out button (UX dead end —
  stale basic-auth assumption). Fix: add a sign-out control.
- **HI-05** — stale security comments contradicting the current admin
  model (`D-ADMIN-1`/Traefik basic-auth references across ~8 files).
  Fix: purge the stale comments. (Memory: admin = `users.role='admin'`,
  no Traefik basic-auth — the comments are wrong, delete them.)
- **HI-06** — hardcoded `:3000` port in production source
  (`internal-api.ts` or similar) — LOCKER-03. Fix: env-driven.

### packages/litellm-client (`.planning/review/litellm-client.md`, HI-1..3)
- **HI-1** — `LitellmUpstreamError` allows an untruncated `message` via
  a constructor override (LOCKER-05 covers `bodyText|...` but the
  `message` override path bypasses truncation). Fix: truncate the
  `message` at construction too.
- **HI-2** — `LITELLM_VIRTUAL_KEY` env binding is silently absent —
  the loader never reads it. Fix: wire it (CLAUDE.md describes
  corporate operators overriding `LITELLM_VIRTUAL_KEY`).
- **HI-3** — plain-HTTP default for `DEFAULT_LITELLM_BASE_URL`, no
  `https://` assertion on operator overrides. Fix: assert `https://`
  in production (mirror the Phase 57 `validateIngressBoot` pattern —
  non-production may keep http for the slim/dev stack).

### packages/byok-guard + contract-tests (`.planning/review/byok-guard-contract-tests.md`, HI-01..05)
- **HI-01** — `FIXTURE_PASSWORD = "test-PW-12345!"` exported from
  `src/` of the PUBLISHED package. Fix: move the fixture out of the
  published surface (into a test-only path / `tests/`), or stop
  exporting it.
- **HI-02** — `.test.ts` files live inside `src/` and ship in the
  published tarball. Fix: move them to `tests/` or add a `files:`
  allowlist to `package.json` excluding test files from the tarball.
- **HI-03** — `contract-tests/src/schemas.ts` defines wire schemas NOT
  in `@openwhispr/wire-schemas` — silent drift surface. Fix: import
  from the canonical package, or document why a divergent copy exists.
- **HI-04** — `negative-matrix.ts` route inventory is a static literal
  → stale entries silently pass; `TolerantEnvelope` weakens the
  contract. Fix: derive the inventory or add a drift guard; tighten
  `TolerantEnvelope`.
- **HI-05** — `audioMultipartBody` reads a repo-root `tests/fixtures/audio/`
  path absent from the published tarball. Fix: bundle the fixture or
  make the helper test-only.

### packages/wire-schemas (`.planning/review/wire-schemas.md`, 1 HIGH)
- Hardcoded EN error message `"metadata too large"` in
  `ConversationInputSchema.MetadataSchema` refinement — violates the
  i18n-locale-keyed-or-empty rule for end-user error messages. Fix:
  empty message (route localizes) or a stable machine key
  (`metadata.too_large`), never inline English.

### packages/small-pkgs (`.planning/review/small-pkgs.md`, HIGH-EMAIL-01)
- `EmailSender` forwards an unescaped `html` body to nodemailer with no
  escape of interpolated values at the package boundary. No live
  exploit today (callers pass trusted templates). Fix: the review's
  own recommendation is to make the HTML-escape contract EXPLICIT in
  the `SendArgs.html` JSDoc + README — i.e. document that the caller
  owns escaping. Decide: doc-only (make the contract explicit) vs an
  actual escape at the boundary. Lean doc-only IF every caller is a
  trusted template renderer (verify) — but if any caller interpolates
  user data into `html`, that is a real fix. Determine during planning.

## Goal

After this phase:
1. All 16 findings resolved — code fix or (where the finding's own
   remediation is documentation) an accurate doc/comment — and
   verified. ALL HIGH findings in `REVIEW-INDEX.md` are then closed.
2. Code fixes land via strict TDD (RED→GREEN→REFACTOR), atomic commits.
3. `pnpm test` green for every touched package (`web`, `litellm-client`,
   `byok-guard`, `contract-tests`, `wire-schemas`, the small pkgs);
   `pnpm lint:lockers` green (8 lockers); `pnpm typecheck` no new
   errors vs the 5-error baseline.
4. `.planning/review/*.md` (the 5 files) + `REVIEW-INDEX.md` annotated
   with per-finding closure markers; `REVIEW-INDEX.md` HIGH count → 0.

## Constraints

- **Strict TDD for code fixes** — RED→GREEN→REFACTOR; test + production
  code atomic. Doc-only items are doc commits, verified accurate.
- **Verify-first** — every finding re-confirmed against current code.
- **HI-01 (web) and HIGH-EMAIL-01 need a judgment call** — the planner
  resolves the open choice with rationale.
- **HI-06 (web) is LOCKER-03** — the fix removes a hardcode-allowlist
  entry; verify `pnpm lint:lockers` passes with it gone (or that the
  literal is genuinely env-driven now).
- **Published-package hygiene (byok HI-01/02/05)** — these affect what
  ships in the npm tarball; verify with `npm pack --dry-run` or the
  `files:` field that the fix actually removes the artifact from the
  published surface.
- **No mocks of internal logic** — package tests are mostly pure-unit;
  any DB-touching path uses real Postgres via testcontainers.
- **No bypassing gitleaks hooks** — CLAUDE.md hard rule 4. byok HI-01
  (`FIXTURE_PASSWORD`) — moving it must not trip gitleaks; if it does,
  the fix is the `.gitleaks.toml` allowlist + regression assertion per
  CLAUDE.md hard rule 4, never a bypass.
- **Constitutional lockers green** — `pnpm lint:lockers` (8). LOCKER-03
  (HI-06 web), LOCKER-05 (HI-1 litellm).
- **No production code edited "to make tests pass"** — CLAUDE.md hard
  rule 1. HALT + `.planning/deferred-items.md` if blocked.
- **Client repo READ-ONLY** — never edit `/Users/nick/openwhispr`.
- **commitlint** — conventional-commit, lowercase subject, ≤ ~72 chars.
- **Out of scope** — all MEDIUM/LOW. Do not scope-creep.
- **EN-only** source artifacts.

## Verification gate

Phase passes when:
1. All 16 findings resolved on main (code fix RED+GREEN, or accurate
   doc commit).
2. `pnpm test` green for `web`, `litellm-client`, `byok-guard`,
   `contract-tests`, `wire-schemas`, small pkgs.
3. `pnpm lint:lockers` green (8 lockers).
4. `pnpm typecheck` — no new errors vs the 5-error baseline.
5. byok HI-01/02/05: `npm pack --dry-run` (or the `files:` field)
   confirms the fixture/test artifacts are NOT in the tarball.
6. Spot-check: each fixed finding's regression test references its ID.
7. `git log --oneline` shows the expected commits.
8. The 5 `.planning/review/*.md` files + `REVIEW-INDEX.md` annotated;
   `REVIEW-INDEX.md` HIGH aggregate → 0.

## Reference

- `.planning/review/{web,litellm-client,byok-guard-contract-tests,wire-schemas,small-pkgs}.md`
- `.planning/review/REVIEW-INDEX.md`
- `apps/web/src/**` — the 6 web findings
- `packages/litellm-client/src/**` — HI-1..3
- `packages/byok-guard/src/**`, `packages/contract-tests/src/**` — HI-01..05
- `packages/wire-schemas/src/conversations.ts` — the metadata message
- `packages/email/src/EmailSender.ts` — HIGH-EMAIL-01
- Phase 57 (LOCKER-05 truncation, validateIngressBoot pattern): `.planning/phases/57-*`
- CLAUDE.md hard rules: 1, 3, 4; LOCKER-03, LOCKER-05
- Memory: admin = `users.role='admin'`, no Traefik basic-auth (HI-05 web)
