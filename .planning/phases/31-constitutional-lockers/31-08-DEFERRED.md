# Phase 31 / Plan 08 — Deferred Ledger

Carryover ledger for violations surfaced by the Phase 31 lockers that are
NOT closed inside 31-08. Each row is tagged with the owning future phase.

Decision rationale in [31-08-DECISIONS.md](./31-08-DECISIONS.md).

## Inventory (Task 0 triage results — 2026-05-16)

Live-tree run of each locker (without `--warn-only`):

| Locker | Mode | Findings | Disposition |
|---|---|---|---|
| LOCKER-01 (lint-no-env-branches) | BLOCKING | 0 | Clean. |
| LOCKER-02 (lint-no-suppressions) | BLOCKING | 0 NEW; 36 allowlisted | Allowlist holds Phase 32 + targeted-fix entries; ALL deferred (see §LOCKER-02 below). |
| LOCKER-03 (lint-no-hardcode) | BLOCKING | 0 NEW; 47 allowlisted | 5 entries re-tagged as PERMANENT docker-compose-internal-url (§D-2); rest deferred. |
| LOCKER-04 (lint-prod-readiness) | WARN-only (script wraps `--warn-only`) | 546 raw / 516 allowlisted | 47 routes → Phase 41; 469 dead-exports → Phase 38. ALL deferred. |
| LOCKER-05 (lint-secret-shape-in-error) | WARN-only | 3 allowlisted | Phase 37. |
| LOCKER-06 (lint-shell-credential-interpolation) | WARN-only | 3 allowlisted + 11 NEW in test files | Phase 36.a. |

## §LOCKER-04 — 47 routes → Phase 41

