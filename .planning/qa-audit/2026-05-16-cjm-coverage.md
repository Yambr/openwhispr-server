# QA Audit — CJM Coverage (2026-05-16)

**Audit type:** Read-only gap analysis.
**Auditor:** Claude (QA pass per user request).
**Scope:** End-user Customer Journey Map (CJM) scenarios across `tests/e2e-cjm/` vs canonical `docs/customer-journeys.md` and wire-surface specs (`BACKEND_SPEC.md`, `WIRE-*` requirements).
**Output is non-prescriptive:** documents WHAT is missing and a Gherkin-scaffold acceptance criterion. Implementation belongs to a follow-up phase.

---

## TL;DR

- **44 CJM scenarios** are wired in 14 `.feature` files (full list in §2).
- **26 GREEN** (runnable in CI today) / **14 `@expected-red`** (deferred to a named future phase) / **4 `@after-docker-up`** (runtime-gated, GHA-only).
- **10 wire-surface journeys have NO `@cjm-*` tag at all** — listed as G1…G10 in §3. These are the actionable gaps the next agent should turn RED then GREEN, phase by phase.
- Anti-rot linter `tools/lint-cjm-doc.ts` keeps doc anchors ↔ Gherkin tags in sync; any new `@cjm-*` tag must add a matching anchor in `docs/customer-journeys.md`.

---

## 1. How CJM coverage is structured today

```
docs/customer-journeys.md         <-- canonical journey catalogue (414 lines, Phase 13)
   │
   │   anchored 1:1 by tag, enforced by tools/lint-cjm-doc.ts
   ▼
tests/e2e-cjm/features/*.feature  <-- Gherkin scenarios with @cjm-* tags
   │
   │   steps glob in playwright.config.ts:42
   ▼
tests/e2e-cjm/steps/*.steps.ts    <-- step definitions (12 files, ~2078 lines)
   │
   ▼
tests/e2e-cjm/support/            <-- world.ts, fixtures, compose-harness, mailpit-helper
```

Key invariants (from `playwright.config.ts:49-51`):
- `retries: 0` — flake is a bug, not a re-run candidate.
- `workers: 1` — sequential, no cross-scenario state leakage.
- `baseURL: https://web.localhost` — Traefik host-split mandatory.

Gate tags used in scenarios:
- `@expected-red` + `@after-phase-X.Y` — scenario lives in the file, but `make e2e-cjm` filters it out (`--grep-invert '@expected-red'`). Phase X.Y is committed to flip it GREEN.
- `@after-docker-up` — requires a live `docker compose up --wait` stack; not runnable in pure-unit context.
- `@after-keycloak-up` — additionally needs Keycloak realm (Phase 19 SSO).

---

## 2. Full inventory — every `@cjm-*` tag currently in the repo

Source of truth at audit time: `git grep '^Scenario:' tests/e2e-cjm/features/` + tag scan.

