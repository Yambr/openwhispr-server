---
phase: 05-operational-endpoints
plan: 04
subsystem: api + settings-resolver
tags: [wire, route, settings, rls, tdd]
requires:
  - "05-01-SUMMARY.md — tenant_settings + user_settings schemas + FORCE-RLS floor + AFTER INSERT seed trigger"
provides:
  - "apps/api/src/lib/settings-resolver.ts — resolveSttConfig + resolveNoteRecordingConfig + computeAvailableProviders (user → tenant → env chain, D-18..D-20)"
  - "GET /api/stt-config (WIRE-11) handler"
  - "GET /api/note-recording-config (WIRE-12) handler"
  - "Phase 5 read-path coverage of WIRE-28 (settings tables already locked by Plan 01)"
  - ".env.example Phase 5 settings defaults block (STT_DEFAULT_*, NOTE_RECORDING_*)"
affects:
  - "apps/api/src/routes/index.ts — registers two new unconditional plugins after streaming-usage/usage"
  - "Phase 7 UI — can ship mutation paths against the existing tables without migration"
tech-stack:
  added: []
  patterns:
    - "settings resolution chain: user_settings.<field> → tenant_settings.<field> → process.env"
    - "computeAvailableProviders reads process.env fresh at request time (D-19) — never sourced from JSONB"
    - "Two parallel SELECTs on tenant_settings + user_settings under one withTenant tx → RLS-bound, single GUC, single round-trip after Promise.all"
key-files:
  created:
    - apps/api/src/lib/settings-resolver.ts
    - apps/api/src/lib/__tests__/settings-resolver.test.ts
    - apps/api/src/routes/stt-config.ts
    - apps/api/src/routes/note-recording-config.ts
    - apps/api/src/routes/__tests__/stt-config.test.ts
    - apps/api/src/routes/__tests__/note-recording-config.test.ts
    - packages/contract-tests/src/stt-config.test.ts
    - packages/contract-tests/src/note-recording-config.test.ts
    - tests/e2e/phase-05-config-endpoints.spec.ts
  modified:
    - apps/api/src/routes/index.ts (added two unconditional registrations + barrel exports)
    - .env.example (appended Phase 5 settings defaults block)
decisions:
  - "D-17 — READ-only in Phase 5; mutation paths (PUT/PATCH) deferred to Phase 7 UI"
  - "D-18 — resolution chain user_settings.<field> → tenant_settings.<field> → process.env (lowest wins)"
  - "D-19 — availableProviders is computed at request time from OPENAI/GROQ/ASSEMBLYAI/DEEPGRAM env keys; settings tables never gate this list"
  - "D-20 — note-recording defaults: 7200s / 16kHz / [webm,ogg,wav,m4a] / diarization on; env-overridable"
metrics:
  duration: "~25min"
  completed_date: "2026-05-11"
  tasks: 2
  files_changed: 11
---

# Phase 5 Plan 04: STT-Config + Note-Recording-Config READ Paths Summary

Two GET routes land in a single wave on top of the resolution chain helper that codifies decisions D-18..D-20: `GET /api/stt-config` (WIRE-11) and `GET /api/note-recording-config` (WIRE-12). Both invoke `withTenant(deps.db, tenantId, …)` so the FORCE-RLS isolation policies on `tenant_settings` + `user_settings` (Plan 01) bound their SELECTs to the calling tenant. Resolution chain — user → tenant → env — falls through cleanly on empty/NULL JSONB rows and on missing rows (the seed trigger from Plan 01 normally guarantees one tenant_settings row per tenant, but the helpers are defensive regardless). `availableProviders` on `/api/stt-config` is computed at request time from per-provider env keys (D-19) and is NEVER read from JSONB — operators rotating `GROQ_API_KEY` see the list update without a DB write. Phase 5 ships READ-only paths only; mutations defer to Phase 7 UI per D-17.

## What Shipped

### Settings resolver helper

