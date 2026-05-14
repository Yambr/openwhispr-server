# OpenWhispr Server

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Languages](https://img.shields.io/badge/languages-en%20%7C%20ru-brightgreen.svg)](./docs/i18n.md)
[![CI](https://github.com/openwhispr/openwhispr-server/actions/workflows/ci.yml/badge.svg)](https://github.com/openwhispr/openwhispr-server/actions/workflows/ci.yml)
[![Security](https://github.com/openwhispr/openwhispr-server/actions/workflows/security.yml/badge.svg)](https://github.com/openwhispr/openwhispr-server/actions/workflows/security.yml)

A drop-in OpenWhispr backend any organization can self-host — open-source
out of the box, corporate-LiteLLM-ready by env override.

> **Status: Phase 10 (i18n, docs, OSS housekeeping).** Wire surface
> (Phase 2-5), operational substrate (Phase 6-7), load-test + SLOs
> (Phase 8), Helm chart (Phase 9), and server-side + web-side i18n
> (Phase 10 / 10-01..02) are all in place. This release closes the
> documentation suite (DOCS-01..06).

## Quickstart — < 5 minutes from clone to first transcription

The canonical operator entrypoint is **Variant A** (embedded LiteLLM Proxy,
hosted providers via `.env` API keys). See [`examples/README.md`](./examples/README.md)
for the full variant matrix.

```bash
# 1. Clone and configure for Variant A.
git clone https://github.com/openwhispr/openwhispr-server.git
cd openwhispr-server
cp .env.embedded.example .env

# 2. Fill in at least one provider key.
#    Variant A routes /api/transcribe via the embedded LiteLLM to a public
#    provider. The cheapest path is GROQ_API_KEY (Whisper-large-v3).
$EDITOR .env   # set every REPLACE_ME including BETTER_AUTH_SECRET and at least one provider key

# 3. Bring the Variant A stack up (canonical default per Plan 11-01).
docker compose -f compose/docker-compose.embedded-litellm.yml up -d
docker compose -f compose/docker-compose.embedded-litellm.yml ps   # confirm api, worker, postgres, valkey, litellm are healthy

# 4. Register a user and verify (dev profile uses mailpit for verification email).
curl -fsS -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"correct-horse-battery-staple","name":"Demo"}'

# Open mailpit at http://localhost:8025 and click the verification link
# (the link 302s to /api/auth/verify-email and sets the session cookie).

# 5. Sign in and capture the bearer token (saved in cookie + set-auth-token header).
curl -fsS -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -c /tmp/owc.cookies \
  -D /tmp/owc.headers \
  -d '{"email":"you@example.com","password":"correct-horse-battery-staple"}'
TOKEN=$(grep -oE 'set-auth-token: [^[:space:]]+' /tmp/owc.headers | cut -d' ' -f2 | tr -d '\r')

# 6. Transcribe a sample WAV.
curl -fsS -X POST http://localhost:3000/api/transcribe \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./tests/fixtures/audio/sample.wav" \
  | jq .
# expect: { "text": "...", "language": "en", "duration_s": ... }
```

End-to-end, from clone to a 200 response on `/api/transcribe`, on a
laptop with a warm Docker cache: under five minutes.

If you need the full enterprise topology (Kubernetes HA, CloudNativePG,
distributed MinIO, Mimir + Tempo + Loki), see [`docs/operations.md`](./docs/operations.md)
and the Helm chart at `charts/openwhispr/`.

## Provider keys

The bundled-default topology calls public providers via the LiteLLM
proxy. Drop real keys into your `.env` to enable each surface; missing
keys produce a `503` envelope on the corresponding endpoint (the
realtime WSS upgrade closes with an error frame when `OPENAI_API_KEY`
is unset).

| Env var              | Used by                                                                                                                  | Where to get a key                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `OPENROUTER_API_KEY` | Chat / reasoning via `/api/reason` (D-06 default `qwen3.6-plus`, D-10 fallback)                                          | <https://openrouter.ai/keys>                        |
| `GROQ_API_KEY`       | Whisper-large-v3 STT via `/api/transcribe` (D-11 — fastest hosted Whisper)                                               | <https://console.groq.com/keys>                     |
| `OPENAI_API_KEY`     | Realtime WSS direct via `WSS /v1/realtime` (D-12 — `gpt-realtime` GA)                                                    | <https://platform.openai.com/api-keys>              |
| `PYANNOTE_API_KEY`   | Diarization via `/v1/audio/diarization` (D-07 REVISED — consumed by the Fastify route, **NOT** the LiteLLM container)    | <https://dashboard.pyannote.ai/>                    |

Corporate operators set `LITELLM_BASE_URL=https://litellm.corp.example.com`
instead of pasting individual provider keys; the corporate proxy holds
the credentials. See [`docs/litellm-target-spec.md`](./docs/litellm-target-spec.md)
"Corporate-Override Configuration" for the full setup.

## Languages

OpenWhispr Server ships English (`en`, default) and Russian (`ru`)
runtime locales. Operators can mount additional locale bundles at
runtime via `LOCALES_DIR` without rebuilding the image. See
[`docs/i18n.md`](./docs/i18n.md) for the operator guide.

Source artifacts are English-only (code, comments, identifiers, logs,
commit messages). Translations live exclusively in `apps/*/locales/`
bundles and are mechanically enforced by `tools/lint-english.ts`.

## Testing modes

| Target                | Network                          | Quota cost   | When to run                                                      |
| --------------------- | -------------------------------- | ------------ | ---------------------------------------------------------------- |
| `make test`           | none (vitest + stryker)          | none         | Every commit; covers unit + property + mutation slices.          |
| `make contract-test`  | local docker only                | none         | Hermetic CI default. Uses LiteLLM `mock_response` + `MOCK_DIARIZATION=true`. See [docs/litellm-mock-mode.md](./docs/litellm-mock-mode.md). |
| `make e2e-test`       | real provider APIs               | real money   | Requires `.env.e2e` with `OPENROUTER_API_KEY` + `GROQ_API_KEY` + `OPENAI_API_KEY` + `PYANNOTE_API_KEY`. Operator-driven cadence (NOT every PR). See [.env.e2e.example](./.env.e2e.example). |
| `make load-test`      | profile-driven (mock / Speaches) | none (mock) / GPU host (Speaches) | Phase 8 load harness; smoke vs baseline vs plateau. See [docs/operations.md](./docs/operations.md). |

## Documentation

Operator and contributor entry points:

- [`docs/architecture.md`](./docs/architecture.md) — components, hot-path
  sequence diagrams, RLS chokepoint, BullMQ topology
- [`docs/operations.md`](./docs/operations.md) — operator runbooks
  (deploy, upgrade, scale, restore, i18n volume mount, troubleshooting)
- [`docs/i18n.md`](./docs/i18n.md) — operator i18n guide
  (LOCALES_DIR, adding a locale, CLDR plurals, audit-log English-only)
- [`docs/security.md`](./docs/security.md) — SSRF gate, secret loading,
  pino redact policy, rate-limit topology, audit-log threat model,
  consolidated threat-ID registry
- [`docs/auth.md`](./docs/auth.md) — Better Auth, dual auth (cookie +
  bearer), channel-scheme echo, token rotation overlap, `users.locale`
- [`docs/wire-contract.md`](./docs/wire-contract.md) — v1 wire surface
  (Phase 2-5 routes), v2-deferred routes, known v1 limitations
- [`docs/litellm-target-spec.md`](./docs/litellm-target-spec.md) —
  bundled-default LiteLLM + corporate-override env path
- [`docs/conventions.md`](./docs/conventions.md) — envelope shape,
  error codes, conventional commits, English-only source rule
- [`docs/self-hosting.md`](./docs/self-hosting.md) — single-VM
  self-hosting overview
- [`docs/observability.md`](./docs/observability.md) — OTel SDK,
  Collector, Tempo + Mimir + Loki + Grafana (LGTM)
- [`docs/oidc-operator-config.md`](./docs/oidc-operator-config.md) —
  per-IdP walkthroughs (Keycloak, Authentik, Google, Azure AD, Okta)
- [`docs/channel-scheme-override.md`](./docs/channel-scheme-override.md)
  — channel-scheme allow-list and `OPENWHISPR_PROTOCOL` override
- [`docs/storage.md`](./docs/storage.md) — Postgres tenant isolation,
  MinIO, WAL archive
- [`docs/litellm-mock-mode.md`](./docs/litellm-mock-mode.md) — hermetic
  contract-test mock mode
- [`docs/wire-contracts-phase-3.md`](./docs/wire-contracts-phase-3.md)
  — desktop wire shape for the AI endpoints

## Constitutional rules

Every PR enforces:

1. **Strict TDD** — tests precede production code. PR template +
   advisory commit-order check.
2. **GitHub Actions CI** must be green before any merge to `main`.
3. **English only** for source artifacts (docs, code, comments,
   identifiers, log keys, commit messages). Mechanically enforced via
   `tools/lint-english.ts`.
4. **Coverage gate** >= 90% lines / branches / functions / statements
   on new and modified code.
5. **Mutation gate** (Stryker) on auth, multi-tenancy, virtual-key
   modules.
6. **No plaintext HTTP** on any externally reachable port.
7. **No mocks of internal logic** — mocks allowed only at process /
   network boundaries (third-party SaaS HTTP, OS time, filesystem).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for dev environment setup,
TDD discipline, Conventional Commits, and the English-only rule.

Architecture Decision Records live in [`docs/adrs/`](./docs/adrs/).

For vulnerability reports see [`SECURITY.md`](./SECURITY.md).
Community conduct is governed by
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) (Contributor Covenant 2.1).

## Project goals

OpenWhispr Server exists to give any organization a deployable,
production-grade backend for the OpenWhispr Electron desktop client
without forcing a SaaS dependency. The constraints that shape the
architecture are:

- **Wire compatibility byte-for-byte** with upstream `BACKEND_SPEC.md`
  / `SELF_HOSTING.md` / `OAUTH_SPEC.md` (1556 lines of authoritative
  spec). Every endpoint, status code, error envelope, NDJSON chunk
  vocabulary, and channel-scheme echo matches.
- **1000 concurrent active users in a single installation** validated
  by the Phase 8 load harness against published p95 SLO budgets.
- **Drop-in corporate-LiteLLM override** so an org's existing internal
  LLM gateway (Bedrock proxy, vLLM, internal LiteLLM) replaces the
  bundled proxy with a single env var, no code changes.
- **Open source end-to-end** — no closed subsystems, no required SaaS.

## Tech stack (quick scan)

| Layer            | Pick                                              |
| ---------------- | ------------------------------------------------- |
| Runtime          | Node.js 24 LTS                                    |
| HTTP framework   | Fastify 5                                         |
| Auth library     | Better Auth 1.x (Bearer + JWT + OAuth plugins)    |
| Database         | PostgreSQL 17 (CloudNativePG 1.29 on K8s)         |
| Schema / ORM     | Drizzle ORM + drizzle-kit                         |
| Pooler           | PgBouncer 1.23+ transaction mode                  |
| Cache / queue substrate | Valkey 8.x (Redis 7.4-compatible)          |
| Job queue        | BullMQ                                            |
| LLM gateway      | LiteLLM Proxy v1.83.7-stable+                     |
| Object storage   | MinIO (S3-compatible)                             |
| Observability    | OTel SDK -> Collector -> Tempo + Mimir + Loki + Grafana |
| Ingress (K8s)    | Traefik 3                                         |
| Web              | Next.js 15 (App Router) + React 19 + Tailwind 4   |

Full rationale, alternatives, and version compatibility matrix in
[`CLAUDE.md`](./CLAUDE.md) and `.planning/research/STACK.md`.

## License

Apache-2.0 with explicit patent grant. See [`LICENSE`](./LICENSE) and
[`NOTICE`](./NOTICE).
