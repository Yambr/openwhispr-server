# Phase 14 — Discussion Log

**Date:** 2026-05-14
**Mode:** discuss (advisor research-backed, user-driven gray-area selection)

## Gray areas selected

User selected ALL four advisor-researched gray areas:
1. Loud-fail UX (format)
2. Worker `noopX` adapters (real vs loud-fail vs delete)
3. `.env.slim.example` design (minimalism vs commented overlays vs per-overlay files)
4. Slim-core 27→19 service routing map

Plus user requested research-backed comparison: 4 parallel `gsd-advisor-researcher` agents spawned for the 4 areas.

## Questions asked and decisions made

### Q1. Loud-fail UX format

**Options presented (after research):**
- A. Typed JSON to stderr + exit 78 (EX_CONFIG)
- B. Human text to stderr + exit 1
- C. NODE_ENV-gated dual mode
- D. Pino fatal + exit 78
- E. Pino fatal + exit 1 (research recommendation)

**User selected:** E — Pino `fatal({event, code, overlay, missing, hint}, msg)` + `pino.final()` + `process.exit(1)`.

**Rationale recorded:** Extends `event:<dot.namespaced.id>` token convention from `createEmailSender`. `exit 1` matches existing precedent (`apps/api/src/index.ts:675`, `apps/worker/src/index.ts:238`). Exit 78 buys ZERO operational change in Docker/K8s. Always loud-fail (no NODE_ENV gate).

### Q2. Worker `noopX` resolution

**Options presented (after research):**
- 1. Build real adapters (extend `@openwhispr/litellm-client`, add `user_settings.litellm_key_id` migration, build `/api/admin/keys/rotate` route)
- 2. Loud-fail at worker boot
- 3. Hybrid (real adapter + loud-fail)
- 4. Delete entire virtual-key-rotation wiring (research recommendation)

**User selected:** 4 — Delete entire virtual-key-rotation worker registration + cron tick + scheduler tests.

**Rationale recorded:** Production driver (`/api/admin/keys/rotate` + per-user dispatcher + DB column + client methods) is NOT implemented; cron enqueues a nil-UUID sentinel that cannot succeed. Replacing noops with real adapters is feature work (3-4 new pieces), not audit closure. REQUIREMENTS BYOK-03 "real adapters OR loud-fail" is satisfied by removing the unsafe path.

### Q3. `.env.slim.example` design

**Options presented (after research):**
- A. Strict 5-key minimum + docs/operations.md matrix only
- B. Slim + commented overlay sections in same file (research recommendation; NocoBase precedent)
- C. Per-overlay `.env.<overlay>.example` files
- D. Strict + `tools/env-merge.ts` codemod

**User selected:** B.

**5 keys locked:**
1. `POSTGRES_APP_PASSWORD`
2. `BETTER_AUTH_SECRET`
3. `LITELLM_MASTER_KEY`
4. `BETTER_AUTH_URL`
5. `OPENROUTER_API_KEY`

**Rationale recorded:** OSS quickstart works identically to Option A (commented sections ignored). Operator who triggers a loud-fail on a misconfigured overlay finds the fix IN THE SAME FILE next to a `# REQUIRES: docker-compose.<overlay>.yml` banner. Discovery via file, not via docs hunt.

### Q4. Slim-core map (4 sub-decisions)

**Sub-Q4a: migrate service interpretation**
- Option A: init-container inside api scope (research recommendation)
- Option B: fold migration into api entrypoint
- **User selected:** A — `docker compose ps` shows 6 long-running + 1 exited. Matches Phase 09 Helm Job.

**Sub-Q4b: OTel disable sentinel**
- `OTEL_EXPORTER_OTLP_ENDPOINT=disabled` (research recommendation)
- New `OBSERVABILITY_DISABLED=1` flag
- **User selected:** sentinel `=disabled`.

**Sub-Q4c: fixture-idp + seed + contract-test-runner home**
- (a) `compose/docker-compose.dev-tools.yml` alongside mailpit
- (b) new `compose/docker-compose.contract-test.yml` (research recommendation)
- (c) delete from compose entirely
- **User selected:** (b) — keeps `dev-tools.yml` clean (mailpit only → 1:1 with `mailpit.enabled` Helm toggle). Contract harness becomes its own overlay parallel to load-test/e2e.

**Sub-Q4d: Phase 14 ↔ 15 order**
- Phase 14 first (user-confirmed order, ROADMAP authoritative) — selected
- Swap with Phase 15 (compose/ reorg first — ARCHITECTURE alternative) — rejected

## Deferred ideas

1. Virtual key rotation feature (route + DB column + client methods + dispatcher) — v3 or later
2. `pgcrypto`-encrypted storage of LiteLLM virtual keys — depends on (1)
3. `tools/env-merge.ts` codemod — over-engineering
4. Per-overlay `.env.<overlay>.example` files — forces env_file stacking syntax
5. `AccountClient.test.tsx` pre-existing failure — belongs in a phase touching that component
6. Phase 15 ↔ 14 swap — logged in ROADMAP open-question; rejected for v2

## Research artifacts

- `/tmp/phase14-loud-fail-research.md` → `14-RESEARCH-loud-fail.md` (92 lines)
- `/tmp/phase14-noopx-research.md` → `14-RESEARCH-noopx.md` (187 lines)
- `/tmp/phase14-env-research.md` → `14-RESEARCH-env-slim.md` (128 lines)
- `/tmp/phase14-slim-core-map.md` → `14-RESEARCH-slim-core-map.md` (126 lines)

## Claude's discretion items (no user input requested)

- Per-overlay Pino loud-fail codes (`BYOK_STORAGE_REQUIRED`, `BYOK_OBSERVABILITY_REQUIRED`, `BYOK_INGRESS_REQUIRED`, `BYOK_DATABASE_REQUIRED`, `BYOK_SMTP_REQUIRED`)
- `.env.example` (90-key monolithic) → rename to `.env.full.example`, kept as complete reference
- `pino.final()` wrapper to avoid truncation pitfall
- Place `assertBYOKConfig()` BEFORE `installGlobalSSRF()` and BEFORE `otel-bootstrap` import side-effects
- pre-flight correction: 19 services in main compose, not 27 (volumes were double-counted)
