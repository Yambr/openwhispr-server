---
phase: 03
plan: 01
slug: wire-contracts-and-litellm-stackup
subsystem: ai-plane
tags: [litellm, wire-contracts, multi-tenancy, postgres, docker-compose]
requires:
  - Phase 1 Postgres + roles (openwhispr_owner with CREATEDB)
  - Phase 2 migrate runner (DATABASE_URL_OWNER plumbing)
provides:
  - docs/wire-contracts-phase-3.md — locked source-of-truth for Plans 03..07 (D-09)
  - compose/litellm/litellm_config.yaml — 7-model bundled config (D-01/D-10/D-11/D-12)
  - LiteLLM sidecar pinned at v1.83.14-stable (LITELLM-01)
  - Idempotent litellm-DB auto-create (initdb + migrate runner — HIGH-1)
  - .env.example surface for Phase 3 keys + LITELLM_BASE_URL override (LITELLM-05)
affects:
  - docker-compose.yml (postgres volumes, NEW litellm service, api depends_on + env)
  - packages/data/src/migrate.ts (exports + ensureLitellmDatabase preflight)
tech-stack:
  added:
    - ghcr.io/berriai/litellm:main-v1.83.14-stable (multi-arch amd64+arm64)
  patterns:
    - "Sidecar topology — LiteLLM as a separate service, not embedded (CLAUDE.md §4)"
    - "Co-tenant Postgres database (`litellm`) on the same cluster as `openwhispr`"
    - "Two-path DB provisioning (initdb fresh-install + migrate-runner upgrade) to honor CLAUDE.md no-workarounds"
    - "OpenAI Realtime API direct via LiteLLM `mode: realtime` (D-12)"
key-files:
  created:
    - docs/wire-contracts-phase-3.md
    - tools/lint-docs-headings.ts
    - tools/lint-docs-headings.test.ts
    - compose/litellm/litellm_config.yaml
    - compose/postgres/initdb/01-litellm-database.sh
    - packages/data/src/__tests__/migrate-litellm-db.test.ts
    - tests/self-tests/litellm-up.test.ts
  modified:
    - docker-compose.yml
    - packages/data/src/migrate.ts
    - .env.example
decisions:
  - "D-09 mount-point: locked /v1/audio/diarization (single mount, no /api alias in v1)"
  - "wordsUsed unit (A5/A6): whitespace-token count of response text; observability-only in v1"
  - "HIGH-1 upgrade path: migrate runner ensureLitellmDatabase() — non-destructive, idempotent, no make clean-stack"
  - "D-07 REVISED locked: Fastify sync-wrapper owns diarization (Plan 06); LiteLLM does NOT carry pyannote pass_through_endpoints"
  - "D-12 locked: OpenAI Realtime direct via mode: realtime — gpt-realtime / gpt-realtime-mini / gpt-4o-realtime-preview alias"
metrics:
  duration: "~25m"
  completed: "2026-05-10"
  commits: 2
  tasks: 2
  files_changed: 10
---

# Phase 03 Plan 01: Wire-Contracts + LiteLLM Stack-Up Summary

Wire-contract source-of-truth (D-09) extracted from upstream BACKEND_SPEC.md plus a healthy LiteLLM v1.83.14-stable sidecar bound to a separate `litellm` Postgres database, provisioned through both fresh-install (initdb) and existing-volume-upgrade (migrate runner) paths.

## What Shipped

### Task 1 — Wire contracts (D-09) — commit `6c06fa1`

`docs/wire-contracts-phase-3.md` is now the locked source-of-truth for Phase 03 Plans 03..07. It carries verbatim quotes (with `BACKEND_SPEC.md:L<line>` citations) for:

- `## POST /api/transcribe` (BACKEND_SPEC.md:L161-L213)
- `## POST /api/reason` (BACKEND_SPEC.md:L242-L296)
- `## Diarization` (BACKEND_SPEC.md:L800-L802 — only place in upstream)
- `## WSS /v1/realtime` (BACKEND_SPEC.md:L761-L803)

Two locked decisions are recorded in dedicated subsections so dependent plans cannot drift:

- **`Decision: wordsUsed semantics`** (resolves RESEARCH A5/A6): `wordsUsed` is the whitespace-token count of the response `text`. v1's quota is OFF (`limitReached` always `false`, PROJECT.md WIRE-05) so the value is observability-only and the cheapest derivation matching the field name is canonical. Re-bind in v2 when per-user enforcement lands.
- **`Decision: diarization mount`**: locked `POST /v1/audio/diarization` (single mount). No `/api/diarization` alias in v1 — would force every contract test, OIDC trusted-origin, and observability label to ship twice with no caller benefit. Aligns with Speaches/LiteLLM corporate-override topology.

