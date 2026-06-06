# CJM Coverage Gaps — quick operator reference

> Before adding a new feature or `.feature` file, scan this list. If your work overlaps a gap below, claim it: add the scaffold from the linked audit doc, mark it `@expected-red @after-phase-<your-phase>`, and link the phase in the table.

Full audits:
- [CJM journey gaps (G1…G10)](../../.planning/qa-audit/2026-05-16-cjm-coverage.md)
- [Test-layering gaps (L1…L8)](../../.planning/qa-audit/2026-05-16-test-layering.md)

---

## At a glance

- **44 `@cjm-*` scenarios** wired across 14 `.feature` files.
- **26 GREEN** runnable in CI today.
- **14 `@expected-red`** waiting on a named phase.
- **4 `@after-docker-up`** runtime-gated (GHA-only).
- **10 user journeys** have NO `@cjm-*` tag at all — see `G1…G10` below.

---

## Currently RED scenarios (will flip GREEN when their phase ships)

| Tag | Title | File | Phase that flips it |
|---|---|---|---|
| `@cjm-1.4` | Locale-scoped error copy (RU) | `signup-verify.feature:27` | Phase 19.3 (Better Auth i18n) |
| `@cjm-3.1` | Password-reset happy path | `password-reset.feature:6` | Phase 19.1 (reset-mail wiring) |
| `@cjm-4.1` | Audio multipart → response shape | `transcribe.feature:6` | Phase 19.2 (mock-litellm STT overlay) |
| `@cjm-6.1` | en↔ru cookie persistence | `locale-switch.feature:6` | Phase 19.4 (locale e2e + web in CJM stack) |
| `@cjm-sso-1.1`…`1.6` (6 scenarios) | Keycloak SSO journeys | `sso/keycloak-oidc.feature` | Phase 19 (v3 deferred) |
| `@cjm-traefik-host-split{,−web}` | Host-split routing | `traefik-host-split.feature` | GHA first run (operator deferred) |
| `@cjm-tls-trusted-localhost` | mkcert cert trusted | `phase17-tls.feature:14` | GHA first run |
| `@cjm-tls-no-dev-ca-in-traefik-image` | Traefik image scan | `phase17-tls.feature:25` | GHA first run |
| `@cjm-tls-acme-staging` | ACME staging cert | `phase17-tls.feature:32` | GHA first run |

If the phase ships and the scenario does NOT flip, that is a regression — open an issue.

---

## End-user journeys with NO `@cjm-*` coverage (gap list)

| # | Journey | Wire surface | Where to add | Suggested tag |
|---|---|---|---|---|
| G1 | LiteLLM virtual-key rotation | `POST /api/admin/tenants/:id/keys/rotate` | `features/byok-key-rotation.feature` | `@cjm-byok-rotation.1` |
| G2 | Per-tenant STT/LLM override via settings | `PUT /api/settings/{stt,llm}` | `features/tenant-settings-override.feature` | `@cjm-9.*` |
| G3 | Diarization round-trip | REMOVED — server-side diarization removed (Quick 260606-g90); diarization is client-local (sherpa-onnx). No server wire surface. | — | — |
| G4 | Realtime streaming user journey | `WSS /v1/realtime` | `features/realtime-stream.feature` | `@cjm-11.*` |
| G5 | Agent stream NDJSON wire shape | `POST /api/agent/stream` | `features/agent-stream.feature` | `@cjm-12.*` |
| G6 | Web-search (Tavily/Yandex via mock) | `POST /api/agent/web-search` | `features/web-search.feature` | `@cjm-13.*` |
| G7 | Session refresh / `set-auth-token` rotation | Better Auth refresh path | `features/session-refresh.feature` | `@cjm-14.*` |
| G8 | Cross-tenant RLS rejection (non-SSO) | Any tenant-scoped GET | `features/rls-cross-tenant.feature` | `@cjm-15.*` |
| G9 | Transcribe via corporate `LITELLM_BASE_URL` override | `POST /api/transcribe` w/ env override | `features/byok-corporate-litellm.feature` | `@cjm-byok-litellm.1` |
| G10 | Billing / subscription | TBD | (deferred to v3) | `@cjm-billing-*` |

Each row has a ready-to-use Gherkin scaffold in the [CJM coverage audit doc](../../.planning/qa-audit/2026-05-16-cjm-coverage.md).

---

## Test-layering gaps (not journey-shaped, but worth knowing)

| ID | Severity | What is missing |
|---|---|---|
| L1 | HIGH | `make smoke` target + `tests/smoke/` synthetic probes between `up --wait` and full e2e |
| L2 | HIGH | BYOK provider-matrix integration test (8 permutations × 4 providers) |
| L3 | MEDIUM | PR-time load smoke (k6 mock-provider, ≤2 min) |
| L4 | LOW | Consolidate `vitest.config.ts` + `vitest.e2e.config.ts` |
| L5 | LOW | Self-test that asserts testcontainers cleanup |
| L6 | MEDIUM | Self-test that diffs SSO step strings against the feature file |
| L7 | LOW | Promote SR-19a.4 to a phase; drop `compose-overrides.yml` worker S3 patch |
| L8 | MEDIUM | Weekly staleness alert for `@expected-red` scenarios past their phase ETA |

Full proposed fixes in the [test-layering audit doc](../../.planning/qa-audit/2026-05-16-test-layering.md).

---

## Rules of engagement for the next agent

1. **Negative twin is mandatory.** Every happy-path scenario MUST ship with at least one negative twin in the same feature file.
2. **Step bindings need unit tests.** Every new `steps/*.steps.ts` adds a vitest unit test in `steps/__tests__/` that mocks the HTTP boundary. No exceptions.
3. **No `retries: 0` bypass.** Flake is a bug; never raise `retries`.
4. **Doc anchor + Gherkin tag in lockstep.** Adding `@cjm-X.Y` without an anchor in `docs/customer-journeys.md` will fail `tools/lint-cjm-doc.ts`.
5. **No paid-provider calls in PR-time tests.** Mock LiteLLM upstreams; gate any live variant behind `OPENWHISPR_LOADTEST_ALLOW_PAID`.

---

_Generated 2026-05-16 by QA audit pass. Re-run the audit when scenario count drifts > 10% or any HIGH-severity layering gap closes._