| Tag | Title | File | Status |
|---|---|---|---|
| `@cjm-1.1` | Signup happy path | `signup-verify.feature:6` | GREEN |
| `@cjm-1.2` | Already-registered email dedup | `signup-verify.feature:10` | GREEN |
| `@cjm-1.3` | Password < 8 chars | `signup-verify.feature:17` | GREEN |
| `@cjm-1.4` | Locale-scoped error copy (RU) | `signup-verify.feature:27` | RED → `@after-phase-19.3` |
| `@cjm-1.5` | Zero providers → zero buttons | `signup-verify.feature:32` | GREEN |
| `@cjm-2.1` | Sign-in happy path | `signin.feature:6` | GREEN |
| `@cjm-2.2` | 403 unverified + resend CTA | `signin.feature:12` | GREEN |
| `@cjm-3.1` | Password-reset happy path | `password-reset.feature:6` | RED → `@after-phase-19.1` |
| `@cjm-3.2` | Invalid-token error | `password-reset.feature:11` | GREEN |
| `@cjm-4.1` | Audio multipart → response shape | `transcribe.feature:6` | RED → `@after-phase-19.2` |
| `@cjm-4.2` | Malformed audio → typed-error envelope | `transcribe.feature:11` | GREEN |
| `@cjm-5.1` | `/admin` landing page | `admin-onboarding.feature:6` | GREEN (Phase 12) |
| `@cjm-5.2` | Basicauth break-glass 401 | `admin-onboarding.feature:13` | GREEN |
| `@cjm-5.3` | Setup wizard happy path | `admin-onboarding.feature:19` | GREEN (Phase 12) |
| `@cjm-6.1` | en↔ru cookie persistence | `locale-switch.feature:6` | RED → `@after-phase-19.4` |
| `@cjm-6.2` | `/api/locale` host-split | `locale-switch.feature:12` | GREEN (Phase 15) |
| `@cjm-7.1` | Zero OIDC providers → zero buttons | `oidc-providers.feature:6` | GREEN |
| `@cjm-7.2` | One provider → exactly one button | `oidc-providers.feature:12` | GREEN (Phase 12) |
| `@cjm-8.1` | 4xx typed envelope `{error: {code, message}}` | `error-paths.feature:6` | GREEN |
| `@cjm-8.2` | 5xx friendly screen, no raw stack | `error-paths.feature:12` | GREEN |
| `@cjm-byok-storage.1` | Loud-fail when storage overlay OFF + `S3_ENDPOINT` unset | `byok-storage.feature:25` | GREEN |
| `@cjm-byok-storage.2` | Corp BYOK accept (overlay OFF + env set) | `byok-storage.feature:38` | GREEN |
| `@cjm-byok-storage.3` | Storage overlay ON | `byok-storage.feature:51` | GREEN |
| `@cjm-byok-observability.1` | Loud-fail OTEL unset + overlay OFF | `byok-observability.feature:24` | GREEN |
| `@cjm-byok-observability.2` | `=disabled` sentinel no-op | `byok-observability.feature:39` | GREEN |
| `@cjm-byok-observability.3` | Corp OTLP endpoint accept | `byok-observability.feature:52` | GREEN |
| `@cjm-loud-fail-misconfig.1` | Misconfig fatal precedes SSRF + OTel boot | `loud-fail-misconfig.feature:29` | GREEN |
| `@cjm-loud-fail-misconfig.2` | Credential URLs redacted in fatal | `loud-fail-misconfig.feature:42` | GREEN |
| `@cjm-traefik-host-split` | `/api/locale` on `api.localhost` | `traefik-host-split.feature:14` | RED → `@after-docker-up` |
| `@cjm-traefik-host-split-web` | `/` on `web.localhost` | `traefik-host-split.feature:19` | RED → `@after-docker-up` |
| `@cjm-tls-trusted-localhost` | mkcert cert trusted | `phase17-tls.feature:14` | RED → `@after-docker-up` |
| `@cjm-tls-no-dev-ca-in-prod-image` | Prod image has no dev CA | `phase17-tls.feature:19` | GREEN |
| `@cjm-tls-no-dev-ca-in-traefik-image` | Traefik image has no dev CA | `phase17-tls.feature:25` | RED → `@after-docker-build` |
| `@cjm-tls-acme-staging` | ACME staging cert issuance | `phase17-tls.feature:32` | RED → `@after-docker-up` |
| `@cjm-sso-1.1` | JIT user creation from OIDC token | `sso/keycloak-oidc.feature:6` | RED → `@after-phase-19` |
| `@cjm-sso-1.2` | Returning OIDC user re-sync name+email | `sso/keycloak-oidc.feature:14` | RED → `@after-phase-19` |
| `@cjm-sso-1.3` | Group→role downgrade revokes admin | `sso/keycloak-oidc.feature:22` | RED → `@after-phase-19` |
| `@cjm-sso-1.4` | Tenant from email-domain claim | `sso/keycloak-oidc.feature:30` | RED → `@after-phase-19` |
| `@cjm-sso-1.5` | Cross-tenant RLS rejection (SSO) | `sso/keycloak-oidc.feature:38` | RED → `@after-phase-19` |
| `@cjm-sso-1.6` | Loud-fail when Keycloak config missing | `sso/keycloak-oidc.feature:46` | RED → `@after-phase-19` |

Total: 40 user-facing `@cjm-*` tags + 4 infrastructure tags (`@cjm-traefik-*`, `@cjm-tls-*`) = **44 scenarios**.

---

## 3. CJM gaps — journeys with NO `@cjm-*` tag yet

For each gap: ID, journey, wire surface, why it is missing, suggested file + tag, and a Gherkin scaffold the next agent can drop in.