All 47 route entries currently tagged
`# issue-31-04-debt-LOCKER-04-route-bulkfix-31-08` in
`tools/lint-prod-readiness.allowlist.txt` are operationally Phase 41 territory
(see [DECISIONS §D-1](./31-08-DECISIONS.md#d-1-all-47-locker-04-route-entries-are-operationally-phase-41-territory)).

Phase 41 owns them via the residual-HIGH-sweep umbrella; each route needs
its own RED/GREEN/REFACTOR pair with a real zod schema, real rateLimit
config, and ≥ 90/90/90/90 coverage delta. Phase 41 will retag each entry
from `route-bulkfix-31-08` → `route-bulkfix-phase-41`.

| File | Line | Owning Phase |
|---|---|---|
| apps/api/src/routes/__test/fetch.ts | 65 | 41 |
| apps/api/src/routes/agent/stream.ts | 109 | 41.b (explicit ROADMAP:1226) |
| apps/api/src/routes/agent/web-search.ts | 74 | 41 |
| apps/api/src/routes/auth-callback.ts | 102 | 41 |
| apps/api/src/routes/auth-providers.ts | 73 | 41 |
| apps/api/src/routes/capabilities.ts | 148 | 41 |
| apps/api/src/routes/conversations/create.ts | 29 | 41 |
| apps/api/src/routes/conversations/delete.ts | 31 | 41 |
| apps/api/src/routes/conversations/list.ts | 52 | 41 |
| apps/api/src/routes/conversations/messages.ts | 72, 133 | 41 |
| apps/api/src/routes/conversations/search.ts | 42 | 41 |
| apps/api/src/routes/conversations/update.ts | 37 | 41 |
| apps/api/src/routes/desktop-signin.ts | 76 | 41 |
| apps/api/src/routes/diarization.ts | 139 | 41 |
| apps/api/src/routes/folders/batch-create.ts | 39 | 41 |
| apps/api/src/routes/folders/create.ts | 27 | 41 |
| apps/api/src/routes/folders/delete.ts | 29 | 41 |
| apps/api/src/routes/folders/list.ts | 39 | 41 |
| apps/api/src/routes/folders/update.ts | 48 | 41 |
| apps/api/src/routes/locale.ts | 69 | 41 |
| apps/api/src/routes/note-recording-config.ts | 30 | 41 |
| apps/api/src/routes/notes/batch-create.ts | 46 | 41 |
| apps/api/src/routes/notes/create.ts | 29 | 41 |
| apps/api/src/routes/notes/delete-all.ts | 33 | 41 |
| apps/api/src/routes/notes/delete.ts | 30 | 41 |
| apps/api/src/routes/notes/list.ts | 38 | 41 |
| apps/api/src/routes/notes/search.ts | 47 | 41 |
| apps/api/src/routes/notes/update.ts | 89 | 41 |
| apps/api/src/routes/reason.ts | 82 | 41 |
| apps/api/src/routes/setup-admin.ts | 146 | 41 |
| apps/api/src/routes/setup-state.ts | 62 | 41 |
| apps/api/src/routes/streaming-usage.ts | 54 | 41 |
| apps/api/src/routes/stt-config.ts | 41 | 41 |
| apps/api/src/routes/tokens/assemblyai.ts | 45 | 41 |
| apps/api/src/routes/tokens/deepgram.ts | 26 | 41 |
| apps/api/src/routes/tokens/openai-realtime.ts | 52 | 41 |
| apps/api/src/routes/transcribe.ts | 67 | 41 |
| apps/api/src/routes/transcriptions/batch-create.ts | 38 | 41 |
| apps/api/src/routes/transcriptions/batch-delete.ts | 35 | 41 |
| apps/api/src/routes/transcriptions/create.ts | 25 | 41 |
| apps/api/src/routes/transcriptions/delete.ts | 29 | 41 |
| apps/api/src/routes/transcriptions/list.ts | 35 | 41 |
| apps/api/src/routes/usage.ts | 36 | 41 |
| apps/api/src/routes/v1/keys/create.ts | 57 | 41 |
| apps/api/src/routes/v1/keys/list.ts | 76 | 41 |
| apps/api/src/routes/v1/keys/revoke.ts | 43 | 41 |

**Count:** 47 entries (one `conversations/messages.ts` row covers two distinct
line numbers — same file, two route handlers).

## §LOCKER-04 — 469 dead-exports → Phase 38

All 469 dead-export entries tagged
`# issue-31-04-debt-LOCKER-04-dead-export-phase-38` are routed to Phase 38
(`@openwhispr/auth` package retirement + dead-export sweep). Phase 38 either
removes the exports or wires them to live importers. Not enumerated here
individually — they live in `tools/lint-prod-readiness.allowlist.txt` lines
49+ and are dominated by:

- `@openwhispr/auth/**` (entire package — retirement target).
- `apps/api/src/auth.ts` re-export surface.
- `packages/wire-schemas/**` public surface (subset used by external packages).
- `packages/data/**` public surface (subset used by apps/api).
- `packages/litellm-client/**` public surface.
- `packages/observability/**` public surface.

Phase 38 may choose: (a) delete dead exports, (b) wire them to live importers,
(c) re-tag entries that are "intentional public API kept for external
consumers" with a `permanent-public-api` rationale.

## §LOCKER-02 — 36 type-suppression entries

All 36 entries in `tools/lint-no-suppressions.allowlist.txt` are deferred:

- **9 entries** in `apps/worker/src/db/app-pool.ts` (tagged
  `issue-31-debt-suppression-pg-typing`) → **Phase 32** (RLS work touches
  this file).
- **1 entry** in `apps/api/src/index.ts:288` (tagged
  `issue-31-debt-suppression-tx-bridge`) → **Phase 32** (RLS / tenant
  context bridge).
- **26 entries** (tagged `issue-31-debt-suppression`) distributed across
  `apps/api/*`, `apps/web/*`, `packages/data/*`, `apps/worker/src/jobs/*` →
  **targeted future phases** (no single-phase ownership; will be drained
  opportunistically as adjacent code is rewritten by Phases 32–41).

## §LOCKER-03 — 47 hardcode entries (post-rationale-fix)

After Task A retag (see DECISIONS §D-2), the 47 entries break down as:

- **8 entries** PERMANENT canonical-default-tenant.
- **5 entries** PERMANENT docker-compose-internal-url (re-tagged from
  migration-debt in Task A: `apps/web/src/lib/auth-actions.ts:22`,
  `apps/web/src/lib/auth-server.ts:47`, `packages/litellm-client/src/config.ts:29`,
  plus 2 implicit defaults — see Task A commit).
- **18 entries** comment-only narrative false positives (PERMANENT).
- **9 entries** PERMANENT canonical-fixture-infrastructure.
- **5 entries** `apps/web/src/app/(auth)/app/**/page.tsx` port literals →
  **Phase 41.c** (which already explicitly owns the same files for
  `PLAYWRIGHT_DISABLE_SSR_PREFETCH` removal per ROADMAP:1227 — natural
  co-location).
- **4 entries** apps/api migration-debt (`apps/api/src/auth.ts:237`,
  `apps/api/src/routes/test-only.ts:181`,
  `apps/api/src/routes/better-auth-handler.ts:49`,
  `apps/api/src/index.ts:656`) → **targeted future phase** (no current
  owner; surfaced as a deferred item).

## §LOCKER-05 — 3 secret-shape entries → Phase 37

Per 31-05-SUMMARY:

| File | Line | Field | Owning Phase |
|---|---|---|---|
| apps/api/src/lib/pyannote-client.ts | 68 | `PyannoteBadRequestError.bodyText` | 37 |
| apps/api/src/lib/pyannote-client.ts | 80 | `PyannoteUpstreamError.bodyText` | 37 |
| packages/litellm-client/src/errors.ts | 31 | `LitellmUpstreamError.bodyText` | 37 |

## §LOCKER-06 — 3 + 11 shell-credential entries → Phase 36.a

Per 31-06-SUMMARY + Task 0 triage:

**Already allowlisted (3 entries — Phase 36.a):**

| File | Line | Owning Phase |
|---|---|---|
| apps/worker/src/jobs/audit-archive.ts | 106, 115, 127 | 36.a |

**NEW findings surfaced by Task 0 triage in test/migration files (11 entries — Phase 36.a):**

| File | Line | Binding | Owning Phase |
|---|---|---|---|
| packages/data/migrations/__tests__/0017-setup-state.test.ts | 81 | ownerPassword | 36.a |
| packages/data/migrations/__tests__/0017-setup-state.test.ts | 84 | appPassword | 36.a |
| packages/data/migrations/__tests__/0017-setup-state.test.ts | 95 | ownerPassword | 36.a |
| tests/e2e/compose-helper.ts | 139 | BACKEND_URL | 36.a |
| tests/e2e/compose-helper.ts | 150 | BACKEND_URL | 36.a |
| tests/e2e/helpers/phase6-compose.ts | 316 | BACKEND_URL | 36.a |
| tests/e2e/helpers/phase6-compose.ts | 782 | BACKEND_URL | 36.a |
| tests/e2e/helpers/phase6-compose.ts | 801 | BACKEND_URL | 36.a |
| tests/self-tests/rls-introspection.test.ts | 40 | ownerPassword | 36.a |
| tests/self-tests/rls-introspection.test.ts | 58 | ownerPassword | 36.a |
| tools/lint-rls.test.ts | 67 | ownerPassword | 36.a |

These 11 are currently absorbed by `--warn-only`. Phase 36.a owns the
disposition (rewrite to argv-array form, allowlist as test-only, or
narrow the linter scope to exclude test/tools paths — see DECISIONS §D-4
for analysis).

## §LOCKER-04 BLOCKING flip — Phase 41 closure

The LOCKER-04 BLOCKING-flip operation (drop `--warn-only` from package.json
+ clear route-bulkfix entries from `tools/lint-prod-readiness.allowlist.txt`
+ retag remaining entries) moves from 31-08 (this plan) to **Phase 41
closure** because the 47 route entries are Phase 41's content per
DECISIONS §D-1. The dead-export entries remain in the allowlist after
the flip; their disposition is owned by Phase 38.

The flip will look exactly the same as the proof-of-mechanism demonstrated
in 31-04-SUMMARY:118-124 — a single-line `package.json` script edit plus
matching `lefthook.yml` / `ci.yml` / `nightly.yml` / `Makefile` edits in
ONE atomic commit, after Phase 41 has dropped the 47 route-bulkfix
allowlist entries.

`nightly.yml`'s existing `lockers-nightly` job already invokes the linter
WITHOUT `--warn-only` (per 31-07 wiring), so the in-scope inventory remains
visible daily until Phase 41 closes it.

## Cross-references

- DISCIPLINE Rule 14 prose (post-31-08) reflects the operational defer.
- CLAUDE.md mirror updated in the same 31-08 final commit per LOCKER-07
  atomicity.
- REQUIREMENTS.md LOCKER-04 row stays `Pending`/`WARN-only-pending-Phase-41`
  until Phase 41 closes it.
- 31-04-SUMMARY's flip-readiness proof remains the canonical demonstration
  that the BLOCKING flip is a single-flag change once the route inventory
  is drained.
