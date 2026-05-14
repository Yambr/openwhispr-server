---
phase: 14
phase_name: Slim Core + BYOK Profiles (v2)
phase_slug: slim-core-byok-profiles-v2
date: 2026-05-14
discuss_mode: advisor (research-backed)
---

# Phase 14 — Context

## Domain

Bare `docker compose up` brings up exactly the 6 services a corporate operator needs (api + web + worker + postgres + valkey + litellm). Observability / storage / ingress / pgbouncer / dev-tools land only when the operator explicitly opts in via additive compose overlays under `compose/`. Each overlay has a 1:1 Helm `*.enabled` toggle. The api refuses to start (loud-fail) when an overlay is OFF and the corresponding BYOK env is unset. The constitutional worker `noopX` violation at `apps/worker/src/index.ts:68-92` is closed.

## Canonical refs

- `.planning/ROADMAP.md` — Phase 14 entry (lines ~740-750) — goal + 5 success criteria
- `.planning/REQUIREMENTS.md` — SLIM-01..04, BYOK-01..03 (7 requirements)
- `.planning/PROJECT.md` — project constitution
- `docker-compose.yml` — current 19-service base (pre-Phase-14)
- `compose/postgres/Dockerfile` — pg_partman custom image
- `compose/e2e/docker-compose.e2e.yml` — existing e2e overlay (Phase 04)
- `compose/live-soak/docker-compose.live.yml` — long-soak overlay
- `docker-compose.embedded-litellm.yml` — Phase 11 Variant A canonical (sibling)
- `docker-compose.load-test.yml` + `docker-compose.load-test.realistic.yml` — k6 + mock-litellm (siblings)
- `docs/operations.md` — must gain BYOK matrix section (success criterion #3)
- `.env.example` (90 keys, monolithic) — REPLACED by `.env.slim.example` + appendix
- `.env.embedded.example` (23 keys, Variant A) — kept as-is, sibling
- `.env.e2e.example` (4 keys) — kept as-is, additive
- `packages/email/src/EmailSender.ts:74-91` — `createEmailSender` precedent for the loud-fail `event:<dot.namespaced.id>` token convention
- `apps/api/src/index.ts:670-676` — existing `process.exit(1)` precedent (must NOT regress to exit 78)
- `apps/api/src/index.ts:564-576` — `loadLitellmConfigFromEnv` soft-warn precedent (must NOT match — Phase 14 is hard-fail)
- `apps/api/src/lib/redact-url.ts` — Phase 13 HI-02 helper (mandatory on any credential-bearing string in fatal logs)
- `apps/worker/src/index.ts:68-94` + `apps/worker/src/jobs/virtual-key-rotation.ts` + `apps/worker/src/scheduler.ts:91-98` — virtual-key-rotation wiring slated for removal
- `charts/openwhispr/values.yaml` — Phase 09 Helm chart; gets 5 new `*.enabled` toggles
- `.planning/phases/09-helm-chart-and-cloud-deploy/` — prior Helm work
- `.planning/phases/11-cloud-profile-refactor/` — prior cloud-profile split
- `.planning/phases/13-e2e-cjm-harness-v2-ships-first/` — Gherkin `@cjm-byok-storage`, `@cjm-byok-observability`, `@cjm-loud-fail-misconfig` already authored (must go GREEN)
- Research artifacts (rooted in /tmp during discuss, copy into phase dir before plan):
  - `/tmp/phase14-loud-fail-research.md` — 92 lines, ecosystem + comparison + Option E rationale
  - `/tmp/phase14-noopx-research.md` — 187 lines, per-adapter comparison + Option 4 recommendation
  - `/tmp/phase14-env-research.md` — 128 lines, NocoBase precedent + 5-key proposal
  - `/tmp/phase14-slim-core-map.md` — 126 lines, 19-service routing table

## Decisions

### 1. Slim-core service routing (success criterion #1+#2)

**Actual base count: 19 services in `docker-compose.yml`** (the prompt's "27" double-counted 8 named volumes). Definitive routing:

| Service | Destination | Rationale |
|---|---|---|
| api, web, worker, postgres, valkey, litellm | `docker-compose.yml` (slim-core) | 6 named in success criterion #1 |
| migrate | `docker-compose.yml` (slim-core, init-only `restart: "no"`) | **Decision: init-container pattern inside api scope.** Matches Phase 09 Helm Job semantics. `docker compose ps` shows 6 long-running + 1 exited — strict-6 honored in spirit. |
| otel-collector, loki, tempo, mimir, grafana (5) | `compose/docker-compose.observability.yml` | `observability.enabled` Helm toggle (new) |
| minio (1) | `compose/docker-compose.storage.yml` | `storage.enabled` Helm toggle (new) |
| traefik (1) | `compose/docker-compose.ingress.yml` | `tls.enabled` Helm toggle (existing `ingress.*` block — rename) |
| pgbouncer (1) | `compose/docker-compose.pgbouncer.yml` | `pooler.enabled` Helm toggle (new) |
| mailpit (1) | `compose/docker-compose.dev-tools.yml` | `mailpit.enabled` Helm toggle (new). **Dev-tools is mailpit-only — closes TD-14.a.** |
| fixture-idp + seed + contract-test-runner (3) | **`compose/docker-compose.contract-test.yml` (new — 6th overlay)** | Out of Helm chart entirely. Contract harness is its own opt-in overlay parallel to load-test/e2e. Resolves Q3 of slim-core research. |

**Untouched** (already split, no change in scope): Speaches (lives in `compose/speaches/`, `docker-compose.embedded-litellm.yml`, `examples/`), mock-litellm (lives in `compose/mock-litellm/`, load-test compose), existing e2e/live-soak compose files.

### 2. Loud-fail UX (success criterion #3, BYOK-02)

**Decision: Pino `fatal({event, code, overlay, missing, hint}, msg)` + `pino.final()` + `process.exit(1)`.**

```ts
// apps/api/src/lib/byok-guard.ts (new)
const logger = pino({ name: "boot" });
const finalLogger = pino.final(logger);
finalLogger.fatal(
  {
    event: "byok.required",
    code: "BYOK_STORAGE_REQUIRED",
    overlay: "storage",
    missing: ["S3_ENDPOINT"],
    hint: "Set S3_ENDPOINT or enable the storage overlay (docker compose -f docker-compose.yml -f compose/docker-compose.storage.yml up)",
  },
  "BYOK env missing for disabled overlay; refusing to start",
);
process.exit(1);
```

Rationale:
- Extends the `event:<dot.namespaced.id>` convention from `createEmailSender` (`email.smtp_required_in_production` → `byok.required`, `byok.storage_required`, etc.).
- `code:` field gives ops a stable enum for alerting rules.
- `exit 1` matches `apps/api/src/index.ts:675` (the only existing api exit code) and `apps/worker/src/index.ts:238`. `sysexits.h` exit 78 buys ZERO operational behavior change in Docker / K8s — both back-off identically on any non-zero — and contradicts the precedent.
- `pino.final()` wrapper avoids the truncation pitfall called out in Pino fatal docs.
- The guard MUST fire BEFORE `installGlobalSSRF()` and BEFORE `otel-bootstrap` import side-effects (so OTel SDK doesn't try to dial a misconfigured endpoint and produce cascading noise).
- **Always loud-fail (no NODE_ENV gate).** The overlay flag is the operator's explicit opt-in signal; a dev who forgets to enable storage overlay should see the failure immediately, not get a half-broken stack with 404s.
- Pre-existing soft-warn patterns (`loadLitellmConfigFromEnv` console.warn) must NOT be matched — Phase 14 is hard-fail.

**Per-overlay BYOK env contracts:**

| Overlay | BYOK env(s) when overlay OFF | Loud-fail code |
|---|---|---|
| storage | `S3_ENDPOINT` (+ `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` when ENDPOINT set) | `BYOK_STORAGE_REQUIRED` |
| observability | `OTEL_EXPORTER_OTLP_ENDPOINT` (sentinel `disabled` allowed — see decision 5) | `BYOK_OBSERVABILITY_REQUIRED` |
| ingress | `INGRESS_BASE_URL` | `BYOK_INGRESS_REQUIRED` |
| pgbouncer | `DATABASE_URL` (already required for all profiles — explicit assertion is documentation, not a new gate) | `BYOK_DATABASE_REQUIRED` |
| dev-tools (mailpit) | `SMTP_HOST` (NODE_ENV=production only — matches createEmailSender) | `BYOK_SMTP_REQUIRED` |

### 3. Worker `noopX` audit (success criterion #4, BYOK-03)

**Decision: DELETE the virtual-key-rotation worker wiring entirely.**

Removed in Phase 14:
- `apps/worker/src/index.ts:68-94` — both `noopLitellmKeyClient` and `noopUserKeyLookup` constants
- `apps/worker/src/index.ts:137-145` — virtual-key-rotation BullMQ Worker registration
- `apps/worker/src/scheduler.ts:91-98` — weekly cron tick enqueuing nil-UUID sentinel
- `apps/worker/src/jobs/virtual-key-rotation.ts` — the entire job handler
- `apps/worker/src/scheduler.test.ts` — virtual-key-rotation cron tests
- Any other orphan tests

Rationale: both noop adapters feed ONLY the virtual-key-rotation worker. Its production driver (`/api/admin/keys/rotate` route + per-user fan-out dispatcher + `user_settings.litellm_key_id` column + `generateKey`/`deleteKey` on `@openwhispr/litellm-client`) is NOT implemented. The cron currently enqueues a nil-UUID sentinel that cannot succeed at the RLS layer. Replacing noops with real adapters would require shipping 4 new pieces of work (client methods + migration + API route + dispatcher) — that is a feature, not an audit closure. The phase theme (Slim Core + BYOK) does NOT mandate the feature.

REQUIREMENTS BYOK-03 says "replace with real adapters OR loud-fail" — removing the dead wiring satisfies the "or loud-fail" branch by eliminating the unsafe path entirely. Constitutional "no internal mocks in production code" rule is also satisfied (the noops vanish).

**`noopSender` was already replaced in Phase 13** (commit `17c603e`) — see DECISIONS for the canonical pattern. Phase 14 does NOT re-touch `noopSender`.

When key-rotation feature is later wanted, follow the noopSender pattern: extend `@openwhispr/litellm-client` with `generateKey`/`deleteKey`, loud-fail in prod when config absent, add `user_settings.litellm_key_id` migration, build `/api/admin/keys/rotate` route + per-user dispatcher. Schedule this as a feature phase (v3 or later), NOT inside Phase 14.

### 4. `.env.slim.example` design (SLIM-03, SLIM-04)

**Decision: Option B — slim 5 keys + commented overlay sections in the same file.**

The 5 mandatory input keys:

```dotenv
# 1. POSTGRES_APP_PASSWORD     — Postgres app-role password (non-BYPASSRLS). DATABASE_URL derives.
# 2. BETTER_AUTH_SECRET        — Better Auth session-signing secret. openssl rand -hex 32.
# 3. LITELLM_MASTER_KEY        — Bearer between api/worker and bundled LiteLLM. openssl rand -hex 32.
# 4. BETTER_AUTH_URL           — Public origin (cookie domain + CORS). Default http://localhost:3000.
# 5. OPENROUTER_API_KEY        — Powers /api/reason via bundled LiteLLM. Empty = 503 envelope.
```

Derived URLs (`DATABASE_URL`, `VALKEY_URL`, `LITELLM_BASE_URL`) interpolate via `${VAR}` and are NOT counted as input keys.

Commented overlay appendix in the same file, with `# REQUIRES: docker-compose.<overlay>.yml` banners per section. Operator uncomments the matching section AND adds `-f compose/docker-compose.<overlay>.yml`. Discovery via file, not via docs.

`docs/operations.md` gains a separate BYOK matrix section (success criterion #3) as a reference table — not the primary discovery path.

`.env.example` (the existing 90-key monolithic file) gets **renamed to `.env.full.example`** and kept as a complete reference, but the canonical OSS quickstart now points at `.env.slim.example`. `.env.embedded.example` and `.env.e2e.example` remain unchanged (orthogonal concerns: Variant A and real-provider e2e keys).

### 5. OTel disable sentinel (resolves observability loud-fail paradox)

**Decision: `OTEL_EXPORTER_OTLP_ENDPOINT=disabled` is the sentinel value that disables the api's OTel SDK without violating the loud-fail rule.**

Behavior matrix:

| Overlay state | `OTEL_EXPORTER_OTLP_ENDPOINT` | api boot |
|---|---|---|
| OFF | `disabled` (sentinel) | OK — SDK initializes in no-op mode (no exporter wired) |
| OFF | unset / empty | **loud-fail** with `BYOK_OBSERVABILITY_REQUIRED` |
| OFF | set to URL (corp OTel) | OK — exports to operator's BYOK endpoint |
| ON | `http://otel-collector:4317` (overlay default) | OK |
| ON | overridden | OK |

The `disabled` sentinel is the explicit opt-out: operator must consciously decide "no observability" rather than getting it silently. App-side change: `apps/api/src/lib/otel-bootstrap.ts` checks for `=== "disabled"` and short-circuits SDK init.

`.env.slim.example` ships with `OTEL_EXPORTER_OTLP_ENDPOINT=disabled` by default (the slim path has no observability). Operator who enables the overlay sets it to `http://otel-collector:4317`.

### 6. Helm `*.enabled` toggles (BYOK-01)

5 new top-level booleans in `charts/openwhispr/values.yaml`, 1:1 with compose overlays:

| Helm toggle | Compose overlay | Status |
|---|---|---|
| `observability.enabled` | `compose/docker-compose.observability.yml` | new |
| `storage.enabled` | `compose/docker-compose.storage.yml` | new |
| `tls.enabled` | `compose/docker-compose.ingress.yml` | **rename** from existing `ingress.*` block |
| `pooler.enabled` | `compose/docker-compose.pgbouncer.yml` | new |
| `mailpit.enabled` | `compose/docker-compose.dev-tools.yml` | new (mailpit only — fixture-idp/seed/contract-test-runner are NOT in Helm) |

### 7. Phase 14 / Phase 15 order

**Decision: Phase 14 first (user-confirmed order remains authoritative — `13 → 12 → 14 → 15 → 16 → 17 → 18`).**

Phase 14 ships 5 new overlay files under `compose/`. Phase 15's `compose/` reorg + Traefik host split then reorganises both Phase 14's new overlays and the existing siblings (`docker-compose.embedded-litellm.yml`, `docker-compose.load-test*.yml`) together. ARCHITECTURE's alternative (15 before 14) is logged but NOT chosen.

## Code context

**Existing reusable assets:**
- `packages/email/src/EmailSender.ts:74-91` — canonical loud-fail pattern (factory + `event:` token + prod hard-fail / non-prod degraded).
- `apps/api/src/lib/redact-url.ts` — credential-redaction helper (mandatory on credential-bearing strings in fatal logs).
- `apps/api/src/lib/dep-check.ts` — boot-time dependency-check helper from Phase 13 (pattern to mirror for the new `byok-guard.ts`).
- `pino` logger already constructed in `apps/api/src/index.ts` and `apps/worker/src/index.ts` (no new dep).
- `charts/openwhispr/values.yaml` — Phase 09 base; gets the 5 new toggles.
- `compose/postgres/Dockerfile` — pg_partman custom image (Phase 06). Untouched.

**Existing overlay siblings (do NOT move in Phase 14):**
- `docker-compose.embedded-litellm.yml` (Phase 11 Variant A canonical)
- `docker-compose.load-test.yml` + `docker-compose.load-test.realistic.yml`
- `compose/e2e/docker-compose.e2e.yml` (Phase 04)
- `compose/live-soak/docker-compose.live.yml`

**Tests that need touch:**
- `apps/worker/src/scheduler.test.ts` — delete virtual-key-rotation cron tests
- Phase 13 Gherkin `@cjm-byok-storage`, `@cjm-byok-observability`, `@cjm-loud-fail-misconfig` — must flip to GREEN (tag-strip after implementation)
- Phase 06 testcontainer harness — verify it does NOT hard-code `pgbouncer:6432`; if it does, update to read compose path from env so `-f docker-compose.yml -f compose/docker-compose.pgbouncer.yml` toggling works

## Out of scope (deferred ideas)

These came up during discussion and are explicitly NOT in Phase 14:

1. **Virtual key rotation feature** — `/api/admin/keys/rotate` route + `user_settings.litellm_key_id` column + `generateKey`/`deleteKey` on `@openwhispr/litellm-client` + per-user fan-out dispatcher. v3 or later.
2. **`pgcrypto`-encrypted storage of LiteLLM virtual keys** — depends on (1).
3. **`tools/env-merge.ts` codemod** for composing `.env` from slim + overlays. Rejected as over-engineering; Option B file-level commented sections cover discoverability adequately.
4. **Per-overlay `.env.<overlay>.example` files** (Option C). Rejected; forces operators to learn `env_file:` stacking syntax — friction.
5. **`AccountClient.test.tsx` pre-existing failure** (deferred-items.md from Phase 12). Belongs in a phase that touches `AccountClient.tsx` directly.
6. **Phase 15 ↔ 14 swap** (architectural alternative). Logged in ROADMAP open-question; user-confirmed order authoritative.

## Open questions for researcher / planner

None at discuss-time — all 4 gray areas were research-backed and resolved. Researcher's job is to validate the per-service compose-overlay YAML against current `docker-compose.yml` health-check + dependency wiring; planner's job is to slice into ≤ 6 plans with strict TDD per plan.

---

*Decisions captured 2026-05-14 via 4 parallel `gsd-advisor-researcher` agents (loud-fail UX, worker noopX, .env.slim.example, slim-core 27→19 service map). Reports under `/tmp/phase14-*-research.md`; copy into phase dir as `14-RESEARCH-*.md` before planning.*