### G1 — LiteLLM virtual-key rotation on tenant config change

- **Wire surface:** `POST /api/admin/tenants/:tenantId/keys/rotate` (per `BACKEND_SPEC.md` admin section; verify exact route before writing test)
- **Spec ID:** `LITELLM-04`
- **Why missing:** Phase 14 BYOK closed boot-time validation only. Runtime rotation when an operator updates the LiteLLM virtual key is not exercised — a regression there silently breaks every downstream request without a boot-time signal.
- **Suggested file:** `tests/e2e-cjm/features/byok-key-rotation.feature` (new)
- **Suggested tag:** `@cjm-byok-rotation.1` (happy) + `@cjm-byok-rotation.2` (negative twin: stale key returns 401 from LiteLLM)
- **Phase gate:** `@expected-red @after-phase-LITELLM-04`

```gherkin
@cjm-byok-rotation.1
Scenario: Admin rotates LiteLLM virtual key; subsequent transcribe uses new key
  Given a tenant with an active LiteLLM virtual key "vk-old"
  And a recent successful POST /api/transcribe using "vk-old"
  When the admin rotates the key to "vk-new" via POST /api/admin/tenants/:id/keys/rotate
  Then POST /api/transcribe MUST present "vk-new" upstream
  And the previous key "vk-old" MUST be revoked at the LiteLLM master-key level

@cjm-byok-rotation.2
Scenario: Stale virtual key produces a typed error envelope, not a stack trace
  Given a tenant whose LiteLLM virtual key was revoked
  When POST /api/transcribe is called with that tenant's session
  Then response status MUST be 401
  And body MUST match the typed envelope { error: { code: "auth_failed", message: <string> } }
  And the message MUST NOT contain the revoked key value
```

### G2 — Per-tenant STT/LLM override via settings

- **Wire surface:** `PUT /api/settings/stt`, `PUT /api/settings/llm`, `GET /api/settings`
- **Spec IDs:** `WIRE-11`, `WIRE-12`, `WIRE-28`
- **Why missing:** integration tests cover env-defaults only. The user-visible journey "tenant admin switches default STT model in the dashboard, next transcribe call uses the new model" has no `@cjm-*` coverage.
- **Suggested file:** `tests/e2e-cjm/features/tenant-settings-override.feature` (new)
- **Suggested tag:** `@cjm-9.1` (happy) + `@cjm-9.2` (negative: invalid model id → typed error)
- **Phase gate:** `@expected-red @after-phase-WIRE-11`

```gherkin
@cjm-9.1
Scenario: Tenant admin overrides default STT model and next transcribe uses it
  Given a signed-in admin of tenant T
  And tenant T's effective STT model is "whisper-large-v3"
  When PUT /api/settings/stt is called with model "whisper-large-v3-turbo"
  And POST /api/transcribe is called with a multipart wav
  Then the LiteLLM request log MUST show model="whisper-large-v3-turbo"
  And GET /api/settings/stt MUST echo "whisper-large-v3-turbo"

@cjm-9.2
Scenario: Unknown STT model id rejected with a typed envelope
  Given a signed-in admin of tenant T
  When PUT /api/settings/stt is called with model "not-a-real-model"
  Then response status MUST be 400
  And body MUST match { error: { code: "invalid_model", message: <string> } }
```

### G3 — Diarization round-trip

- **Wire surface:** `POST /v1/audio/diarization` (LiteLLM-proxied to Speaches or pyannote)
- **Spec ID:** `WIRE-04`
- **Why missing:** contract test exists (`packages/contract-tests/`), but no end-user CJM exercises the full flow. Per memory `speaches_diarization_build_from_main`, the diarization endpoint requires a `main`-branch Speaches build — the test must document that prerequisite.
- **Suggested file:** `tests/e2e-cjm/features/diarization.feature` (new)
- **Suggested tag:** `@cjm-10.1` (happy: wav → speaker-segmented JSON) + `@cjm-10.2` (negative: text/plain payload → 415)
- **Phase gate:** `@expected-red @after-docker-up @after-speaches-main`

```gherkin
@cjm-10.1
Scenario: Multi-speaker wav returns speaker-segmented JSON
  Given a signed-in user
  And a 2-speaker wav fixture "tests/fixtures/diarize-2speakers.wav"
  When POST /v1/audio/diarization is called with that fixture
  Then response status MUST be 200
  And body MUST contain at least 2 distinct speaker ids
  And every segment MUST have { speaker, start, end } fields
```