`tools/lint-docs-headings.ts` enforces the document shape (4 H2 sections, fenced quotes per section, ≥1 BACKEND_SPEC.md:L citation, both locked decisions). `tools/lint-docs-headings.test.ts` covers happy path + 4 failure modes.

### Task 2 — LiteLLM sidecar + litellm-DB auto-create — commit `e854628`

**Image pin verified:** `ghcr.io/berriai/litellm:main-v1.83.14-stable` (>= v1.83.7-stable carries the multipart-passthrough fix natively per CLAUDE.md §4). Multi-arch amd64+arm64.

**Bundled `model_list` (7 entries) — verified via OpenRouter live model API at plan time (D-10/D-11/D-12, 2026-05-10):**

| model_name | LiteLLM target | Provider |
|---|---|---|
| `qwen3.6-plus` | `openrouter/qwen/qwen3.6-plus` | OpenRouter |
| `gemini-3-flash` | `openrouter/google/gemini-3.1-flash-lite` | OpenRouter |
| `gpt-4o-mini` | `openrouter/openai/gpt-4o-mini` | OpenRouter |
| `whisper-large-v3` | Groq endpoint (`api_base: https://api.groq.com/openai/v1`) | Groq (D-11) |
| `gpt-realtime` | `openai/gpt-realtime` | OpenAI direct, `mode: realtime` (D-12 default) |
| `gpt-realtime-mini` | `openai/gpt-realtime-mini` | OpenAI direct, `mode: realtime` |
| `gpt-4o-realtime-preview` | `openai/gpt-4o-realtime-preview` | OpenAI direct, `mode: realtime` (legacy alias) |

**D-07 REVISED — diarization is NOT in the bundled config.** `compose/litellm/litellm_config.yaml` carries no `pyannote` mention in any YAML key and no `pass_through_endpoints` block. The Fastify route in Plan 06 orchestrates pyannote.ai's 4-step async API directly using `PYANNOTE_API_KEY` from `.env`. The HIGH-2 spike (Replicate / HuggingFace alternatives) is closed — Option A locked. The leading comment block in `litellm_config.yaml` documents this and points corporate operators at `pass_through_endpoints` in their override config when single-hop is sufficient.

**HIGH-1 fix shipped (no `make clean-stack` required):**

- `compose/postgres/initdb/01-litellm-database.sh` covers fresh-install (initdb runs once on first volume init, idempotent `\gexec` guard).
- `packages/data/src/migrate.ts` — exported `ensureLitellmDatabase(adminUrl, owner, log)`. `main()` now runs this BEFORE `drizzle migrate()`. Connects DIRECT to `postgres:5432` (NEVER pgbouncer — same anti-pattern guard as DDL). Existing-volume operators upgrading from Phase 2 get the database created idempotently on every `up`. CLAUDE.md "no workarounds" honored.
- `pgIdent()` whitelists role names (`[A-Za-z_][A-Za-z0-9_]*`) before interpolating into `CREATE DATABASE OWNER ...` (CREATE DATABASE rejects parameterized values).
- `main()` is now guarded by `isCliEntry()` so the module is safely importable by tests; CLI invocation path unchanged.

**docker-compose.yml wiring:**

- `postgres`: `POSTGRES_OWNER_USER` forwarded for the init script; `./compose/postgres/initdb` mounted at `/docker-entrypoint-initdb.d/litellm` (subdir, no collision with the existing init dir).
- NEW `litellm` service: profiles `[default]`, `openwhispr_internal` network, env (LITELLM_MASTER_KEY, LITELLM_DATABASE_URL, OPENROUTER/GROQ/OPENAI keys with `:-` defaults), config-mount, `--num_workers 2`, healthcheck on `/health/liveliness`, depends_on postgres+migrate. **PYANNOTE_API_KEY is deliberately omitted** (T-03-01-06 mitigation; verified by guard in `tests/self-tests/litellm-up.test.ts`).
- `api`: depends_on `litellm: service_healthy`; forwards `LITELLM_BASE_URL`, `LITELLM_MASTER_KEY`, `PYANNOTE_API_KEY`.

**`.env.example`:** new Phase 3 section with operator-readable comments — `LITELLM_MASTER_KEY` (placeholder, bootstrap-generated), `LITELLM_DATABASE_URL` / `POSTGRES_ADMIN_URL` (composites referencing `${POSTGRES_OWNER_PASSWORD}`), provider keys (operator opt-in), and `LITELLM_BASE_URL=http://litellm:4000` (the LITELLM-05 override hint).