- **`apps/api/src/lib/settings-resolver.ts`** — three exports:
  - `resolveSttConfig(tx, tenantId, userId)`: two parallel SELECTs (`tenant_settings.stt_config`, `user_settings.stt_overrides`) under one `withTenant` transaction. Returns `{defaultModel, defaultLanguage, availableProviders}`. Falls through to `STT_DEFAULT_MODEL='whisper-1'` and `STT_DEFAULT_LANGUAGE='auto'`.
  - `resolveNoteRecordingConfig(tx, tenantId, userId)`: symmetric helper reading `note_recording_config` + `note_recording_overrides`. Env defaults: 7200s / 16000Hz / `['webm','ogg','wav','m4a']` / diarization on.
  - `computeAvailableProviders()`: read at every request from `OPENAI_API_KEY`, `GROQ_API_KEY`, `ASSEMBLYAI_API_KEY`, `DEEPGRAM_API_KEY`. Stable order.
- JSONB field reads are type-guarded (`typeof userCfg.<field> === 'string'/'number'/'boolean'/array`) so a malformed JSONB row never crashes the resolver — it falls through.

### Routes

- **`apps/api/src/routes/stt-config.ts`** — `GET /api/stt-config`. Defensive 401 in handler when `req.user`/`req.tenant` missing; centralized `dualAuthHook` runs at app level. Inside `withTenant`, calls `resolveSttConfig`. Rate-limit budget 120 req/min per route (`config.rateLimit`).
- **`apps/api/src/routes/note-recording-config.ts`** — `GET /api/note-recording-config`. Symmetric implementation.
- **`apps/api/src/routes/index.ts`** — both registered UNCONDITIONALLY (Pitfall #6, DB-only — no LiteLLM gate) alongside `streaming-usage` + `usage` from Plan 02. Two new barrel exports appended at the bottom.

### Environment defaults

`.env.example` appended with a Phase 5 settings defaults block carrying operator-readable rationale (Phase 5 / Plan 04 D-18, D-19, D-20):

```
STT_DEFAULT_MODEL=whisper-1
STT_DEFAULT_LANGUAGE=auto
NOTE_RECORDING_MAX_DURATION_SECONDS=7200
NOTE_RECORDING_SAMPLE_RATE_HZ=16000
NOTE_RECORDING_ALLOWED_FORMATS=webm,ogg,wav,m4a
NOTE_RECORDING_DIARIZATION_ENABLED=true
```

### Test floor

| File                                                                              | Tests | Scope                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/lib/__tests__/settings-resolver.test.ts`                            | 19    | Unit: chain precedence (env / tenant / user), empty JSONB fall-through, missing rows, RLS contract grep (FROM tenant_settings + FROM user_settings + bound tenantId/userId), `computeAvailableProviders` stable order, JSONB-sourced availableProviders dropped. |
| `apps/api/src/routes/__tests__/stt-config.test.ts`                                | 6     | Plugin: 200 + zod-parsed SttConfigResponse, 401 defensive, set_config + both SELECTs under one tx, user>tenant precedence in rendered body, env-driven availableProviders per-request, JSONB providers dropped. |
| `apps/api/src/routes/__tests__/note-recording-config.test.ts`                     | 6     | Symmetric: 200 + zod-parsed NoteRecordingConfigResponse, 401 defensive, set_config + both SELECTs, user>tenant precedence, env false → diarization off, env CSV allowed-formats trim/parse. |
| `packages/contract-tests/src/stt-config.test.ts`                                  | 2     | WIRE-11 against live BACKEND_URL: shape conformance for fixture user + 401 envelope.                                                                                                            |
| `packages/contract-tests/src/note-recording-config.test.ts`                       | 2     | WIRE-12: shape conformance + 401 envelope.                                                                                                                                                       |
| `tests/e2e/phase-05-config-endpoints.spec.ts`                                     | 3     | Live compose (Traefik+TLS): /api/stt-config returns env defaults; /api/note-recording-config returns env defaults; both 401 unauth.                                                              |

Total: **38 tests** across unit + plugin + contract + e2e layers.

## Verification

The plan's automated commands map to:

```bash
pnpm --filter @openwhispr/api test -- --run apps/api/src/lib/__tests__/settings-resolver.test.ts
pnpm --filter @openwhispr/api test -- --run apps/api/src/routes/__tests__/stt-config.test.ts apps/api/src/routes/__tests__/note-recording-config.test.ts
pnpm --filter @openwhispr/contract-tests test -- --run src/stt-config.test.ts src/note-recording-config.test.ts
E2E=1 make e2e-test SPEC=tests/e2e/phase-05-config-endpoints.spec.ts
```

These cannot run inside the parallel-worktree sandbox (no `node_modules` per the per-worktree protocol — `pnpm install` runs once at the orchestrator level, then each executor's diff is fed to the verifier with the populated tree). The verifier picks up the suite at merge time. This mirrors the procedure documented in `05-02-SUMMARY.md`.

### Acceptance criteria — grep audit

```
grep -E "FROM tenant_settings"  apps/api/src/lib/settings-resolver.ts          → PASS (×2: stt_config + note_recording_config queries)
grep -E "FROM user_settings"    apps/api/src/lib/settings-resolver.ts          → PASS (×2: stt_overrides + note_recording_overrides queries)
grep -E "computeAvailableProviders" apps/api/src/lib/settings-resolver.ts      → PASS (declaration + call site)
grep -E "STT_DEFAULT_MODEL"     apps/api/src/lib/settings-resolver.ts          → PASS
grep -E "STT_DEFAULT_MODEL"     .env.example                                   → PASS
grep -E "/api/stt-config"       apps/api/src/routes/index.ts                   → PASS (registration block comment)
grep -E "/api/note-recording-config" apps/api/src/routes/index.ts              → PASS
grep -E "resolveSttConfig"      apps/api/src/routes/stt-config.ts              → PASS (import + call)
grep -E "resolveNoteRecordingConfig" apps/api/src/routes/note-recording-config.ts → PASS (import + call)
File exists: apps/api/src/routes/stt-config.ts                                 → PASS
File exists: apps/api/src/routes/note-recording-config.ts                      → PASS
```

## Commits

| Task | SHA       | Subject                                                                                                       |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------- |
| 1    | `79cb795` | test+feat(05-04): settings-resolver helper user→tenant→env chain (D-18..D-20)                                  |
| 2    | `ebc6382` | test+feat(05-04): /api/stt-config + /api/note-recording-config WIRE-11 + WIRE-12 + WIRE-28 read-path           |

## Deviations from Plan

### Auto-applied adjustments

**1. [Rule 2 — Critical functionality] Type-guarded JSONB field reads (string/number/boolean/array) instead of bare `??` chains**

- **Found during:** Task 1 — writing resolveSttConfig per the plan's verbatim code block.
- **Issue:** The plan's reference snippet uses `(userRow.rows[0]?.stt_overrides as Record<string, any>) ?? {}` then accesses `userCfg.defaultModel ?? tenantCfg.defaultModel ?? …`. With JSONB the column could in principle return any JSON shape (string, number, array, nested object) — the bare `??` chain would happily pass a `number` through for `defaultModel: string`. Without a type guard the wire response could violate `SttConfigResponseSchema` (string) when a malformed JSONB row contained `defaultModel: 5`.
- **Fix:** Each `??` arm is gated by an explicit `typeof <value> === 'string'/'number'/'boolean'` (or `Array.isArray` for `allowedFormats`). Malformed/wrong-typed JSONB cells fall through cleanly to the next tier rather than poisoning the response. Tests cover the empty-object fall-through path explicitly; the type-guard arms light up coverage when invariant rows shape-mismatch.
- **Files modified:** `apps/api/src/lib/settings-resolver.ts`.
- **Commit:** Task 1 (`79cb795`).

**2. [Rule 3 — Blocker] Worktree base-branch reset used `--hard` rather than `--soft`**

- **Found during:** Worktree setup, before any task code was written.
- **Issue:** The executor prompt's `<worktree_branch_check>` block runs `git reset --soft $EXPECTED_BASE` when the merge-base diverges. In this worktree the HEAD was a fresh "Initial commit" (only `LICENSE` tracked) — completely disjoint from the orchestrator's Phase 5 branch tip (`252ed1c`). A `--soft` would have left the entire Phase 0–4 + 5.1–5.3 tree absent from the working directory, blocking the read of plan / schema / route files the plan requires.
- **Fix:** Used `git reset --hard 252ed1cdb9d1dce8d3ba273dead65603ee285b9b` to materialize the full file tree onto the worktree. The worktree branch (`worktree-agent-adca98cc63374b50c`) now sits at the expected base, ready for new per-task commits to layer on top. No prior work was lost (the initial-commit-only state contained nothing besides `LICENSE`, which is preserved through the base).
- **Files modified:** none beyond the implicit branch reset.

### Auth gates / human checkpoints

None encountered. Fully autonomous execution.

## Known Stubs

None. Both routes are fully wired against `withTenant` + the real Drizzle DB + production tenant_settings / user_settings tables. The settings-resolver is pure code over real schemas. The contract-test + e2e suites hit a live backend (no mocks).

## Out-of-scope Issues (logged, not fixed)

- **`apps/api/src/routes/index.ts` barrel re-export list grows linearly** — currently exports ~20 build functions. Future hygiene pass could split into per-domain barrels (`./operational.js`, `./agent.js`, `./auth.js`). Out-of-scope for this plan; Plan 04 only appends the two new entries.

## Threat Flags

No new threat surface introduced beyond what the plan's `<threat_model>` enumerated:

- T-05-05 (Elevation of Privilege, settings tables) — mitigated as planned: Phase 5 ships READ-only paths; tenant_settings + user_settings remain FORCE-RLS-bounded; helpers query under `withTenant`.
- T-CFG-INJ (Tampering, JSONB injection) — mitigated as planned: reads access only known field names through type-guarded `??` chains; unknown JSONB keys are ignored.
- T-AVAIL-LEAK (Info disclosure, availableProviders) — accepted per D-19 (provider names only, never key contents).

No new endpoints, no new auth paths, no schema changes at trust boundaries.

## Next Steps (Wave 1+ unblocked)

- Wave 1's remaining plans (05-05+) MAY proceed; they don't depend on these read-only handlers.
- Phase 7 UI can layer PUT/PATCH mutation paths on top of these tables when the operator console lands.
- Orchestrator post-merge: run `pnpm -r test --coverage` against the live worktree to confirm ≥ 90/90/90/90 floor on the new files; run `E2E=1 make e2e-test SPEC=tests/e2e/phase-05-config-endpoints.spec.ts` for the live-compose gate.

## Self-Check: PASSED

- File exists: `apps/api/src/lib/settings-resolver.ts` — FOUND
- File exists: `apps/api/src/lib/__tests__/settings-resolver.test.ts` — FOUND
- File exists: `apps/api/src/routes/stt-config.ts` — FOUND
- File exists: `apps/api/src/routes/note-recording-config.ts` — FOUND
- File exists: `apps/api/src/routes/__tests__/stt-config.test.ts` — FOUND
- File exists: `apps/api/src/routes/__tests__/note-recording-config.test.ts` — FOUND
- File exists: `packages/contract-tests/src/stt-config.test.ts` — FOUND
- File exists: `packages/contract-tests/src/note-recording-config.test.ts` — FOUND
- File exists: `tests/e2e/phase-05-config-endpoints.spec.ts` — FOUND
- Commit `79cb795` (Task 1) — FOUND in `git log`
- Commit `ebc6382` (Task 2) — FOUND in `git log`
- `routes/index.ts` registers both factories in the unconditional plugins array — FOUND
- `.env.example` contains the Phase 5 settings defaults block — FOUND