### G4 — Realtime streaming (WSS) user journey

- **Wire surface:** `WSS /v1/realtime` (LiteLLM-proxied)
- **Spec ID:** `WIRE-05`
- **Why missing:** contract test asserts handshake/auth-gate; no scenario exercises the full open → send PCM → receive transcript-delta → close lifecycle.
- **Suggested file:** `tests/e2e-cjm/features/realtime-stream.feature` (new)
- **Suggested tag:** `@cjm-11.1` (happy) + `@cjm-11.2` (negative: missing bearer → close with code 4401)
- **Phase gate:** `@expected-red @after-docker-up`

```gherkin
@cjm-11.1
Scenario: Realtime session streams partial transcripts
  Given a signed-in user with a valid session cookie
  When a WSS connection to /v1/realtime opens with that cookie
  And 5 seconds of PCM audio fixture frames are sent
  Then at least one server message of type "transcript.delta" MUST be received
  And the session MUST close cleanly on client-initiated close
```

### G5 — Agent stream

- **Wire surface:** `POST /api/agent/stream` (NDJSON)
- **Spec ID:** `WIRE-20`
- **Why missing:** internal unit tests cover the orchestrator, but no Gherkin journey asserts the NDJSON wire shape end-to-end.
- **Suggested file:** `tests/e2e-cjm/features/agent-stream.feature` (new)
- **Suggested tag:** `@cjm-12.1` (happy) + `@cjm-12.2` (cancellation mid-stream)
- **Phase gate:** `@expected-red`

```gherkin
@cjm-12.1
Scenario: Agent stream yields NDJSON event sequence
  Given a signed-in user
  When POST /api/agent/stream is called with prompt "Summarize the day"
  Then response Content-Type MUST be "application/x-ndjson"
  And the stream MUST start with an event of type "start"
  And MUST end with an event of type "complete"
  And every line MUST be a valid JSON object with a "type" field
```

### G6 — Web-search (Tavily / Yandex)

- **Wire surface:** `POST /api/agent/web-search`
- **Spec ID:** Phase 5 (per memory `project_phase5_websearch`: providers locked at Tavily + Yandex; env-driven adapter; keys due 2026-05-12).
- **Why missing:** Phase 5 has unit + integration tests, but no end-user CJM. Without one, a provider regression at the adapter boundary is invisible until a customer reports it.
- **Suggested file:** `tests/e2e-cjm/features/web-search.feature` (new)
- **Suggested tag:** `@cjm-13.1` (happy, mock provider) + `@cjm-13.2` (negative: provider 5xx → typed error)
- **Phase gate:** `@expected-red @after-phase-5`. Per memory `feedback_loadtest_cost_discipline`, the happy path MUST hit a mock provider, never a paid one — gate any live-provider variant behind `OPENWHISPR_LOADTEST_ALLOW_PAID`.

```gherkin
@cjm-13.1
Scenario: Web-search returns a normalized result list (mock provider)
  Given a signed-in user
  And WEB_SEARCH_PROVIDER=mock (deterministic fixture)
  When POST /api/agent/web-search is called with query "node.js LTS"
  Then response status MUST be 200
  And body.results MUST be an array of at least 3 items
  And every item MUST have { title, url, snippet }
```

### G7 — Session refresh / token rotation

- **Wire surface:** Better Auth session refresh + `set-auth-token` response header (per `BACKEND_SPEC.md §4`).
- **Why missing:** no scenario exercises the silent-refresh path. A regression where the client never picks up the rotated token would only surface as 401 storms in production.
- **Suggested file:** `tests/e2e-cjm/features/session-refresh.feature` (new)
- **Suggested tag:** `@cjm-14.1` (happy: long-running session sees rotated token) + `@cjm-14.2` (negative: expired session → 401 + clear cookie)
- **Phase gate:** `@expected-red`

```gherkin
@cjm-14.1
Scenario: Long-running session receives rotated auth token
  Given a signed-in user with session cookie at T0
  When the system clock advances past the rotation threshold
  And any authenticated request is made
  Then the response MUST include a "set-auth-token" header
  And the new token MUST decode to the same user id
  And subsequent requests MUST use the new token
```