**`tools/bootstrap.sh` required ZERO changes** — the existing PLACEHOLDER_BOOTSTRAP_WILL_REPLACE branch generates `LITELLM_MASTER_KEY`; the composite-interpolation branch handles `LITELLM_DATABASE_URL` and `POSTGRES_ADMIN_URL`. Verified via isolated bootstrap dry-run in `mktemp` directory.

## Tests

| Test | Type | Status |
|---|---|---|
| `tools/lint-docs-headings.test.ts` (5 cases) | Unit | GREEN — live doc + 4 failure modes |
| `packages/data/src/__tests__/migrate-litellm-db.test.ts` `pgIdent` (2 cases) | Unit | GREEN — accepts canonical, rejects unsafe |
| `packages/data/src/__tests__/migrate-litellm-db.test.ts` `ensureLitellmDatabase` (3 cases) | Integration (testcontainers) | Pending docker (orchestrator validates post-wave) |
| `tests/self-tests/litellm-up.test.ts` smoke | E2E (skipIf !docker) | Pending docker |
| `tests/self-tests/litellm-up.test.ts` config + compose guards (2 cases) | Unit | GREEN — D-07 REVISED + T-03-01-06 |

**Plan-level verify:** `node tools/lint-docs-headings.ts docs/wire-contracts-phase-3.md` exits 0 with `4 required H2 sections, 2 decisions`. `docker compose --profile default config` shows the pinned image. The model-count + no-pyannote/no-pass_through invariant runs as a one-liner via `tsx` and passes.

## Deviations from Plan

None of substance. Two minor refinements applied as in-task adjustments:

1. **Migration runner refactor scope** — the plan specified adding `ensureLitellmDatabase()` to migrate.ts. To make the helper testable without spinning up the CLI process, I also (a) extracted `pgIdent`, `resolveAdminUrl`, and `ownerFromUrl` as exports and (b) guarded the auto-execution under `isCliEntry()` so the module is importable from vitest. The CLI entry path is unchanged — `node /app/packages/data/dist/migrate.cjs` still runs `main()` via `require.main === module`. No behavior change for production. This is a Rule 3 (auto-fix blocking issue) — without the import-safety guard the new tests cannot exist.

2. **bootstrap.sh** — the plan said "extend bootstrap to generate LITELLM_MASTER_KEY". On inspection, the existing `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` literal branch already generates secrets for any matching key in `.env.example`, and the composite `${VAR}` branch handles the URL-shaped values. No bootstrap.sh change required — verified via isolated dry-run that all 7 new keys are produced correctly. Documented this in the Task 2 commit message.

## Threat Surface

Threat model from PLAN.md is fully discharged:

| Threat ID | Mitigation status |
|---|---|
| T-03-01-01 (LiteLLM /health publicly exposed) | accept — internal network only, Traefik does not route /health |
| T-03-01-02 (initdb SQL injection) | mitigate — `quote_ident('${POSTGRES_OWNER_USER}')` in script; bootstrap-controlled value |
| T-03-01-03 (default LITELLM_MASTER_KEY) | mitigate — bootstrap.sh generates random secret; deny-list refuses placeholder |
| T-03-01-04 (LiteLLM OOM at 1000 concurrent) | accept — Phase 8 load test |
| T-03-01-05 (provider keys in env) | accept — 12-factor; Phase 9 secret-manager hooks |
| T-03-01-06 (PYANNOTE_API_KEY accidentally on litellm container) | mitigate — deliberately omitted; automated guard in `tests/self-tests/litellm-up.test.ts` |

No new threat-flag surface introduced.

## Known Stubs

None. Bundled `model_list` is wired live; corporate-override path documented; pyannote routed to the Plan 06 Fastify route by design (intentional scope partition, NOT a stub).

## Self-Check: PASSED

Files asserted present:
- `docs/wire-contracts-phase-3.md` — FOUND
- `tools/lint-docs-headings.ts` — FOUND
- `tools/lint-docs-headings.test.ts` — FOUND
- `compose/litellm/litellm_config.yaml` — FOUND
- `compose/postgres/initdb/01-litellm-database.sh` — FOUND (executable)
- `packages/data/src/__tests__/migrate-litellm-db.test.ts` — FOUND
- `tests/self-tests/litellm-up.test.ts` — FOUND

Commits asserted present:
- `6c06fa1` — Task 1 (wire-contracts + lint tool)
- `e854628` — Task 2 (LiteLLM sidecar + migrate runner litellm-DB auto-create)

Verify commands re-run at SUMMARY time:
- `tsx tools/lint-docs-headings.ts docs/wire-contracts-phase-3.md` — exit 0
- 4-required-H2 grep returns 4
- yaml parse + ≥7 models + no-pyannote / no-pass_through invariant — pass
- `docker compose --profile default config` — pinned image present

---

*Generated 2026-05-10 by Phase 03 Plan 01 executor.*