### G8 — Cross-tenant RLS rejection for non-SSO sessions

- **Wire surface:** Any tenant-scoped read (`GET /api/transcribe/jobs/:id`, `GET /api/settings`).
- **Spec ID:** `DATA-RLS-*` policies.
- **Why missing:** only `@cjm-sso-1.5` (RED, Phase 19) covers cross-tenant rejection — and only via the SSO path. The default email/password tenant has no equivalent CJM, so RLS regressions for the OSS happy path would slip through.
- **Suggested file:** `tests/e2e-cjm/features/rls-cross-tenant.feature` (new)
- **Suggested tag:** `@cjm-15.1` (negative: user A cannot read tenant B's job) + `@cjm-15.2` (positive: same user, same tenant, succeeds)
- **Phase gate:** GREEN-capable today (no phase dependency)

```gherkin
@cjm-15.1
Scenario: User from tenant A cannot read a job belonging to tenant B
  Given a signed-in user U_A in tenant T_A
  And an existing transcribe job J_B owned by tenant T_B
  When GET /api/transcribe/jobs/{J_B.id} is called with U_A's session
  Then response status MUST be 404 (NOT 403 — leakage of existence is forbidden)
  And body MUST match { error: { code: "not_found", message: <string> } }
```

### G9 — End-to-end transcribe via corporate LiteLLM (BYOK happy path)

- **Wire surface:** `POST /api/transcribe` with `LITELLM_BASE_URL` overridden to a corporate endpoint.
- **Spec ID:** `BYOK-04`
- **Why missing:** `@cjm-byok-storage.2` validates boot-time acceptance of a corporate `S3_ENDPOINT`, but no scenario exercises the equivalent path for `LITELLM_BASE_URL` end-to-end (i.e. boot + actual transcribe request reaches the override).
- **Suggested file:** `tests/e2e-cjm/features/byok-corporate-litellm.feature` (new)
- **Suggested tag:** `@cjm-byok-litellm.1`
- **Phase gate:** `@expected-red @after-phase-19.2` (depends on the same mock-litellm overlay being added for `@cjm-4.1`)

```gherkin
@cjm-byok-litellm.1
Scenario: Transcribe routes through a corporate LITELLM_BASE_URL override
  Given the api boots with LITELLM_BASE_URL=http://mock-corp-litellm:4000
  And the corporate mock returns a canned transcript "hello world"
  When POST /api/transcribe is called with tests/fixtures/short.wav
  Then response status MUST be 200
  And body.text MUST equal "hello world"
  And mock-corp-litellm MUST have logged exactly 1 inbound request
```

### G10 — Billing / subscription endpoints

- **Wire surface:** TBD (no spec section yet).
- **Why missing:** out-of-scope for v2.1 — but worth recording so the next milestone planning sees the gap explicitly rather than rediscovering it.
- **Suggested tag namespace (when phase exists):** `@cjm-billing-*`
- **Phase gate:** Deferred to v3 roadmap.

---

## 4. Acceptance criteria for the follow-up agent

For each gap G1…G10 above, the implementer must:

1. Create the suggested `.feature` file with the scaffold scenarios.
2. Mark each scenario `@expected-red @after-phase-<X>` if its phase has not landed, GREEN if it has.
3. Add the matching anchor section to `docs/customer-journeys.md` so `tools/lint-cjm-doc.ts` keeps passing.
4. Add step bindings in `tests/e2e-cjm/steps/` — each step MUST have a vitest unit test under `steps/__tests__/` per memory `feedback_cjm_steps_need_unit_tests` (URL/payload bugs that the linter would otherwise miss).
5. Re-run `pnpm exec tsx tools/lint-cjm-doc.ts` to verify doc↔Gherkin parity.

Negative-twin rule (from `customer-journeys.md`): **every happy path scenario MUST ship with at least one negative twin in the same feature file.** The scaffolds above honor this.

---

## 5. Out of scope of this audit

- Verifying that current GREEN scenarios actually pass — that is CI's job; this audit trusts the `@expected-red` tag as ground truth for status.
- Reviewing `tools/lint-cjm-doc.ts` or `docs/customer-journeys.md` content for correctness — they are the canonical sources.
- Suggesting changes to existing scenarios — only NEW journey gaps are listed here.
